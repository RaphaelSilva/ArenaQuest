import { AdminGamificationApiError } from '@web/lib/admin-gamification-api';
import type { Dictionary } from '@web/i18n/types';
import type { StepIssue } from './mission-draft';

type MissionsDict = Dictionary['admin']['missions'];
/** API error codes (and target `reason`s) that have their own sentence in `errors`. */
const CODES = [
  'TOPIC_NOT_FOUND',
  'TOPIC_NOT_PUBLISHED',
  'TOPIC_ARCHIVED',
  'TOPIC_HAS_NO_VIDEO',
  'EVENT_NOT_FOUND',
  'EVENT_NOT_PUBLISHED',
  'EVENT_NOT_CHARGEABLE',
  'REQUIREMENT_SHARING_DISABLED',
  'MISSION_STARTED',
  'MISSION_LEGACY',
  'MISSION_NOT_ASSIGNED',
  'BADGE_NOT_FOUND',
  'UNKNOWN_AUDIENCE_TARGET',
  'AUDIENCE_NOT_ALLOWED',
] as const satisfies readonly (keyof MissionsDict['errors'])[];
type ErrorCode = (typeof CODES)[number];

const isCode = (value: string | undefined): value is ErrorCode =>
  value !== undefined && (CODES as readonly string[]).includes(value);

export type MappedMissionError = {
  /** Form-level message. */
  message: string;
  /** Index of the step the API refused, with the card's message. */
  step?: { index: number; message: string };
  /** `409 MISSION_STARTED`: the editor switches to its started (locked) state. */
  started?: boolean;
};

/**
 * Turns an admin missions API error into editor copy. A requirement-scoped
 * error (`index`) lands on the card at that index; its `reason` picks the
 * sentence, falling back to the schema `field` for a validation issue.
 */
export function mapMissionError(error: unknown, d: MissionsDict): MappedMissionError {
  if (!(error instanceof AdminGamificationApiError)) return { message: d.saveError };

  const { code, index, reason, field } = error;
  if (index !== undefined) {
    const message = isCode(reason) ? d.errors[reason] : d.errors.invalidStep(field || reason || code);
    return { message: d.errors.stepsInvalid, step: { index, message } };
  }
  if (code === 'MISSION_STARTED') return { message: d.errors.MISSION_STARTED, started: true };
  if (isCode(code)) return { message: d.errors[code] };
  if (code === 'ValidationError') return { message: d.errors.validation };
  return { message: d.saveError };
}

/** Copy for a client-side step issue (the shared schema refused the step). */
export function stepIssueMessage(issue: StepIssue, d: MissionsDict, limits: { minCountMax: number; instructionsMax: number }): string {
  switch (issue.code) {
    case 'title':
      return d.errors.stepTitleRequired;
    case 'topic':
      return d.errors.topicRequired;
    case 'event':
      return d.errors.eventRequired;
    case 'minCount':
      return d.errors.minCountRange(1, limits.minCountMax);
    case 'xp':
      return d.errors.xpInvalid;
    case 'instructions':
      return d.errors.instructionsTooLong(limits.instructionsMax);
    case 'videoCap':
      return d.errors.videoCap(issue.count);
    case 'other':
      return d.errors.invalidStep(issue.field);
  }
}
