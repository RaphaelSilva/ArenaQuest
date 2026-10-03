import type { IBadgeRepository } from '../../ports/i-badge-repository';
import type { IMissionRepository, MissionCandidate } from '../../ports/i-mission-repository';
import type { IMissionParticipationRepository } from '../../ports/i-mission-participation-repository';
import type { EvidenceCount, IMissionEvidenceRepository } from '../../ports/i-mission-evidence-repository';
import type {
  Mission,
  MissionEnrollment,
  MissionRequirement,
  MissionRequirementProgress,
} from '../mission';
import type { CompletedBy, RequirementKind } from '../missions/requirements';
import { REQUIREMENTS_PREDICATE_KIND, targetCountOf } from '../missions/requirements';
import { ROLES } from '../../constants/roles';
import type { XpEngine } from './xp-engine';
import type { StreakEngine } from './streak-engine';

/**
 * Mission evaluator (RFC 0022 §3–§5): the single routine behind the mission hooks,
 * the manual check and the daily reconciliation. Pure domain code — every fact comes
 * from an injected port and the clock is always the `now` parameter.
 *
 * Invariants:
 * - Evidence counts only inside a step's open interval (§3.3): from the later of the
 *   mission's `startAt` and the enrollment's `countsFrom` (or, in sequential mode, from
 *   the previous step's `completedAt`) up to the earlier of `endAt` and now.
 * - A step's `completedAt` is the instant of its target-th qualifying item, never the
 *   evaluation clock; a completed step is never recounted nor un-completed (§3.4–§3.5).
 * - Rewards are granted only when a write actually changed a row; XP idempotency keys
 *   are the second guard. Nothing is ever revoked.
 */

/** What a hook site reports after its originating write succeeded (RFC 0022 §3.1–§3.2). */
export type MissionSignal =
  | { kind: 'submission'; userId: string; topicIds: string[] }
  | { kind: 'topic_visit'; userId: string; topicId: string }
  | { kind: 'video_watch'; userId: string; topicId: string; mediaId: string }
  | { kind: 'event_charge'; userId: string; eventId: string };

/** Which path runs an evaluation; `reconcile` completions record no streak activity. */
export type EvaluationOrigin = 'hook' | 'manual_check' | 'reconcile';

/** Roles that are never enrolled implicitly in an `auto` mission (RFC 0022 §5). */
export const MISSION_STAFF_ROLES: readonly string[] = [ROLES.ADMIN, ROLES.CONTENT_CREATOR];

/** True when the role names include a staff role (`admin`, `content_creator`). */
export const isMissionStaff = (roleNames: readonly string[]): boolean =>
  roleNames.some((role) => MISSION_STAFF_ROLES.includes(role));

/** The user facts the enrollment policy needs. */
export interface MissionUserContext {
  /** `admin` or `content_creator` (see `isMissionStaff`). */
  isStaff: boolean;
  groupIds: string[];
  /** The user's effective access set (`IEnrollmentRepository.getEffectiveAccessTopicIds`). */
  accessibleTopicIds: string[];
}

/**
 * Facts the evaluator needs about users and media. Task 06 implements it from the
 * user, enrollment and media ports, so the evaluator never re-implements them.
 */
export interface MissionContextResolver {
  /** null when the user does not exist (or must not take part, e.g. inactive). */
  getUserContext(userId: string): Promise<MissionUserContext | null>;
  /** true when `mediaId` is a `ready` video media row of `topicId`. */
  isReadyVideoOfTopic(topicId: string, mediaId: string): Promise<boolean>;
}

export interface CompletedStep {
  missionId: string;
  requirementId: string;
  /** The evidence instant written as the step's `completedAt`. */
  completedAt: string;
}

/** What one call changed: steps and missions completed by this call only. */
export interface EvaluationOutcome {
  stepsCompleted: CompletedStep[];
  missionsCompleted: string[];
}

export type CheckFailureReason =
  | 'mission_not_found'
  | 'requirement_not_found'
  | 'not_manual_check'
  | 'not_enrolled'
  | 'mission_closed'
  | 'step_locked'
  | 'already_completed';

export type CheckResult =
  | { ok: true; outcome: EvaluationOutcome; alreadyChecked: boolean }
  | { ok: false; reason: CheckFailureReason };

