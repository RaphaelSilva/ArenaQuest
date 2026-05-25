import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { D1GamificationRepository } from '@api/adapters/db/d1-gamification-repository';
import { applyMigrations } from '../helpers/apply-migrations';


describe('D1GamificationRepository', () => {
  let repo: D1GamificationRepository;
  let userId: string;

  beforeAll(async () => {
    await applyMigrations(env.DB);

    repo = new D1GamificationRepository(env.DB);
  });

  beforeEach(async () => {
    userId = crypto.randomUUID();
    await env.DB
      .prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .bind(userId, 'test', `u-${userId}@test.com`, 'hash')
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
