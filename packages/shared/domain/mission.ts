export interface Mission {
  id: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  predicateKind: string;
  predicateParams: string;
  xpReward: number;
  badgeId: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MissionProgress {
  userId: string;
  missionId: string;
  currentValue: number;
  targetValue: number;
  completed: boolean;
  completedAt: Date | null;
  updatedAt: Date;
}
