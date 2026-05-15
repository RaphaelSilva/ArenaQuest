import type { IQuestRepository } from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';
import { QuestKind, type QuestWithProgress } from '@arenaquest/shared/domain/quest';

function dailyPeriodKey(now: Date): string {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

function weeklyPeriodKey(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  const year = d.getUTCFullYear();
  // ISO week number
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const weekNum = Math.ceil(((d.getTime() - startOfYear.getTime()) / 86_400_000 + startOfYear.getUTCDay() + 1) / 7);
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

export class MeQuestsController {
  constructor(private readonly questRepo: IQuestRepository) {}

  async getDailyQuests(userId: string, now: Date): Promise<ControllerResult<QuestWithProgress[] | null>> {
    const periodKey = dailyPeriodKey(now);
    const quests = await this.questRepo.listActiveQuestsForUser(userId, QuestKind.DAILY, periodKey);
    return { ok: true, data: quests.length > 0 ? quests : null };
  }

  async getWeeklyQuests(userId: string, now: Date): Promise<ControllerResult<QuestWithProgress[] | null>> {
    const periodKey = weeklyPeriodKey(now);
    const quests = await this.questRepo.listActiveQuestsForUser(userId, QuestKind.WEEKLY, periodKey);
    return { ok: true, data: quests.length > 0 ? quests : null };
  }
}
