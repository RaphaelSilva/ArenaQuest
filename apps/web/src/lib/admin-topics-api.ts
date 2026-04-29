import type { Media } from './admin-media-api';

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

export const adminTopicsApi = {
  async list(token: string): Promise<TopicNode[]> {
    const res = await apiFetch('/admin/topics', token);
    if (!res.ok) throw new Error(`Failed to list topics (${res.status})`);
    const body = (await res.json()) as { data: TopicNode[] };
    return body.data;
  },

  async create(token: string, data: CreateTopicInput): Promise<TopicNode> {
    const res = await apiFetch('/admin/topics', token, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Failed to create topic (${res.status})`);
    }
    return res.json();
  },

  async update(token: string, id: string, data: UpdateTopicInput): Promise<TopicNode> {
    const res = await apiFetch(`/admin/topics/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Failed to update topic (${res.status})`);
    }
    return res.json();
  },

  async move(token: string, id: string, data: MoveTopicInput): Promise<TopicNode> {
    const res = await apiFetch(`/admin/topics/${id}/move`, token, {
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

  async archive(token: string, id: string): Promise<void> {
    const res = await apiFetch(`/admin/topics/${id}`, token, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      throw new Error(`Failed to archive topic (${res.status})`);
    }
  },
};