export interface ReconcileStats {
  missionId: string;
  enrollmentsEvaluated: number;
  /** Always 0 here: materialising implicit enrollments is the scheduled job's step (Task 08). */
  implicitEnrollmentsCreated: number;
  stepsCompleted: number;
  missionsCompleted: number;
}

export interface MissionEvaluatorOptions {
  /** `SUBMISSIONS_SHARING_ENABLED` of the label: gates `shared_only` submission steps. */
  sharingEnabled: boolean;
}

/** A step's state for one enrollment at one instant. */
export type StepState = 'completed' | 'open' | 'locked';

const emptyOutcome = (): EvaluationOutcome => ({ stepsCompleted: [], missionsCompleted: [] });

const SQLITE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Milliseconds of an ISO or SQLite (`YYYY-MM-DD HH:MM:SS`, UTC) instant. A string
 * without a zone designator is read as UTC — never as the runtime's local time.
 */
export function instantMs(value: string): number {
  const trimmed = value.trim();
  if (SQLITE_DATETIME.test(trimmed)) return Date.parse(`${trimmed.replace(' ', 'T')}Z`);
  if (trimmed.length > 10 && !HAS_ZONE.test(trimmed)) return Date.parse(`${trimmed}Z`);
  return Date.parse(trimmed);
}

/** Requirements in evaluation order (by `position`). */
const byPosition = (requirements: MissionRequirement[]): MissionRequirement[] =>
  [...requirements].sort((a, b) => a.position - b.position);

/** Distinct topic targets of a mission's requirements. */
const topicTargetsOf = (requirements: MissionRequirement[]): string[] => [
  ...new Set(requirements.map((r) => r.topicId).filter((id): id is string => id !== null)),
];

/** Mutable per-enrollment state while a mission is being evaluated. */
interface EnrollmentRun {
  enrollment: MissionEnrollment;
  progress: Map<string, MissionRequirementProgress>;
  /** `completedAt` of the previous step in position order (sequential unlock). */
  prevCompletedAt: string | null;
  /** Sequential mode stopped at an incomplete step: later steps are locked. */
  stopped: boolean;
  completedSteps: number;
  outcome: EvaluationOutcome;
}

export class MissionEvaluator {
  constructor(
    private readonly missions: IMissionRepository,
    private readonly participation: IMissionParticipationRepository,
    private readonly evidence: IMissionEvidenceRepository,
    private readonly badges: IBadgeRepository,
    private readonly xp: XpEngine,
    private readonly streak: StreakEngine,
    private readonly context: MissionContextResolver,
    private readonly options: MissionEvaluatorOptions,
  ) {}

  // -------------------------------------------------------------------------
  // Hook entry point (RFC 0022 §3.1)
  // -------------------------------------------------------------------------

  /** Evaluates only what `signal` can affect. Zero candidates end after one lookup. */
  async onSignal(signal: MissionSignal, now: Date): Promise<EvaluationOutcome> {
    const nowIso = now.toISOString();
    const candidates = await this.findCandidates(signal, nowIso);
    if (candidates.length === 0) return emptyOutcome();

    // The watched route does not check the media itself (RFC 0022 §3.1 step 3).
    if (signal.kind === 'video_watch') {
      const valid = await this.context.isReadyVideoOfTopic(signal.topicId, signal.mediaId);
      if (!valid) return emptyOutcome();
    }

    const byMission = new Map<string, { mission: Mission; requirementIds: Set<string> }>();
    for (const { mission, requirement } of candidates) {
      const entry = byMission.get(mission.id) ?? { mission, requirementIds: new Set<string>() };
      entry.requirementIds.add(requirement.id);
      byMission.set(mission.id, entry);
    }

    const userId = signal.userId;
    const loadContext = this.memoContext(userId);
    const outcome = emptyOutcome();

    for (const { mission, requirementIds } of byMission.values()) {
      const requirements = byPosition(await this.missions.listRequirements(mission.id));
      if (requirements.length === 0) continue;

      const enrollment = await this.resolveEnrollment(mission, requirements, userId, now, loadContext);
      if (!enrollment) continue;

      if (signal.kind === 'topic_visit' || signal.kind === 'video_watch') {
        const progress = await this.participation.listStepProgress(mission.id, userId);
        const progressById = new Map(progress.map((p) => [p.requirementId, p]));
        const refId = signal.kind === 'topic_visit' ? signal.topicId : signal.mediaId;
        for (const requirement of requirements) {
          if (!requirementIds.has(requirement.id)) continue;
          if (this.stepState(mission, requirements, progressById, enrollment, requirement, now) !== 'open') continue;
          await this.participation.captureEvidence({
            requirementId: requirement.id,
            userId,
            refId,
            occurredAt: nowIso,
            source: 'hook',
          });
        }
      }

      const evaluated = await this.evaluateEnrollment(mission, requirements, enrollment, now, 'hook');
      outcome.stepsCompleted.push(...evaluated.stepsCompleted);
      outcome.missionsCompleted.push(...evaluated.missionsCompleted);
    }

    await this.recordStreak(userId, outcome, 'hook', now);
    return outcome;
  }

