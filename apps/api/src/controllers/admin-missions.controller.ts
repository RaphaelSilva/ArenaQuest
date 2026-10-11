import type { z } from 'zod';
import type {
  IBadgeRepository,
  IEventChargeRepository,
  IEventRepository,
  IMediaRepository,
  IMissionParticipationRepository,
  IMissionRepository,
  ITopicNodeRepository,
  IUserGroupRepository,
  IUserRepository,
  MissionAudience,
  TopicNodeRecord,
} from '@arenaquest/shared/ports';
import type {
  Mission,
  MissionEnrollment,
  MissionRequirement,
  MissionRequirementProgress,
} from '@arenaquest/shared/domain/mission';
import {
  REQUIREMENTS_PREDICATE_KIND,
  type RequirementInput,
} from '@arenaquest/shared/domain/missions/requirements';
import { Entities } from '@arenaquest/shared/types/entities';
import type { MissionEvaluator } from '@arenaquest/shared/domain/gamification/mission-evaluator';
import type { ControllerResult } from '@api/core/result';
import { reconcileOneMission, type ReconcileRunReport } from '@api/jobs/reconcile-missions';
import type {
  MissionCreateBodySchema,
  MissionPatchBodySchema,
  MissionAudienceSchema,
} from '@api/openapi/components/entities';

export type MissionCreateBody = z.output<typeof MissionCreateBodySchema>;
export type MissionPatchBody = z.output<typeof MissionPatchBodySchema>;
export type MissionAudienceBody = z.output<typeof MissionAudienceSchema>;

/** Page size of the participants listing. */
export const PARTICIPANTS_PAGE_SIZE = 50;

/** Fields frozen once `now >= startAt` (RFC 0022 §6, "Locked after start"). */
const START_LOCKED_FIELDS = ['startAt', 'mode', 'enrollmentMode', 'xpReward', 'badgeId'] as const;

/** Why a requirement's target was refused; carried as `reason` next to its `index`. */
export type RequirementTargetReason =
  | 'TOPIC_NOT_FOUND'
  | 'TOPIC_NOT_PUBLISHED'
  | 'TOPIC_ARCHIVED'
  | 'TOPIC_HAS_NO_VIDEO'
  | 'EVENT_NOT_FOUND'
  | 'EVENT_NOT_PUBLISHED'
  | 'EVENT_NOT_CHARGEABLE'
  | 'REQUIREMENT_SHARING_DISABLED';

/** The two reasons the API also names as the top-level error (RFC 0022 §2, §6). */
const TOP_LEVEL_REASONS: ReadonlySet<RequirementTargetReason> = new Set<RequirementTargetReason>([
  'EVENT_NOT_CHARGEABLE',
  'REQUIREMENT_SHARING_DISABLED',
]);

export interface MissionListItem extends Mission {
  requirementCount: number;
  enrolledCount: number;
  completedCount: number;
}

export interface MissionDetail {
  mission: Mission;
  requirements: MissionRequirement[];
  audience: MissionAudience;
}

export type MissionParticipantStep = Pick<
  MissionRequirementProgress,
  'requirementId' | 'currentCount' | 'targetCount' | 'checkedAt' | 'completedAt' | 'completedBy'
>;

export interface MissionParticipant {
  userId: string;
  name: string | null;
  email: string | null;
  source: MissionEnrollment['source'];
  joinedAt: string;
  countsFrom: string;
  leftAt: string | null;
  progress: { currentValue: number; targetValue: number; completed: boolean; completedAt: string | null } | null;
  steps: MissionParticipantStep[];
}

/** Decoded keyset position of the participants listing: `joinedAt`, then `userId`. */
export interface ParticipantsCursor {
  sortKey: string;
  id: string;
}

export interface MissionParticipantPage {
  data: MissionParticipant[];
  nextCursor: ParticipantsCursor | null;
}

export interface AdminMissionsDeps {
  missions: IMissionRepository;
  participation: IMissionParticipationRepository;
  topics: ITopicNodeRepository;
  media: IMediaRepository;
  events: IEventRepository;
  eventCharges: IEventChargeRepository;
  userGroups: IUserGroupRepository;
  users: IUserRepository;
  badges: IBadgeRepository;
  /** The label's submission sharing switch; `null` when the submission config is invalid. */
  sharingEnabled: boolean | null;
  /** Requirement-based evaluation, behind the on-demand reconciliation. */
  evaluator?: MissionEvaluator;
  now?: () => Date;
}

