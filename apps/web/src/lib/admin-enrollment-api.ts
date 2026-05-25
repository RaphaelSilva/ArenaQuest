import type { HttpTransport } from './api-client';

export type UserGrant = {
  id: string;
  userId: string;
  topicNodeId: string;
  grantedBy: string;
  grantedAt: string;
};

export type GroupGrant = {
  id: string;
  groupId: string;
  topicNodeId: string;
  grantedBy: string;
  grantedAt: string;
};

export function createAdminEnrollmentApi(http: HttpTransport) {
  return {
    async listUserGrants(userId: string): Promise<UserGrant[]> {
      const res = await http('GET', `/admin/users/${userId}/enrollments`);
      if (!res.ok) throw new Error(`Failed to list user grants (${res.status})`);
      const body = (await res.json()) as { data: UserGrant[] };
      return body.data;
    },

    async grantUserTopic(userId: string, topicNodeId: string): Promise<{ grant: UserGrant; created: boolean }> {
      const res = await http('POST', `/admin/users/${userId}/enrollments`, {
        body: JSON.stringify({ topicNodeId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to grant access (${res.status})`);
      }
      const grant = (await res.json()) as UserGrant;
      return { grant, created: res.status === 201 };
    },

    async revokeUserTopic(userId: string, topicId: string, cascade = false): Promise<void> {
      const qs = cascade ? '?cascade=true' : '';
      const res = await http('DELETE', `/admin/users/${userId}/enrollments/${topicId}${qs}`);
      if (!res.ok && res.status !== 204) {
        throw new Error(`Failed to revoke access (${res.status})`);
      }
    },

    async listGroupGrants(groupId: string): Promise<GroupGrant[]> {
      const res = await http('GET', `/admin/groups/${groupId}/enrollments`);
      if (!res.ok) throw new Error(`Failed to list group grants (${res.status})`);
      const body = (await res.json()) as { data: GroupGrant[] };
      return body.data;
    },

    async grantGroupTopic(groupId: string, topicNodeId: string): Promise<{ grant: GroupGrant; created: boolean }> {
      const res = await http('POST', `/admin/groups/${groupId}/enrollments`, {
        body: JSON.stringify({ topicNodeId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to grant group access (${res.status})`);
      }
      const grant = (await res.json()) as GroupGrant;
      return { grant, created: res.status === 201 };
    },

    async revokeGroupTopic(groupId: string, topicId: string, cascade = false): Promise<void> {
      const qs = cascade ? '?cascade=true' : '';
      const res = await http('DELETE', `/admin/groups/${groupId}/enrollments/${topicId}${qs}`);
      if (!res.ok && res.status !== 204) {
        throw new Error(`Failed to revoke group access (${res.status})`);
      }
    },
  };
}

const _err = () => { throw new Error('adminEnrollmentApi is deprecated. Use useApiClient() hook instead.'); };
export const adminEnrollmentApi = {
  listUserGrants: _err,
  grantUserTopic: _err,
  revokeUserTopic: _err,
  listGroupGrants: _err,
  grantGroupTopic: _err,
  revokeGroupTopic: _err,
};
