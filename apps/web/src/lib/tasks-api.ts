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

export type CheckInResult = {
  checkIn: { id: string; stageId: string; checkedInAt: string };
  taskProgress: { status: string; currentStageId: string | null; completedAt: string | null };
};

export type CheckInError =
  | { type: 'OUT_OF_ORDER'; expectedStageId: string | null }
  | { type: 'NOT_ENROLLED' }
  | { type: 'NOT_FOUND' }
  | { type: 'UNKNOWN'; message: string };

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

  async checkIn(
    token: string,
    taskId: string,
    stageId: string,
  ): Promise<{ result: CheckInResult; created: boolean } | { error: CheckInError }> {
    const res = await apiFetch(`/tasks/${taskId}/stages/${stageId}/check-in`, token, {
      method: 'POST',
    });
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
