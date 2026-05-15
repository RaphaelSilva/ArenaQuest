import type { TopicNode } from './admin-topics-api';
export type { TopicNode };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

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

export type TopicProgressStatus = 'not_started' | 'in_progress' | 'completed';

export type TopicProgressEntry = {
  topicNodeId: string;
  status: TopicProgressStatus;
};

export const topicsApi = {
  async list(token: string): Promise<TopicNode[]> {
    const res = await apiFetch('/topics', token);
    if (!res.ok) throw new Error(`Failed to list published topics (${res.status})`);
    const body = (await res.json()) as { data: TopicNode[] };
    return body.data;
  },

  async getById(token: string, id: string): Promise<TopicNode & { children: TopicNode[] }> {
    const res = await apiFetch(`/topics/${id}`, token);
    if (!res.ok) {
      if (res.status === 404) throw new Error('Topic not found or not published');
      throw new Error(`Failed to get topic (${res.status})`);
    }
    return res.json();
  },

  /** Fire-and-forget visit beacon. Never throws. */
  async visit(token: string, id: string): Promise<void> {
    try {
      await apiFetch(`/topics/${id}/visit`, token, { method: 'POST' });
    } catch {
      // intentionally silent — beacon must not block rendering
    }
  },

  async listProgress(token: string): Promise<TopicProgressEntry[]> {
    try {
      const res = await apiFetch('/me/progress/topics', token);
      if (!res.ok) return [];
      const body = (await res.json()) as { data: TopicProgressEntry[] };
      return body.data;
    } catch {
      return [];
    }
  },

  async complete(token: string, id: string): Promise<TopicProgressStatus> {
    const res = await apiFetch(`/topics/${id}/complete`, token, { method: 'POST' });
    if (!res.ok) throw new Error(`Failed to mark topic as read (${res.status})`);
    const body = (await res.json()) as { topicProgress: { status: string } };
    return body.topicProgress.status as TopicProgressStatus;
  },
};
