import type {
  IEnrollmentRepository,
  IEventRepository,
  IMissionEvidenceRepository,
  IMissionParticipationRepository,
  IMissionRepository,
  ITopicNodeRepository,
  IUserGroupRepository,
} from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';
import type {
  DashboardMissionEntry,
  MissionEnrollmentView,
  MissionStepView,
} from '@arenaquest/shared/types/dashboard';
import type {
  Mission,
  MissionEnrollment,
  MissionRequirement,
} from '@arenaquest/shared/domain/mission';
import {
  instantMs,
  isMissionStaff,
  type MissionEvaluator,
} from '@arenaquest/shared/domain/gamification/mission-evaluator';
import type { BadgeEngine } from '@arenaquest/shared/domain/gamification/badge-engine';
import {
  REQUIREMENTS_PREDICATE_KIND,
  targetCountOf,
} from '@arenaquest/shared/domain/missions/requirements';
import { Entities } from '@arenaquest/shared/types/entities';

/**
 * The student side of missions (RFC 0022 §5, §6, §8; M27 Task 07).
 *
 * Invariants:
 * - **Reads never write.** `getMissions` / `getMission` create no enrollment and no
 *   progress row: an `auto` (or covered `assigned`) mission without a row is shown with
 *   an implicit enrollment and steps computed read-only against a synthetic enrollment
 *   that counts from the mission start. Only `join`, `leave` and `check` write.
 * - **Gate reuse.** Topic accessibility is the enrollment repository's effective access
 *   set (staff bypass it, as in the catalog) plus published and not archived; event
 *   visibility is the event repository's audience rule. Neither is re-implemented.
 * - **404 on every miss.** A mission the caller cannot see — inactive, a gated-out
 *   `auto`, an `assigned` mission the caller is not in — answers 404 on detail, join,
 *   leave and check. The list teaser is the only disclosure of an `assigned` mission to
 *   a non-member: title and audience group names, nothing else.
 */

export interface MissionCaller {
  userId: string;
  roles: readonly string[];
}

export interface MeMissionsDeps {
  missions: IMissionRepository;
  participation: IMissionParticipationRepository;
  evidence: IMissionEvidenceRepository;
  /** Step states and the manual check. Always wired by `buildContainer`. */
  evaluator?: MissionEvaluator;
  /** Runs the `mission_completed` badge rule after a check completed a mission. */
  badgeEngine?: BadgeEngine;
  topics: ITopicNodeRepository;
  enrollment: IEnrollmentRepository;
  events: IEventRepository;
  userGroups: IUserGroupRepository;
  /** `SUBMISSIONS_SHARING_ENABLED`: gates `shared_only` submission steps when counting. */
  sharingEnabled: boolean;
}

export interface JoinResult {
  /** false when the caller was already actively enrolled (the route answers 200, not 201). */
  created: boolean;
  entry: DashboardMissionEntry;
}

export interface CheckStepResult {
  step: MissionStepView;
  mission: DashboardMissionEntry;
}

type Err = { ok: false; status: number; error: string };

const NOT_FOUND: Err = { ok: false, status: 404, error: 'NotFound' };
const NOT_JOINABLE: Err = { ok: false, status: 409, error: 'MISSION_NOT_JOINABLE' };
const CLOSED: Err = { ok: false, status: 409, error: 'MISSION_CLOSED' };
const NOT_LEAVABLE: Err = { ok: false, status: 409, error: 'MISSION_NOT_LEAVABLE' };
const STEP_LOCKED: Err = { ok: false, status: 409, error: 'MISSION_STEP_LOCKED' };
const EVALUATOR_UNAVAILABLE: Err = { ok: false, status: 500, error: 'MISSION_EVALUATOR_UNAVAILABLE' };

/**
 * How one requirements mission relates to the caller.
 * - `participating`: an active row, or the implicit enrollment the policy grants
 *   (`auto` passing the gate, `assigned` covering the caller) — `enrollment` is then
 *   synthetic and nothing is written.
 * - `open`: an `open` mission the caller is not (or no longer) in; `preview` is the
 *   enrollment a Join would give (a left row keeps its `countsFrom`).
 * - `teaser`: an `assigned` mission the caller is not in.
 * - `hidden`: a gated-out or staff `auto` mission, or a left `auto` row.
 */
