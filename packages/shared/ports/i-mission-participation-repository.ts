import type { MissionEnrollment, MissionRequirementProgress } from '../domain/mission';
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
