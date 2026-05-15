import type { ControllerResult } from '@api/core/result';
import type { DashboardShape } from '@arenaquest/shared/types/dashboard';
import type { MeGamificationController } from './me-gamification.controller';
import type { MeQuestsController } from './me-quests.controller';
import type { MeMissionsController } from './me-missions.controller';

export class MeDashboardController {
  constructor(
    private readonly gamification: MeGamificationController,
    private readonly quests: MeQuestsController,
    private readonly missions: MeMissionsController,
  ) {}

  async getDashboard(userId: string, now: Date): Promise<ControllerResult<DashboardShape>> {
    const [xpResult, streakResult, badgesResult, dailyResult, weeklyResult, missionsResult] =
      await Promise.all([
        this.gamification.getXp(userId),
        this.gamification.getStreak(userId),
        this.gamification.getBadges(userId),
        this.quests.getDailyQuests(userId, now),
        this.quests.getWeeklyQuests(userId, now),
        this.missions.getMissions(userId, now),
      ]);

    return {
      ok: true,
      data: {
        xp: xpResult.ok ? xpResult.data : null,
        streak: streakResult.ok ? streakResult.data : null,
        badges: badgesResult.ok ? badgesResult.data : null,
        questsDaily: dailyResult.ok ? dailyResult.data : null,
        questsWeekly: weeklyResult.ok ? weeklyResult.data : null,
        missions: missionsResult.ok ? missionsResult.data : null,
      },
    };
  }
}
