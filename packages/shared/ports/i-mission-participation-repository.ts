import type { Mission, MissionEnrollment, MissionRequirement, MissionRequirementProgress } from '../domain/mission';
import type { CompletedBy, EvidenceSource } from '../domain/missions/requirements';

/**
 * Enrollments, per-step progress and captured evidence of mission participants
 * (RFC 0022 §1, §3.5, §5). Instants are ISO/SQLite UTC strings.
 */
export interface IMissionParticipationRepository {
  /**
   * Creates an implicit (`auto`) or audience (`admin`) enrollment when none exists.
   * An existing row — active or left — is left untouched. Returns true when inserted.
   */
  ensureEnrollment(
    missionId: string,
    userId: string,
    source: 'auto' | 'admin',
    countsFrom: string,
  ): Promise<boolean>;
  /**
   * Daily reconciliation (RFC 0022 §4 step 2): creates every implicit enrollment the
   * mission's policy grants, in one set-based statement. `auto` — every active user
   * without the `admin` or `content_creator` role whose effective access set holds
   * every id of `topicTargetIds` (all of them when the list is empty), `source = 'auto'`;
   * `assigned` — direct audience users and members of the audience groups,
   * `source = 'admin'`; `open` — nothing. `countsFrom = mission.startAt`. Existing rows,
   * active or left, are left untouched. Returns the number of rows inserted.
   */
  materializeImplicitEnrollments(
    mission: Pick<Mission, 'id' | 'startAt' | 'enrollmentMode'>,
    topicTargetIds: string[],
  ): Promise<number>;
  /**
   * Daily reconciliation (RFC 0022 §4 step 3): captures, with `source = 'backfill'`,
   * the evidence the source tables still prove for the mission's active enrollments
   * inside `[startAt, endAt]` — first video watches from the XP log for
   * `video_watched`, topic visits from topic progress for `topic_visited`. Existing
   * rows (hook rows included) are kept. Other kinds insert nothing. Returns the number
   * of rows inserted.
   */
  backfillEvidence(
    mission: Pick<Mission, 'id' | 'startAt' | 'endAt'>,
    requirement: Pick<MissionRequirement, 'id' | 'kind' | 'topicId'>,
  ): Promise<number>;
  /**
   * Joins as `self` with `countsFrom = nowIso`. A re-join clears `leftAt` and keeps the
   * original `countsFrom`, so leaving can never reset a window.
   */
  join(missionId: string, userId: string, nowIso: string): Promise<MissionEnrollment>;
  /** Sets `leftAt = nowIso` on an active enrollment; true when a row changed. */
  leave(missionId: string, userId: string, nowIso: string): Promise<boolean>;
  /** The enrollment row, active or left, or null. */
  findEnrollment(missionId: string, userId: string): Promise<MissionEnrollment | null>;
  /** Enrollments of a mission; `activeOnly` skips rows with `leftAt` set. */
  listEnrollments(missionId: string, opts?: { activeOnly?: boolean }): Promise<MissionEnrollment[]>;
  /** Enrollments of a user across missions; `activeOnly` skips rows with `leftAt` set. */
  listUserEnrollments(userId: string, opts?: { activeOnly?: boolean }): Promise<MissionEnrollment[]>;
  /** The user's per-step progress rows on the mission (steps never evaluated have none). */
  listStepProgress(missionId: string, userId: string): Promise<MissionRequirementProgress[]>;
  /**
   * Write-once completion: sets `completedAt` (the evidence instant), `currentCount =
   * targetCount` and `completedBy` only while `completedAt` is unset, creating the row
   * if needed. True only when this call completed the step — the reward guard.
   */
  completeStep(args: {
    requirementId: string;
    userId: string;
    missionId: string;
    targetCount: number;
    completedAt: string;
    completedBy: CompletedBy;
  }): Promise<boolean>;
  /** Writes the partial count (may go down); never touches a completed row. */
  setPartialCount(args: {
    requirementId: string;
    userId: string;
    missionId: string;
    currentCount: number;
    targetCount: number;
  }): Promise<void>;
  /** `manual_check`: sets `checkedAt` once, creating the row if needed. True when it was unset. */
  markChecked(args: {
    requirementId: string;
    userId: string;
    missionId: string;
    targetCount: number;
    checkedAt: string;
  }): Promise<boolean>;
  /**
   * Captures one evidence item (`refId` = media id for `video_watched`, topic id for
   * `topic_visited`). The first row per (requirement, user, refId) wins; true when inserted.
   */
  captureEvidence(args: {
    requirementId: string;
    userId: string;
    refId: string;
    occurredAt: string;
    source: EvidenceSource;
  }): Promise<boolean>;
}