type Resolution =
  | { kind: 'participating'; enrollment: MissionEnrollment; view: MissionEnrollmentView }
  | { kind: 'open'; preview: MissionEnrollment }
  | { kind: 'teaser' }
  | { kind: 'hidden' };

type StepTarget = MissionStepView['target'];

const REDACTED_TOPIC: StepTarget = { type: 'topic', topicId: null, title: null, accessible: false };
const REDACTED_EVENT: StepTarget = { type: 'event', slug: null, title: null, startsAt: null };

/**
 * Per-request memo of the caller-scoped reads, so a list of missions sharing topics,
 * events or groups asks each port once.
 */
class ReadScope {
  private accessible?: Promise<Set<string>>;
  private readonly topicTargets = new Map<string, Promise<StepTarget>>();
  private readonly eventTargets = new Map<string, Promise<StepTarget>>();
  private readonly groupMembers = new Map<string, Promise<boolean>>();

  constructor(
    private readonly deps: MeMissionsDeps,
    readonly caller: MissionCaller,
    readonly now: Date,
  ) {}

  get isStaff(): boolean {
    return isMissionStaff(this.caller.roles);
  }

  get nowIso(): string {
    return this.now.toISOString();
  }

  accessibleTopicIds(): Promise<Set<string>> {
    this.accessible ??= this.deps.enrollment
      .getEffectiveAccessTopicIds(this.caller.userId)
      .then((ids) => new Set(ids));
    return this.accessible;
  }

  isGroupMember(groupId: string): Promise<boolean> {
    return this.memo(this.groupMembers, groupId, async () => {
      const members = await this.deps.userGroups.listMembers(groupId);
      return members.some((member) => member.userId === this.caller.userId);
    });
  }

  /** The catalog gate: published, not archived and (unless staff) in the effective access set. */
  topicTarget(topicId: string): Promise<StepTarget> {
    return this.memo(this.topicTargets, topicId, async () => {
      const topic = await this.deps.topics.findById(topicId);
      if (!topic || topic.status !== Entities.Config.TopicNodeStatus.PUBLISHED || topic.archived) {
        return REDACTED_TOPIC;
      }
      if (!this.isStaff && !(await this.accessibleTopicIds()).has(topicId)) return REDACTED_TOPIC;
      return { type: 'topic', topicId, title: topic.title, accessible: true };
    });
  }

  /** The events audience rule, through the repository's own visible-by-slug read. */
  eventTarget(eventId: string): Promise<StepTarget> {
    return this.memo(this.eventTargets, eventId, async () => {
      const event = await this.deps.events.findById(eventId);
      if (!event) return REDACTED_EVENT;
      const visible = await this.deps.events.findVisibleBySlug(event.slug, { viewerUserId: this.caller.userId });
      if (!visible) return REDACTED_EVENT;
      return {
        type: 'event',
        slug: visible.slug,
        title: visible.title,
        startsAt: new Date(visible.startsAt).toISOString(),
      };
    });
  }

  private memo<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
    let pending = cache.get(key);
    if (!pending) {
      pending = load();
      cache.set(key, pending);
    }
    return pending;
  }
}

const isRequirementsMission = (mission: Mission): boolean =>
  mission.predicateKind === REQUIREMENTS_PREDICATE_KIND;

const isInWindow = (mission: Mission, now: Date): boolean => {
  const nowMs = now.getTime();
  return instantMs(mission.startAt) <= nowMs && nowMs <= instantMs(mission.endAt);
};

/** A synthetic, never persisted enrollment. */
const syntheticEnrollment = (
  mission: Mission,
  userId: string,
  source: MissionEnrollment['source'],
  countsFrom: string,
): MissionEnrollment => ({
  missionId: mission.id,
  userId,
  source,
  joinedAt: countsFrom,
  countsFrom,
  leftAt: null,
});

/** A teaser discloses only `id` and `title`; the other fields carry neutral values. */
const teaserMission = (mission: Mission): Mission => ({
  ...mission,
  description: '',
  xpReward: 0,
  badgeId: null,
});

export class MeMissionsController {
  constructor(private readonly deps: MeMissionsDeps) {}

  // -------------------------------------------------------------------------
  // Reads (never write)
  // -------------------------------------------------------------------------

