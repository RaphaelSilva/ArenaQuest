import type { IQuestRepository } from '../../ports/i-quest-repository';
import type { IMissionRepository } from '../../ports/i-mission-repository';
import type { XpEngine } from './xp-engine';
import { QuestKind } from '../../domain/quest';

const PREDICATE_TO_SOURCE: Record<string, string> = {
  watch_video: 'video',
  complete_subtopic: 'stage',
  post_comment: 'comment',
  check_in_stage: 'stage',
  daily_login: 'login',
  complete_topic: 'topic',
};

function isoWeekKey(date: Date): string {
  // Copy date to avoid mutation; shift to nearest Thursday (ISO week ownership rule)
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Sunday=7
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export class QuestEvaluator {
  constructor(
    private readonly questRepo: IQuestRepository,
    private readonly missionRepo: IMissionRepository,
    private readonly xpEngine: XpEngine,
  ) {}

  async evaluate(userId: string, sourceKind: string, nowUtc: Date): Promise<void> {
    const dailyPeriod = nowUtc.toISOString().slice(0, 10);
    const weeklyPeriod = isoWeekKey(nowUtc);

    for (const kind of [QuestKind.DAILY, QuestKind.WEEKLY]) {
      const periodKey = kind === QuestKind.DAILY ? dailyPeriod : weeklyPeriod;
      const defs = await this.questRepo.listActiveDefinitions(kind);

      for (const def of defs) {
        const mappedSource = PREDICATE_TO_SOURCE[def.predicateKind];
        if (!mappedSource) {
          console.debug(`[quest] unknown predicateKind "${def.predicateKind}" — skipping`);
          continue;
        }
        if (mappedSource !== sourceKind) continue;

        const progress = await this.questRepo.findProgress(userId, def.id, periodKey);
        if (progress?.completed) continue;

        let targetValue = 1;
        try {
          targetValue = JSON.parse(def.predicateParams)?.target ?? 1;
        } catch {
          // malformed params — default to 1
        }

        const updated = await this.questRepo.upsertProgress({
          userId,
          questId: def.id,
          periodKey,
          incrementBy: 1,
          targetValue,
        });

        if (updated.completed && !progress?.completed && def.xpReward > 0) {
          await this.xpEngine.award({
            userId,
            action: 'quest_reward',
            sourceKind: 'quest_reward',
            sourceId: def.id,
            version: periodKey,
            customPoints: def.xpReward,
          });
        }
      }
    }

    const missions = await this.missionRepo.listActiveMissions(nowUtc.toISOString());
    for (const mission of missions) {
      const mappedSource = PREDICATE_TO_SOURCE[mission.predicateKind];
      if (!mappedSource || mappedSource !== sourceKind) continue;

      const progress = await this.missionRepo.findProgress(userId, mission.id);
      if (progress?.completed) continue;

      let targetValue = 1;
      try {
        targetValue = JSON.parse(mission.predicateParams)?.target ?? 1;
      } catch {
        // malformed params — default to 1
      }

      const updated = await this.missionRepo.upsertProgress(userId, mission.id, 1, targetValue);

      if (updated.completed && !progress?.completed && mission.xpReward > 0) {
        await this.xpEngine.award({
          userId,
          action: 'mission_reward',
          sourceKind: 'mission_reward',
          sourceId: mission.id,
          version: 'v1',
          customPoints: mission.xpReward,
        });
      }
    }
  }
}