  // -------------------------------------------------------------------------
  // Enrollment evaluation (RFC 0022 §3.4)
  // -------------------------------------------------------------------------

  /** Evaluates one enrollment: counts open steps, completes them write-once, rewards on change. */
  async evaluateEnrollment(
    mission: Mission,
    requirements: MissionRequirement[],
    enrollment: MissionEnrollment,
    now: Date,
    origin: EvaluationOrigin,
  ): Promise<EvaluationOutcome> {
    if (enrollment.leftAt !== null) return emptyOutcome();
    const [run] = await this.evaluateRuns(mission, requirements, [enrollment], enrollment.userId, now, origin);
    return run ? run.outcome : emptyOutcome();
  }

  // -------------------------------------------------------------------------
  // Manual check (RFC 0022 §3.6)
  // -------------------------------------------------------------------------

  /** Sets the step's `checkedAt` (once) and evaluates the enrollment in the same call. */
  async check(userId: string, missionId: string, requirementId: string, now: Date): Promise<CheckResult> {
    const mission = await this.missions.findById(missionId);
    if (!mission || mission.predicateKind !== REQUIREMENTS_PREDICATE_KIND) {
      return { ok: false, reason: 'mission_not_found' };
    }
    if (!this.isOpenWindow(mission, now)) return { ok: false, reason: 'mission_closed' };

    const requirements = byPosition(await this.missions.listRequirements(missionId));
    const requirement = requirements.find((r) => r.id === requirementId);
    if (!requirement) return { ok: false, reason: 'requirement_not_found' };
    if (requirement.kind !== 'manual_check') return { ok: false, reason: 'not_manual_check' };

    const enrollment = await this.resolveEnrollment(mission, requirements, userId, now, this.memoContext(userId));
    if (!enrollment) return { ok: false, reason: 'not_enrolled' };

    const progress = await this.participation.listStepProgress(missionId, userId);
    const progressById = new Map(progress.map((p) => [p.requirementId, p]));
    const state = this.stepState(mission, requirements, progressById, enrollment, requirement, now);
    if (state === 'completed') return { ok: false, reason: 'already_completed' };
    if (state === 'locked') return { ok: false, reason: 'step_locked' };

    const changed = await this.participation.markChecked({
      requirementId,
      userId,
      missionId,
      targetCount: targetCountOf(requirement),
      checkedAt: now.toISOString(),
    });

    const outcome = await this.evaluateEnrollment(mission, requirements, enrollment, now, 'manual_check');
    await this.recordStreak(userId, outcome, 'manual_check', now);
    return { ok: true, outcome, alreadyChecked: !changed };
  }

  // -------------------------------------------------------------------------
  // Reconciliation (RFC 0022 §4)
  // -------------------------------------------------------------------------

  /**
   * Recomputes one mission for all its active enrollments. Counting is set-based —
   * one evidence query per requirement for every enrollment (`userId: null`) — and
   * no streak activity is recorded. Implicit enrollments are materialised by the
   * scheduled job through `ensureImplicitEnrollment` before this runs.
   */
  async reconcileMission(missionId: string, now: Date): Promise<ReconcileStats> {
    const stats: ReconcileStats = {
      missionId,
      enrollmentsEvaluated: 0,
      implicitEnrollmentsCreated: 0,
      stepsCompleted: 0,
      missionsCompleted: 0,
    };
    const mission = await this.missions.findById(missionId);
    if (!mission || mission.predicateKind !== REQUIREMENTS_PREDICATE_KIND) return stats;
    const requirements = byPosition(await this.missions.listRequirements(missionId));
    if (requirements.length === 0) return stats;

    const enrollments = (await this.participation.listEnrollments(missionId, { activeOnly: true })).filter(
      (e) => e.leftAt === null,
    );
    const runs = await this.evaluateRuns(mission, requirements, enrollments, null, now, 'reconcile');
    stats.enrollmentsEvaluated = runs.length;
    for (const run of runs) {
      stats.stepsCompleted += run.outcome.stepsCompleted.length;
      stats.missionsCompleted += run.outcome.missionsCompleted.length;
    }
    return stats;
  }

