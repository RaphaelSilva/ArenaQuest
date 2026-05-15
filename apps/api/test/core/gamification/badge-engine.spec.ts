import { describe, it, expect, vi } from 'vitest';
import { BadgeEngine } from '@arenaquest/shared/domain/gamification/badge-engine';
import type { IBadgeRepository, BadgeRecord, UserBadgeRecord } from '@arenaquest/shared/ports/i-badge-repository';
import type { IGamificationRepository } from '@arenaquest/shared/ports/i-gamification-repository';
import type { IMissionRepository } from '@arenaquest/shared/ports/i-mission-repository';
import type { XpEngine } from '@arenaquest/shared/domain/gamification/xp-engine';

function makeBadge(overrides: Partial<BadgeRecord> = {}): BadgeRecord {
  return {
    id: 'badge-1',
    slug: 'test-badge',
    name: 'Test Badge',
    iconEmoji: '🏆',
    description: '',
    xpReward: 0,
    ruleKind: 'streak_days',
    ruleParams: '{"days":7}',
    active: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeUserBadge(badgeId: string, userId = 'user-1'): UserBadgeRecord {
  return { id: 'ub-1', userId, badgeId, earnedAt: '2026-01-01T00:00:00Z' };
}

function makeBadgeRepo(overrides: Partial<IBadgeRepository> = {}): IBadgeRepository {
  return {
    listActive: vi.fn().mockResolvedValue([]),
    listAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    findBySlug: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn(),
    awardBadge: vi.fn().mockResolvedValue(makeUserBadge('badge-1')),
    listUserBadges: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeGamificationRepo(overrides: Partial<IGamificationRepository> = {}): IGamificationRepository {
  return {
    appendXpEvent: vi.fn(),
    getUserXp: vi.fn().mockResolvedValue(null),
    getUserStreak: vi.fn().mockResolvedValue(null),
    upsertUserStreak: vi.fn(),
    listLevelDefinitions: vi.fn().mockResolvedValue([]),
    countXpEventsBySource: vi.fn().mockResolvedValue(0),
    countAllCompletedTopics: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function makeMissionRepo(overrides: Partial<IMissionRepository> = {}): IMissionRepository {
  return {
    listActiveMissions: vi.fn().mockResolvedValue([]),
    findProgress: vi.fn().mockResolvedValue(null),
    upsertProgress: vi.fn(),
    markCompleted: vi.fn(),
    countCompletedMissions: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function makeXpEngine(): XpEngine {
  return { award: vi.fn().mockResolvedValue({ points: 50 }) } as unknown as XpEngine;
}

const NOW = new Date('2026-05-15T12:00:00Z');
const USER_ID = 'user-1';

describe('BadgeEngine', () => {
  describe('streak_days rule', () => {
    it('awards badge when streak meets threshold', async () => {
      const badge = makeBadge({ ruleKind: 'streak_days', ruleParams: '{"days":7}' });
      const badgeRepo = makeBadgeRepo({ listActive: vi.fn().mockResolvedValue([badge]) });
      const gamificationRepo = makeGamificationRepo({
        getUserStreak: vi.fn().mockResolvedValue({ currentStreak: 7, longestStreak: 7, lastActivityDate: '2026-05-15', updatedAt: '' }),
      });
      const engine = new BadgeEngine(badgeRepo, gamificationRepo, makeMissionRepo(), makeXpEngine());

      await engine.evaluate(USER_ID, NOW);

      expect(badgeRepo.awardBadge).toHaveBeenCalledWith(USER_ID, badge.id);
    });

    it('does not award badge when streak is below threshold', async () => {
      const badge = makeBadge({ ruleKind: 'streak_days', ruleParams: '{"days":7}' });
      const badgeRepo = makeBadgeRepo({ listActive: vi.fn().mockResolvedValue([badge]) });
      const gamificationRepo = makeGamificationRepo({
        getUserStreak: vi.fn().mockResolvedValue({ currentStreak: 6, longestStreak: 6, lastActivityDate: '2026-05-15', updatedAt: '' }),
      });
      const engine = new BadgeEngine(badgeRepo, gamificationRepo, makeMissionRepo(), makeXpEngine());

      await engine.evaluate(USER_ID, NOW);

      expect(badgeRepo.awardBadge).not.toHaveBeenCalled();
    });
  });

  describe('idempotency', () => {
    it('does not re-award a badge the user already has', async () => {
      const badge = makeBadge({ ruleKind: 'streak_days', ruleParams: '{"days":7}' });
      const badgeRepo = makeBadgeRepo({
        listActive: vi.fn().mockResolvedValue([badge]),
        listUserBadges: vi.fn().mockResolvedValue([makeUserBadge(badge.id)]),
      });
      const gamificationRepo = makeGamificationRepo({
        getUserStreak: vi.fn().mockResolvedValue({ currentStreak: 10, longestStreak: 10, lastActivityDate: '2026-05-15', updatedAt: '' }),
      });
      const engine = new BadgeEngine(badgeRepo, gamificationRepo, makeMissionRepo(), makeXpEngine());

      await engine.evaluate(USER_ID, NOW);

      expect(badgeRepo.awardBadge).not.toHaveBeenCalled();
    });
  });

  describe('topic_completed rule', () => {
    it('awards badge when completed topic count meets threshold', async () => {
      const badge = makeBadge({ ruleKind: 'topic_completed', ruleParams: '{"count":5}' });
      const badgeRepo = makeBadgeRepo({ listActive: vi.fn().mockResolvedValue([badge]) });
      const gamificationRepo = makeGamificationRepo({
        countAllCompletedTopics: vi.fn().mockResolvedValue(5),
      });
      const engine = new BadgeEngine(badgeRepo, gamificationRepo, makeMissionRepo(), makeXpEngine());

      await engine.evaluate(USER_ID, NOW);

      expect(badgeRepo.awardBadge).toHaveBeenCalledWith(USER_ID, badge.id);
    });
  });

  describe('total_xp rule', () => {
    it('awards badge when total XP meets threshold', async () => {
      const badge = makeBadge({ ruleKind: 'total_xp', ruleParams: '{"min_xp":500}' });
      const badgeRepo = makeBadgeRepo({ listActive: vi.fn().mockResolvedValue([badge]) });
      const gamificationRepo = makeGamificationRepo({
        getUserXp: vi.fn().mockResolvedValue({ userId: USER_ID, totalXp: 500, updatedAt: '' }),
      });
      const engine = new BadgeEngine(badgeRepo, gamificationRepo, makeMissionRepo(), makeXpEngine());

      await engine.evaluate(USER_ID, NOW);

      expect(badgeRepo.awardBadge).toHaveBeenCalledWith(USER_ID, badge.id);
    });
  });

  describe('no active badges', () => {
    it('returns early without querying context when no badges are active', async () => {
      const badgeRepo = makeBadgeRepo({ listActive: vi.fn().mockResolvedValue([]) });
      const gamificationRepo = makeGamificationRepo();
      const engine = new BadgeEngine(badgeRepo, gamificationRepo, makeMissionRepo(), makeXpEngine());

      await engine.evaluate(USER_ID, NOW);

      expect(gamificationRepo.getUserStreak).not.toHaveBeenCalled();
      expect(gamificationRepo.getUserXp).not.toHaveBeenCalled();
    });
  });

  describe('xp_reward on award', () => {
    it('calls xpEngine.award with customPoints when badge has xpReward > 0', async () => {
      const badge = makeBadge({ ruleKind: 'streak_days', ruleParams: '{"days":1}', xpReward: 50 });
      const badgeRepo = makeBadgeRepo({ listActive: vi.fn().mockResolvedValue([badge]) });
      const gamificationRepo = makeGamificationRepo({
        getUserStreak: vi.fn().mockResolvedValue({ currentStreak: 1, longestStreak: 1, lastActivityDate: '2026-05-15', updatedAt: '' }),
      });
      const xpEngine = makeXpEngine();
      const engine = new BadgeEngine(badgeRepo, gamificationRepo, makeMissionRepo(), xpEngine);

      await engine.evaluate(USER_ID, NOW);

      expect(xpEngine.award).toHaveBeenCalledWith(expect.objectContaining({
        userId: USER_ID,
        action: 'badge_award',
        sourceId: badge.id,
        customPoints: 50,
      }));
    });

    it('does not call xpEngine.award when badge xpReward is 0', async () => {
      const badge = makeBadge({ ruleKind: 'streak_days', ruleParams: '{"days":1}', xpReward: 0 });
      const badgeRepo = makeBadgeRepo({ listActive: vi.fn().mockResolvedValue([badge]) });
      const gamificationRepo = makeGamificationRepo({
        getUserStreak: vi.fn().mockResolvedValue({ currentStreak: 1, longestStreak: 1, lastActivityDate: '2026-05-15', updatedAt: '' }),
      });
      const xpEngine = makeXpEngine();
      const engine = new BadgeEngine(badgeRepo, gamificationRepo, makeMissionRepo(), xpEngine);

      await engine.evaluate(USER_ID, NOW);

      expect(xpEngine.award).not.toHaveBeenCalled();
    });
  });

  describe('mission_completed rule', () => {
    it('awards badge when completed mission count meets threshold', async () => {
      const badge = makeBadge({ ruleKind: 'mission_completed', ruleParams: '{"count":3}' });
      const badgeRepo = makeBadgeRepo({ listActive: vi.fn().mockResolvedValue([badge]) });
      const missionRepo = makeMissionRepo({ countCompletedMissions: vi.fn().mockResolvedValue(3) });
      const engine = new BadgeEngine(badgeRepo, makeGamificationRepo(), missionRepo, makeXpEngine());

      await engine.evaluate(USER_ID, NOW);

      expect(badgeRepo.awardBadge).toHaveBeenCalledWith(USER_ID, badge.id);
    });
  });

  describe('videos_watched_in_period rule', () => {
    it('awards badge when videos watched this week meets threshold', async () => {
      const badge = makeBadge({ ruleKind: 'videos_watched_in_period', ruleParams: '{"count":5,"period":"week"}' });
      const badgeRepo = makeBadgeRepo({ listActive: vi.fn().mockResolvedValue([badge]) });
      const gamificationRepo = makeGamificationRepo({
        countXpEventsBySource: vi.fn().mockResolvedValue(5),
      });
      const engine = new BadgeEngine(badgeRepo, gamificationRepo, makeMissionRepo(), makeXpEngine());

      await engine.evaluate(USER_ID, NOW);

      expect(badgeRepo.awardBadge).toHaveBeenCalledWith(USER_ID, badge.id);
      expect(gamificationRepo.countXpEventsBySource).toHaveBeenCalledWith(
        USER_ID,
        'video',
        expect.any(String),
      );
    });
  });
});
