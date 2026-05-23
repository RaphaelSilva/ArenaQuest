import type { HttpTransport } from './api-client';

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

export type CheckInResult = {
  checkIn: { id: string; stageId: string; checkedInAt: string };
  taskProgress: { status: string; currentStageId: string | null; completedAt: string | null };
};

export type CheckInError =
  | { type: 'OUT_OF_ORDER'; expectedStageId: string | null }
  | { type: 'NOT_ENROLLED' }
  | { type: 'NOT_FOUND' }
  | { type: 'UNKNOWN'; message: string };

export function createTasksApi(http: HttpTransport) {
  return {
    async list(): Promise<TaskSummary[]> {
      const res = await http('GET', '/tasks');
      if (!res.ok) throw new Error(`Failed to list tasks (${res.status})`);
      const body = (await res.json()) as { data: TaskSummary[] };
      return body.data;
    },

    async getById(id: string): Promise<PublicTaskDetail> {
      const res = await http('GET', `/tasks/${id}`);
      if (!res.ok) throw new Error(`Failed to load task (${res.status})`);
      return res.json();
    },

    async checkIn(taskId: string, stageId: string): Promise<{ result: CheckInResult; created: boolean } | { error: CheckInError }> {
      const res = await http('POST', `/tasks/${taskId}/stages/${stageId}/check-in`);
      if (res.ok) {
        const body = (await res.json()) as CheckInResult;
        return { result: body, created: res.status === 201 };
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; expectedStageId?: string | null };
      if (res.status === 409 && body.error === 'OUT_OF_ORDER') {
        return { error: { type: 'OUT_OF_ORDER', expectedStageId: body.expectedStageId ?? null } };
      }
      if (res.status === 403) return { error: { type: 'NOT_ENROLLED' } };
      if (res.status === 404) return { error: { type: 'NOT_FOUND' } };
      return { error: { type: 'UNKNOWN', message: body.error ?? `HTTP ${res.status}` } };
    },
  };
}

const _err = () => { throw new Error('tasksApi is deprecated. Use useApiClient() hook instead.'); };
export const tasksApi = {
  list: _err,
  getById: _err,
  checkIn: _err,
};
