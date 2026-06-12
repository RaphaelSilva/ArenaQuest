import type { IBadgeRepository, BadgeRecord, UserBadgeRecord } from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';
import { type CreateBadgeInput, type UpdateBadgeInput } from '@api/openapi/components/entities';

export class AdminBadgesController {
  constructor(private readonly repo: IBadgeRepository) {}

  async list(): Promise<ControllerResult<BadgeRecord[]>> {
    const data = await this.repo.listAll();
    return { ok: true, data };
  }

  async create(body: CreateBadgeInput): Promise<ControllerResult<BadgeRecord>> {
    const data = await this.repo.create(body);
    return { ok: true, data };
  }

  async update(id: string, body: UpdateBadgeInput): Promise<ControllerResult<BadgeRecord>> {
    const data = await this.repo.update(id, body);
    if (!data) return { ok: false, status: 404, error: 'NotFound' };
    return { ok: true, data };
  }

  async awardBadge(userId: string, badgeId: string): Promise<ControllerResult<UserBadgeRecord>> {
    const data = await this.repo.awardBadge(userId, badgeId);
    return { ok: true, data };
  }
}
