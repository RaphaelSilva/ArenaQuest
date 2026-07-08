import { D1Database } from '@cloudflare/workers-types';
import { QuestDefinition, QuestKind, QuestProgress, QuestWithProgress } from '@arenaquest/shared/domain/quest';
import { IQuestRepository, UpsertQuestProgressInput } from '@arenaquest/shared/ports/i-quest-repository';

type QuestDefinitionRow = {
  id: string;
  kind: string;
  title: string;
  description: string;
  predicate_kind: string;
  predicate_params: string;
  xp_reward: number;
  active: number;
  created_at: string;
  updated_at: string;
};

type QuestProgressRow = {
  user_id: string;
  quest_id: string;
  period_key: string;
  current_value: number;
  target_value: number;
  completed: number;
  completed_at: string | null;
  updated_at: string;
};

export class D1QuestRepository implements IQuestRepository {
  constructor(private readonly db: D1Database) {}

  private rowToDefinition(row: QuestDefinitionRow): QuestDefinition {
    return {
      id: row.id,
      kind: row.kind as QuestKind,
      title: row.title,
      description: row.description,
      predicateKind: row.predicate_kind,
      predicateParams: row.predicate_params,
      xpReward: row.xp_reward,
      active: row.active === 1,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private rowToProgress(row: QuestProgressRow): QuestProgress {
    return {
      userId: row.user_id,
      questId: row.quest_id,
      periodKey: row.period_key,
      currentValue: row.current_value,
      targetValue: row.target_value,
      completed: row.completed === 1,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      updatedAt: new Date(row.updated_at),
    };
  }

  private async findById(id: string): Promise<QuestDefinition | null> {
    const row = await this.db
      .prepare('SELECT * FROM quest_definitions WHERE id = ?')
      .bind(id)
      .first<QuestDefinitionRow>();
    return row ? this.rowToDefinition(row) : null;
  }

  async listAll(): Promise<QuestDefinition[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM quest_definitions ORDER BY created_at DESC')
      .all<QuestDefinitionRow>();
    return results.map(row => this.rowToDefinition(row));
  }

  async create(input: Omit<QuestDefinition, 'id' | 'createdAt' | 'updatedAt'>): Promise<QuestDefinition> {
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO quest_definitions (id, kind, title, description, predicate_kind, predicate_params, xp_reward, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.kind,
        input.title,
        input.description,
        input.predicateKind,
        input.predicateParams,
        input.xpReward,
        input.active ? 1 : 0,
      )
      .run();

    const created = await this.findById(id);
    if (!created) throw new Error('D1QuestRepository: failed to fetch quest after create');
    return created;
  }

  async update(id: string, partial: Partial<Omit<QuestDefinition, 'id' | 'createdAt' | 'updatedAt'>>): Promise<QuestDefinition | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (partial.kind !== undefined) {
      updates.push('kind = ?');
      values.push(partial.kind);
    }
    if (partial.title !== undefined) {
      updates.push('title = ?');
      values.push(partial.title);
    }
    if (partial.description !== undefined) {
      updates.push('description = ?');
      values.push(partial.description);
    }
    if (partial.predicateKind !== undefined) {
      updates.push('predicate_kind = ?');
      values.push(partial.predicateKind);
    }
    if (partial.predicateParams !== undefined) {
      updates.push('predicate_params = ?');
      values.push(partial.predicateParams);
    }
    if (partial.xpReward !== undefined) {
      updates.push('xp_reward = ?');
      values.push(partial.xpReward);
    }
    if (partial.active !== undefined) {
      updates.push('active = ?');
      values.push(partial.active ? 1 : 0);
    }

    if (updates.length === 0) {
      return existing;
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    await this.db
      .prepare(`UPDATE quest_definitions SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM quest_definitions WHERE id = ?')
      .bind(id)
      .run();
    return (result.meta.changes ?? 0) > 0;
  }

  async listActiveDefinitions(kind: QuestKind): Promise<QuestDefinition[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM quest_definitions WHERE kind = ? AND active = 1')
      .bind(kind)
      .all<QuestDefinitionRow>();

    return results.map(row => this.rowToDefinition(row));
  }

  async listActiveQuestsForUser(userId: string, kind: QuestKind, periodKey: string): Promise<QuestWithProgress[]> {
    const query = `
      SELECT qd.*, qp.user_id, qp.current_value, qp.target_value, qp.completed, qp.completed_at, qp.updated_at as progress_updated_at
      FROM quest_definitions qd
      LEFT JOIN quest_progress qp ON qd.id = qp.quest_id AND qp.user_id = ? AND qp.period_key = ?
      WHERE qd.kind = ? AND qd.active = 1
    `;

    const { results } = await this.db
      .prepare(query)
      .bind(userId, periodKey, kind)
      .all<QuestDefinitionRow & { progress_updated_at: string | null } & Partial<QuestProgressRow>>();

    return results.map(row => {
      const definition = this.rowToDefinition(row);
      const progress = row.user_id ? this.rowToProgress({
        user_id: row.user_id,
        quest_id: row.id,
        period_key: periodKey,
        current_value: row.current_value!,
        target_value: row.target_value!,
        completed: row.completed!,
        completed_at: row.completed_at!,
        updated_at: row.progress_updated_at!,
      }) : null;

      return { ...definition, progress };
    });
  }

  async findProgress(userId: string, questId: string, periodKey: string): Promise<QuestProgress | null> {
    const row = await this.db
      .prepare('SELECT * FROM quest_progress WHERE user_id = ? AND quest_id = ? AND period_key = ?')
      .bind(userId, questId, periodKey)
      .first<QuestProgressRow>();

    if (!row) return null;
    return this.rowToProgress(row);
  }

  async upsertProgress(input: UpsertQuestProgressInput): Promise<QuestProgress> {
    const { userId, questId, periodKey, incrementBy, targetValue } = input;

    const query = `
      INSERT INTO quest_progress (user_id, quest_id, period_key, current_value, target_value, completed, completed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, CASE WHEN ? >= ? THEN 1 ELSE 0 END, CASE WHEN ? >= ? THEN datetime('now') ELSE NULL END, datetime('now'))
      ON CONFLICT(user_id, quest_id, period_key) DO UPDATE SET
        current_value = current_value + EXCLUDED.current_value,
        completed = CASE WHEN current_value + EXCLUDED.current_value >= target_value THEN 1 ELSE completed END,
        completed_at = CASE WHEN current_value + EXCLUDED.current_value >= target_value AND completed = 0 THEN datetime('now') ELSE completed_at END,
        updated_at = datetime('now')
    `;

    await this.db
      .prepare(query)
      .bind(
        userId, questId, periodKey, incrementBy, targetValue, 
        incrementBy, targetValue, incrementBy, targetValue
      )
      .run();

    const progress = await this.findProgress(userId, questId, periodKey);
    if (!progress) throw new Error(`D1QuestRepository: failed to fetch progress after upsert (userId=${userId}, questId=${questId})`);
    return progress;
  }

  async markCompleted(userId: string, questId: string, periodKey: string): Promise<QuestProgress> {
    const query = `
      UPDATE quest_progress
      SET completed = 1, completed_at = datetime('now'), updated_at = datetime('now')
      WHERE user_id = ? AND quest_id = ? AND period_key = ?
    `;

    await this.db.prepare(query).bind(userId, questId, periodKey).run();

    const progress = await this.findProgress(userId, questId, periodKey);
    if (!progress) throw new Error(`D1QuestRepository: failed to fetch progress after markCompleted (userId=${userId}, questId=${questId})`);
    return progress;
  }
}
