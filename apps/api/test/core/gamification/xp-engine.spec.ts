import { describe, it, expect, vi } from 'vitest';
import { XpEngine } from '@arenaquest/shared/domain/gamification/xp-engine';
import { XP_POINTS } from '@arenaquest/shared/domain/gamification/xp-config';
import type { IGamificationRepository, XpEventRecord } from '@arenaquest/shared/ports';

function makeXpEvent(overrides: Partial<XpEventRecord> = {}): XpEventRecord {
  return {
    id: 'evt-1',
    userId: 'user-1',
    sourceKind: 'topic',
    sourceId: 'topic-abc',
    points: 100,
    idempotencyKey: 'topic:topic-abc:v1',
    earnedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeRepo(overrides: Partial<IGamificationRepository> = {}): IGamificationRepository {
  return {
    appendXpEvent: vi.fn(async () => makeXpEvent()),
    getUserXp: vi.fn(async () => null),
    getUserStreak: vi.fn(async () => null),
    upsertUserStreak: vi.fn(async () => ({ userId: 'user-1', currentStreak: 0, longestStreak: 0, lastActivityDate: null, updatedAt: '2026-01-01T00:00:00Z' })),
    listLevelDefinitions: vi.fn(async () => []),
    ...overrides,
  };
}

describe('XpEngine', () => {
  describe('award', () => {
    it('calls appendXpEvent with correct points and idempotency key', async () => {
      const appendFn = vi.fn(async () => makeXpEvent({ points: XP_POINTS.topic_complete, idempotencyKey: 'topic:topic-abc:v1' }));
      const repo = makeRepo({ appendXpEvent: appendFn });
      const engine = new XpEngine(repo, true);

      const result = await engine.award({
        userId: 'user-1',
        action: 'topic_complete',
        sourceKind: 'topic',
        sourceId: 'topic-abc',
      });

      expect(result).not.toBeNull();
      expect(appendFn).toHaveBeenCalledOnce();
      const call = appendFn.mock.calls[0][0];
      expect(call.points).toBe(XP_POINTS.topic_complete);
      expect(call.idempotencyKey).toBe('topic:topic-abc:v1');
      expect(call.userId).toBe('user-1');
      expect(call.sourceKind).toBe('topic');
    });

    it('constructs idempotency key with default version v1', async () => {
      const appendFn = vi.fn(async () => makeXpEvent());
      const repo = makeRepo({ appendXpEvent: appendFn });
      const engine = new XpEngine(repo, true);

      await engine.award({
        userId: 'user-1',
        action: 'stage_checkin',
        sourceKind: 'stage',
        sourceId: 'stage-xyz',
      });

      const call = appendFn.mock.calls[0][0];
      expect(call.idempotencyKey).toBe('stage:stage-xyz:v1');
    });

    it('returns same event for identical params (idempotency via repo)', async () => {
      const existingEvent = makeXpEvent({ id: 'existing-evt' });
      // Simulate idempotent repo: always returns same event for same key
      const appendFn = vi.fn(async () => existingEvent);
      const repo = makeRepo({ appendXpEvent: appendFn });
      const engine = new XpEngine(repo, true);

      const params = { userId: 'user-1', action: 'video_watched' as const, sourceKind: 'video', sourceId: 'vid-1' };
      const first = await engine.award(params);
      const second = await engine.award(params);

      expect(first?.id).toBe('existing-evt');
      expect(second?.id).toBe('existing-evt');
      // appendXpEvent is called each time; idempotency is inside the repo
      expect(appendFn).toHaveBeenCalledTimes(2);
    });

    it('returns null and does not call repo when GAMIFICATION_ENABLED is false', async () => {
      const appendFn = vi.fn(async () => makeXpEvent());
      const repo = makeRepo({ appendXpEvent: appendFn });
      const engine = new XpEngine(repo, false);

      const result = await engine.award({
        userId: 'user-1',
        action: 'topic_complete',
        sourceKind: 'topic',
        sourceId: 'topic-1',
      });

      expect(result).toBeNull();
      expect(appendFn).not.toHaveBeenCalled();
    });
  });
});
