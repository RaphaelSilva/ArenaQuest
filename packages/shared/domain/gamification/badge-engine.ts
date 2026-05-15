import type { IBadgeRepository } from '../../ports/i-badge-repository';
import type { IGamificationRepository } from '../../ports/i-gamification-repository';
import type { IMissionRepository } from '../../ports/i-mission-repository';
import type { XpEngine } from './xp-engine';

function startOfISOWeekUTC(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

export class BadgeEngine {
  constructor(
    private readonly badgeRepo: IBadgeRepository,
    private readonly gamificationRepo: IGamificationRepository,
    private readonly missionRepo: IMissionRepository,
    private readonly xpEngine: XpEngine,
  ) {}

  async evaluate(userId: string, nowUtc: Date): Promise<void> {
    const badges = await this.badgeRepo.listActive();
    if (badges.length === 0) return;

    const [streak, xp, completedTopicCount, videosWatchedThisWeek, completedMissionCount, userBadges] =
      await Promise.all([
        this.gamificationRepo.getUserStreak(userId),
        this.gamificationRepo.getUserXp(userId),
        this.gamificationRepo.countAllCompletedTopics(userId),
        this.gamificationRepo.countXpEventsBySource(userId, 'video', startOfISOWeekUTC(nowUtc).toISOString()),
        this.missionRepo.countCompletedMissions(userId),
        this.badgeRepo.listUserBadges(userId),
      ]);

    const streakDays = streak?.currentStreak ?? 0;
    const totalXp = xp?.totalXp ?? 0;
    const earnedBadgeIds = new Set(userBadges.map(b => b.badgeId));

    for (const badge of badges) {
      if (earnedBadgeIds.has(badge.id)) continue;

      let ruleMet = false;
      try {
        const rule = JSON.parse(badge.ruleParams) as Record<string, number>;
        switch (badge.ruleKind) {
          case 'streak_days':
            ruleMet = streakDays >= (rule.days ?? 0);
            break;
          case 'topic_completed':
            ruleMet = completedTopicCount >= (rule.count ?? 1);
            break;
          case 'videos_watched_in_period':
            ruleMet = videosWatchedThisWeek >= (rule.count ?? 1);
            break;
          case 'total_xp':
            ruleMet = totalXp >= (rule.min_xp ?? 0);
            break;
          case 'mission_completed':
            ruleMet = completedMissionCount >= (rule.count ?? 1);
            break;
          default:
            console.debug(`[badge] unknown ruleKind "${badge.ruleKind}" — skipping badge ${badge.id}`);
        }
      } catch {
        console.debug(`[badge] malformed ruleParams for badge ${badge.id} — skipping`);
      }

      if (!ruleMet) continue;

      await this.badgeRepo.awardBadge(userId, badge.id);

      if (badge.xpReward > 0) {
        await this.xpEngine.award({
          userId,
          action: 'badge_award',
          sourceKind: 'badge_award',
          sourceId: badge.id,
          customPoints: badge.xpReward,
        });
      }
    }
  }
}
