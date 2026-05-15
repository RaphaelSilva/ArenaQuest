import type { IGamificationRepository } from '@arenaquest/shared/ports';
import type { IBadgeRepository } from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';
import { LevelTable } from '@arenaquest/shared/domain/gamification/level-table';
import type { DashboardXp, DashboardStreak, DashboardBadgeEntry } from '@arenaquest/shared/types/dashboard';

export class MeGamificationController {
  constructor(
    private readonly gamification: IGamificationRepository,
    private readonly badges: IBadgeRepository,
  ) {}

  async getXp(userId: string): Promise<ControllerResult<DashboardXp | null>> {
    const [xpRecord, levelDefs] = await Promise.all([
      this.gamification.getUserXp(userId),
      this.gamification.listLevelDefinitions(),
    ]);

    if (!xpRecord) return { ok: true, data: null };

    const table = new LevelTable(levelDefs);
    const { definition, xpToNext } = table.forXp(xpRecord.totalXp);

    return {
      ok: true,
      data: {
        totalXp: xpRecord.totalXp,
        level: definition.level,
        rankTitle: definition.rankTitle,
        xpToNext,
        xpInLevel: xpRecord.totalXp - definition.minXp,
      },
    };
  }

  async getStreak(userId: string): Promise<ControllerResult<DashboardStreak | null>> {
    const record = await this.gamification.getUserStreak(userId);
    if (!record) return { ok: true, data: null };

    return {
      ok: true,
      data: {
        currentStreak: record.currentStreak,
        longestStreak: record.longestStreak,
        lastActivityDate: record.lastActivityDate,
      },
    };
  }

  async getBadges(userId: string): Promise<ControllerResult<DashboardBadgeEntry[] | null>> {
    const [userBadges, allBadges] = await Promise.all([
      this.badges.listUserBadges(userId),
      this.badges.listAll(),
    ]);

    if (userBadges.length === 0) return { ok: true, data: null };

    const badgeMap = new Map(allBadges.map(b => [b.id, b]));
    const entries: DashboardBadgeEntry[] = [];

    for (const ub of userBadges) {
      const badge = badgeMap.get(ub.badgeId);
      if (badge) {
        entries.push({ badge, earnedAt: ub.earnedAt });
      }
    }

    return { ok: true, data: entries.length > 0 ? entries : null };
  }
}
