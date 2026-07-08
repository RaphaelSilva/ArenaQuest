import { describe, it, expect, vi } from 'vitest';
import { AdminBadgesController } from '@api/controllers/admin-badges.controller';
import type { IBadgeRepository, BadgeRecord, UserBadgeRecord } from '@arenaquest/shared/ports';

function makeBadge(overrides: Partial<BadgeRecord> = {}): BadgeRecord {
  return {
    id: 'badge-1',
    slug: 'test-badge',
    name: 'Test Badge',
    iconEmoji: '🏆',
    description: '',
    xpReward: 100,
    ruleKind: 'total_xp',
    ruleParams: '{"min_xp":100}',
    active: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeUserBadge(overrides: Partial<UserBadgeRecord> = {}): UserBadgeRecord {
  return {
    id: 'ub-1',
    userId: 'user-1',
    badgeId: 'badge-1',
    earnedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeRepo(overrides: Partial<IBadgeRepository> = {}): IBadgeRepository {
  return {
    listActive: vi.fn(async () => []),
    listAll: vi.fn(async () => []),
    findById: vi.fn(async () => null),
    findBySlug: vi.fn(async () => null),
    create: vi.fn(async () => makeBadge()),
    update: vi.fn(async () => null),
    awardBadge: vi.fn(async () => makeUserBadge()),
    listUserBadges: vi.fn(async () => []),
    ...overrides,
  };
}

describe('AdminBadgesController', () => {
  describe('list', () => {
    it('returns all badges', async () => {
      const badge = makeBadge();
      const repo = makeRepo({ listAll: vi.fn(async () => [badge]) });
      const controller = new AdminBadgesController(repo);

      const result = await controller.list();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].id).toBe('badge-1');
      }
    });
  });

  describe('create', () => {
    it('returns created badge for valid data', async () => {
      const badge = makeBadge({ slug: 'my-badge', name: 'My Badge' });
      const repo = makeRepo({ create: vi.fn(async () => badge) });
      const controller = new AdminBadgesController(repo);

      const result = await controller.create({
        slug: 'my-badge',
        name: 'My Badge',
        iconEmoji: '🏆',
        ruleKind: 'total_xp',
        ruleParams: '{"min_xp":500}',
        xpReward: 200,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.slug).toBe('my-badge');
        expect(result.data.name).toBe('My Badge');
      }
    });
  });

  describe('awardBadge', () => {
    it('is idempotent — calling twice returns same record', async () => {
      const userBadge = makeUserBadge();
      const awardFn = vi.fn(async () => userBadge);
      const repo = makeRepo({ awardBadge: awardFn });
      const controller = new AdminBadgesController(repo);

      const first = await controller.awardBadge('user-1', 'badge-1');
      const second = await controller.awardBadge('user-1', 'badge-1');

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(first.data.id).toBe(second.data.id);
      }
      // Repo.awardBadge is called twice; idempotency is enforced in the adapter (INSERT OR IGNORE)
      expect(awardFn).toHaveBeenCalledTimes(2);
    });
  });
});
