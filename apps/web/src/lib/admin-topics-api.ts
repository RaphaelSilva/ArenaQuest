import type { Media } from './admin-media-api';
import { fetchWithAuth, type FetchWithAuthOptions } from './fetch-with-auth';
export type { Media };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export type TopicNode = {
  id: string;
  parentId: string | null;
  title: string;
  content: string;
  status: 'draft' | 'published' | 'archived';
  archived: boolean;
  order: number;
  estimatedMinutes: number;
  tags: { id: string; name: string; slug: string }[];
  prerequisiteIds: string[];
  media?: Media[];
};

export type CreateTopicInput = {
  title: string;
  parentId?: string | null;
  content?: string;
  status?: 'draft' | 'published' | 'archived';
  estimatedMinutes?: number;
  tagIds?: string[];
  prerequisiteIds?: string[];
};

export type UpdateTopicInput = {
  title?: string;
  content?: string;
  status?: 'draft' | 'published' | 'archived';
  estimatedMinutes?: number;
  tagIds?: string[];
  prerequisiteIds?: string[];
};

export type MoveTopicInput = {
  newParentId: string | null;
  newSortOrder?: number;
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

export const adminTopicsApi = {
  async list(
    token: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<TopicNode[]> {
    const res = await apiFetch('/admin/topics', token, refreshFn, onTokenUpdate, onSessionExpired);
    if (!res.ok) throw new Error(`Failed to list topics (${res.status})`);
    const body = (await res.json()) as { data: TopicNode[] };
    return body.data;
  },

  async create(
    token: string,
    data: CreateTopicInput,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<TopicNode> {
    const res = await apiFetch('/admin/topics', token, refreshFn, onTokenUpdate, onSessionExpired, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Failed to create topic (${res.status})`);
    }
    return res.json();
  },

  async update(
    token: string,
    id: string,
    data: UpdateTopicInput,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<TopicNode> {
    const res = await apiFetch(`/admin/topics/${id}`, token, refreshFn, onTokenUpdate, onSessionExpired, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Failed to update topic (${res.status})`);
    }
    return res.json();
  },

  async move(
    token: string,
    id: string,
    data: MoveTopicInput,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<TopicNode> {
    const res = await apiFetch(`/admin/topics/${id}/move`, token, refreshFn, onTokenUpdate, onSessionExpired, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      if (res.status === 409) throw new Error('WOULD_CYCLE');
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Failed to move topic (${res.status})`);
    }
    return res.json();
  },

  async archive(
    token: string,
    id: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<void> {
    const res = await apiFetch(`/admin/topics/${id}`, token, refreshFn, onTokenUpdate, onSessionExpired, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(`Failed to archive topic (${res.status})`);
    }
  },
};