type Err = { ok: false; status: number; error: string; meta?: Record<string, unknown> };

const NOT_FOUND: Err = { ok: false, status: 404, error: 'NotFound' };

const validationError = (message: string): Err => ({
  ok: false,
  status: 400,
  error: 'ValidationError',
  meta: { formErrors: [message] },
});

const instant = (value: string): number => Date.parse(value);

/**
 * Admin authoring of missions (RFC 0022 §6). Reads serve both staff roles; the
 * router restricts every write to `admin`. Topic, media, event, price, badge,
 * group and user checks go through their ports — no SQL here.
 */
export class AdminMissionsController {
  private readonly missions: IMissionRepository;
  private readonly participation: IMissionParticipationRepository;
  private readonly topics: ITopicNodeRepository;
  private readonly media: IMediaRepository;
  private readonly events: IEventRepository;
  private readonly eventCharges: IEventChargeRepository;
  private readonly userGroups: IUserGroupRepository;
  private readonly users: IUserRepository;
  private readonly badges: IBadgeRepository;
  private readonly sharingEnabled: boolean | null;
  private readonly evaluator: MissionEvaluator | undefined;
  private readonly now: () => Date;

  constructor(deps: AdminMissionsDeps) {
    this.missions = deps.missions;
    this.participation = deps.participation;
    this.topics = deps.topics;
    this.media = deps.media;
    this.events = deps.events;
    this.eventCharges = deps.eventCharges;
    this.userGroups = deps.userGroups;
    this.users = deps.users;
    this.badges = deps.badges;
    this.sharingEnabled = deps.sharingEnabled;
    this.evaluator = deps.evaluator;
    this.now = deps.now ?? (() => new Date());
  }

  // -- reads -----------------------------------------------------------------

  /**
   * Every mission with its counts. Counting goes through the ports, one progress
   * read per enrollment — acceptable at admin volume; a set-based count belongs in
   * the adapter if mission rosters grow large.
   */
  async list(): Promise<ControllerResult<MissionListItem[]>> {
    const missions = await this.missions.listAll();
    const data = await Promise.all(
      missions.map(async (mission): Promise<MissionListItem> => {
        const [requirements, enrollments] = await Promise.all([
          this.missions.listRequirements(mission.id),
          this.participation.listEnrollments(mission.id),
        ]);
        const progress = await Promise.all(
          enrollments.map((e) => this.missions.findProgress(e.userId, mission.id)),
        );
        return {
          ...mission,
          requirementCount: requirements.length,
          enrolledCount: enrollments.filter((e) => e.leftAt === null).length,
          completedCount: progress.filter((p) => p?.completed === true).length,
        };
      }),
    );
    return { ok: true, data };
  }

  async get(id: string): Promise<ControllerResult<MissionDetail>> {
    const mission = await this.missions.findById(id);
    if (!mission) return NOT_FOUND;
    const [requirements, audience] = await Promise.all([
      this.missions.listRequirements(id),
      this.missions.getAudience(id),
    ]);
    return { ok: true, data: { mission, requirements, audience } };
  }

