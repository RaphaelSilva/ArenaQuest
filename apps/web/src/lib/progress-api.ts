import type { HttpTransport } from './api-client';

export type ProgressSummary = {
  topics: { total: number; completed: number; inProgress: number; percentage: number };
  tasks: { total: number; completed: number; inProgress: number; percentage: number };
  lastActivityAt: string | null;
};

export type TopicProgressItem = {
  topicNodeId: string;
  status: string;
  completedAt: string | null;
  updatedAt: string;
};

export type TaskProgressItem = {
  taskId: string;
  status: string;
  currentStageId: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export function createProgressApi(http: HttpTransport) {
  return {
    async getSummary(): Promise<ProgressSummary> {
      const res = await http('GET', '/me/progress/summary');
      if (!res.ok) throw new Error(`Failed to load progress summary (${res.status})`);
      return res.json();
    },

    async getTopics(): Promise<TopicProgressItem[]> {
      const res = await http('GET', '/me/progress/topics');
      if (!res.ok) throw new Error(`Failed to load topic progress (${res.status})`);
      const body = (await res.json()) as { data: TopicProgressItem[] };
      return body.data;
    },

    async getTasks(): Promise<TaskProgressItem[]> {
      const res = await http('GET', '/me/progress/tasks');
      if (!res.ok) throw new Error(`Failed to load task progress (${res.status})`);
      const body = (await res.json()) as { data: TaskProgressItem[] };
      return body.data;
    },
  };
}

const _err = () => { throw new Error('progressApi is deprecated. Use useApiClient() hook instead.'); };
export const progressApi = { getSummary: _err, getTopics: _err, getTasks: _err };
