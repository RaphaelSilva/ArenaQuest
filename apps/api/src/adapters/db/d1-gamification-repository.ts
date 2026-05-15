import type {
  IGamificationRepository,
  XpEventRecord,
  UserXpRecord,
  UserStreakRecord,
  LevelDefinitionRecord,
  AppendXpEventParams,
  UpsertUserStreakParams,
  LeaderboardRow,
  GetLeaderboardParams,
  GetUserRankParams,
  UserRankRecord,
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

  // ---------------------------------------------------------------------------
  // Leaderboard
  // ---------------------------------------------------------------------------

  async getLeaderboard(params: GetLeaderboardParams): Promise<{ rows: LeaderboardRow[]; total: number }> {
    const { scope, topicId, period, weekStart, limit, offset } = params;

    const enrollmentFilter =
      scope === 'topic' && topicId
        ? `AND ux.user_id IN (
             SELECT user_id FROM enrollments_user WHERE topic_node_id = ?1
             UNION
             SELECT ugm.user_id FROM enrollments_user_group eug
             JOIN user_group_members ugm ON ugm.group_id = eug.group_id
             WHERE eug.topic_node_id = ?1
           )`
        : '';

    if (period === 'all_time') {
      const rowsSql = `
        SELECT
          ux.user_id,
          ux.total_xp,
          COALESCE(ld.level, 1) AS level,
          COALESCE(ld.rank_title, 'Aspirante') AS rank_title,
          COALESCE(MAX(xe.earned_at), '1970-01-01T00:00:00Z') AS last_xp_event_at
        FROM user_xp ux
        LEFT JOIN xp_events xe ON xe.user_id = ux.user_id
        LEFT JOIN level_definitions ld ON ld.level = (
          SELECT MAX(ld2.level) FROM level_definitions ld2 WHERE ld2.min_xp <= ux.total_xp
        )
        WHERE 1=1 ${enrollmentFilter}
        GROUP BY ux.user_id, ux.total_xp, ld.level, ld.rank_title
        ORDER BY ux.total_xp DESC, COALESCE(MAX(xe.earned_at), '1970-01-01T00:00:00Z') ASC
        LIMIT ?2 OFFSET ?3`;

      const countSql = `
        SELECT COUNT(*) AS cnt FROM user_xp ux WHERE 1=1 ${enrollmentFilter}`;

      if (scope === 'topic' && topicId) {
        const [rowsResult, countResult] = await Promise.all([
          this.db.prepare(rowsSql).bind(topicId, limit, offset).all<LeaderboardDbRow>(),
          this.db.prepare(countSql).bind(topicId).first<{ cnt: number }>(),
        ]);
        return {
          rows: rowsResult.results.map(rowToLeaderboardRow),
          total: countResult?.cnt ?? 0,
        };
      } else {
        const simpleRowsSql = `
          SELECT
            ux.user_id,
            ux.total_xp,
            COALESCE(ld.level, 1) AS level,
            COALESCE(ld.rank_title, 'Aspirante') AS rank_title,
            COALESCE(MAX(xe.earned_at), '1970-01-01T00:00:00Z') AS last_xp_event_at
          FROM user_xp ux
          LEFT JOIN xp_events xe ON xe.user_id = ux.user_id
          LEFT JOIN level_definitions ld ON ld.level = (
            SELECT MAX(ld2.level) FROM level_definitions ld2 WHERE ld2.min_xp <= ux.total_xp
          )
          GROUP BY ux.user_id, ux.total_xp, ld.level, ld.rank_title
          ORDER BY ux.total_xp DESC, COALESCE(MAX(xe.earned_at), '1970-01-01T00:00:00Z') ASC
          LIMIT ? OFFSET ?`;
        const [rowsResult, countResult] = await Promise.all([
          this.db.prepare(simpleRowsSql).bind(limit, offset).all<LeaderboardDbRow>(),
          this.db.prepare('SELECT COUNT(*) AS cnt FROM user_xp').first<{ cnt: number }>(),
        ]);
        return {
          rows: rowsResult.results.map(rowToLeaderboardRow),
          total: countResult?.cnt ?? 0,
        };
      }
    } else {
      // period = 'week'
      if (!weekStart) throw new Error('weekStart is required for period=week');

      if (scope === 'topic' && topicId) {
        const rowsSql = `
          SELECT
            xe.user_id,
            SUM(xe.points) AS total_xp,
            COALESCE(ld.level, 1) AS level,
            COALESCE(ld.rank_title, 'Aspirante') AS rank_title,
            MAX(xe.earned_at) AS last_xp_event_at
          FROM xp_events xe
          LEFT JOIN user_xp ux ON ux.user_id = xe.user_id
          LEFT JOIN level_definitions ld ON ld.level = (
            SELECT MAX(ld2.level) FROM level_definitions ld2 WHERE ld2.min_xp <= COALESCE(ux.total_xp, 0)
          )
          WHERE xe.earned_at >= ?
            AND xe.user_id IN (
              SELECT user_id FROM enrollments_user WHERE topic_node_id = ?
              UNION
              SELECT ugm.user_id FROM enrollments_user_group eug
              JOIN user_group_members ugm ON ugm.group_id = eug.group_id
              WHERE eug.topic_node_id = ?
            )
          GROUP BY xe.user_id, ld.level, ld.rank_title
          ORDER BY total_xp DESC, last_xp_event_at ASC
          LIMIT ? OFFSET ?`;
        const countSql = `
          SELECT COUNT(DISTINCT xe.user_id) AS cnt
          FROM xp_events xe
          WHERE xe.earned_at >= ?
            AND xe.user_id IN (
              SELECT user_id FROM enrollments_user WHERE topic_node_id = ?
              UNION
              SELECT ugm.user_id FROM enrollments_user_group eug
              JOIN user_group_members ugm ON ugm.group_id = eug.group_id
              WHERE eug.topic_node_id = ?
            )`;
        const [rowsResult, countResult] = await Promise.all([
          this.db.prepare(rowsSql).bind(weekStart, topicId, topicId, limit, offset).all<LeaderboardDbRow>(),
          this.db.prepare(countSql).bind(weekStart, topicId, topicId).first<{ cnt: number }>(),
        ]);
        return {
          rows: rowsResult.results.map(rowToLeaderboardRow),
          total: countResult?.cnt ?? 0,
        };
      } else {
        const rowsSql = `
          SELECT
            xe.user_id,
            SUM(xe.points) AS total_xp,
            COALESCE(ld.level, 1) AS level,
            COALESCE(ld.rank_title, 'Aspirante') AS rank_title,
            MAX(xe.earned_at) AS last_xp_event_at
          FROM xp_events xe
          LEFT JOIN user_xp ux ON ux.user_id = xe.user_id
          LEFT JOIN level_definitions ld ON ld.level = (
            SELECT MAX(ld2.level) FROM level_definitions ld2 WHERE ld2.min_xp <= COALESCE(ux.total_xp, 0)
          )
          WHERE xe.earned_at >= ?
          GROUP BY xe.user_id, ld.level, ld.rank_title
          ORDER BY total_xp DESC, last_xp_event_at ASC
          LIMIT ? OFFSET ?`;
        const countSql = `
          SELECT COUNT(DISTINCT user_id) AS cnt FROM xp_events WHERE earned_at >= ?`;
        const [rowsResult, countResult] = await Promise.all([
          this.db.prepare(rowsSql).bind(weekStart, limit, offset).all<LeaderboardDbRow>(),
          this.db.prepare(countSql).bind(weekStart).first<{ cnt: number }>(),
        ]);
        return {
          rows: rowsResult.results.map(rowToLeaderboardRow),
          total: countResult?.cnt ?? 0,
        };
      }
    }
  }

  async getUserRank(userId: string, params: GetUserRankParams): Promise<UserRankRecord> {
    const { scope, topicId, period, weekStart } = params;

    if (period === 'all_time') {
      const userXpRow = await this.db
        .prepare('SELECT * FROM user_xp WHERE user_id = ?')
        .bind(userId)
        .first<UserXpRow>();
      const totalXp = userXpRow?.total_xp ?? 0;

      const enrollmentFilter =
        scope === 'topic' && topicId
          ? `AND user_id IN (
               SELECT user_id FROM enrollments_user WHERE topic_node_id = ?
               UNION
               SELECT ugm.user_id FROM enrollments_user_group eug
               JOIN user_group_members ugm ON ugm.group_id = eug.group_id
               WHERE eug.topic_node_id = ?
             )`
          : '';

      let rankRow: { cnt: number } | null;
      if (scope === 'topic' && topicId) {
        rankRow = await this.db
          .prepare(`SELECT COUNT(*) + 1 AS cnt FROM user_xp WHERE total_xp > ? ${enrollmentFilter}`)
          .bind(totalXp, topicId, topicId)
          .first<{ cnt: number }>();
      } else {
        rankRow = await this.db
          .prepare('SELECT COUNT(*) + 1 AS cnt FROM user_xp WHERE total_xp > ?')
          .bind(totalXp)
          .first<{ cnt: number }>();
      }

      const levelRow = await this.db
        .prepare('SELECT level, rank_title FROM level_definitions WHERE min_xp <= ? ORDER BY level DESC LIMIT 1')
        .bind(totalXp)
        .first<{ level: number; rank_title: string }>();

      return {
        rank: rankRow?.cnt ?? 1,
        totalXp,
        level: levelRow?.level ?? 1,
        rankTitle: levelRow?.rank_title ?? 'Aspirante',
      };
    } else {
      // period = 'week'
      if (!weekStart) throw new Error('weekStart is required for period=week');

      const userWeekXpRow = await this.db
        .prepare('SELECT SUM(points) AS total_xp FROM xp_events WHERE user_id = ? AND earned_at >= ?')
        .bind(userId, weekStart)
        .first<{ total_xp: number | null }>();
      const totalXp = userWeekXpRow?.total_xp ?? 0;

      const enrollmentFilter =
        scope === 'topic' && topicId
          ? `AND user_id IN (
               SELECT user_id FROM enrollments_user WHERE topic_node_id = ?
               UNION
               SELECT ugm.user_id FROM enrollments_user_group eug
               JOIN user_group_members ugm ON ugm.group_id = eug.group_id
               WHERE eug.topic_node_id = ?
             )`
          : '';

      let rankRow: { cnt: number } | null;
      const higherXpSql = scope === 'topic' && topicId
        ? `SELECT COUNT(*) + 1 AS cnt FROM (
             SELECT user_id, SUM(points) AS week_xp FROM xp_events
             WHERE earned_at >= ? ${enrollmentFilter}
             GROUP BY user_id
           ) WHERE week_xp > ?`
        : `SELECT COUNT(*) + 1 AS cnt FROM (
             SELECT user_id, SUM(points) AS week_xp FROM xp_events
             WHERE earned_at >= ?
             GROUP BY user_id
           ) WHERE week_xp > ?`;

      if (scope === 'topic' && topicId) {
        rankRow = await this.db
          .prepare(higherXpSql)
          .bind(weekStart, topicId, topicId, totalXp)
          .first<{ cnt: number }>();
      } else {
        rankRow = await this.db
          .prepare(higherXpSql)
          .bind(weekStart, totalXp)
          .first<{ cnt: number }>();
      }

      const userAllTimeXpRow = await this.db
        .prepare('SELECT total_xp FROM user_xp WHERE user_id = ?')
        .bind(userId)
        .first<{ total_xp: number }>();
      const allTimeXp = userAllTimeXpRow?.total_xp ?? 0;

      const levelRow = await this.db
        .prepare('SELECT level, rank_title FROM level_definitions WHERE min_xp <= ? ORDER BY level DESC LIMIT 1')
        .bind(allTimeXp)
        .first<{ level: number; rank_title: string }>();

      return {
        rank: rankRow?.cnt ?? 1,
        totalXp,
        level: levelRow?.level ?? 1,
        rankTitle: levelRow?.rank_title ?? 'Aspirante',
      };
    }
  }
}

type LeaderboardDbRow = {
  user_id: string;
  total_xp: number;
  level: number;
  rank_title: string;
  last_xp_event_at: string | null;
};

function rowToLeaderboardRow(row: LeaderboardDbRow): LeaderboardRow {
  return {
    userId: row.user_id,
    totalXp: row.total_xp,
    level: row.level,
    rankTitle: row.rank_title,
    lastXpEventAt: row.last_xp_event_at === '1970-01-01T00:00:00Z' ? null : row.last_xp_event_at,
  };
}
