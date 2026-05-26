import { z } from 'zod';
import type { IBadgeRepository, BadgeRecord, UserBadgeRecord } from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';

const VALID_RULE_KINDS = [
  'streak_days',
  'topic_completed',
  'videos_watched_in_period',
  'total_xp',
  'mission_completed',
] as const;

const createSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  iconEmoji: z.string().min(1),
  description: z.string().optional(),
  xpReward: z.number().int().min(0).optional(),
  ruleKind: z.enum(VALID_RULE_KINDS),
  ruleParams: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  iconEmoji: z.string().min(1).optional(),
  description: z.string().optional(),
  xpReward: z.number().int().min(0).optional(),
  ruleKind: z.enum(VALID_RULE_KINDS).optional(),
  ruleParams: z.string().optional(),
  active: z.boolean().optional(),
});

export class AdminBadgesController {
  constructor(private readonly repo: IBadgeRepository) {}

  async list(): Promise<ControllerResult<BadgeRecord[]>> {
    const data = await this.repo.listAll();
    return { ok: true, data };
  }

  async create(body: unknown): Promise<ControllerResult<BadgeRecord>> {
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return { ok: false, status: 400, error: 'ValidationError', meta: parsed.error.flatten() };
    }
    const data = await this.repo.create(parsed.data);
    return { ok: true, data };
  }

  async update(id: string, body: unknown): Promise<ControllerResult<BadgeRecord>> {
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return { ok: false, status: 400, error: 'ValidationError', meta: parsed.error.flatten() };
    }
    const data = await this.repo.update(id, parsed.data);
    if (!data) return { ok: false, status: 404, error: 'NotFound' };
    return { ok: true, data };
  }

  async awardBadge(userId: string, badgeId: string): Promise<ControllerResult<UserBadgeRecord>> {
    const data = await this.repo.awardBadge(userId, badgeId);
    return { ok: true, data };
  }
}
