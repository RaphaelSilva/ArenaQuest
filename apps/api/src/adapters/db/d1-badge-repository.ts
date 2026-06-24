import { D1Database } from '@cloudflare/workers-types';
import type {
  IBadgeRepository,
  BadgeRecord,
  UserBadgeRecord,
  CreateBadgeParams,
  UpdateBadgeParams,
} from '@arenaquest/shared/ports';

type BadgeRow = {
  id: string;
  slug: string;
  name: string;
  icon_emoji: string;
  description: string;
  xp_reward: number;
  rule_kind: string;
  rule_params: string;
  active: number;
  created_at: string;
  updated_at: string;
};

type UserBadgeRow = {
  id: string;
  user_id: string;
  badge_id: string;
  earned_at: string;
};

function rowToBadge(row: BadgeRow): BadgeRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    iconEmoji: row.icon_emoji,
    description: row.description,
    xpReward: row.xp_reward,
    ruleKind: row.rule_kind,
    ruleParams: row.rule_params,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToUserBadge(row: UserBadgeRow): UserBadgeRecord {
  return {
    id: row.id,
    userId: row.user_id,
    badgeId: row.badge_id,
    earnedAt: row.earned_at,
  };
}

export class D1BadgeRepository implements IBadgeRepository {
  constructor(private readonly db: D1Database) {}

  async listActive(): Promise<BadgeRecord[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM badges WHERE active = 1 ORDER BY created_at ASC')
      .all<BadgeRow>();
    return results.map(rowToBadge);
  }

  async listAll(): Promise<BadgeRecord[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM badges ORDER BY created_at ASC')
      .all<BadgeRow>();
    return results.map(rowToBadge);
  }

  async findById(id: string): Promise<BadgeRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM badges WHERE id = ?')
      .bind(id)
      .first<BadgeRow>();
    return row ? rowToBadge(row) : null;
  }

  async findBySlug(slug: string): Promise<BadgeRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM badges WHERE slug = ?')
      .bind(slug)
      .first<BadgeRow>();
    return row ? rowToBadge(row) : null;
  }

  async create(params: CreateBadgeParams): Promise<BadgeRecord> {
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO badges (id, slug, name, icon_emoji, description, xp_reward, rule_kind, rule_params)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        params.slug,
        params.name,
        params.iconEmoji,
        params.description ?? '',
        params.xpReward ?? 0,
        params.ruleKind,
        params.ruleParams ?? '{}',
      )
      .run();

    const record = await this.findById(id);
    if (!record) throw new Error('D1BadgeRepository: badge not found after insert');
    return record;
  }

  async update(id: string, params: UpdateBadgeParams): Promise<BadgeRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (params.name !== undefined) { fields.push('name = ?'); values.push(params.name); }
    if (params.iconEmoji !== undefined) { fields.push('icon_emoji = ?'); values.push(params.iconEmoji); }
    if (params.description !== undefined) { fields.push('description = ?'); values.push(params.description); }
    if (params.xpReward !== undefined) { fields.push('xp_reward = ?'); values.push(params.xpReward); }
    if (params.ruleKind !== undefined) { fields.push('rule_kind = ?'); values.push(params.ruleKind); }
    if (params.ruleParams !== undefined) { fields.push('rule_params = ?'); values.push(params.ruleParams); }
    if (params.active !== undefined) { fields.push('active = ?'); values.push(params.active ? 1 : 0); }

    if (fields.length === 0) return existing;

    fields.push("updated_at = datetime('now')");
    values.push(id);

    await this.db
      .prepare(`UPDATE badges SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    return this.findById(id);
  }

  async awardBadge(userId: string, badgeId: string): Promise<UserBadgeRecord> {
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO user_badges (id, user_id, badge_id) VALUES (?, ?, ?)`,
      )
      .bind(id, userId, badgeId)
      .run();

    const row = await this.db
      .prepare('SELECT * FROM user_badges WHERE user_id = ? AND badge_id = ?')
      .bind(userId, badgeId)
      .first<UserBadgeRow>();

    if (!row) throw new Error('D1BadgeRepository: user_badge not found after award');
    return rowToUserBadge(row);
  }

  async listUserBadges(userId: string): Promise<UserBadgeRecord[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM user_badges WHERE user_id = ? ORDER BY earned_at ASC')
      .bind(userId)
      .all<UserBadgeRow>();
    return results.map(rowToUserBadge);
  }

  async revokeBadge(userId: string, badgeId: string): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?')
      .bind(userId, badgeId)
      .run();
    return result.meta.changes > 0;
  }
}
