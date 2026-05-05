const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export type TaskStatus = 'draft' | 'published' | 'archived';

export type Task = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskStage = {
  id: string;
  taskId: string;
  label: string;
  order: number;
  createdAt: string;
};

export type TaskDetail = Task & {
  stages: TaskStage[];
  taskTopicIds: string[];
  stageTopicIds: Record<string, string[]>;
};

export type CreateTaskInput = {
  title: string;
  description?: string;
};

export type UpdateTaskInput = {
  title?: string;
  description?: string;
  status?: TaskStatus;
};

export type PublishError = {
  error: string;
  reasons?: string[];
};

export class AdminTasksApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'AdminTasksApiError';
  }
}

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

async function rejectWith(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  throw new AdminTasksApiError(
    typeof body.error === 'string' ? body.error : fallback,
    res.status,
    body,
  );
}

export const adminTasksApi = {
  async list(token: string, status?: TaskStatus): Promise<Task[]> {
    const qs = status ? `?status=${status}` : '';
    const res = await apiFetch(`/admin/tasks${qs}`, token);
    if (!res.ok) await rejectWith(res, 'LIST_FAILED');
    const body = (await res.json()) as { data: Task[] };
    return body.data;
  },

  async create(token: string, data: CreateTaskInput): Promise<Task> {
    const res = await apiFetch('/admin/tasks', token, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!res.ok) await rejectWith(res, 'CREATE_FAILED');
    return res.json();
  },

  async getById(token: string, id: string): Promise<TaskDetail> {
    const res = await apiFetch(`/admin/tasks/${id}`, token);
    if (!res.ok) await rejectWith(res, 'GET_FAILED');
    return res.json();
  },

  async update(token: string, id: string, data: UpdateTaskInput): Promise<Task> {
    const res = await apiFetch(`/admin/tasks/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (!res.ok) await rejectWith(res, 'UPDATE_FAILED');
    return res.json();
  },

  async archive(token: string, id: string): Promise<void> {
    const res = await apiFetch(`/admin/tasks/${id}`, token, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) await rejectWith(res, 'ARCHIVE_FAILED');
  },

  async setTaskTopics(token: string, id: string, topicIds: string[]): Promise<void> {
    const res = await apiFetch(`/admin/tasks/${id}/topics`, token, {
      method: 'POST',
      body: JSON.stringify({ topicIds }),
    });
    if (!res.ok) await rejectWith(res, 'SET_TASK_TOPICS_FAILED');
  },

  async createStage(token: string, taskId: string, label: string): Promise<TaskStage> {
    const res = await apiFetch(`/admin/tasks/${taskId}/stages`, token, {
      method: 'POST',
      body: JSON.stringify({ label }),
    });
    if (!res.ok) await rejectWith(res, 'CREATE_STAGE_FAILED');
    return res.json();
  },

  async updateStage(token: string, taskId: string, stageId: string, label: string): Promise<TaskStage> {
    const res = await apiFetch(`/admin/tasks/${taskId}/stages/${stageId}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ label }),
    });
    if (!res.ok) await rejectWith(res, 'UPDATE_STAGE_FAILED');
    return res.json();
  },

  async deleteStage(token: string, taskId: string, stageId: string): Promise<void> {
    const res = await apiFetch(`/admin/tasks/${taskId}/stages/${stageId}`, token, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) await rejectWith(res, 'DELETE_STAGE_FAILED');
  },

  async reorderStages(token: string, taskId: string, stageIds: string[]): Promise<TaskStage[]> {
    const res = await apiFetch(`/admin/tasks/${taskId}/stages/reorder`, token, {
      method: 'POST',
      body: JSON.stringify({ stageIds }),
    });
    if (!res.ok) await rejectWith(res, 'REORDER_STAGES_FAILED');
    const body = (await res.json()) as { data: TaskStage[] };
    return body.data;
  },

  async setStageTopics(token: string, taskId: string, stageId: string, topicIds: string[]): Promise<void> {
    const res = await apiFetch(`/admin/tasks/${taskId}/stages/${stageId}/topics`, token, {
      method: 'POST',
      body: JSON.stringify({ topicIds }),
    });
    if (!res.ok) await rejectWith(res, 'SET_STAGE_TOPICS_FAILED');
  },
};
