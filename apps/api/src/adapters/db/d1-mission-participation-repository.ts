import type { IMissionParticipationRepository } from '@arenaquest/shared/ports/i-mission-participation-repository';
import type {
  Mission,
  MissionEnrollment,
  MissionRequirement,
  MissionRequirementProgress,
} from '@arenaquest/shared/domain/mission';
import type { CompletedBy, EvidenceSource } from '@arenaquest/shared/domain/missions/requirements';
import { MISSION_STAFF_ROLES } from '@arenaquest/shared/domain/gamification/mission-evaluator';

/**
 * Enrollments, per-step progress and captured evidence (RFC 0022 §1, §3.5, §5).
 *
 * Every write-once statement is a single conditional statement whose effect is
 * read through `meta.changes`, never read-then-write: two concurrent hooks
 * completing the same step produce exactly one `true`, which is the reward guard.
 * Duplicate inserts use `ON CONFLICT … DO NOTHING` rather than `INSERT OR IGNORE`,
 * which would also swallow a CHECK violation. Instants are stored as the caller passes them (ISO-8601 or SQLite form); every
 * reader compares them through `datetime()`.
 */

type EnrollmentRow = {
  mission_id: string;
  user_id: string;
  source: MissionEnrollment['source'];
  joined_at: string;
  counts_from: string;
  left_at: string | null;
};

type ProgressRow = {
  requirement_id: string;
  user_id: string;
  mission_id: string;
  current_count: number;
  target_count: number;
  checked_at: string | null;
  completed_at: string | null;
  completed_by: CompletedBy | null;
  recorded_at: string | null;
  updated_at: string;
};

export class D1MissionParticipationRepository implements IMissionParticipationRepository {
  constructor(private readonly db: D1Database) {}