  // -------------------------------------------------------------------------
  // Enrollment policy (RFC 0022 §5)
  // -------------------------------------------------------------------------

  /**
   * Creates the implicit enrollment the mission's policy grants `userId`, if any:
   * `auto` — the user exists, is not staff and can access every topic target of the
   * mission; `assigned` — the audience covers the user directly or by group; `open` —
   * never (only Join enrolls). `countsFrom = mission.startAt`. True when a row was inserted.
   */
  async ensureImplicitEnrollment(
    mission: Mission,
    requirements: MissionRequirement[],
    userId: string,
    now: Date,
  ): Promise<boolean> {
    return this.applyImplicitPolicy(mission, requirements, userId, now, this.memoContext(userId));
  }

  /** The step's state for `enrollment` at `now` (RFC 0022 §3.3). */
  stepState(
    mission: Mission,
    orderedRequirements: MissionRequirement[],
    progressById: Map<string, MissionRequirementProgress>,
    enrollment: MissionEnrollment,
    requirement: MissionRequirement,
    now: Date,
  ): StepState {
    if (progressById.get(requirement.id)?.completedAt) return 'completed';
    const opensAt = this.stepOpensAt(mission, orderedRequirements, progressById, enrollment, requirement);
    if (opensAt === null) return 'locked';
    const nowMs = now.getTime();
    if (instantMs(opensAt) > nowMs || instantMs(mission.endAt) < nowMs) return 'locked';
    return 'open';
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async findCandidates(signal: MissionSignal, nowIso: string): Promise<MissionCandidate[]> {
    const lookups: Array<{ kind: RequirementKind; topicId?: string; eventId?: string }> = [];
    switch (signal.kind) {
      case 'submission':
        for (const topicId of new Set(signal.topicIds)) lookups.push({ kind: 'submissions_on_topic', topicId });
        break;
      case 'topic_visit':
        lookups.push({ kind: 'topic_visited', topicId: signal.topicId });
        break;
      case 'video_watch':
        lookups.push({ kind: 'video_watched', topicId: signal.topicId });
        break;
      case 'event_charge':
        lookups.push({ kind: 'event_participation', eventId: signal.eventId });
        break;
    }
    const seen = new Set<string>();
    const candidates: MissionCandidate[] = [];
    for (const target of lookups) {
      for (const candidate of await this.missions.findCandidateRequirements(target, nowIso)) {
        if (seen.has(candidate.requirement.id)) continue;
        seen.add(candidate.requirement.id);
        candidates.push(candidate);
      }
    }
    return candidates;
  }

  /** The active enrollment, creating the implicit one when the policy grants it; null otherwise. */
  private async resolveEnrollment(
    mission: Mission,
    requirements: MissionRequirement[],
    userId: string,
    now: Date,
    loadContext: () => Promise<MissionUserContext | null>,
  ): Promise<MissionEnrollment | null> {
    let enrollment = await this.participation.findEnrollment(mission.id, userId);
    if (!enrollment) {
      await this.applyImplicitPolicy(mission, requirements, userId, now, loadContext);
      enrollment = await this.participation.findEnrollment(mission.id, userId);
    }
    if (!enrollment || enrollment.leftAt !== null) return null;
    return enrollment;
  }

  private async applyImplicitPolicy(
    mission: Mission,
    requirements: MissionRequirement[],
    userId: string,
    now: Date,
    loadContext: () => Promise<MissionUserContext | null>,
  ): Promise<boolean> {
    if (!mission.active || instantMs(mission.startAt) > now.getTime()) return false;

    if (mission.enrollmentMode === 'auto') {
      const ctx = await loadContext();
      if (!ctx || ctx.isStaff) return false;
      const accessible = new Set(ctx.accessibleTopicIds);
      if (!topicTargetsOf(requirements).every((topicId) => accessible.has(topicId))) return false;
      return this.participation.ensureEnrollment(mission.id, userId, 'auto', mission.startAt);
    }

    if (mission.enrollmentMode === 'assigned') {
      const ctx = await loadContext();
      if (!ctx) return false;
      const audience = await this.missions.getAudience(mission.id);
      const covered =
        audience.userIds.includes(userId) || ctx.groupIds.some((groupId) => audience.groupIds.includes(groupId));
      if (!covered) return false;
      return this.participation.ensureEnrollment(mission.id, userId, 'admin', mission.startAt);
    }

    return false; // 'open': only Join creates the enrollment.
  }

  private memoContext(userId: string): () => Promise<MissionUserContext | null> {
    let pending: Promise<MissionUserContext | null> | undefined;
    return () => (pending ??= this.context.getUserContext(userId));
  }

  /** Opening instant of a step, or null when a sequential predecessor is incomplete. */
  private stepOpensAt(
    mission: Mission,
    orderedRequirements: MissionRequirement[],
    progressById: Map<string, MissionRequirementProgress>,
    enrollment: MissionEnrollment,
    requirement: MissionRequirement,
  ): string | null {
    const index = orderedRequirements.findIndex((r) => r.id === requirement.id);
    if (mission.mode === 'sequential' && index > 0) {
      return progressById.get(orderedRequirements[index - 1].id)?.completedAt ?? null;
    }
    return this.enrollmentFloor(mission, enrollment);
  }

  /** `max(mission.startAt, enrollment.countsFrom)`. */
  private enrollmentFloor(mission: Mission, enrollment: MissionEnrollment): string {
    return instantMs(enrollment.countsFrom) > instantMs(mission.startAt) ? enrollment.countsFrom : mission.startAt;
  }

  private isOpenWindow(mission: Mission, now: Date): boolean {
    const nowMs = now.getTime();
    return mission.active && instantMs(mission.startAt) <= nowMs && nowMs <= instantMs(mission.endAt);
  }

  /**
   * The §3.4 loop, run requirement by requirement over a set of enrollments so the
   * hook (one user, `countUserId` set) and the reconciliation (`countUserId: null`)
   * share one code path and the evidence port is queried once per requirement.
   */
  private async evaluateRuns(
    mission: Mission,
    requirements: MissionRequirement[],
    enrollments: MissionEnrollment[],
    countUserId: string | null,
    now: Date,
    origin: EvaluationOrigin,
  ): Promise<EnrollmentRun[]> {
    const ordered = byPosition(requirements);
    if (ordered.length === 0 || enrollments.length === 0) return [];
    const nowIso = now.toISOString();
    const endMs = Math.min(instantMs(mission.endAt), now.getTime());
    const completedBy: CompletedBy = origin === 'reconcile' ? 'reconcile' : 'hook';

    const runs: EnrollmentRun[] = [];
    for (const enrollment of enrollments) {
      const progress = await this.participation.listStepProgress(mission.id, enrollment.userId);
      runs.push({
        enrollment,
        progress: new Map(progress.map((p) => [p.requirementId, p])),
        prevCompletedAt: null,
        stopped: false,
        completedSteps: 0,
        outcome: emptyOutcome(),
      });
    }

    for (let index = 0; index < ordered.length; index++) {
      const requirement = ordered[index];
      const target = targetCountOf(requirement);
      const sequentialAfterFirst = mission.mode === 'sequential' && index > 0;

      // Steps already completed are never recounted (write-once).
      const pending: EnrollmentRun[] = [];
      for (const run of runs) {
        if (run.stopped) continue;
        const completedAt = run.progress.get(requirement.id)?.completedAt;
        if (completedAt) {
          run.prevCompletedAt = completedAt;
          run.completedSteps++;
          continue;
        }
        if (sequentialAfterFirst && !run.prevCompletedAt) {
          run.stopped = true; // locked
          continue;
        }
        pending.push(run);
      }
      if (pending.length === 0) continue;

      const counts = await this.countFor(mission, requirement, ordered, index, pending, countUserId, nowIso, endMs);

      for (const run of pending) {
        const { count, kthAt } = counts.get(run.enrollment.userId) ?? { count: 0, kthAt: null };
        const userId = run.enrollment.userId;
        if (count >= target && kthAt) {
          const changed = await this.participation.completeStep({
            requirementId: requirement.id,
            userId,
            missionId: mission.id,
            targetCount: target,
            completedAt: kthAt,
            completedBy,
          });
          if (changed) {
            if (requirement.xpReward > 0) {
              await this.xp.award({
                userId,
                action: 'mission_step_reward',
                sourceKind: 'mission_step_reward',
                sourceId: requirement.id,
                customPoints: requirement.xpReward,
              });
            }
            run.outcome.stepsCompleted.push({ missionId: mission.id, requirementId: requirement.id, completedAt: kthAt });
          }
          run.prevCompletedAt = kthAt;
          run.completedSteps++;
        } else {
          const current = run.progress.get(requirement.id);
          const partial = Math.min(count, target);
          if (!current || current.currentCount !== partial || current.targetCount !== target) {
            // May go down: partial progress regresses until the step completes.
            await this.participation.setPartialCount({
              requirementId: requirement.id,
              userId,
              missionId: mission.id,
              currentCount: partial,
              targetCount: target,
            });
          }
          if (mission.mode === 'sequential') run.stopped = true;
        }
      }
    }

    for (const run of runs) {
      await this.syncMissionProgress(mission, ordered.length, run);
    }
    return runs;
  }

  /** Per-user evidence counts for one requirement. */
  private async countFor(
    mission: Mission,
    requirement: MissionRequirement,
    ordered: MissionRequirement[],
    index: number,
    pending: EnrollmentRun[],
    countUserId: string | null,
    nowIso: string,
    endMs: number,
  ): Promise<Map<string, Pick<EvidenceCount, 'count' | 'kthAt'>>> {
    const counts = new Map<string, Pick<EvidenceCount, 'count' | 'kthAt'>>();

    // manual_check: the evidence is the step's own `checkedAt`, never the evidence port.
    if (requirement.kind === 'manual_check') {
      for (const run of pending) {
        const checkedAt = run.progress.get(requirement.id)?.checkedAt ?? null;
        const opensAt =
          mission.mode === 'sequential' && index > 0 ? run.prevCompletedAt : this.enrollmentFloor(mission, run.enrollment);
        const inWindow =
          checkedAt !== null &&
          opensAt !== null &&
          instantMs(checkedAt) >= instantMs(opensAt) &&
          instantMs(checkedAt) <= endMs;
        counts.set(run.enrollment.userId, inWindow ? { count: 1, kthAt: checkedAt } : { count: 0, kthAt: null });
      }
      return counts;
    }

    const rows = await this.evidence.countForRequirement({
      mission,
      requirement,
      previousRequirementId: mission.mode === 'sequential' && index > 0 ? ordered[index - 1].id : null,
      userId: countUserId,
      nowIso,
      sharingEnabled: this.options.sharingEnabled,
    });
    for (const row of rows) counts.set(row.userId, { count: row.count, kthAt: row.kthAt });
    return counts;
  }

  /**
   * Keeps `mission_progress` as the aggregate (`currentValue` = completed steps,
   * `targetValue` = number of steps) and completes the mission once every step is
   * complete. Mission XP and the badge are granted only when this call made the
   * progress row transition to completed.
   */
  private async syncMissionProgress(mission: Mission, stepCount: number, run: EnrollmentRun): Promise<void> {
    if (run.completedSteps === 0) return;
    const userId = run.enrollment.userId;
    const before = await this.missions.findProgress(userId, mission.id);
    if (before?.completed) return; // never un-completed, never re-rewarded

    let current = before;
    const delta = run.completedSteps - (before?.currentValue ?? 0);
    if (delta > 0) current = await this.missions.upsertProgress(userId, mission.id, delta, stepCount);

    if (run.completedSteps < stepCount) return;
    if (!current?.completed) await this.missions.markCompleted(userId, mission.id);

    if (mission.xpReward > 0) {
      await this.xp.award({
        userId,
        action: 'mission_reward',
        sourceKind: 'mission_reward',
        sourceId: mission.id,
        customPoints: mission.xpReward,
      });
    }
    if (mission.badgeId) {
      const badge = await this.badges.findById(mission.badgeId);
      if (badge && badge.active) {
        await this.badges.awardBadge(userId, badge.id);
        if (badge.xpReward > 0) {
          await this.xp.award({
            userId,
            action: 'badge_award',
            sourceKind: 'badge_award',
            sourceId: badge.id,
            customPoints: badge.xpReward,
          });
        }
      }
    }
    run.outcome.missionsCompleted.push(mission.id);
  }

  private async recordStreak(
    userId: string,
    outcome: EvaluationOutcome,
    origin: EvaluationOrigin,
    now: Date,
  ): Promise<void> {
    if (origin === 'reconcile' || outcome.stepsCompleted.length === 0) return;
    await this.streak.recordActivity(userId, now);
  }
}
