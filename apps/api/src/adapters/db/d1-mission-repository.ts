import type {
  IMissionRepository,
  MissionAudience,
  MissionCandidate,
  MissionCreateInput,
} from '@arenaquest/shared/ports/i-mission-repository';
import type { Mission, MissionProgress, MissionRequirement } from '@arenaquest/shared/domain/mission';
import {
  REQUIREMENTS_PREDICATE_KIND,
  parseRequirementParams,
  type RequirementInput,
  type RequirementKind,
} from '@arenaquest/shared/domain/missions/requirements';

type MissionRow = {
  id: string;
  title: string;
  description: string;
  start_at: string;
  end_at: string;
  predicate_kind: string;
  predicate_params: string;
  xp_reward: number;
  badge_id: string | null;
  active: number;
  // Columns added by migration 0031 (RFC 0022 section 1).
  mode: Mission['mode'] | null;
  enrollment_mode: Mission['enrollmentMode'] | null;
  created_at: string;
  updated_at: string;
};

type RequirementRow = {
  id: string;
  mission_id: string;
  position: number;
  kind: RequirementKind;
  title: string;
  topic_node_id: string | null;
  event_id: string | null;
  params: string;
  xp_reward: number;
  created_at: string;
  updated_at: string;
};

/** A requirement joined with its mission: the requirement columns carry an `r_` prefix. */
type CandidateRow = MissionRow & {
  r_id: string;
  r_mission_id: string;
  r_position: number;
  r_kind: RequirementKind;
  r_title: string;
  r_topic_node_id: string | null;
  r_event_id: string | null;
  r_params: string;
  r_xp_reward: number;
  r_created_at: string;
  r_updated_at: string;
};

/**
 * Window predicate of an active mission at `?` (bound twice). Both sides go through
 * `datetime()`: `missions` stores ISO-8601 strings, callers may pass either form.
 */
const IN_WINDOW_SQL = 'datetime(m.start_at) <= datetime(?) AND datetime(?) <= datetime(m.end_at)';

type MissionProgressRow = {
  user_id: string;
  mission_id: string;
  current_value: number;
  target_value: number;
  completed: number;
  completed_at: string | null;
  updated_at: string;
};

export class D1MissionRepository implements IMissionRepository {
  constructor(private readonly db: D1Database) {}
  
  async findById(id: string): Promise<Mission | null> {
    const row = await this.db
      .prepare('SELECT * FROM missions WHERE id = ?')
      .bind(id)
      .first<MissionRow>();
    return row ? this.rowToMission(row) : null;
  }

  async create(mission: MissionCreateInput): Promise<Mission> {
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO missions (id, title, description, start_at, end_at, predicate_kind, predicate_params, xp_reward, badge_id, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        mission.title,
        mission.description,
        mission.startAt,
        mission.endAt,
        mission.predicateKind,
        mission.predicateParams,
        mission.xpReward,
        mission.badgeId,
        mission.active ? 1 : 0
      )
      .run();

    const created = await this.findById(id);
    if (!created) throw new Error('D1MissionRepository: failed to fetch mission after create');
    return created;
  }

