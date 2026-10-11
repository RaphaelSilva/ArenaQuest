import type { Dictionary } from '@web/i18n/types';
import { MissionsApiError } from '@web/lib/missions-api';

type MissionsDict = Dictionary['missions'];

/** Student-facing copy for a failed mission call (join, leave, check). */
export function missionErrorMessage(error: unknown, d: MissionsDict): string {
  if (!(error instanceof MissionsApiError)) return d.errors.generic;
  switch (error.code) {
    case 'MISSION_CLOSED':
    case 'MISSION_NOT_JOINABLE':
    case 'MISSION_NOT_LEAVABLE':
    case 'MISSION_STEP_LOCKED':
    case 'MISSION_EVALUATOR_UNAVAILABLE':
    case 'NotFound':
      return d.errors[error.code];
    case 'NetworkError':
      return d.errors.network;
    default:
      return d.errors.generic;
  }
}
