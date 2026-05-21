import type { Entities } from '@arenaquest/shared/types/entities';
import type { RoleName } from '@arenaquest/shared/constants/roles';
import { fetchWithAuth, type FetchWithAuthOptions } from './fetch-with-auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

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

export const adminUsersApi = {
  async list(
    token: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
    page = 1,
    pageSize = 20,
  ): Promise<{ data: Entities.Identity.User[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const res = await apiFetch(
      `/admin/users?limit=${pageSize}&offset=${offset}`,
      token,
      refreshFn,
      onTokenUpdate,
      onSessionExpired,
    );
    if (!res.ok) throw new Error(`Failed to list users (${res.status})`);
    return res.json();
  },

  async create(
    token: string,
    data: CreateUserInput,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<Entities.Identity.User> {
    const res = await apiFetch('/admin/users', token, refreshFn, onTokenUpdate, onSessionExpired, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Failed to create user (${res.status})`);
    }
    return res.json();
  },

  async update(
    token: string,
    id: string,
    data: Partial<UpdateUserInput>,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<Entities.Identity.User> {
    const res = await apiFetch(`/admin/users/${id}`, token, refreshFn, onTokenUpdate, onSessionExpired, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Failed to update user (${res.status})`);
    }
    return res.json();
  },

  async deactivate(
    token: string,
    id: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<void> {
    const res = await apiFetch(`/admin/users/${id}`, token, refreshFn, onTokenUpdate, onSessionExpired, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(`Failed to deactivate user (${res.status})`);
    }
  },
};
