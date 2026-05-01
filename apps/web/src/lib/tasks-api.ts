const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export type TaskSummary = {
  id: string;
  title: string;
  stageCount: number;
  topicCount: number;
  updatedAt: string;
};

export type PublicStage = {
  id: string;
  label: string;
  order: number;
  topics: { id: string; title: string }[];
};

export type PublicTaskDetail = {
  id: string;
  title: string;
  description: string;
  updatedAt: string;
  stages: PublicStage[];
};

async function apiFetch(path: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

export const tasksApi = {
  async list(token: string): Promise<TaskSummary[]> {
    const res = await apiFetch('/tasks', token);
    if (!res.ok) throw new Error(`Failed to list tasks (${res.status})`);
    const body = (await res.json()) as { data: TaskSummary[] };
    return body.data;
  },

  async getById(token: string, id: string): Promise<PublicTaskDetail> {
    const res = await apiFetch(`/tasks/${id}`, token);
    if (!res.ok) throw new Error(`Failed to load task (${res.status})`);
    return res.json();
  },
};
