import type { Entities } from '../types/entities';

export interface XpEventRecord {
  id: string;
  userId: string;
  sourceKind: string;
  sourceId: string | null;
  points: number;
  idempotencyKey: string;
  earnedAt: string;
}

export interface UserXpRecord {
  userId: string;
  totalXp: number;
  updatedAt: string;
}

export interface UserStreakRecord {
  userId: string;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | null;
  updatedAt: string;
}

export type LevelDefinitionRecord = Entities.Gamification.LevelDefinition;

export interface AppendXpEventParams {
  userId: string;
  sourceKind: string;
  sourceId?: string | null;
  points: number;
  idempotencyKey: string;
}

export interface UpsertUserStreakParams {
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string;
}

export interface IGamificationRepository {
  /** Idempotent — same (userId, sourceKind, idempotencyKey) returns the existing event. */
  appendXpEvent(params: AppendXpEventParams): Promise<XpEventRecord>;
  getUserXp(userId: string): Promise<UserXpRecord | null>;
  getUserStreak(userId: string): Promise<UserStreakRecord | null>;
  upsertUserStreak(userId: string, params: UpsertUserStreakParams): Promise<UserStreakRecord>;
  listLevelDefinitions(): Promise<LevelDefinitionRecord[]>;
}
