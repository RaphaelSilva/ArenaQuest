import type { Entities } from '../types/entities';

export type Mission = Entities.Gamification.Mission;

export interface MissionProgress {
  userId: string;
  missionId: string;
  currentValue: number;
  targetValue: number;
  completed: boolean;
  completedAt: Date | null;
  updatedAt: Date;
}
