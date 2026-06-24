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

export interface LeaderboardRow {
  userId: string;
  totalXp: number;
  level: number;
  rankTitle: string;
  lastXpEventAt: string | null;
}

export interface GetLeaderboardParams {
  scope: 'global' | 'topic';
  topicId?: string;
  period: 'all_time' | 'week';
  weekStart?: string;
  limit: number;
  offset: number;
}

export interface GetUserRankParams {
  scope: 'global' | 'topic';
  topicId?: string;
  period: 'all_time' | 'week';
  weekStart?: string;
}

export interface UserRankRecord {
  rank: number;
  totalXp: number;
  level: number;
  rankTitle: string;
}

export interface IGamificationRepository {
  /** Idempotent — same (userId, sourceKind, idempotencyKey) returns the existing event. */
  appendXpEvent(params: AppendXpEventParams): Promise<XpEventRecord>;
  getUserXp(userId: string): Promise<UserXpRecord | null>;
  getUserStreak(userId: string): Promise<UserStreakRecord | null>;
  upsertUserStreak(userId: string, params: UpsertUserStreakParams): Promise<UserStreakRecord>;
  listLevelDefinitions(): Promise<LevelDefinitionRecord[]>;
  /**
   * Atomically replace the entire level curve (delete-all + insert-all in one
   * transaction). The caller validates the curve shape beforehand; this method
   * only persists. Returns the persisted rows ordered by level.
   */
  replaceAllLevelDefinitions(rows: LevelDefinitionRecord[]): Promise<LevelDefinitionRecord[]>;
  countXpEventsBySource(userId: string, sourceKind: string, since?: string): Promise<number>;
  countAllCompletedTopics(userId: string): Promise<number>;
  getLeaderboard(params: GetLeaderboardParams): Promise<{ rows: LeaderboardRow[]; total: number }>;
  getUserRank(userId: string, params: GetUserRankParams): Promise<UserRankRecord>;
}
