import type { HttpTransport } from './api-client';
import type { components } from './api-types.gen';

type Schemas = components['schemas'];

/**
 * One mission as the student sees it (RFC 0022 §6): the mission, the caller's
 * aggregate progress, how they are enrolled, whether they may join, the locked
 * teaser and the evaluated steps. The server decides every field — the UI only
 * renders them.
 */
export type DashboardMissionEntry = Schemas['DashboardMissionEntry'];

/** One evaluated step, with its target redacted when the caller cannot open it (§8). */
export type MissionStepView = Schemas['MissionStepView'];

/** A step's target: a topic or an event; `null` for a `manual_check` step. */
export type MissionStepTarget = MissionStepView['target'];

/** How the caller takes part; `null` when not enrolled. */
export type MissionEnrollmentView = Schemas['MissionEnrollmentView'];

/** Teaser of an `assigned` mission the caller is not in; `null` otherwise. */
export type MissionLocked = Schemas['MissionLocked'];

/** The caller's aggregate progress; `null` before any evaluation. */
export type MissionProgress = Schemas['MissionProgress'];

export type MissionMode = Schemas['Mission']['mode'];

export type MissionStepKind = MissionStepView['kind'];

/** `POST …/requirements/{reqId}/check`: the ticked step and its re-evaluated mission. */
export type MissionCheckResult = { step: MissionStepView; mission: DashboardMissionEntry };

/** `POST …/join`: `created` is `true` on `201`, `false` on `200` (already joined). */
export type MissionJoinResult = { created: boolean; entry: DashboardMissionEntry };

/**
 * Error codes the student mission routes answer, plus the transport-level ones.
 * `NotFound` covers every miss (§8): the UI never learns why.
 */
export type MissionsApiErrorCode =
  | 'MISSION_NOT_JOINABLE'
  | 'MISSION_CLOSED'
  | 'MISSION_NOT_LEAVABLE'
  | 'MISSION_STEP_LOCKED'
  | 'MISSION_EVALUATOR_UNAVAILABLE'
  | 'NotFound'
  | 'Unauthorized'
  | 'NetworkError'
  | 'Unknown';

const KNOWN_CODES: readonly MissionsApiErrorCode[] = [
  'MISSION_NOT_JOINABLE',
  'MISSION_CLOSED',
  'MISSION_NOT_LEAVABLE',
  'MISSION_STEP_LOCKED',
  'MISSION_EVALUATOR_UNAVAILABLE',
];

export class MissionsApiError extends Error {
  readonly code: MissionsApiErrorCode;
  readonly status: number;

  constructor(code: MissionsApiErrorCode, status: number, message: string = code) {
    super(message);
    this.name = 'MissionsApiError';
    this.code = code;
    this.status = status;
  }
}

async function send(http: HttpTransport, method: string, path: string): Promise<Response> {
  try {
    return await http(method, path);
  } catch {
    throw new MissionsApiError('NetworkError', 0, 'Network failure.');
  }
}

/** Maps a non-2xx response to a typed error carrying the API's `error` code. */
async function rejectWith(res: Response): Promise<never> {
  if (res.status === 404) throw new MissionsApiError('NotFound', 404);
  if (res.status === 401) throw new MissionsApiError('Unauthorized', 401);
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  const code = typeof body.error === 'string' ? body.error : '';
  const known = KNOWN_CODES.find((c) => c === code);
  throw new MissionsApiError(known ?? 'Unknown', res.status, code || `Failed (${res.status})`);
}

const missionPath = (id: string) => `/me/missions/${encodeURIComponent(id)}`;

/** Student missions (`/v1/me/missions/*`). Responses are bare entries — no `{ data }` envelope. */
export function createMissionsApi(http: HttpTransport) {
  return {
    /** One mission with its steps (the mission page). A miss is `NotFound`. */
    async getMission(id: string): Promise<DashboardMissionEntry> {
      const res = await send(http, 'GET', missionPath(id));
      if (!res.ok) return rejectWith(res);
      return (await res.json()) as DashboardMissionEntry;
    },

    /** Joins an `open` mission; evidence counts from now on. */
    async join(id: string): Promise<MissionJoinResult> {
      const res = await send(http, 'POST', `${missionPath(id)}/join`);
      if (!res.ok) return rejectWith(res);
      const entry = (await res.json()) as DashboardMissionEntry;
      return { created: res.status === 201, entry };
    },

    /** Leaves a `self` enrollment; completed steps and rewards stay. */
    async leave(id: string): Promise<void> {
      const res = await send(http, 'POST', `${missionPath(id)}/leave`);
      if (!res.ok) return rejectWith(res);
    },

    /** Ticks a `manual_check` step; the check is final. */
    async check(id: string, requirementId: string): Promise<MissionCheckResult> {
      const res = await send(
        http,
        'POST',
        `${missionPath(id)}/requirements/${encodeURIComponent(requirementId)}/check`,
      );
      if (!res.ok) return rejectWith(res);
      return (await res.json()) as MissionCheckResult;
    },
  };
}
