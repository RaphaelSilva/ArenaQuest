import type { Entities } from '@arenaquest/shared/types/entities';
import type { RoleName } from '@arenaquest/shared/constants/roles';
import type { HttpTransport } from './api-client';

export type CreateUserInput = {
  name: string;
  email: string;
  password: string;
  roles?: RoleName[];
};

export type UpdateUserInput = {
  name?: string;
  roles?: RoleName[];
  status?: Entities.Config.UserStatus;
};

export function createAdminUsersApi(http: HttpTransport) {
  return {
    async list(page = 1, pageSize = 20): Promise<{ data: Entities.Identity.User[]; total: number }> {
      const offset = (page - 1) * pageSize;
      const res = await http('GET', `/admin/users?limit=${pageSize}&offset=${offset}`);
      if (!res.ok) throw new Error(`Failed to list users (${res.status})`);
      return res.json();
    },

    async create(data: CreateUserInput): Promise<Entities.Identity.User> {
      const res = await http('POST', '/admin/users', {
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to create user (${res.status})`);
      }
      return res.json();
    },

    async update(id: string, data: Partial<UpdateUserInput>): Promise<Entities.Identity.User> {
      const res = await http('PATCH', `/admin/users/${id}`, {
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to update user (${res.status})`);
      }
      return res.json();
    },

    async deactivate(id: string): Promise<void> {
      const res = await http('DELETE', `/admin/users/${id}`);
      if (!res.ok && res.status !== 204) {
        throw new Error(`Failed to deactivate user (${res.status})`);
      }
    },
  };
}

const _err = () => { throw new Error('adminUsersApi is deprecated. Use useApiClient() hook instead.'); };
export const adminUsersApi = { list: _err, create: _err, update: _err, deactivate: _err };
