import type {
  IGamificationRepository,
  XpEventRecord,
  UserXpRecord,
  UserStreakRecord,
  LevelDefinitionRecord,
  AppendXpEventParams,
  UpsertUserStreakParams,
} from '@arenaquest/shared/ports';

type XpEventRow = {
  id: string;
  user_id: string;
  source_kind: string;
  source_id: string | null;
  points: number;
  idempotency_key: string;
  earned_at: string;
};

type UserXpRow = {
  user_id: string;
  total_xp: number;
  updated_at: string;
};

type UserStreakRow = {
  user_id: string;
  current_streak: number;
  longest_streak: number;
  last_activity_date: string | null;
  updated_at: string;
};

type LevelDefinitionRow = {
  level: number;
  rank_title: string;
  min_xp: number;
  max_xp: number | null;
};

function rowToXpEvent(row: XpEventRow): XpEventRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    points: row.points,
    idempotencyKey: row.idempotency_key,
    earnedAt: row.earned_at,
  };
}

function rowToUserXp(row: UserXpRow): UserXpRecord {
  return {
    userId: row.user_id,
    totalXp: row.total_xp,
    updatedAt: row.updated_at,
  };
}

function rowToUserStreak(row: UserStreakRow): UserStreakRecord {
  return {
    userId: row.user_id,
    currentStreak: row.current_streak,
    longestStreak: row.longest_streak,
    lastActivityDate: row.last_activity_date,
    updatedAt: row.updated_at,
  };
}

function rowToLevelDefinition(row: LevelDefinitionRow): LevelDefinitionRecord {
  return {
    level: row.level,
    rankTitle: row.rank_title,
    minXp: row.min_xp,
    maxXp: row.max_xp,
  };
}

export class D1GamificationRepository implements IGamificationRepository {
  constructor(private readonly db: D1Database) {}

  // ---------------------------------------------------------------------------
  // XP events
  // ---------------------------------------------------------------------------

  async appendXpEvent(params: AppendXpEventParams): Promise<XpEventRecord> {
    const id = crypto.randomUUID();

    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO xp_events (id, user_id, source_kind, source_id, points, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, params.userId, params.sourceKind, params.sourceId ?? null, params.points, params.idempotencyKey)
      .run();

    if (result.meta.changes > 0) {
      await this.db
        .prepare(
          `INSERT INTO user_xp (user_id, total_xp)
           VALUES (?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             total_xp   = total_xp + excluded.total_xp,
             updated_at = datetime('now')`,
        )
        .bind(params.userId, params.points)
        .run();
    }

    const row = await this.db
      .prepare(
        `SELECT * FROM xp_events
         WHERE user_id = ? AND source_kind = ? AND idempotency_key = ?`,
      )
      .bind(params.userId, params.sourceKind, params.idempotencyKey)
      .first<XpEventRow>();

    if (!row) throw new Error('D1GamificationRepository: xp_event not found after insert');
    return rowToXpEvent(row);
  }

  // ---------------------------------------------------------------------------
  // User XP read model
  // ---------------------------------------------------------------------------

  async getUserXp(userId: string): Promise<UserXpRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM user_xp WHERE user_id = ?')
      .bind(userId)
      .first<UserXpRow>();
    return row ? rowToUserXp(row) : null;
  }

  // ---------------------------------------------------------------------------
  // Streak
  // ---------------------------------------------------------------------------

  async getUserStreak(userId: string): Promise<UserStreakRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM user_streak WHERE user_id = ?')
      .bind(userId)
      .first<UserStreakRow>();
    return row ? rowToUserStreak(row) : null;
  }

  async upsertUserStreak(userId: string, params: UpsertUserStreakParams): Promise<UserStreakRecord> {
    await this.db
      .prepare(
        `INSERT INTO user_streak (user_id, current_streak, longest_streak, last_activity_date)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           current_streak      = excluded.current_streak,
           longest_streak      = excluded.longest_streak,
           last_activity_date  = excluded.last_activity_date,
           updated_at          = datetime('now')`,
      )
      .bind(userId, params.currentStreak, params.longestStreak, params.lastActivityDate)
      .run();

    const row = await this.getUserStreak(userId);
    if (!row) throw new Error('D1GamificationRepository: streak not found after upsert');
    return row;
  }

  // ---------------------------------------------------------------------------
  // Level definitions
  // ---------------------------------------------------------------------------

  async listLevelDefinitions(): Promise<LevelDefinitionRecord[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM level_definitions ORDER BY level ASC')
      .all<LevelDefinitionRow>();
    return results.map(rowToLevelDefinition);
  }

  // ---------------------------------------------------------------------------
  // Badge evaluation helpers
  // ---------------------------------------------------------------------------

  async countXpEventsBySource(userId: string, sourceKind: string, since?: string): Promise<number> {
    const row = since
      ? await this.db
          .prepare('SELECT COUNT(*) as cnt FROM xp_events WHERE user_id = ? AND source_kind = ? AND earned_at >= ?')
          .bind(userId, sourceKind, since)
          .first<{ cnt: number }>()
      : await this.db
          .prepare('SELECT COUNT(*) as cnt FROM xp_events WHERE user_id = ? AND source_kind = ?')
          .bind(userId, sourceKind)
          .first<{ cnt: number }>();
    return row?.cnt ?? 0;
  }

  async countAllCompletedTopics(userId: string): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) as cnt FROM topic_progress WHERE user_id = ? AND status = 'completed'")
      .bind(userId)
      .first<{ cnt: number }>();
    return row?.cnt ?? 0;
  }
}