  /** Enrollments (active and left) ordered by `joinedAt, userId`, one keyset page at a time. */
  async listParticipants(
    id: string,
    cursor: ParticipantsCursor | null,
  ): Promise<ControllerResult<MissionParticipantPage>> {
    const mission = await this.missions.findById(id);
    if (!mission) return NOT_FOUND;

    const [enrollments, requirements] = await Promise.all([
      this.participation.listEnrollments(id),
      this.missions.listRequirements(id),
    ]);
    // Same order as the adapter's ORDER BY joined_at, user_id (string comparison).
    const after = cursor
      ? enrollments.filter(
          (e) => e.joinedAt > cursor.sortKey || (e.joinedAt === cursor.sortKey && e.userId > cursor.id),
        )
      : enrollments;
    const page = after.slice(0, PARTICIPANTS_PAGE_SIZE);
    const last = page[page.length - 1];
    const nextCursor =
      after.length > PARTICIPANTS_PAGE_SIZE && last ? { sortKey: last.joinedAt, id: last.userId } : null;

    const positionOf = new Map(requirements.map((r) => [r.id, r.position]));
    const data = await Promise.all(
      page.map(async (enrollment): Promise<MissionParticipant> => {
        const [user, progress, steps] = await Promise.all([
          this.users.findById(enrollment.userId),
          this.missions.findProgress(enrollment.userId, id),
          this.participation.listStepProgress(id, enrollment.userId),
        ]);
        return {
          userId: enrollment.userId,
          name: user?.name ?? null,
          email: user?.email ?? null,
          source: enrollment.source,
          joinedAt: enrollment.joinedAt,
          countsFrom: enrollment.countsFrom,
          leftAt: enrollment.leftAt,
          progress: progress
            ? {
                currentValue: progress.currentValue,
                targetValue: progress.targetValue,
                completed: progress.completed,
                completedAt: progress.completedAt ? progress.completedAt.toISOString() : null,
              }
            : null,
          steps: steps
            .slice()
            .sort((a, b) => (positionOf.get(a.requirementId) ?? 0) - (positionOf.get(b.requirementId) ?? 0))
            .map((s) => ({
              requirementId: s.requirementId,
              currentCount: s.currentCount,
              targetCount: s.targetCount,
              checkedAt: s.checkedAt,
              completedAt: s.completedAt,
              completedBy: s.completedBy,
            })),
        };
      }),
    );
    return { ok: true, data: { data, nextCursor } };
  }

  // -- writes ----------------------------------------------------------------

  async create(body: MissionCreateBody): Promise<ControllerResult<MissionDetail>> {
    if (instant(body.endAt) <= instant(body.startAt)) {
      return validationError('Mission must end after it starts');
    }
    if (body.audience && body.enrollmentMode !== 'assigned') {
      return {
        ok: false,
        status: 400,
        error: 'AUDIENCE_NOT_ALLOWED',
        meta: { formErrors: ["An audience is only accepted with enrollmentMode 'assigned'"] },
      };
    }

    const badgeError = await this.checkBadge(body.badgeId);
    if (badgeError) return badgeError;

    const targetError = await this.validateTargets(body.requirements);
    if (targetError) return targetError;

    const audience = body.audience ? normalizeAudience(body.audience) : null;
    if (audience) {
      const audienceError = await this.checkAudience(audience);
      if (audienceError) return audienceError;
    }

    const { mission, requirements } = await this.missions.createWithRequirements(
      {
        title: body.title,
        description: body.description,
        startAt: body.startAt,
        endAt: body.endAt,
        predicateKind: REQUIREMENTS_PREDICATE_KIND,
        predicateParams: '{}',
        xpReward: body.xpReward,
        badgeId: body.badgeId,
        active: true,
        mode: body.mode,
        enrollmentMode: body.enrollmentMode,
      },
      body.requirements,
    );

    let stored: MissionAudience = { groupIds: [], userIds: [] };
    if (audience) {
      await this.missions.replaceAudience(mission.id, audience);
      await this.syncEnrollments(mission, audience);
      stored = audience;
    }
    return { ok: true, data: { mission, requirements, audience: stored } };
  }

  async update(id: string, body: MissionPatchBody): Promise<ControllerResult<Mission>> {
    const existing = await this.missions.findById(id);
    if (!existing) return NOT_FOUND;

    const now = this.now();
    const finalStart = instant(body.startAt ?? existing.startAt);
    const finalEnd = instant(body.endAt ?? existing.endAt);
    if (finalEnd <= finalStart) {
      return validationError('Mission must end after it starts');
    }

    // Kept from M7: an end date may never be moved below now when it shortens the mission.
    if (body.endAt !== undefined) {
      const newEnd = instant(body.endAt);
      if (newEnd < now.getTime() && newEnd < instant(existing.endAt)) {
        return validationError('Cannot shorten mission end date below current time');
      }
    }

    if (this.hasStarted(existing, now)) {
      const locked: string[] = START_LOCKED_FIELDS.filter((field) => changes(existing, body, field));
      if (body.endAt !== undefined && instant(body.endAt) < instant(existing.endAt)) locked.push('endAt');
      if (locked.length > 0) return missionStarted(locked);
    }

    if (body.badgeId !== undefined) {
      const badgeError = await this.checkBadge(body.badgeId);
      if (badgeError) return badgeError;
    }

    const data = await this.missions.update(id, body);
    return { ok: true, data };
  }

