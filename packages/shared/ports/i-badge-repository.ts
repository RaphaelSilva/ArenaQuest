import type { Entities } from '../types/entities';

export type BadgeRecord = Entities.Gamification.Badge;

export interface UserBadgeRecord {
  id: string;
  userId: string;
  badgeId: string;
  earnedAt: string;
}

export interface CreateBadgeParams {
  slug: string;
  name: string;
  iconEmoji: string;
  description?: string;
  xpReward?: number;
  ruleKind: string;
  ruleParams?: string;
}

export interface UpdateBadgeParams {
  name?: string;
  iconEmoji?: string;
  description?: string;
  xpReward?: number;
  ruleKind?: string;
  ruleParams?: string;
  active?: boolean;
}

export interface IBadgeRepository {
  listActive(): Promise<BadgeRecord[]>;
  listAll(): Promise<BadgeRecord[]>;
  findById(id: string): Promise<BadgeRecord | null>;
  findBySlug(slug: string): Promise<BadgeRecord | null>;
  create(params: CreateBadgeParams): Promise<BadgeRecord>;
  update(id: string, params: UpdateBadgeParams): Promise<BadgeRecord | null>;
  awardBadge(userId: string, badgeId: string): Promise<UserBadgeRecord>;
  listUserBadges(userId: string): Promise<UserBadgeRecord[]>;
  /**
   * Remove a user's badge. Returns `true` when a row was deleted, `false` when
   * the user did not hold the badge (so callers can map to 404).
   */
  revokeBadge(userId: string, badgeId: string): Promise<boolean>;
}
