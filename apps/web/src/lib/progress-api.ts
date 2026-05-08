const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

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

async function apiFetch(path: string, token: string): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  });
}

export const progressApi = {
  async getSummary(token: string): Promise<ProgressSummary> {
    const res = await apiFetch('/me/progress/summary', token);
    if (!res.ok) throw new Error(`Failed to load progress summary (${res.status})`);
    return res.json();
  },

  async getTopics(token: string): Promise<TopicProgressItem[]> {
    const res = await apiFetch('/me/progress/topics', token);
    if (!res.ok) throw new Error(`Failed to load topic progress (${res.status})`);
    const body = (await res.json()) as { data: TopicProgressItem[] };
    return body.data;
  },

  async getTasks(token: string): Promise<TaskProgressItem[]> {
    const res = await apiFetch('/me/progress/tasks', token);
    if (!res.ok) throw new Error(`Failed to load task progress (${res.status})`);
    const body = (await res.json()) as { data: TaskProgressItem[] };
    return body.data;
  },
};
