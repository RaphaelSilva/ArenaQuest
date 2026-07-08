import type { HttpTransport } from './api-client';

export type AdminGroup = {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  createdAt: string;
};

export type GroupMember = {
  userId: string;
  name: string;
  email: string;
};

export function createAdminGroupsApi(http: HttpTransport) {
  return {
    async list(): Promise<AdminGroup[]> {
      const res = await http('GET', '/admin/groups');
      if (!res.ok) throw new Error(`Failed to list groups (${res.status})`);
      const body = (await res.json()) as { data: AdminGroup[] };
      return body.data;
    },

    async create(input: { name: string; description?: string }): Promise<AdminGroup> {
      const res = await http('POST', '/admin/groups', { body: JSON.stringify(input) });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to create group (${res.status})`);
      }
      return (await res.json()) as AdminGroup;
    },

    async listMembers(groupId: string): Promise<GroupMember[]> {
      const res = await http('GET', `/admin/groups/${groupId}/members`);
      if (!res.ok) throw new Error(`Failed to list members (${res.status})`);
      const body = (await res.json()) as { data: GroupMember[] };
      return body.data;
    },

    async addMember(groupId: string, userId: string): Promise<GroupMember> {
      const res = await http('POST', `/admin/groups/${groupId}/members`, {
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to add member (${res.status})`);
      }
      return (await res.json()) as GroupMember;
    },

    async removeMember(groupId: string, userId: string): Promise<void> {
      const res = await http('DELETE', `/admin/groups/${groupId}/members/${userId}`);
      if (!res.ok) throw new Error(`Failed to remove member (${res.status})`);
    },
  };
}

const _err = () => { throw new Error('adminGroupsApi is deprecated. Use useApiClient() hook instead.'); };
export const adminGroupsApi = { list: _err };
