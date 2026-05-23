import type { HttpTransport } from './api-client';

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

async function rejectWith(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  throw new AdminTasksApiError(
    typeof body.error === 'string' ? body.error : fallback,
    res.status,
    body,
  );
}

export function createAdminTasksApi(http: HttpTransport) {
  return {
    async list(status?: TaskStatus): Promise<Task[]> {
      const qs = status ? `?status=${status}` : '';
      const res = await http('GET', `/admin/tasks${qs}`);
      if (!res.ok) await rejectWith(res, 'LIST_FAILED');
      const body = (await res.json()) as { data: Task[] };
      return body.data;
    },

    async create(data: CreateTaskInput): Promise<Task> {
      const res = await http('POST', '/admin/tasks', {
        body: JSON.stringify(data),
      });
      if (!res.ok) await rejectWith(res, 'CREATE_FAILED');
      return res.json();
    },

    async getById(id: string): Promise<TaskDetail> {
      const res = await http('GET', `/admin/tasks/${id}`);
      if (!res.ok) await rejectWith(res, 'GET_FAILED');
      return res.json();
    },

    async update(id: string, data: UpdateTaskInput): Promise<Task> {
      const res = await http('PATCH', `/admin/tasks/${id}`, {
        body: JSON.stringify(data),
      });
      if (!res.ok) await rejectWith(res, 'UPDATE_FAILED');
      return res.json();
    },

    async archive(id: string): Promise<void> {
      const res = await http('DELETE', `/admin/tasks/${id}`);
      if (!res.ok && res.status !== 204) await rejectWith(res, 'ARCHIVE_FAILED');
    },

    async setTaskTopics(id: string, topicIds: string[]): Promise<void> {
      const res = await http('POST', `/admin/tasks/${id}/topics`, {
        body: JSON.stringify({ topicIds }),
      });
      if (!res.ok) await rejectWith(res, 'SET_TASK_TOPICS_FAILED');
    },

    async createStage(taskId: string, label: string): Promise<TaskStage> {
      const res = await http('POST', `/admin/tasks/${taskId}/stages`, {
        body: JSON.stringify({ label }),
      });
      if (!res.ok) await rejectWith(res, 'CREATE_STAGE_FAILED');
      return res.json();
    },

    async updateStage(taskId: string, stageId: string, label: string): Promise<TaskStage> {
      const res = await http('PATCH', `/admin/tasks/${taskId}/stages/${stageId}`, {
        body: JSON.stringify({ label }),
      });
      if (!res.ok) await rejectWith(res, 'UPDATE_STAGE_FAILED');
      return res.json();
    },

    async deleteStage(taskId: string, stageId: string): Promise<void> {
      const res = await http('DELETE', `/admin/tasks/${taskId}/stages/${stageId}`);
      if (!res.ok && res.status !== 204) await rejectWith(res, 'DELETE_STAGE_FAILED');
    },

    async reorderStages(taskId: string, stageIds: string[]): Promise<TaskStage[]> {
      const res = await http('POST', `/admin/tasks/${taskId}/stages/reorder`, {
        body: JSON.stringify({ stageIds }),
      });
      if (!res.ok) await rejectWith(res, 'REORDER_STAGES_FAILED');
      const body = (await res.json()) as { data: TaskStage[] };
      return body.data;
    },

    async setStageTopics(taskId: string, stageId: string, topicIds: string[]): Promise<void> {
      const res = await http('POST', `/admin/tasks/${taskId}/stages/${stageId}/topics`, {
        body: JSON.stringify({ topicIds }),
      });
      if (!res.ok) await rejectWith(res, 'SET_STAGE_TOPICS_FAILED');
    },
  };
}

const _err = () => { throw new Error('adminTasksApi is deprecated. Use useApiClient() hook instead.'); };
export const adminTasksApi = {
  list: _err,
  create: _err,
  getById: _err,
  update: _err,
  archive: _err,
  setTaskTopics: _err,
  createStage: _err,
  updateStage: _err,
  deleteStage: _err,
  reorderStages: _err,
  setStageTopics: _err,
};
