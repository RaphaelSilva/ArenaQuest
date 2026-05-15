import type { Mission, MissionProgress } from '../domain/mission';

export interface IMissionRepository {
  listActiveMissions(nowIso: string): Promise<Mission[]>;
  findProgress(userId: string, missionId: string): Promise<MissionProgress | null>;
  upsertProgress(userId: string, missionId: string, increment: number, target: number): Promise<MissionProgress>;
  markCompleted(userId: string, missionId: string): Promise<MissionProgress>;
}