  async replaceRequirements(
    id: string,
    requirements: RequirementInput[],
  ): Promise<ControllerResult<MissionRequirement[]>> {
    const mission = await this.missions.findById(id);
    if (!mission) return NOT_FOUND;
    if (this.hasStarted(mission, this.now())) return missionStarted(['requirements']);
    if (mission.predicateKind !== REQUIREMENTS_PREDICATE_KIND) {
      // A legacy predicate mission is evaluated by the M7 loop; steps on it would never run.
      return { ok: false, status: 409, error: 'MISSION_LEGACY' };
    }

    const targetError = await this.validateTargets(requirements);
    if (targetError) return targetError;

    const data = await this.missions.replaceRequirements(id, requirements);
    return { ok: true, data };
  }

  /** The one requirement field editable after start; the id (and its progress) is kept. */
  async updateRequirementTitle(
    id: string,
    requirementId: string,
    title: string,
  ): Promise<ControllerResult<MissionRequirement>> {
    const data = await this.missions.updateRequirementTitle(id, requirementId, title);
    if (!data) return NOT_FOUND;
    return { ok: true, data };
  }

  /**
   * Replace-all of an `assigned` mission's grants. Newly covered users are enrolled
   * (`admin`, counting from `startAt`); users no longer covered get `leftAt`, their
   * progress and rewards untouched.
   */
  async replaceAudience(id: string, body: MissionAudienceBody): Promise<ControllerResult<MissionAudience>> {
    const mission = await this.missions.findById(id);
    if (!mission) return NOT_FOUND;
    if (mission.enrollmentMode !== 'assigned') {
      return { ok: false, status: 409, error: 'MISSION_NOT_ASSIGNED' };
    }

    const audience = normalizeAudience(body);
    const audienceError = await this.checkAudience(audience);
    if (audienceError) return audienceError;

    await this.missions.replaceAudience(id, audience);
    await this.syncEnrollments(mission, audience);
    return { ok: true, data: audience };
  }

  async delete(id: string): Promise<ControllerResult<{ success: true }>> {
    const existing = await this.missions.findById(id);
    if (!existing) return NOT_FOUND;

    await this.missions.update(id, { active: false });
    return { ok: true, data: { success: true } };
  }

  /**
   * Runs the daily reconciliation (RFC 0022 §4) for this one mission — the same
   * routine `scheduled()` calls. `404` for an unknown or legacy predicate mission.
   */
  async reconcile(id: string): Promise<ControllerResult<ReconcileRunReport>> {
    const report = await reconcileOneMission(
      { missions: this.missions, participation: this.participation, evaluator: this.evaluator },
      id,
      this.now(),
    );
    if (!report) return NOT_FOUND;
    return { ok: true, data: report };
  }

  // -- rules -----------------------------------------------------------------

  private hasStarted(mission: Mission, now: Date): boolean {
    return now.getTime() >= instant(mission.startAt);
  }

  private async checkBadge(badgeId: string | null): Promise<Err | null> {
    if (badgeId === null) return null;
    const badge = await this.badges.findById(badgeId);
    return badge ? null : { ok: false, status: 400, error: 'BADGE_NOT_FOUND' };
  }

  private async checkAudience(audience: MissionAudience): Promise<Err | null> {
    const [groups, users] = await Promise.all([
      Promise.all(audience.groupIds.map((groupId) => this.userGroups.getById(groupId))),
      Promise.all(audience.userIds.map((userId) => this.users.findById(userId))),
    ]);
    const groupIds = audience.groupIds.filter((_, i) => groups[i] === null);
    const userIds = audience.userIds.filter((_, i) => users[i] === null);
    if (groupIds.length === 0 && userIds.length === 0) return null;
    return { ok: false, status: 400, error: 'UNKNOWN_AUDIENCE_TARGET', meta: { groupIds, userIds } };
  }

