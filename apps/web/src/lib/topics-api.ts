import type { TopicNode, Media } from './admin-topics-api';
import type { HttpTransport } from './api-client';
export type { TopicNode, Media };

export type TopicProgressStatus = 'not_started' | 'in_progress' | 'completed';

export type TopicProgressEntry = {
  topicNodeId: string;
  status: TopicProgressStatus;
};

export type TopicWithMedia = TopicNode & {
  children: TopicNode[];
  media: Media[];
};

export function createTopicsApi(http: HttpTransport) {
  return {
    async list(): Promise<TopicNode[]> {
      const res = await http('GET', '/topics');
      if (!res.ok) throw new Error(`Failed to list published topics (${res.status})`);
      const body = (await res.json()) as { data: TopicNode[] };
      return body.data;
    },

    async getById(id: string): Promise<TopicWithMedia> {
      const res = await http('GET', `/topics/${id}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error('Topic not found or not published');
        throw new Error(`Failed to get topic (${res.status})`);
      }
      return res.json();
    },

    async visit(id: string): Promise<void> {
      try {
        await http('POST', `/topics/${id}/visit`);
      } catch {
        // intentionally silent — beacon must not block rendering
      }
    },

    async listProgress(): Promise<TopicProgressEntry[]> {
      try {
        const res = await http('GET', '/me/progress/topics');
        if (!res.ok) return [];
        const body = (await res.json()) as { data: TopicProgressEntry[] };
        return body.data;
      } catch {
        return [];
      }
    },

    async complete(id: string): Promise<TopicProgressStatus> {
      const res = await http('POST', `/topics/${id}/complete`);
      if (!res.ok) throw new Error(`Failed to mark topic as read (${res.status})`);
      const body = (await res.json()) as { topicProgress: { status: string } };
      return body.topicProgress.status as TopicProgressStatus;
    },

    async markVideoWatched(topicId: string, mediaId: string): Promise<void> {
      try {
        await http('POST', `/topics/${topicId}/videos/${mediaId}/watched`);
      } catch {
        // non-blocking beacon — swallow all errors
      }
    },
  };
}

// Deprecated: use useApiClient hook instead. Temporary export for backward compatibility during migration.
// This will be removed in Phase C after all consumers are migrated.
const _deprecationError = () => {
  throw new Error(
    'topicsApi is deprecated and no longer bound to auth context. Use const client = useApiClient(); instead.',
  );
};
export const topicsApi = {
  list: _deprecationError,
  getById: _deprecationError,
  visit: _deprecationError,
  listProgress: _deprecationError,
  complete: _deprecationError,
};