  async ensureEnrollment(
    missionId: string,
    userId: string,
    source: 'auto' | 'admin',
    countsFrom: string,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `INSERT INTO mission_enrollments (mission_id, user_id, source, counts_from)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (mission_id, user_id) DO NOTHING`,
      )
      .bind(missionId, userId, source, countsFrom)
      .run();
    return result.meta.changes === 1;
  }

  async materializeImplicitEnrollments(
    mission: Pick<Mission, 'id' | 'startAt' | 'enrollmentMode'>,
    topicTargetIds: string[],
  ): Promise<number> {
    if (mission.enrollmentMode === 'auto') {
      const staffRoles = MISSION_STAFF_ROLES.map((_, i) => `?${i + 4}`).join(', ');
      const result = await this.db
        .prepare(
          // Effective access, per user, for the targets only. Same rule as the single-user
          // CTE of `D1EnrollmentRepository.getEffectiveAccessTopicIds`
          // ((allow_tree ∪ public_set) − private_set), turned around so it costs one
          // statement for every user: a target is reachable when it is not private and
          // it is either public and not archived, or it or one of its ancestors is
          // granted to the user directly or through one of their groups (an ancestor
          // grant is what `allow_tree` expands downwards).
          `WITH RECURSIVE
             targets(id) AS (SELECT DISTINCT value FROM json_each(?2)),
             target_anc(target_id, anc_id) AS (
               SELECT id, id FROM targets
               UNION
               SELECT ta.target_id, tn.parent_id
                 FROM target_anc ta
                 JOIN topic_nodes tn ON tn.id = ta.anc_id
                WHERE tn.parent_id IS NOT NULL
             )
           INSERT INTO mission_enrollments (mission_id, user_id, source, counts_from)
           SELECT ?1, u.id, 'auto', ?3
             FROM users u
            WHERE u.status = 'active'
              AND NOT EXISTS (
                SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                 WHERE ur.user_id = u.id AND r.name IN (${staffRoles})
              )
              AND NOT EXISTS (
                SELECT 1 FROM targets t
                 WHERE EXISTS (SELECT 1 FROM topic_nodes p WHERE p.id = t.id AND p.visibility = 'private')
                    OR NOT (
                         EXISTS (SELECT 1 FROM topic_nodes pub
                                  WHERE pub.id = t.id AND pub.visibility = 'public' AND pub.archived = 0)
                      OR EXISTS (SELECT 1 FROM target_anc ta
                                   JOIN enrollments_user eu ON eu.topic_node_id = ta.anc_id
                                  WHERE ta.target_id = t.id AND eu.user_id = u.id)
                      OR EXISTS (SELECT 1 FROM target_anc ta
                                   JOIN enrollments_user_group eg ON eg.topic_node_id = ta.anc_id
                                   JOIN user_group_members ugm ON ugm.group_id = eg.group_id
                                  WHERE ta.target_id = t.id AND ugm.user_id = u.id)
                    )
              )
           ON CONFLICT (mission_id, user_id) DO NOTHING`,
        )
        .bind(mission.id, JSON.stringify(topicTargetIds), mission.startAt, ...MISSION_STAFF_ROLES)
        .run();
      return result.meta.changes;
    }

    if (mission.enrollmentMode === 'assigned') {
      const result = await this.db
        .prepare(
          `INSERT INTO mission_enrollments (mission_id, user_id, source, counts_from)
           SELECT ?1, u.id, 'admin', ?2
             FROM users u
            WHERE u.status = 'active'
              AND (
                u.id IN (SELECT au.user_id FROM mission_audience_user au WHERE au.mission_id = ?1)
                OR u.id IN (SELECT ugm.user_id
                              FROM mission_audience_group ag
                              JOIN user_group_members ugm ON ugm.group_id = ag.group_id
                             WHERE ag.mission_id = ?1)
              )
           ON CONFLICT (mission_id, user_id) DO NOTHING`,
        )
        .bind(mission.id, mission.startAt)
        .run();
      return result.meta.changes;
    }

    return 0; // 'open': only Join creates the enrollment.
  }

  async backfillEvidence(
    mission: Pick<Mission, 'id' | 'startAt' | 'endAt'>,
    requirement: Pick<MissionRequirement, 'id' | 'kind' | 'topicId'>,
  ): Promise<number> {
    if (requirement.topicId === null) return 0;

    if (requirement.kind === 'video_watched') {
      // The XP log keeps one `video` row per (user, media) — the first watch. Only
      // ready video media of the target topic count, as in the hook path.
      const result = await this.db
        .prepare(
          `INSERT INTO mission_evidence (requirement_id, user_id, ref_id, occurred_at, source)
           SELECT ?1, e.user_id, md.id, e.earned_at, 'backfill'
             FROM xp_events e
             JOIN media md ON md.id = e.source_id
             JOIN mission_enrollments me
               ON me.mission_id = ?2 AND me.user_id = e.user_id AND me.left_at IS NULL
            WHERE e.source_kind = 'video'
              AND md.topic_node_id = ?3
              AND md.status = 'ready'
              AND md.type LIKE 'video/%'
              AND datetime(e.earned_at) >= datetime(?4)
              AND datetime(e.earned_at) <= datetime(?5)
            ORDER BY datetime(e.earned_at)
           ON CONFLICT (requirement_id, user_id, ref_id) DO NOTHING`,
        )
        .bind(requirement.id, mission.id, requirement.topicId, mission.startAt, mission.endAt)
        .run();
      return result.meta.changes;
    }

    if (requirement.kind === 'topic_visited') {
      // Two instants per progress row: its creation always, its last update only
      // while `in_progress` (a completed row's `updated_at` is not a visit). The
      // primary key keeps one row per user; the earliest in-window instant wins.
      const result = await this.db
        .prepare(
          `INSERT INTO mission_evidence (requirement_id, user_id, ref_id, occurred_at, source)
           SELECT ?1, v.user_id, ?3, v.at, 'backfill'
             FROM (
               SELECT tp.user_id, tp.created_at AS at
                 FROM topic_progress tp
                 JOIN mission_enrollments me
                   ON me.mission_id = ?2 AND me.user_id = tp.user_id AND me.left_at IS NULL
                WHERE tp.topic_node_id = ?3
               UNION ALL
               SELECT tp.user_id, tp.updated_at AS at
                 FROM topic_progress tp
                 JOIN mission_enrollments me
                   ON me.mission_id = ?2 AND me.user_id = tp.user_id AND me.left_at IS NULL
                WHERE tp.topic_node_id = ?3 AND tp.status = 'in_progress'
             ) v
            WHERE datetime(v.at) >= datetime(?4)
              AND datetime(v.at) <= datetime(?5)
            ORDER BY datetime(v.at)
           ON CONFLICT (requirement_id, user_id, ref_id) DO NOTHING`,
        )
        .bind(requirement.id, mission.id, requirement.topicId, mission.startAt, mission.endAt)
        .run();
      return result.meta.changes;
    }

    return 0;
  }

  async join(missionId: string, userId: string, nowIso: string): Promise<MissionEnrollment> {
    // A re-join only clears left_at: source, joined_at and counts_from are kept,
    // so leaving and joining again can never reset the evidence window.
    await this.db
      .prepare(
        `INSERT INTO mission_enrollments (mission_id, user_id, source, joined_at, counts_from)
         VALUES (?, ?, 'self', ?, ?)
         ON CONFLICT (mission_id, user_id) DO UPDATE SET left_at = NULL`,
      )
      .bind(missionId, userId, nowIso, nowIso)
      .run();

    const enrollment = await this.findEnrollment(missionId, userId);
    if (!enrollment) {
      throw new Error(`D1MissionParticipationRepository: failed to fetch enrollment after join (missionId=${missionId})`);
    }
    return enrollment;
  }

  async leave(missionId: string, userId: string, nowIso: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE mission_enrollments SET left_at = ?
          WHERE mission_id = ? AND user_id = ? AND left_at IS NULL`,
      )
      .bind(nowIso, missionId, userId)
      .run();
    return result.meta.changes === 1;
  }

  async findEnrollment(missionId: string, userId: string): Promise<MissionEnrollment | null> {
    const row = await this.db
      .prepare('SELECT * FROM mission_enrollments WHERE mission_id = ? AND user_id = ?')
      .bind(missionId, userId)
      .first<EnrollmentRow>();
    return row ? this.rowToEnrollment(row) : null;
  }

  async listEnrollments(missionId: string, opts: { activeOnly?: boolean } = {}): Promise<MissionEnrollment[]> {
    const active = opts.activeOnly ? ' AND left_at IS NULL' : '';
    const { results } = await this.db
      .prepare(`SELECT * FROM mission_enrollments WHERE mission_id = ?${active} ORDER BY joined_at ASC, user_id ASC`)
      .bind(missionId)
      .all<EnrollmentRow>();
    return results.map((row) => this.rowToEnrollment(row));
  }

  async listUserEnrollments(userId: string, opts: { activeOnly?: boolean } = {}): Promise<MissionEnrollment[]> {
    const active = opts.activeOnly ? ' AND left_at IS NULL' : '';
    const { results } = await this.db
      .prepare(`SELECT * FROM mission_enrollments WHERE user_id = ?${active} ORDER BY joined_at ASC, mission_id ASC`)
      .bind(userId)
      .all<EnrollmentRow>();
    return results.map((row) => this.rowToEnrollment(row));
  }

  async listStepProgress(missionId: string, userId: string): Promise<MissionRequirementProgress[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM mission_requirement_progress WHERE mission_id = ? AND user_id = ?')
      .bind(missionId, userId)
      .all<ProgressRow>();
    return results.map((row) => this.rowToProgress(row));
  }

  async completeStep(args: {
    requirementId: string;
    userId: string;
    missionId: string;
    targetCount: number;
    completedAt: string;
    completedBy: CompletedBy;
  }): Promise<boolean> {
    const result = await this.db
      .prepare(
        `INSERT INTO mission_requirement_progress
           (requirement_id, user_id, mission_id, current_count, target_count,
            completed_at, completed_by, recorded_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT (requirement_id, user_id) DO UPDATE SET
           completed_at  = excluded.completed_at,
           current_count = excluded.target_count,
           target_count  = excluded.target_count,
           completed_by  = excluded.completed_by,
           recorded_at   = datetime('now'),
           updated_at    = datetime('now')
         WHERE mission_requirement_progress.completed_at IS NULL`,
      )
      .bind(
        args.requirementId,
        args.userId,
        args.missionId,
        args.targetCount,
        args.targetCount,
        args.completedAt,
        args.completedBy,
      )
      .run();
    return result.meta.changes === 1;
  }

  async setPartialCount(args: {
    requirementId: string;
    userId: string;
    missionId: string;
    currentCount: number;
    targetCount: number;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO mission_requirement_progress
           (requirement_id, user_id, mission_id, current_count, target_count, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT (requirement_id, user_id) DO UPDATE SET
           current_count = excluded.current_count,
           target_count  = excluded.target_count,
           updated_at    = datetime('now')
         WHERE mission_requirement_progress.completed_at IS NULL`,
      )
      .bind(args.requirementId, args.userId, args.missionId, args.currentCount, args.targetCount)
      .run();
  }

  async markChecked(args: {
    requirementId: string;
    userId: string;
    missionId: string;
    targetCount: number;
    checkedAt: string;
  }): Promise<boolean> {
    const result = await this.db
      .prepare(
        `INSERT INTO mission_requirement_progress
           (requirement_id, user_id, mission_id, current_count, target_count, checked_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?, datetime('now'))
         ON CONFLICT (requirement_id, user_id) DO UPDATE SET
           checked_at = excluded.checked_at,
           updated_at = datetime('now')
         WHERE mission_requirement_progress.checked_at IS NULL`,
      )
      .bind(args.requirementId, args.userId, args.missionId, args.targetCount, args.checkedAt)
      .run();
    return result.meta.changes === 1;
  }

  async captureEvidence(args: {
    requirementId: string;
    userId: string;
    refId: string;
    occurredAt: string;
    source: EvidenceSource;
  }): Promise<boolean> {
    const result = await this.db
      .prepare(
        `INSERT INTO mission_evidence (requirement_id, user_id, ref_id, occurred_at, source)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (requirement_id, user_id, ref_id) DO NOTHING`,
      )
      .bind(args.requirementId, args.userId, args.refId, args.occurredAt, args.source)
      .run();
    return result.meta.changes === 1;
  }

  private rowToEnrollment(row: EnrollmentRow): MissionEnrollment {
    return {
      missionId: row.mission_id,
      userId: row.user_id,
      source: row.source,
      joinedAt: row.joined_at,
      countsFrom: row.counts_from,
      leftAt: row.left_at,
    };
  }

  private rowToProgress(row: ProgressRow): MissionRequirementProgress {
    return {
      requirementId: row.requirement_id,
      userId: row.user_id,
      missionId: row.mission_id,
      currentCount: row.current_count,
      targetCount: row.target_count,
      checkedAt: row.checked_at,
      completedAt: row.completed_at,
      completedBy: row.completed_by,
      recordedAt: row.recorded_at,
      updatedAt: row.updated_at,
    };
  }
}
