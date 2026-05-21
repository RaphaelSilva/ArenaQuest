import { fetchWithAuth, type FetchWithAuthOptions } from './fetch-with-auth';

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
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    },
    token,
    refreshFn,
    onTokenUpdate,
    onSessionExpired,
  );
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
  async list(
    token: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<TaskSummary[]> {
    const res = await apiFetch('/tasks', token, refreshFn, onTokenUpdate, onSessionExpired);
    if (!res.ok) throw new Error(`Failed to list tasks (${res.status})`);
    const body = (await res.json()) as { data: TaskSummary[] };
    return body.data;
  },

  async getById(
    token: string,
    id: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<PublicTaskDetail> {
    const res = await apiFetch(`/tasks/${id}`, token, refreshFn, onTokenUpdate, onSessionExpired);
    if (!res.ok) throw new Error(`Failed to load task (${res.status})`);
    return res.json();
  },

  async checkIn(
    token: string,
    taskId: string,
    stageId: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<{ result: CheckInResult; created: boolean } | { error: CheckInError }> {
    const res = await apiFetch(
      `/tasks/${taskId}/stages/${stageId}/check-in`,
      token,
      refreshFn,
      onTokenUpdate,
      onSessionExpired,
      { method: 'POST' },
    );
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
