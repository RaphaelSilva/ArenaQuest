import type { IUserGroupRepository, UserGroupRecord } from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';

export class AdminGroupsController {
  constructor(private readonly groups: IUserGroupRepository) {}

  async listAll(): Promise<ControllerResult<UserGroupRecord[]>> {
    const data = await this.groups.listAll();
    return { ok: true, data };
  }
}
