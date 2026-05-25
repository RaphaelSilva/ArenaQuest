import type { IGamificationRepository } from '../../ports/i-gamification-repository';
import { toLocalDateString } from '../time/local-date';

export class StreakEngine {
  constructor(
    private readonly repo: IGamificationRepository,
    private readonly getUserTimezone: (userId: string) => Promise<string | null>,
  ) {}

  async recordActivity(userId: string, nowUtc: Date): Promise<void> {
    const tz = (await this.getUserTimezone(userId)) ?? 'UTC';
    const todayLocal = toLocalDateString(nowUtc, tz);

    const existing = await this.repo.getUserStreak(userId);

    if (!existing || existing.lastActivityDate === null) {
      await this.repo.upsertUserStreak(userId, {
        currentStreak: 1,
        longestStreak: 1,
        lastActivityDate: todayLocal,
      });
      return;
    }

    if (existing.lastActivityDate === todayLocal) {
      return;
    }

    const prev = new Date(`${existing.lastActivityDate}T00:00:00Z`).getTime();
    const today = new Date(`${todayLocal}T00:00:00Z`).getTime();
    const diffDays = Math.round((today - prev) / 86_400_000);

    const newCurrent = diffDays === 1 ? existing.currentStreak + 1 : 1;
    const newLongest = Math.max(newCurrent, existing.longestStreak);

    await this.repo.upsertUserStreak(userId, {
      currentStreak: newCurrent,
      longestStreak: newLongest,
      lastActivityDate: todayLocal,
    });
  }
}