  /**
   * First refused requirement, in array order, as `400` with its `index` and `reason`.
   * Topics must exist, be published and not archived; `video_watched` needs a ready
   * video; events must be published and priced; `shared_only` needs sharing enabled.
   */
  private async validateTargets(requirements: RequirementInput[]): Promise<Err | null> {
    const topicCache = new Map<string, Promise<TopicNodeRecord | null>>();
    const findTopic = (topicId: string): Promise<TopicNodeRecord | null> => {
      let found = topicCache.get(topicId);
      if (!found) {
        found = this.topics.findById(topicId);
        topicCache.set(topicId, found);
      }
      return found;
    };

    for (const [index, requirement] of requirements.entries()) {
      const reason = await this.targetReason(requirement, findTopic);
      if (reason === 'CONFIG_INVALID') {
        return { ok: false, status: 500, error: 'SUBMISSION_CONFIG_INVALID' };
      }
      if (reason) {
        return {
          ok: false,
          status: 400,
          error: TOP_LEVEL_REASONS.has(reason) ? reason : 'INVALID_REQUIREMENT_TARGET',
          meta: { index, reason },
        };
      }
    }
    return null;
  }

  private async targetReason(
    requirement: RequirementInput,
    findTopic: (topicId: string) => Promise<TopicNodeRecord | null>,
  ): Promise<RequirementTargetReason | 'CONFIG_INVALID' | null> {
    switch (requirement.kind) {
      case 'manual_check':
        return null;
      case 'event_participation': {
        const event = await this.events.findById(requirement.eventId);
        if (!event) return 'EVENT_NOT_FOUND';
        if (event.status !== Entities.Config.EventStatus.PUBLISHED) return 'EVENT_NOT_PUBLISHED';
        const price = await this.eventCharges.getPrice(requirement.eventId);
        return price ? null : 'EVENT_NOT_CHARGEABLE';
      }
      default: {
        if (requirement.kind === 'submissions_on_topic' && requirement.params.visibility === 'shared_only') {
          if (this.sharingEnabled === null) return 'CONFIG_INVALID';
          if (!this.sharingEnabled) return 'REQUIREMENT_SHARING_DISABLED';
        }
        const topic = await findTopic(requirement.topicId);
        if (!topic) return 'TOPIC_NOT_FOUND';
        if (topic.archived) return 'TOPIC_ARCHIVED';
        if (topic.status !== Entities.Config.TopicNodeStatus.PUBLISHED) return 'TOPIC_NOT_PUBLISHED';
        if (requirement.kind === 'video_watched') {
          const media = await this.media.listByTopic(requirement.topicId);
          const hasVideo = media.some(
            (m) => m.status === Entities.Config.MediaStatus.READY && m.type.startsWith('video/'),
          );
          if (!hasVideo) return 'TOPIC_HAS_NO_VIDEO';
        }
        return null;
      }
    }
  }

  /** Direct users plus the members of every group. */
  private async coveredUsers(audience: MissionAudience): Promise<Set<string>> {
    const members = await Promise.all(audience.groupIds.map((groupId) => this.userGroups.listMembers(groupId)));
    return new Set([...audience.userIds, ...members.flat().map((m) => m.userId)]);
  }

  /**
   * Enrolls every covered user (a left row is re-activated, keeping its source and
   * `countsFrom`) and sets `leftAt` on every active enrollment no longer covered.
   */
  private async syncEnrollments(mission: Mission, audience: MissionAudience): Promise<void> {
    const nowIso = this.now().toISOString();
    const covered = await this.coveredUsers(audience);

    for (const userId of covered) {
      const enrollment = await this.participation.findEnrollment(mission.id, userId);
      if (!enrollment) {
        await this.participation.ensureEnrollment(mission.id, userId, 'admin', mission.startAt);
      } else if (enrollment.leftAt !== null) {
        await this.participation.join(mission.id, userId, nowIso);
      }
    }

    const active = await this.participation.listEnrollments(mission.id, { activeOnly: true });
    for (const enrollment of active) {
      if (!covered.has(enrollment.userId)) {
        await this.participation.leave(mission.id, enrollment.userId, nowIso);
      }
    }
  }
}

function missionStarted(fields: string[]): Err {
  return { ok: false, status: 409, error: 'MISSION_STARTED', meta: { fields } };
}

function normalizeAudience(audience: MissionAudienceBody): MissionAudience {
  return { groupIds: [...new Set(audience.groupIds)], userIds: [...new Set(audience.userIds)] };
}

/** True when the PATCH body sets `field` to a value different from the stored one. */
function changes(
  existing: Mission,
  body: MissionPatchBody,
  field: (typeof START_LOCKED_FIELDS)[number],
): boolean {
  const next = body[field];
  if (next === undefined) return false;
  if (field === 'startAt') return instant(next as string) !== instant(existing.startAt);
  return next !== existing[field];
}
