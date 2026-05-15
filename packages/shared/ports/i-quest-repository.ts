import { QuestDefinition, QuestKind, QuestProgress, QuestWithProgress } from '../domain/quest';

export interface UpsertQuestProgressInput {
  userId: string;
  questId: string;
  periodKey: string;
  incrementBy: number;
  targetValue: number;
}

export interface IQuestRepository {
  /**
   * List all active quest definitions of a specific kind.
   */
  listActiveDefinitions(kind: QuestKind): Promise<QuestDefinition[]>;

  /**
   * List active quests for a user in a specific period, including their current progress.
   */
  listActiveQuestsForUser(userId: string, kind: QuestKind, periodKey: string): Promise<QuestWithProgress[]>;

  /**
   * Find progress for a specific user, quest and period.
   */
  findProgress(userId: string, questId: string, periodKey: string): Promise<QuestProgress | null>;

  /**
   * Upsert progress for a user. If currentValue >= targetValue, marks as completed.
   * Returns the updated progress.
   */
  upsertProgress(input: UpsertQuestProgressInput): Promise<QuestProgress>;

  /**
   * Mark a quest as completed for a user in a period.
   */
  markCompleted(userId: string, questId: string, periodKey: string): Promise<QuestProgress>;
}
