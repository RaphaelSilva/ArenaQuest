export interface BadgeRecord {
  id: string;
  slug: string;
  name: string;
  iconEmoji: string;
  description: string;
  xpReward: number;
  ruleKind: string;
  ruleParams: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

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
}
