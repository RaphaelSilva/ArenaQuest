import { fetchWithAuth, type FetchWithAuthOptions } from './fetch-with-auth';

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

async function rejectWith(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  throw new AdminTasksApiError(
    typeof body.error === 'string' ? body.error : fallback,
    res.status,
    body,
  );
}

export const adminTasksApi = {
  async list(
    token: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
    status?: TaskStatus,
  ): Promise<Task[]> {
    const qs = status ? `?status=${status}` : '';
    const res = await apiFetch(`/admin/tasks${qs}`, token, refreshFn, onTokenUpdate, onSessionExpired);
    if (!res.ok) await rejectWith(res, 'LIST_FAILED');
    const body = (await res.json()) as { data: Task[] };
    return body.data;
  },

  async create(
    token: string,
    data: CreateTaskInput,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<Task> {
    const res = await apiFetch('/admin/tasks', token, refreshFn, onTokenUpdate, onSessionExpired, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!res.ok) await rejectWith(res, 'CREATE_FAILED');
    return res.json();
  },

  async getById(
    token: string,
    id: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<TaskDetail> {
    const res = await apiFetch(`/admin/tasks/${id}`, token, refreshFn, onTokenUpdate, onSessionExpired);
    if (!res.ok) await rejectWith(res, 'GET_FAILED');
    return res.json();
  },

  async update(
    token: string,
    id: string,
    data: UpdateTaskInput,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<Task> {
    const res = await apiFetch(`/admin/tasks/${id}`, token, refreshFn, onTokenUpdate, onSessionExpired, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (!res.ok) await rejectWith(res, 'UPDATE_FAILED');
    return res.json();
  },

  async archive(
    token: string,
    id: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<void> {
    const res = await apiFetch(`/admin/tasks/${id}`, token, refreshFn, onTokenUpdate, onSessionExpired, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 204) await rejectWith(res, 'ARCHIVE_FAILED');
  },

  async setTaskTopics(
    token: string,
    id: string,
    topicIds: string[],
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<void> {
    const res = await apiFetch(`/admin/tasks/${id}/topics`, token, refreshFn, onTokenUpdate, onSessionExpired, {
      method: 'POST',
      body: JSON.stringify({ topicIds }),
    });
    if (!res.ok) await rejectWith(res, 'SET_TASK_TOPICS_FAILED');
  },

  async createStage(
    token: string,
    taskId: string,
    label: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<TaskStage> {
    const res = await apiFetch(`/admin/tasks/${taskId}/stages`, token, refreshFn, onTokenUpdate, onSessionExpired, {
      method: 'POST',
      body: JSON.stringify({ label }),
    });
    if (!res.ok) await rejectWith(res, 'CREATE_STAGE_FAILED');
    return res.json();
  },

  async updateStage(
    token: string,
    taskId: string,
    stageId: string,
    label: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<TaskStage> {
    const res = await apiFetch(`/admin/tasks/${taskId}/stages/${stageId}`, token, refreshFn, onTokenUpdate, onSessionExpired, {
      method: 'PATCH',
      body: JSON.stringify({ label }),
    });
    if (!res.ok) await rejectWith(res, 'UPDATE_STAGE_FAILED');
    return res.json();
  },

  async deleteStage(
    token: string,
    taskId: string,
    stageId: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<void> {
    const res = await apiFetch(
      `/admin/tasks/${taskId}/stages/${stageId}`,
      token,
      refreshFn,
      onTokenUpdate,
      onSessionExpired,
      { method: 'DELETE' },
    );
    if (!res.ok && res.status !== 204) await rejectWith(res, 'DELETE_STAGE_FAILED');
  },

  async reorderStages(
    token: string,
    taskId: string,
    stageIds: string[],
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<TaskStage[]> {
    const res = await apiFetch(`/admin/tasks/${taskId}/stages/reorder`, token, refreshFn, onTokenUpdate, onSessionExpired, {
      method: 'POST',
      body: JSON.stringify({ stageIds }),
    });
    if (!res.ok) await rejectWith(res, 'REORDER_STAGES_FAILED');
    const body = (await res.json()) as { data: TaskStage[] };
    return body.data;
  },

  async setStageTopics(
    token: string,
    taskId: string,
    stageId: string,
    topicIds: string[],
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<void> {
    const res = await apiFetch(
      `/admin/tasks/${taskId}/stages/${stageId}/topics`,
      token,
      refreshFn,
      onTokenUpdate,
      onSessionExpired,
      {
        method: 'POST',
        body: JSON.stringify({ topicIds }),
      },
    );
    if (!res.ok) await rejectWith(res, 'SET_STAGE_TOPICS_FAILED');
  },
};
