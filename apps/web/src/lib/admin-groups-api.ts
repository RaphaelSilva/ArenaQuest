import type { HttpTransport } from './api-client';

export type AdminGroup = {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  createdAt: string;
};

export function createAdminGroupsApi(http: HttpTransport) {
  return {
    async list(): Promise<AdminGroup[]> {
      const res = await http('GET', '/admin/groups');
      if (!res.ok) throw new Error(`Failed to list groups (${res.status})`);
      const body = (await res.json()) as { data: AdminGroup[] };
      return body.data;
    },
  };
}

const _err = () => { throw new Error('adminGroupsApi is deprecated. Use useApiClient() hook instead.'); };
export const adminGroupsApi = { list: _err };
