import type { Mission, MissionProgress } from '../domain/mission';

export interface IMissionRepository {
  findById(id: string): Promise<Mission | null>;
  create(mission: Omit<Mission, 'id' | 'createdAt' | 'updatedAt'>): Promise<Mission>;
  update(id: string, mission: Partial<Omit<Mission, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Mission>;
  listAll(): Promise<Mission[]>;
  listActiveMissions(nowIso: string): Promise<Mission[]>;
  findProgress(userId: string, missionId: string): Promise<MissionProgress | null>;
  upsertProgress(userId: string, missionId: string, increment: number, target: number): Promise<MissionProgress>;
  markCompleted(userId: string, missionId: string): Promise<MissionProgress>;
  countCompletedMissions(userId: string): Promise<number>;
}
