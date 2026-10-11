import type { Entities } from '../types/entities';

export type Mission = Entities.Gamification.Mission;
export type MissionRequirement = Entities.Gamification.MissionRequirement;
export type MissionEnrollment = Entities.Gamification.MissionEnrollment;
export type MissionRequirementProgress = Entities.Gamification.MissionRequirementProgress;

export interface MissionProgress {
  userId: string;
  missionId: string;
  currentValue: number;
  targetValue: number;
  completed: boolean;
  completedAt: Date | null;
  updatedAt: Date;
}