  /**
   * Active, in-window missions for the caller: enrolled (or implicitly enrolled),
   * joinable `open` missions, locked teasers of `assigned` missions, and legacy missions
   * with `steps: []`. `null` when there is no entry at all.
   */
  async getMissions(caller: MissionCaller, now: Date): Promise<ControllerResult<DashboardMissionEntry[] | null>> {
    const nowIso = now.toISOString();
    const [requirementMissions, legacyMissions] = await Promise.all([
      this.deps.missions.listActiveRequirementMissions(nowIso),
      this.deps.missions.listActiveLegacyMissions(nowIso),
    ]);
    if (requirementMissions.length > 0 && !this.deps.evaluator) return EVALUATOR_UNAVAILABLE;

    // Same order as the repository reads: by end of window, then id.
    const missions = [...requirementMissions, ...legacyMissions].sort(
      (a, b) => instantMs(a.endAt) - instantMs(b.endAt) || a.id.localeCompare(b.id),
    );

    const scope = new ReadScope(this.deps, caller, now);
    const entries: DashboardMissionEntry[] = [];
    for (const mission of missions) {
      const entry = await this.entryFor(mission, scope);
      if (entry) entries.push(entry);
    }
    return { ok: true, data: entries.length > 0 ? entries : null };
  }

  /** One mission with its steps (the mission page); 404 for a teaser or anything the list omits. */
  async getMission(
    caller: MissionCaller,
    missionId: string,
    now: Date,
  ): Promise<ControllerResult<DashboardMissionEntry>> {
    const mission = await this.deps.missions.findById(missionId);
    if (!mission || !mission.active || !isInWindow(mission, now)) return NOT_FOUND;
    if (isRequirementsMission(mission) && !this.deps.evaluator) return EVALUATOR_UNAVAILABLE;

    const entry = await this.entryFor(mission, new ReadScope(this.deps, caller, now));
    if (!entry || entry.locked) return NOT_FOUND;
    return { ok: true, data: entry };
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  /**
   * Joins an `open` mission inside its window as `self`, counting from now. A rejoin
   * after Leave keeps the first `countsFrom` (the repository's rule).
   */
  async join(caller: MissionCaller, missionId: string, now: Date): Promise<ControllerResult<JoinResult>> {
    if (!this.deps.evaluator) return EVALUATOR_UNAVAILABLE;
    const visible = await this.visibleMission(caller, missionId, now);
    if (!visible) return NOT_FOUND;
    const { mission, requirements, resolution } = visible;

    if (mission.enrollmentMode !== 'open') return NOT_JOINABLE;
    if (!isInWindow(mission, now)) return CLOSED;

    const created = resolution.kind !== 'participating';
    if (created) await this.deps.participation.join(mission.id, caller.userId, now.toISOString());

    const entry = await this.freshEntry(mission, requirements, caller, now);
    if (!entry) return NOT_FOUND;
    return { ok: true, data: { created, entry } };
  }

  /** Leaves a `self` enrollment: sets `leftAt`; completed steps and rewards stay. */
  async leave(caller: MissionCaller, missionId: string, now: Date): Promise<ControllerResult<null>> {
    const visible = await this.visibleMission(caller, missionId, now);
    if (!visible || visible.resolution.kind !== 'participating') return NOT_FOUND;
    const { enrollment, view } = visible.resolution;
    if (view.implicit || enrollment.source !== 'self') return NOT_LEAVABLE;

    await this.deps.participation.leave(missionId, caller.userId, now.toISOString());
    return { ok: true, data: null };
  }

  /**
   * Ticks a `manual_check` step: the evaluator sets `checkedAt` once and evaluates the
   * enrollment in the same call (creating the implicit enrollment the policy grants —
   * a write, on a POST). A second tick is idempotent and answers the current step.
   */
  async check(
    caller: MissionCaller,
    missionId: string,
    requirementId: string,
    now: Date,
  ): Promise<ControllerResult<CheckStepResult>> {
    const evaluator = this.deps.evaluator;
    if (!evaluator) return EVALUATOR_UNAVAILABLE;

    const visible = await this.visibleMission(caller, missionId, now);
    if (!visible || visible.resolution.kind !== 'participating') return NOT_FOUND;
    const requirement = visible.requirements.find((r) => r.id === requirementId);
    if (!requirement || requirement.kind !== 'manual_check') return NOT_FOUND;

    const result = await evaluator.check(caller.userId, missionId, requirementId, now);
    if (!result.ok) {
      if (result.reason === 'mission_closed') return CLOSED;
      if (result.reason === 'step_locked') return STEP_LOCKED;
      // `already_completed` is the idempotent second tick: answer the current step.
      if (result.reason !== 'already_completed') return NOT_FOUND;
    } else if (result.outcome.missionsCompleted.length > 0) {
      await this.runBadgeRule(caller.userId, missionId, now);
    }

    const entry = await this.freshEntry(visible.mission, visible.requirements, caller, now);
    const step = entry?.steps?.find((s) => s.id === requirementId);
    if (!entry || !step) return NOT_FOUND;
    return { ok: true, data: { step, mission: entry } };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * An active requirements mission the caller may act on (participating or `open`),
   * whatever its window — the window answers `409 MISSION_CLOSED`, not 404.
   */
  private async visibleMission(
    caller: MissionCaller,
    missionId: string,
    now: Date,
  ): Promise<{ mission: Mission; requirements: MissionRequirement[]; resolution: Resolution } | null> {
    const mission = await this.deps.missions.findById(missionId);
    if (!mission || !mission.active || !isRequirementsMission(mission)) return null;
    const requirements = await this.deps.missions.listRequirements(mission.id);
    const resolution = await this.resolve(mission, requirements, new ReadScope(this.deps, caller, now));
    if (resolution.kind === 'teaser' || resolution.kind === 'hidden') return null;
    return { mission, requirements, resolution };
  }

  /** The entry as it stands after a write. */
  private async freshEntry(
    mission: Mission,
    requirements: MissionRequirement[],
    caller: MissionCaller,
    now: Date,
  ): Promise<DashboardMissionEntry | null> {
    const scope = new ReadScope(this.deps, caller, now);
    return this.buildEntry(mission, requirements, await this.resolve(mission, requirements, scope), scope);
  }

  private async entryFor(mission: Mission, scope: ReadScope): Promise<DashboardMissionEntry | null> {
    if (!isRequirementsMission(mission)) {
      return {
        mission,
        progress: await this.deps.missions.findProgress(scope.caller.userId, mission.id),
        enrollment: null,
        joinable: false,
        locked: null,
        steps: [],
      };
    }
    const requirements = await this.deps.missions.listRequirements(mission.id);
    return this.buildEntry(mission, requirements, await this.resolve(mission, requirements, scope), scope);
  }

  /** The enrollment policy of RFC 0022 §5, read-only. */
  private async resolve(
    mission: Mission,
    requirements: MissionRequirement[],
    scope: ReadScope,
  ): Promise<Resolution> {
    const userId = scope.caller.userId;
    const row = await this.deps.participation.findEnrollment(mission.id, userId);
    if (row && row.leftAt === null) {
      return {
        kind: 'participating',
        enrollment: row,
        view: { source: row.source, joinedAt: row.joinedAt, implicit: false },
      };
    }

    switch (mission.enrollmentMode) {
      case 'open':
        // A left `self` row keeps its countsFrom on rejoin, so the preview uses it.
        return {
          kind: 'open',
          preview: syntheticEnrollment(mission, userId, 'self', row?.countsFrom ?? scope.nowIso),
        };

      case 'auto': {
        // The policy never re-creates a left row, and staff are never enrolled implicitly.
        if (row || scope.isStaff) return { kind: 'hidden' };
        const accessible = await scope.accessibleTopicIds();
        if (requirements.some((r) => r.topicId !== null && !accessible.has(r.topicId))) {
          return { kind: 'hidden' };
        }
        return {
          kind: 'participating',
          enrollment: syntheticEnrollment(mission, userId, 'auto', mission.startAt),
          view: { source: 'auto', joinedAt: null, implicit: true },
        };
      }

      case 'assigned': {
        // A left row means the audience no longer covers the caller.
        if (row) return { kind: 'teaser' };
        const audience = await this.deps.missions.getAudience(mission.id);
        let covered = audience.userIds.includes(userId);
        for (const groupId of audience.groupIds) {
          if (covered) break;
          covered = await scope.isGroupMember(groupId);
        }
        if (!covered) return { kind: 'teaser' };
        return {
          kind: 'participating',
          enrollment: syntheticEnrollment(mission, userId, 'admin', mission.startAt),
          view: { source: 'admin', joinedAt: null, implicit: true },
        };
      }
    }
  }

  private async buildEntry(
    mission: Mission,
    requirements: MissionRequirement[],
    resolution: Resolution,
    scope: ReadScope,
  ): Promise<DashboardMissionEntry | null> {
    const userId = scope.caller.userId;
    switch (resolution.kind) {
      case 'hidden':
        return null;

      case 'teaser': {
        const audience = await this.deps.missions.getAudience(mission.id);
        const groups = await Promise.all(audience.groupIds.map((id) => this.deps.userGroups.getById(id)));
        return {
          mission: teaserMission(mission),
          progress: null,
          enrollment: null,
          joinable: false,
          locked: {
            reason: 'assigned',
            groups: groups.flatMap((group) => (group ? [group.name] : [])),
          },
          steps: [],
        };
      }

      case 'participating':
        return {
          mission,
          progress: await this.deps.missions.findProgress(userId, mission.id),
          enrollment: resolution.view,
          joinable: false,
          locked: null,
          // Only a real row is in the evidence scope; an implicit one has nothing counted yet.
          steps: await this.buildSteps(mission, requirements, resolution.enrollment, !resolution.view.implicit, scope),
        };

      case 'open':
        return {
          mission,
          progress: await this.deps.missions.findProgress(userId, mission.id),
          enrollment: null,
          joinable: isInWindow(mission, scope.now),
          locked: null,
          steps: await this.buildSteps(mission, requirements, resolution.preview, false, scope),
        };
    }
  }

  /**
   * Steps in position order. `countable` — the enrollment is a real active row, so an
   * open step without a progress row is counted read-only through the evidence port.
   */
  private async buildSteps(
    mission: Mission,
    requirements: MissionRequirement[],
    enrollment: MissionEnrollment,
    countable: boolean,
    scope: ReadScope,
  ): Promise<MissionStepView[]> {
    const evaluator = this.deps.evaluator;
    if (!evaluator) return [];
    const ordered = [...requirements].sort((a, b) => a.position - b.position);
    const progress = await this.deps.participation.listStepProgress(mission.id, scope.caller.userId);
    const progressById = new Map(progress.map((p) => [p.requirementId, p]));

    const steps: MissionStepView[] = [];
    for (let index = 0; index < ordered.length; index++) {
      const requirement = ordered[index];
      const row = progressById.get(requirement.id);
      const state = evaluator.stepState(mission, ordered, progressById, enrollment, requirement, scope.now);
      const required = targetCountOf(requirement);

      let current = 0;
      if (state === 'completed') {
        current = required;
      } else if (requirement.kind === 'manual_check') {
        current = row?.checkedAt ? 1 : 0;
      } else if (row) {
        current = row.currentCount;
      } else if (state === 'open' && countable) {
        const [count] = await this.deps.evidence.countForRequirement({
          mission,
          requirement,
          previousRequirementId: mission.mode === 'sequential' && index > 0 ? ordered[index - 1].id : null,
          userId: scope.caller.userId,
          nowIso: scope.nowIso,
          sharingEnabled: this.deps.sharingEnabled,
        });
        current = Math.min(count?.count ?? 0, required);
      }

      let target: StepTarget = null;
      if (requirement.topicId !== null) target = await scope.topicTarget(requirement.topicId);
      else if (requirement.eventId !== null) target = await scope.eventTarget(requirement.eventId);

      steps.push({
        id: requirement.id,
        position: requirement.position,
        kind: requirement.kind,
        title: requirement.title,
        xpReward: requirement.xpReward,
        target,
        instructions:
          requirement.kind === 'manual_check'
            ? ((requirement.params as { instructions?: string } | null)?.instructions ?? '')
            : null,
        current,
        required,
        state,
        completedAt: row?.completedAt ?? null,
      });
    }
    return steps;
  }

  /** Best-effort, like the hook runner: a badge failure never fails the tick. Logs ids only. */
  private async runBadgeRule(userId: string, missionId: string, now: Date): Promise<void> {
    if (!this.deps.badgeEngine) return;
    try {
      await this.deps.badgeEngine.evaluate(userId, now);
    } catch (err) {
      console.error('[mission] badge rule after manual check failed', {
        userId,
        missionId,
        error: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }
}
