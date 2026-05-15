import type { IMissionRepository } from '@arenaquest/shared/ports/i-mission-repository';
import type { Mission, MissionProgress } from '@arenaquest/shared/domain/mission';

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
  created_at: string;
  updated_at: string;
};

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
           current_value = MIN(target_value, current_value + ?),
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
         WHERE user_id = ? AND mission_id = ?`,
      )
      .bind(userId, missionId)
      .run();

    const progress = await this.findProgress(userId, missionId);
    if (!progress) throw new Error(`D1MissionRepository: failed to fetch progress after markCompleted (userId=${userId}, missionId=${missionId})`);
    return progress;
  }
}
