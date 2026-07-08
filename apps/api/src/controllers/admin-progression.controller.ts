import { z } from 'zod';
import type { IBadgeRepository, IGamificationRepository } from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';
import { LevelTable } from '@arenaquest/shared/domain/gamification/level-table';

const RECENT_XP_EVENTS_LIMIT = 20;

export const XpAdjustmentBodySchema = z.object({
  points: z.number().int(),
  reason: z.string().trim().min(1),
});

export type XpAdjustmentInput = z.infer<typeof XpAdjustmentBodySchema>;

export interface PlayerProgression {
  userId: string;
  xp: {
    totalXp: number;
    level: number;
    rankTitle: string;
  };
  badges: Array<{
    badgeId: string;
    slug: string;
    name: string;
    earnedAt: string;
  }>;
  recentXpEvents: Array<{
    id: string;
    sourceKind: string;
    points: number;
    earnedAt: string;
  }>;
}

export class AdminProgressionController {
  constructor(
    private readonly gamification: IGamificationRepository,
    private readonly badges: IBadgeRepository,
  ) {}

  async getProgression(userId: string): Promise<ControllerResult<PlayerProgression>> {
    const [xpRecord, levelDefs, userBadges, allBadges, recentEvents] = await Promise.all([
      this.gamification.getUserXp(userId),
      this.gamification.listLevelDefinitions(),
      this.badges.listUserBadges(userId),
      this.badges.listAll(),
      this.gamification.listRecentXpEvents(userId, RECENT_XP_EVENTS_LIMIT),
    ]);

    const totalXp = xpRecord?.totalXp ?? 0;

    let level = 1;
    let rankTitle = 'Aspirante';
    if (levelDefs.length > 0) {
      const { definition } = new LevelTable(levelDefs).forXp(totalXp);
      level = definition.level;
      rankTitle = definition.rankTitle;
    }

    const badgeMap = new Map(allBadges.map((b) => [b.id, b]));
    const badges = userBadges.flatMap((ub) => {
      const badge = badgeMap.get(ub.badgeId);
      if (!badge) return [];
      return [{ badgeId: badge.id, slug: badge.slug, name: badge.name, earnedAt: ub.earnedAt }];
    });

    const recentXpEvents = recentEvents.map((e) => ({
      id: e.id,
      sourceKind: e.sourceKind,
      points: e.points,
      earnedAt: e.earnedAt,
    }));

    return {
      ok: true,
      data: { userId, xp: { totalXp, level, rankTitle }, badges, recentXpEvents },
    };
  }

  async revokeBadge(userId: string, badgeId: string): Promise<ControllerResult<null>> {
    const removed = await this.badges.revokeBadge(userId, badgeId);
    if (!removed) {
      return { ok: false, status: 404, error: 'NotFound', meta: { message: 'User does not hold this badge.' } };
    }
    return { ok: true, data: null };
  }

  async adjustXp(
    userId: string,
    adminId: string,
    body: unknown,
  ): Promise<ControllerResult<{ previousTotal: number; newTotal: number }>> {
    const parsed = XpAdjustmentBodySchema.safeParse(body);
    if (!parsed.success) {
      return {
        ok: false,
        status: 400,
        error: 'ValidationError',
        meta: { message: 'Invalid XP adjustment payload.', issues: parsed.error.issues },
      };
    }

    const before = await this.gamification.getUserXp(userId);
    const previousTotal = before?.totalXp ?? 0;

    // The ledger keeps the true delta; the read model is clamped at 0 below.
    await this.gamification.appendXpEvent({
      userId,
      sourceKind: 'admin_adjustment',
      sourceId: adminId,
      points: parsed.data.points,
      idempotencyKey: crypto.randomUUID(),
    });

    const after = await this.gamification.getUserXp(userId);
    let newTotal = after?.totalXp ?? 0;

    // Clamp the read model at 0 when a negative adjustment drives it below zero;
    // the ledger sum may stay negative, matching recompute's MAX(0, SUM(...)).
    if (newTotal < 0) {
      const recomputed = await this.gamification.recomputeUserXp(userId);
      newTotal = recomputed.newTotal;
    }

    return { ok: true, data: { previousTotal, newTotal } };
  }

  async recomputeXp(userId: string): Promise<ControllerResult<{ previousTotal: number; newTotal: number }>> {
    const data = await this.gamification.recomputeUserXp(userId);
    return { ok: true, data };
  }
}
