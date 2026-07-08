import type { Entities } from '../types/entities';

export enum QuestKind {
  DAILY = 'daily',
  WEEKLY = 'weekly',
}

export type QuestDefinition = Entities.Gamification.QuestDefinition;

export interface QuestProgress {
  userId: string;
  questId: string;
  periodKey: string; // e.g., '2026-05-14' or '2026-W20'
  currentValue: number;
  targetValue: number;
  completed: boolean;
  completedAt: Date | null;
  updatedAt: Date;
}

export interface QuestWithProgress extends QuestDefinition {
  progress: QuestProgress | null;
}
