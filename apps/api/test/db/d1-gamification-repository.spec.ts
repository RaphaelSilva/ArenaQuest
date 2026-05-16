import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { D1GamificationRepository } from '@api/adapters/db/d1-gamification-repository';

const MIGRATION_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id    TEXT NOT NULL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE
  )`,
  `CREATE TABLE IF NOT EXISTS xp_events (
    id               TEXT    NOT NULL PRIMARY KEY,
    user_id          TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_kind      TEXT    NOT NULL,
    source_id        TEXT,
    points           INTEGER NOT NULL,
    idempotency_key  TEXT    NOT NULL,
    earned_at        TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_xp_events_idempotency
    ON xp_events(user_id, source_kind, idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS idx_xp_events_user ON xp_events(user_id)`,
  `CREATE TABLE IF NOT EXISTS user_xp (
    user_id    TEXT    NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    total_xp   INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS user_streak (
    user_id             TEXT    NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_streak      INTEGER NOT NULL DEFAULT 0,
    longest_streak      INTEGER NOT NULL DEFAULT 0,
    last_activity_date  TEXT,
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS level_definitions (
    level      INTEGER NOT NULL PRIMARY KEY,
    rank_title TEXT    NOT NULL,
    min_xp     INTEGER NOT NULL,
    max_xp     INTEGER
  )`,
];

const LEVEL_SEED = [
  [1,  'Aspirante',        0,     100],
  [2,  'Aspirante',        100,   300],
  [3,  'Aspirante',        300,   600],
  [4,  'Aspirante',        600,   1000],
  [5,  'Treinador Júnior', 1000,  1500],
  [6,  'Treinador Júnior', 1500,  2100],
  [7,  'Treinador Júnior', 2100,  2800],
  [8,  'Treinador Júnior', 2800,  3600],
  [9,  'Treinador Júnior', 3600,  4500],
  [10, 'Treinador',        4500,  5500],
  [11, 'Treinador',        5500,  6600],
  [12, 'Treinador',        6600,  7800],
  [13, 'Treinador',        7800,  9100],
  [14, 'Treinador',        9100,  10500],
  [15, 'Treinador Sênior', 10500, 12000],
  [16, 'Treinador Sênior', 12000, 13600],
  [17, 'Treinador Sênior', 13600, 15300],
  [18, 'Treinador Sênior', 15300, 17100],
  [19, 'Treinador Sênior', 17100, 19000],
  [20, 'Especialista',     19000, 21000],
  [21, 'Especialista',     21000, 23100],
  [22, 'Especialista',     23100, 25300],
  [23, 'Especialista',     25300, 27600],
  [24, 'Especialista',     27600, 30000],
  [25, 'Mestre',           30000, 32500],
  [26, 'Mestre',           32500, 35100],
  [27, 'Mestre',           35100, 37800],
  [28, 'Mestre',           37800, 40600],
  [29, 'Mestre',           40600, 43500],
  [30, 'Grão-Mestre',      43500, null],
] as const;

describe('D1GamificationRepository', () => {
  let repo: D1GamificationRepository;
  let userId: string;

  beforeAll(async () => {
    await env.DB.batch(MIGRATION_STATEMENTS.map((sql) => env.DB.prepare(sql)));

    const seedStmts = LEVEL_SEED.map(([level, rankTitle, minXp, maxXp]) =>
      env.DB
        .prepare('INSERT OR IGNORE INTO level_definitions (level, rank_title, min_xp, max_xp) VALUES (?, ?, ?, ?)')
        .bind(level, rankTitle, minXp, maxXp),
    );
    await env.DB.batch(seedStmts);

    repo = new D1GamificationRepository(env.DB);
  });

  beforeEach(async () => {
    userId = crypto.randomUUID();
    await env.DB
      .prepare('INSERT INTO users (id, email) VALUES (?, ?)')
      .bind(userId, `u-${userId}@test.com`)
      .run();
  });

  // ---------------------------------------------------------------------------
  // appendXpEvent — idempotency
  // ---------------------------------------------------------------------------

  describe('appendXpEvent', () => {
    it('inserts a new xp_event and credits user_xp', async () => {
      const event = await repo.appendXpEvent({
        userId,
        sourceKind: 'task_complete',
        sourceId: 'task-1',
        points: 50,
        idempotencyKey: 'key-1',
      });

      expect(event.userId).toBe(userId);
      expect(event.sourceKind).toBe('task_complete');
      expect(event.points).toBe(50);
      expect(event.idempotencyKey).toBe('key-1');

      const xp = await repo.getUserXp(userId);
      expect(xp?.totalXp).toBe(50);
    });

    it('is idempotent — duplicate call returns same event, no double credit', async () => {
      const params = {
        userId,
        sourceKind: 'task_complete',
        sourceId: 'task-2',
        points: 30,
        idempotencyKey: 'key-2',
      };

      const first = await repo.appendXpEvent(params);
      const second = await repo.appendXpEvent(params);

      expect(first.id).toBe(second.id);

      const xp = await repo.getUserXp(userId);
      expect(xp?.totalXp).toBe(30);

      const rows = await env.DB
        .prepare('SELECT COUNT(*) AS n FROM xp_events WHERE user_id = ?')
        .bind(userId)
        .first<{ n: number }>();
      expect(rows?.n).toBe(1);
    });

    it('accumulates total_xp across multiple distinct events', async () => {
      await repo.appendXpEvent({ userId, sourceKind: 'task_complete', points: 100, idempotencyKey: 'a' });
      await repo.appendXpEvent({ userId, sourceKind: 'topic_complete', points: 75, idempotencyKey: 'b' });
      await repo.appendXpEvent({ userId, sourceKind: 'streak_bonus', points: 25, idempotencyKey: 'c' });

      const xp = await repo.getUserXp(userId);
      expect(xp?.totalXp).toBe(200);
    });

    it('allows same idempotency_key for different source_kind', async () => {
      await repo.appendXpEvent({ userId, sourceKind: 'task_complete', points: 40, idempotencyKey: 'shared-key' });
      await repo.appendXpEvent({ userId, sourceKind: 'topic_complete', points: 60, idempotencyKey: 'shared-key' });

      const xp = await repo.getUserXp(userId);
      expect(xp?.totalXp).toBe(100);
    });
  });

  // ---------------------------------------------------------------------------
  // getUserXp
  // ---------------------------------------------------------------------------

  describe('getUserXp', () => {
    it('returns null for a user with no XP events', async () => {
      const xp = await repo.getUserXp(userId);
      expect(xp).toBeNull();
    });

    it('returns the correct record after events', async () => {
      await repo.appendXpEvent({ userId, sourceKind: 'task_complete', points: 80, idempotencyKey: 'q1' });
      const xp = await repo.getUserXp(userId);
      expect(xp?.userId).toBe(userId);
      expect(xp?.totalXp).toBe(80);
      expect(typeof xp?.updatedAt).toBe('string');
    });
  });

  // ---------------------------------------------------------------------------
  // upsertUserStreak / getUserStreak
  // ---------------------------------------------------------------------------

  describe('upsertUserStreak / getUserStreak', () => {
    it('returns null when no streak record exists', async () => {
      const streak = await repo.getUserStreak(userId);
      expect(streak).toBeNull();
    });

    it('creates a streak record on first upsert', async () => {
      const streak = await repo.upsertUserStreak(userId, {
        currentStreak: 3,
        longestStreak: 3,
        lastActivityDate: '2026-05-13',
      });

      expect(streak.userId).toBe(userId);
      expect(streak.currentStreak).toBe(3);
      expect(streak.longestStreak).toBe(3);
      expect(streak.lastActivityDate).toBe('2026-05-13');
    });

    it('updates streak values on subsequent upsert', async () => {
      await repo.upsertUserStreak(userId, {
        currentStreak: 5,
        longestStreak: 5,
        lastActivityDate: '2026-05-12',
      });

      const updated = await repo.upsertUserStreak(userId, {
        currentStreak: 6,
        longestStreak: 6,
        lastActivityDate: '2026-05-13',
      });

      expect(updated.currentStreak).toBe(6);
      expect(updated.longestStreak).toBe(6);
      expect(updated.lastActivityDate).toBe('2026-05-13');
    });

    it('preserves longest_streak when current_streak resets', async () => {
      await repo.upsertUserStreak(userId, {
        currentStreak: 10,
        longestStreak: 10,
        lastActivityDate: '2026-05-01',
      });

      const reset = await repo.upsertUserStreak(userId, {
        currentStreak: 1,
        longestStreak: 10,
        lastActivityDate: '2026-05-13',
      });

      expect(reset.currentStreak).toBe(1);
      expect(reset.longestStreak).toBe(10);
    });
  });

  // ---------------------------------------------------------------------------
  // listLevelDefinitions
  // ---------------------------------------------------------------------------

  describe('listLevelDefinitions', () => {
    it('returns all 30 level definitions ordered by level', async () => {
      const levels = await repo.listLevelDefinitions();
      expect(levels).toHaveLength(30);
      expect(levels[0].level).toBe(1);
      expect(levels[29].level).toBe(30);
    });

    it('level 1 starts at 0 XP and last level has null maxXp', async () => {
      const levels = await repo.listLevelDefinitions();
      expect(levels[0].minXp).toBe(0);
      expect(levels[0].rankTitle).toBe('Aspirante');
      expect(levels[29].maxXp).toBeNull();
      expect(levels[29].rankTitle).toBe('Grão-Mestre');
    });

    it('XP boundaries are strictly ascending', async () => {
      const levels = await repo.listLevelDefinitions();
      for (let i = 1; i < levels.length; i++) {
        expect(levels[i].minXp).toBeGreaterThan(levels[i - 1].minXp);
      }
    });
  });
});
