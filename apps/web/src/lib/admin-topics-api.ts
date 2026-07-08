import type { Media } from './admin-media-api';
import type { HttpTransport } from './api-client';
export type { Media };

export type TopicNode = {
  id: string;
  parentId: string | null;
  title: string;
  content: string;
  status: 'draft' | 'published' | 'archived';
  visibility?: 'public' | 'restricted' | 'private';
  archived: boolean;
  order: number;
  estimatedMinutes: number;
  tags: { id: string; name: string; slug: string }[];
  prerequisiteIds: string[];
  media?: Media[];
  mediaCount?: {
    video: number;
    audio: number;
    pdf: number;
    total: number;
  };
};

export type CreateTopicInput = {
  title: string;
  parentId?: string | null;
  content?: string;
  status?: 'draft' | 'published' | 'archived';
  visibility?: 'public' | 'restricted' | 'private';
  estimatedMinutes?: number;
  tagIds?: string[];
  prerequisiteIds?: string[];
};

export type UpdateTopicInput = {
  title?: string;
  content?: string;
  status?: 'draft' | 'published' | 'archived';
  visibility?: 'public' | 'restricted' | 'private';
  estimatedMinutes?: number;
  tagIds?: string[];
  prerequisiteIds?: string[];
};

export type MoveTopicInput = {
  newParentId: string | null;
  newSortOrder?: number;
};

export function createAdminTopicsApi(http: HttpTransport) {
  return {
    async list(): Promise<TopicNode[]> {
      const res = await http('GET', '/admin/topics');
      if (!res.ok) throw new Error(`Failed to list topics (${res.status})`);
      const body = (await res.json()) as { data: TopicNode[] };
      return body.data;
    },

    async create(data: CreateTopicInput): Promise<TopicNode> {
      const res = await http('POST', '/admin/topics', {
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to create topic (${res.status})`);
      }
      return res.json();
    },

    async update(id: string, data: UpdateTopicInput): Promise<TopicNode> {
      const res = await http('PATCH', `/admin/topics/${id}`, {
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to update topic (${res.status})`);
      }
      return res.json();
    },

    async move(id: string, data: MoveTopicInput): Promise<TopicNode> {
      const res = await http('POST', `/admin/topics/${id}/move`, {
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        if (res.status === 409) throw new Error('WOULD_CYCLE');
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to move topic (${res.status})`);
      }
      return res.json();
    },

    async archive(id: string): Promise<void> {
      const res = await http('DELETE', `/admin/topics/${id}`);
      if (!res.ok && res.status !== 204) {
        throw new Error(`Failed to archive topic (${res.status})`);
      }
    },
  };
}

const _err = () => { throw new Error('adminTopicsApi is deprecated. Use useApiClient() hook instead: const client = useApiClient(); await client.adminTopics.list()'); };
export const adminTopicsApi = {
  list: _err,
  create: _err,
  update: _err,
  move: _err,
  archive: _err,
};
