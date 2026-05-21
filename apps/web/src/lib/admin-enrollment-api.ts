import { fetchWithAuth, type FetchWithAuthOptions } from './fetch-with-auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

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

async function apiFetch(
  path: string,
  token: string,
  refreshFn: () => Promise<string | null>,
  onTokenUpdate: (token: string) => void,
  onSessionExpired: () => void,
  init?: FetchWithAuthOptions,
): Promise<Response> {
  return fetchWithAuth(
    `${API_URL}${path}`,
    {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    },
    token,
    refreshFn,
    onTokenUpdate,
    onSessionExpired,
  );
}

export const adminEnrollmentApi = {
  // --- User enrollment ---

  async listUserGrants(
    token: string,
    userId: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<UserGrant[]> {
    const res = await apiFetch(`/admin/users/${userId}/enrollments`, token, refreshFn, onTokenUpdate, onSessionExpired);
    if (!res.ok) throw new Error(`Failed to list user grants (${res.status})`);
    const body = (await res.json()) as { data: UserGrant[] };
    return body.data;
  },

  async grantUserTopic(
    token: string,
    userId: string,
    topicNodeId: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<{ grant: UserGrant; created: boolean }> {
    const res = await apiFetch(`/admin/users/${userId}/enrollments`, token, refreshFn, onTokenUpdate, onSessionExpired, {
      method: 'POST',
      body: JSON.stringify({ topicNodeId }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Failed to grant access (${res.status})`);
    }
    const grant = (await res.json()) as UserGrant;
    return { grant, created: res.status === 201 };
  },

  async revokeUserTopic(
    token: string,
    userId: string,
    topicId: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
    cascade = false,
  ): Promise<void> {
    const qs = cascade ? '?cascade=true' : '';
    const res = await apiFetch(`/admin/users/${userId}/enrollments/${topicId}${qs}`, token, refreshFn, onTokenUpdate, onSessionExpired, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(`Failed to revoke access (${res.status})`);
    }
  },

  // --- Group enrollment ---

  async listGroupGrants(
    token: string,
    groupId: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<GroupGrant[]> {
    const res = await apiFetch(`/admin/groups/${groupId}/enrollments`, token, refreshFn, onTokenUpdate, onSessionExpired);
    if (!res.ok) throw new Error(`Failed to list group grants (${res.status})`);
    const body = (await res.json()) as { data: GroupGrant[] };
    return body.data;
  },

  async grantGroupTopic(
    token: string,
    groupId: string,
    topicNodeId: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<{ grant: GroupGrant; created: boolean }> {
    const res = await apiFetch(`/admin/groups/${groupId}/enrollments`, token, refreshFn, onTokenUpdate, onSessionExpired, {
      method: 'POST',
      body: JSON.stringify({ topicNodeId }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Failed to grant group access (${res.status})`);
    }
    const grant = (await res.json()) as GroupGrant;
    return { grant, created: res.status === 201 };
  },

  async revokeGroupTopic(
    token: string,
    groupId: string,
    topicId: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
    cascade = false,
  ): Promise<void> {
    const qs = cascade ? '?cascade=true' : '';
    const res = await apiFetch(`/admin/groups/${groupId}/enrollments/${topicId}${qs}`, token, refreshFn, onTokenUpdate, onSessionExpired, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(`Failed to revoke group access (${res.status})`);
    }
  },
};
