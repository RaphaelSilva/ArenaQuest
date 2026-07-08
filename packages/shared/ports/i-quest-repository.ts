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
   * List all quest definitions (active and inactive) for admin management.
   */
  listAll(): Promise<QuestDefinition[]>;

  /**
   * Create a new quest definition. Generates id/createdAt/updatedAt internally.
   */
  create(input: Omit<QuestDefinition, 'id' | 'createdAt' | 'updatedAt'>): Promise<QuestDefinition>;

  /**
   * Update an existing quest definition. Returns the updated row, or null if not found.
   */
  update(id: string, partial: Partial<Omit<QuestDefinition, 'id' | 'createdAt' | 'updatedAt'>>): Promise<QuestDefinition | null>;

  /**
   * Hard-delete a quest definition by id. Returns whether a row was removed.
   */
  delete(id: string): Promise<boolean>;

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
