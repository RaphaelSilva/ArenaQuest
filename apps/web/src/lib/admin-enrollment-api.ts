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

async function apiFetch(path: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

export const adminEnrollmentApi = {
  // --- User enrollment ---

  async listUserGrants(token: string, userId: string): Promise<UserGrant[]> {
    const res = await apiFetch(`/admin/users/${userId}/enrollments`, token);
    if (!res.ok) throw new Error(`Failed to list user grants (${res.status})`);
    const body = (await res.json()) as { data: UserGrant[] };
    return body.data;
  },

  async grantUserTopic(token: string, userId: string, topicNodeId: string): Promise<{ grant: UserGrant; created: boolean }> {
    const res = await apiFetch(`/admin/users/${userId}/enrollments`, token, {
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

  async revokeUserTopic(token: string, userId: string, topicId: string, cascade = false): Promise<void> {
    const qs = cascade ? '?cascade=true' : '';
    const res = await apiFetch(`/admin/users/${userId}/enrollments/${topicId}${qs}`, token, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(`Failed to revoke access (${res.status})`);
    }
  },

  // --- Group enrollment ---

  async listGroupGrants(token: string, groupId: string): Promise<GroupGrant[]> {
    const res = await apiFetch(`/admin/groups/${groupId}/enrollments`, token);
    if (!res.ok) throw new Error(`Failed to list group grants (${res.status})`);
    const body = (await res.json()) as { data: GroupGrant[] };
    return body.data;
  },

  async grantGroupTopic(token: string, groupId: string, topicNodeId: string): Promise<{ grant: GroupGrant; created: boolean }> {
    const res = await apiFetch(`/admin/groups/${groupId}/enrollments`, token, {
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

  async revokeGroupTopic(token: string, groupId: string, topicId: string, cascade = false): Promise<void> {
    const qs = cascade ? '?cascade=true' : '';
    const res = await apiFetch(`/admin/groups/${groupId}/enrollments/${topicId}${qs}`, token, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(`Failed to revoke group access (${res.status})`);
    }
  },
};
