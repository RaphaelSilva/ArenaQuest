import type { TopicNode, Media } from './admin-topics-api';
import { fetchWithAuth, type FetchWithAuthOptions } from './fetch-with-auth';
export type { TopicNode, Media };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

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

export type TopicProgressStatus = 'not_started' | 'in_progress' | 'completed';

export type TopicProgressEntry = {
  topicNodeId: string;
  status: TopicProgressStatus;
};

export type TopicWithMedia = TopicNode & {
  children: TopicNode[];
  media: Media[];
};

export const topicsApi = {
  async list(
    token: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<TopicNode[]> {
    const res = await apiFetch('/topics', token, refreshFn, onTokenUpdate, onSessionExpired);
    if (!res.ok) throw new Error(`Failed to list published topics (${res.status})`);
    const body = (await res.json()) as { data: TopicNode[] };
    return body.data;
  },

  async getById(
    token: string,
    id: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<TopicWithMedia> {
    const res = await apiFetch(`/topics/${id}`, token, refreshFn, onTokenUpdate, onSessionExpired);
    if (!res.ok) {
      if (res.status === 404) throw new Error('Topic not found or not published');
      throw new Error(`Failed to get topic (${res.status})`);
    }
    return res.json();
  },

  /** Fire-and-forget visit beacon. Never throws. */
  async visit(
    token: string,
    id: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<void> {
    try {
      await apiFetch(
        `/topics/${id}/visit`,
        token,
        refreshFn,
        onTokenUpdate,
        onSessionExpired,
        { method: 'POST' },
      );
    } catch {
      // intentionally silent — beacon must not block rendering
    }
  },

  async listProgress(
    token: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<TopicProgressEntry[]> {
    try {
      const res = await apiFetch('/me/progress/topics', token, refreshFn, onTokenUpdate, onSessionExpired);
      if (!res.ok) return [];
      const body = (await res.json()) as { data: TopicProgressEntry[] };
      return body.data;
    } catch {
      return [];
    }
  },

  async complete(
    token: string,
    id: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<TopicProgressStatus> {
    const res = await apiFetch(
      `/topics/${id}/complete`,
      token,
      refreshFn,
      onTokenUpdate,
      onSessionExpired,
      { method: 'POST' },
    );
    if (!res.ok) throw new Error(`Failed to mark topic as read (${res.status})`);
    const body = (await res.json()) as { topicProgress: { status: string } };
    return body.topicProgress.status as TopicProgressStatus;
  },
};
