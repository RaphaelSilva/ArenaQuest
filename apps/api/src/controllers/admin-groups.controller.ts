import type {
  IUserGroupRepository,
  UserGroupRecord,
  GroupMemberRecord,
} from '@arenaquest/shared/ports';
import type { IUserRepository } from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';

export class AdminGroupsController {
  constructor(
    private readonly groups: IUserGroupRepository,
    private readonly users: IUserRepository,
  ) {}

  async listAll(): Promise<ControllerResult<UserGroupRecord[]>> {
    const data = await this.groups.listAll();
    return { ok: true, data };
  }

  async createGroup(input: {
    name: string;
    description: string;
  }): Promise<ControllerResult<UserGroupRecord>> {
    const name = input.name.trim();
    if (!name) {
      return { ok: false, status: 400, error: 'Group name is required' };
    }

    const existing = await this.groups.findByName(name);
    if (existing) {
      return { ok: false, status: 409, error: 'A group with this name already exists' };
    }

    const created = await this.groups.create({
      id: crypto.randomUUID(),
      name,
      description: input.description.trim(),
    });
    return { ok: true, data: created };
  }

  async listMembers(groupId: string): Promise<ControllerResult<GroupMemberRecord[]>> {
    const group = await this.groups.getById(groupId);
    if (!group) {
      return { ok: false, status: 404, error: 'Group not found' };
    }
    const data = await this.groups.listMembers(groupId);
    return { ok: true, data };
  }

  async addMember(
    groupId: string,
    userId: string,
  ): Promise<ControllerResult<GroupMemberRecord>> {
    const group = await this.groups.getById(groupId);
    if (!group) {
      return { ok: false, status: 404, error: 'Group not found' };
    }
    const user = await this.users.findById(userId);
    if (!user) {
      return { ok: false, status: 404, error: 'User not found' };
    }

    await this.groups.addMember(groupId, userId);
    return { ok: true, data: { userId: user.id, name: user.name, email: user.email } };
  }

  async removeMember(
    groupId: string,
    userId: string,
  ): Promise<ControllerResult<null>> {
    const group = await this.groups.getById(groupId);
    if (!group) {
      return { ok: false, status: 404, error: 'Group not found' };
    }
    await this.groups.removeMember(groupId, userId);
    return { ok: true, data: null };
  }
}
