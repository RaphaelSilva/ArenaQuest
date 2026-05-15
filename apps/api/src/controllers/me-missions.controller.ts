import type { IMissionRepository } from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';
import type { DashboardMissionEntry } from '@arenaquest/shared/types/dashboard';

export class MeMissionsController {
  constructor(private readonly missionRepo: IMissionRepository) {}

  async getMissions(userId: string, now: Date): Promise<ControllerResult<DashboardMissionEntry[] | null>> {
    const missions = await this.missionRepo.listActiveMissions(now.toISOString());
    if (missions.length === 0) return { ok: true, data: null };

    const progressList = await Promise.all(
      missions.map(m => this.missionRepo.findProgress(userId, m.id)),
    );

    const entries: DashboardMissionEntry[] = missions.map((mission, i) => ({
      mission,
      progress: progressList[i] ?? null,
    }));

    return { ok: true, data: entries };
  }
}
