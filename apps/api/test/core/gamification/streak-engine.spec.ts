import { describe, it, expect, vi } from 'vitest';
import { StreakEngine } from '@arenaquest/shared/domain/gamification/streak-engine';
import { toLocalDateString } from '@arenaquest/shared/domain/time/local-date';
import type { IGamificationRepository, UserStreakRecord } from '@arenaquest/shared/ports';

function makeStreakRecord(overrides: Partial<UserStreakRecord> = {}): UserStreakRecord {
  return {
    userId: 'user-1',
    currentStreak: 1,
    longestStreak: 1,
    lastActivityDate: '2024-01-10',
    updatedAt: '2024-01-10T00:00:00Z',
    ...overrides,
  };
}

function makeRepo(overrides: Partial<IGamificationRepository> = {}): IGamificationRepository {
  return {
    appendXpEvent: vi.fn(async () => ({ id: 'e', userId: 'user-1', sourceKind: 'x', sourceId: null, points: 0, idempotencyKey: 'k', earnedAt: '' })),
    getUserXp: vi.fn(async () => null),
    getUserStreak: vi.fn(async () => null),
    upsertUserStreak: vi.fn(async (_userId: string, params) => makeStreakRecord({ ...params })),
    listLevelDefinitions: vi.fn(async () => []),
    ...overrides,
  };
}

function makeEngine(repoOverrides: Partial<IGamificationRepository> = {}, timezone = 'UTC') {
  const repo = makeRepo(repoOverrides);
  const engine = new StreakEngine(repo, async () => timezone);
  return { repo, engine };
}

describe('StreakEngine', () => {
  describe('recordActivity', () => {
    it('creates streak at 1 on first activity ever', async () => {
      const { repo, engine } = makeEngine({ getUserStreak: vi.fn(async () => null) });
      await engine.recordActivity('user-1', new Date('2024-01-10T12:00:00Z'));

      expect(repo.upsertUserStreak).toHaveBeenCalledOnce();
      const call = (repo.upsertUserStreak as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toMatchObject({ currentStreak: 1, longestStreak: 1, lastActivityDate: '2024-01-10' });
    });

    it('is a no-op when called twice on the same local day', async () => {
      const existing = makeStreakRecord({ currentStreak: 3, longestStreak: 5, lastActivityDate: '2024-01-10' });
      const { repo, engine } = makeEngine({ getUserStreak: vi.fn(async () => existing) });

      await engine.recordActivity('user-1', new Date('2024-01-10T15:00:00Z'));

      expect(repo.upsertUserStreak).not.toHaveBeenCalled();
    });

    it('increments streak on the next day', async () => {
      const existing = makeStreakRecord({ currentStreak: 4, longestStreak: 4, lastActivityDate: '2024-01-10' });
      const { repo, engine } = makeEngine({ getUserStreak: vi.fn(async () => existing) });

      await engine.recordActivity('user-1', new Date('2024-01-11T08:00:00Z'));

      const call = (repo.upsertUserStreak as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toMatchObject({ currentStreak: 5, longestStreak: 5, lastActivityDate: '2024-01-11' });
    });

    it('resets streak to 1 after a gap greater than 1 day', async () => {
      const existing = makeStreakRecord({ currentStreak: 7, longestStreak: 10, lastActivityDate: '2024-01-05' });
      const { repo, engine } = makeEngine({ getUserStreak: vi.fn(async () => existing) });

      await engine.recordActivity('user-1', new Date('2024-01-10T08:00:00Z'));

      const call = (repo.upsertUserStreak as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toMatchObject({ currentStreak: 1, lastActivityDate: '2024-01-10' });
    });

    it('does not decrease longestStreak after a reset', async () => {
      const existing = makeStreakRecord({ currentStreak: 7, longestStreak: 10, lastActivityDate: '2024-01-05' });
      const { repo, engine } = makeEngine({ getUserStreak: vi.fn(async () => existing) });

      await engine.recordActivity('user-1', new Date('2024-01-10T08:00:00Z'));

      const call = (repo.upsertUserStreak as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1].longestStreak).toBe(10);
    });

    it('updates longestStreak when new streak exceeds it on increment', async () => {
      const existing = makeStreakRecord({ currentStreak: 6, longestStreak: 6, lastActivityDate: '2024-01-10' });
      const { repo, engine } = makeEngine({ getUserStreak: vi.fn(async () => existing) });

      await engine.recordActivity('user-1', new Date('2024-01-11T08:00:00Z'));

      const call = (repo.upsertUserStreak as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toMatchObject({ currentStreak: 7, longestStreak: 7 });
    });
  });

  describe('timezone handling', () => {
    it('resolves 2024-01-14 for 02:30 UTC in America/Sao_Paulo (UTC-3)', () => {
      const result = toLocalDateString(new Date('2024-01-15T02:30:00Z'), 'America/Sao_Paulo');
      expect(result).toBe('2024-01-14');
    });

    it('resolves 2024-01-15 for 03:30 UTC in America/Sao_Paulo (UTC-3)', () => {
      const result = toLocalDateString(new Date('2024-01-15T03:30:00Z'), 'America/Sao_Paulo');
      expect(result).toBe('2024-01-15');
    });

    it('crosses day boundary correctly for Sao_Paulo user near midnight', async () => {
      const repo = makeRepo();
      const engine = new StreakEngine(repo, async () => 'America/Sao_Paulo');

      // First activity: 02:30 UTC = 23:30 local on Jan 14
      const getStreakFn = repo.getUserStreak as ReturnType<typeof vi.fn>;

      getStreakFn.mockResolvedValueOnce(null);
      await engine.recordActivity('user-1', new Date('2024-01-15T02:30:00Z'));
      const firstCall = (repo.upsertUserStreak as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(firstCall[1].lastActivityDate).toBe('2024-01-14');

      // Second activity: 03:30 UTC = 00:30 local on Jan 15 — crosses midnight
      getStreakFn.mockResolvedValueOnce(makeStreakRecord({ currentStreak: 1, longestStreak: 1, lastActivityDate: '2024-01-14' }));
      await engine.recordActivity('user-1', new Date('2024-01-15T03:30:00Z'));
      const secondCall = (repo.upsertUserStreak as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(secondCall[1]).toMatchObject({ currentStreak: 2, lastActivityDate: '2024-01-15' });
    });

    it('defaults to UTC when getUserTimezone returns null', async () => {
      const repo = makeRepo({ getUserStreak: vi.fn(async () => null) });
      const engine = new StreakEngine(repo, async () => null);

      await engine.recordActivity('user-1', new Date('2024-01-15T00:30:00Z'));

      const call = (repo.upsertUserStreak as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1].lastActivityDate).toBe('2024-01-15');
    });
  });
});