  async update(id: string, mission: Partial<Omit<Mission, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Mission> {
    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (mission.title !== undefined) {
      updates.push('title = ?');
      values.push(mission.title);
    }
    if (mission.description !== undefined) {
      updates.push('description = ?');
      values.push(mission.description);
    }
    if (mission.startAt !== undefined) {
      updates.push('start_at = ?');
      values.push(mission.startAt);
    }
    if (mission.endAt !== undefined) {
      updates.push('end_at = ?');
      values.push(mission.endAt);
    }
    if (mission.predicateKind !== undefined) {
      updates.push('predicate_kind = ?');
      values.push(mission.predicateKind);
    }
    if (mission.predicateParams !== undefined) {
      updates.push('predicate_params = ?');
      values.push(mission.predicateParams);
    }
    if (mission.xpReward !== undefined) {
      updates.push('xp_reward = ?');
      values.push(mission.xpReward);
    }
    if (mission.badgeId !== undefined) {
      updates.push('badge_id = ?');
      values.push(mission.badgeId);
    }
    if (mission.active !== undefined) {
      updates.push('active = ?');
      values.push(mission.active ? 1 : 0);
    }
    if (mission.mode !== undefined) {
      updates.push('mode = ?');
      values.push(mission.mode);
    }
    if (mission.enrollmentMode !== undefined) {
      updates.push('enrollment_mode = ?');
      values.push(mission.enrollmentMode);
    }

    if (updates.length === 0) {
      const existing = await this.findById(id);
      if (!existing) throw new Error('D1MissionRepository: mission not found for update');
      return existing;
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    await this.db
      .prepare(`UPDATE missions SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    const updated = await this.findById(id);
    if (!updated) throw new Error('D1MissionRepository: failed to fetch mission after update');
    return updated;
  }

  async listAll(): Promise<Mission[]> {
    const { results } = await this.db.prepare('SELECT * FROM missions ORDER BY created_at DESC').all<MissionRow>();
    return results.map((row) => this.rowToMission(row));
  }

  private rowToMission(row: MissionRow): Mission {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      startAt: row.start_at,
      endAt: row.end_at,
      predicateKind: row.predicate_kind,
      predicateParams: row.predicate_params,
      xpReward: row.xp_reward,
      badgeId: row.badge_id,
      active: row.active === 1,
      mode: row.mode ?? 'parallel',
      enrollmentMode: row.enrollment_mode ?? 'auto',
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private rowToProgress(row: MissionProgressRow): MissionProgress {
    return {
      userId: row.user_id,
      missionId: row.mission_id,
      currentValue: row.current_value,
      targetValue: row.target_value,
      completed: row.completed === 1,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      updatedAt: new Date(row.updated_at),
    };
  }

  async listActiveMissions(nowIso: string): Promise<Mission[]> {
    const { results } = await this.db
      .prepare(
        'SELECT * FROM missions WHERE active = 1 AND start_at <= ? AND end_at >= ? ORDER BY end_at ASC',
      )
      .bind(nowIso, nowIso)
      .all<MissionRow>();

    return results.map(row => this.rowToMission(row));
  }

  async findProgress(userId: string, missionId: string): Promise<MissionProgress | null> {
    const row = await this.db
      .prepare('SELECT * FROM mission_progress WHERE user_id = ? AND mission_id = ?')
      .bind(userId, missionId)
      .first<MissionProgressRow>();

    if (!row) return null;
    return this.rowToProgress(row);
  }

  async upsertProgress(userId: string, missionId: string, increment: number, target: number): Promise<MissionProgress> {
    await this.db
      .prepare(
        `INSERT INTO mission_progress (user_id, mission_id, current_value, target_value, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, mission_id) DO UPDATE SET
           current_value = MIN(excluded.target_value, current_value + ?),
           target_value = excluded.target_value,
           updated_at = datetime('now')`,
      )
      .bind(userId, missionId, Math.min(increment, target), target, increment)
      .run();

    const progress = await this.findProgress(userId, missionId);
    if (!progress) throw new Error(`D1MissionRepository: failed to fetch progress after upsert (userId=${userId}, missionId=${missionId})`);

    if (!progress.completed && progress.currentValue >= progress.targetValue) {
      return this.markCompleted(userId, missionId);
    }
    return progress;
  }

  async markCompleted(userId: string, missionId: string): Promise<MissionProgress> {
    await this.db
      .prepare(
        `UPDATE mission_progress
         SET completed = 1, completed_at = datetime('now'), updated_at = datetime('now')
         WHERE user_id = ? AND mission_id = ? AND completed = 0`,
      )
      .bind(userId, missionId)
      .run();

    const progress = await this.findProgress(userId, missionId);
    if (!progress) throw new Error(`D1MissionRepository: failed to fetch progress after markCompleted (userId=${userId}, missionId=${missionId})`);
    return progress;
  }

  async createWithRequirements(
    input: MissionCreateInput,
    requirements: RequirementInput[],
  ): Promise<{ mission: Mission; requirements: MissionRequirement[] }> {
    const id = crypto.randomUUID();
    const insertMission = this.db
      .prepare(
        `INSERT INTO missions
           (id, title, description, start_at, end_at, predicate_kind, predicate_params,
            xp_reward, badge_id, active, mode, enrollment_mode)
         VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.title,
        input.description,
        input.startAt,
        input.endAt,
        REQUIREMENTS_PREDICATE_KIND,
        input.xpReward,
        input.badgeId,
        input.active ? 1 : 0,
        input.mode ?? 'parallel',
        input.enrollmentMode ?? 'auto',
      );
    await this.db.batch([insertMission, ...this.requirementInserts(id, requirements)]);

    const mission = await this.findById(id);
    if (!mission) throw new Error('D1MissionRepository: failed to fetch mission after createWithRequirements');
    return { mission, requirements: await this.listRequirements(id) };
  }

  async listRequirements(missionId: string): Promise<MissionRequirement[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM mission_requirements WHERE mission_id = ? ORDER BY position ASC')
      .bind(missionId)
      .all<RequirementRow>();
    return results.map((row) => this.rowToRequirement(row));
  }

  async replaceRequirements(missionId: string, requirements: RequirementInput[]): Promise<MissionRequirement[]> {
    await this.db.batch([
      this.db.prepare('DELETE FROM mission_requirements WHERE mission_id = ?').bind(missionId),
      ...this.requirementInserts(missionId, requirements),
    ]);
    return this.listRequirements(missionId);
  }

  async updateRequirementTitle(
    missionId: string,
    requirementId: string,
    title: string,
  ): Promise<MissionRequirement | null> {
    const row = await this.db
      .prepare(
        `UPDATE mission_requirements SET title = ?, updated_at = datetime('now')
          WHERE id = ? AND mission_id = ?
          RETURNING *`,
      )
      .bind(title, requirementId, missionId)
      .first<RequirementRow>();
    return row ? this.rowToRequirement(row) : null;
  }

  async findCandidateRequirements(
    target: { kind: RequirementKind; topicId?: string; eventId?: string },
    nowIso: string,
  ): Promise<MissionCandidate[]> {
    // The target filter matches one of the two partial indexes; a kind with neither
    // target (manual_check) only matches rows whose two target columns are NULL.
    let targetSql: string;
    const targetValues: string[] = [];
    if (target.topicId !== undefined) {
      targetSql = 'r.topic_node_id = ?';
      targetValues.push(target.topicId);
    } else if (target.eventId !== undefined) {
      targetSql = 'r.event_id = ?';
      targetValues.push(target.eventId);
    } else {
      targetSql = 'r.topic_node_id IS NULL AND r.event_id IS NULL';
    }

    const { results } = await this.db
      .prepare(
        `SELECT m.*,
                r.id AS r_id, r.mission_id AS r_mission_id, r.position AS r_position, r.kind AS r_kind,
                r.title AS r_title, r.topic_node_id AS r_topic_node_id, r.event_id AS r_event_id,
                r.params AS r_params, r.xp_reward AS r_xp_reward,
                r.created_at AS r_created_at, r.updated_at AS r_updated_at
           FROM mission_requirements r
           JOIN missions m ON m.id = r.mission_id
          WHERE ${targetSql}
            AND r.kind = ?
            AND m.active = 1
            AND m.predicate_kind = ?
            AND ${IN_WINDOW_SQL}
          ORDER BY m.end_at ASC, m.id ASC, r.position ASC`,
      )
      .bind(...targetValues, target.kind, REQUIREMENTS_PREDICATE_KIND, nowIso, nowIso)
      .all<CandidateRow>();

    return results.map((row) => ({
      mission: this.rowToMission(row),
      requirement: this.rowToRequirement({
        id: row.r_id,
        mission_id: row.r_mission_id,
        position: row.r_position,
        kind: row.r_kind,
        title: row.r_title,
        topic_node_id: row.r_topic_node_id,
        event_id: row.r_event_id,
        params: row.r_params,
        xp_reward: row.r_xp_reward,
        created_at: row.r_created_at,
        updated_at: row.r_updated_at,
      }),
    }));
  }

  async getAudience(missionId: string): Promise<MissionAudience> {
    const [groups, users] = await this.db.batch<{ id: string }>([
      this.db
        .prepare('SELECT group_id AS id FROM mission_audience_group WHERE mission_id = ? ORDER BY group_id')
        .bind(missionId),
      this.db
        .prepare('SELECT user_id AS id FROM mission_audience_user WHERE mission_id = ? ORDER BY user_id')
        .bind(missionId),
    ]);
    return {
      groupIds: (groups?.results ?? []).map((r) => r.id),
      userIds: (users?.results ?? []).map((r) => r.id),
    };
  }

  /** Replace-all, like event audiences: one batch, so a reader never sees half a list. */
  async replaceAudience(missionId: string, audience: MissionAudience): Promise<void> {
    const statements: D1PreparedStatement[] = [
      this.db.prepare('DELETE FROM mission_audience_group WHERE mission_id = ?').bind(missionId),
      this.db.prepare('DELETE FROM mission_audience_user WHERE mission_id = ?').bind(missionId),
    ];
    for (const groupId of new Set(audience.groupIds)) {
      statements.push(
        this.db
          .prepare('INSERT INTO mission_audience_group (mission_id, group_id) VALUES (?, ?)')
          .bind(missionId, groupId),
      );
    }
    for (const userId of new Set(audience.userIds)) {
      statements.push(
        this.db
          .prepare('INSERT INTO mission_audience_user (mission_id, user_id) VALUES (?, ?)')
          .bind(missionId, userId),
      );
    }
    await this.db.batch(statements);
  }

  async listActiveLegacyMissions(nowIso: string): Promise<Mission[]> {
    return this.listActiveByPredicate('<>', nowIso);
  }

  async listActiveRequirementMissions(nowIso: string): Promise<Mission[]> {
    return this.listActiveByPredicate('=', nowIso);
  }

  private async listActiveByPredicate(op: '=' | '<>', nowIso: string): Promise<Mission[]> {
    const { results } = await this.db
      .prepare(
        `SELECT m.* FROM missions m
          WHERE m.active = 1 AND m.predicate_kind ${op} ? AND ${IN_WINDOW_SQL}
          ORDER BY m.end_at ASC, m.id ASC`,
      )
      .bind(REQUIREMENTS_PREDICATE_KIND, nowIso, nowIso)
      .all<MissionRow>();
    return results.map((row) => this.rowToMission(row));
  }

  /** One INSERT per requirement; positions follow the array order starting at 1. */
  private requirementInserts(missionId: string, requirements: RequirementInput[]): D1PreparedStatement[] {
    return requirements.map((requirement, index) =>
      this.db
        .prepare(
          `INSERT INTO mission_requirements
             (id, mission_id, position, kind, title, topic_node_id, event_id, params, xp_reward)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          missionId,
          index + 1,
          requirement.kind,
          requirement.title,
          'topicId' in requirement ? requirement.topicId : null,
          'eventId' in requirement ? requirement.eventId : null,
          JSON.stringify(parseRequirementParams(requirement.kind, requirement.params ?? {})),
          requirement.xpReward ?? 0,
        ),
    );
  }

  private rowToRequirement(row: RequirementRow): MissionRequirement {
    return {
      id: row.id,
      missionId: row.mission_id,
      position: row.position,
      kind: row.kind,
      title: row.title,
      topicId: row.topic_node_id,
      eventId: row.event_id,
      params: parseRequirementParams(row.kind, JSON.parse(row.params)),
      xpReward: row.xp_reward,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async countCompletedMissions(userId: string): Promise<number> {
    const row = await this.db
      .prepare('SELECT COUNT(*) as cnt FROM mission_progress WHERE user_id = ? AND completed = 1')
      .bind(userId)
      .first<{ cnt: number }>();
    return row?.cnt ?? 0;
  }
}
