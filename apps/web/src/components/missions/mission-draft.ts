import {
  MANUAL_CHECK_INSTRUCTIONS_MAX,
  REQUIREMENT_MIN_COUNT_MAX,
  RequirementInput,
  type RequirementKind,
} from '@arenaquest/shared/domain/missions/requirements';
import type {
  CreateMissionInput,
  MissionAudience,
  MissionDetail,
  MissionEnrollmentMode,
  MissionMode,
  MissionRequirement,
  MissionRequirementInput,
  UpdateMissionInput,
} from '@web/lib/admin-gamification-api';

/**
 * The editor's working copy of a mission and its steps.
 *
 * A step keeps every kind's fields side by side (as form strings), so the card
 * can render any kind from one shape; {@link stepToInput} keeps only the fields
 * of the step's kind when building the payload, and the shared `RequirementInput`
 * schema — the one the API validates with — decides whether it is valid.
 */
export type StepDraft = {
  /** Client-only stable key (React list key and drag identity). */
  key: string;
  /** Persisted requirement id; `null` for a step added in this session. */
  id: string | null;
  kind: RequirementKind;
  title: string;
  xpReward: string;
  topicId: string;
  eventId: string;
  minCount: string;
  requireDescription: boolean;
  visibility: 'any' | 'shared_only';
  countModerated: boolean;
  instructions: string;
};

export type MissionDraft = {
  title: string;
  description: string;
  /** `datetime-local` values, read in the browser's zone. */
  startAt: string;
  endAt: string;
  mode: MissionMode;
  enrollmentMode: MissionEnrollmentMode;
  xpReward: string;
  badgeId: string;
  active: boolean;
  audience: MissionAudience;
  steps: StepDraft[];
};

let keySeq = 0;
const nextKey = (): string => {
  keySeq += 1;
  return `step-${keySeq}`;
};

export function emptyStep(kind: RequirementKind): StepDraft {
  return {
    key: nextKey(),
    id: null,
    kind,
    title: '',
    xpReward: '0',
    topicId: '',
    eventId: '',
    minCount: '1',
    requireDescription: false,
    visibility: 'any',
    // Owner's default (RFC 0022 Open Question 2): a moderated demonstration does not count.
    countModerated: false,
    instructions: '',
  };
}

export function emptyDraft(): MissionDraft {
  return {
    title: '',
    description: '',
    startAt: '',
    endAt: '',
    mode: 'parallel',
    enrollmentMode: 'auto',
    xpReward: '0',
    badgeId: '',
    active: true,
    audience: { groupIds: [], userIds: [] },
    steps: [],
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** ISO instant → `YYYY-MM-DDTHH:mm` in the browser's zone (the `datetime-local` shape). */
export function isoToLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `datetime-local` value → ISO instant, or `null` when empty or malformed. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stepFromRequirement(r: MissionRequirement): StepDraft {
  const params = r.params;
  const step = emptyStep(r.kind);
  return {
    ...step,
    id: r.id,
    title: r.title,
    xpReward: String(r.xpReward),
    topicId: r.topicId ?? '',
    eventId: r.eventId ?? '',
    minCount: typeof params.minCount === 'number' ? String(params.minCount) : step.minCount,
    requireDescription: params.requireDescription === true,
    visibility: params.visibility === 'shared_only' ? 'shared_only' : 'any',
    countModerated: params.countModerated === true,
    instructions: typeof params.instructions === 'string' ? params.instructions : '',
  };
}

export function draftFromDetail(detail: MissionDetail): MissionDraft {
  const { mission } = detail;
  return {
    title: mission.title,
    description: mission.description,
    startAt: isoToLocalInput(mission.startAt),
    endAt: isoToLocalInput(mission.endAt),
    mode: mission.mode,
    enrollmentMode: mission.enrollmentMode,
    xpReward: String(mission.xpReward),
    badgeId: mission.badgeId ?? '',
    active: mission.active,
    audience: { groupIds: [...detail.audience.groupIds], userIds: [...detail.audience.userIds] },
    steps: [...detail.requirements].sort((a, b) => a.position - b.position).map(stepFromRequirement),
  };
}

/** A form number: an empty field reads as `0` for XP, anything else as typed (NaN fails the schema). */
const toNumber = (value: string, emptyAs: number): number => (value.trim() === '' ? emptyAs : Number(value));

/** The payload object of one step — only the fields of its kind. Not validated. */
export function stepToInput(step: StepDraft): Record<string, unknown> {
  const base = { kind: step.kind, title: step.title.trim(), xpReward: toNumber(step.xpReward, 0) };
  switch (step.kind) {
    case 'submissions_on_topic':
      return {
        ...base,
        topicId: step.topicId,
        params: {
          minCount: toNumber(step.minCount, Number.NaN),
          requireDescription: step.requireDescription,
          visibility: step.visibility,
          countModerated: step.countModerated,
        },
      };
    case 'topic_visited':
      return { ...base, topicId: step.topicId, params: {} };
    case 'video_watched':
      return { ...base, topicId: step.topicId, params: { minCount: toNumber(step.minCount, Number.NaN) } };
    case 'manual_check':
      return { ...base, params: { instructions: step.instructions.trim() } };
    case 'event_participation':
      return { ...base, eventId: step.eventId, params: {} };
  }
}

/** Why a step failed the shared schema, as a stable code the editor turns into copy. */
export type StepIssue =
  | { code: 'title' }
  | { code: 'topic' }
  | { code: 'event' }
  | { code: 'minCount' }
  | { code: 'xp' }
  | { code: 'instructions' }
  | { code: 'videoCap'; count: number }
  | { code: 'other'; field: string };

export type StepValidation =
  | { ok: true; inputs: MissionRequirementInput[] }
  | { ok: false; issues: Record<number, StepIssue> };

/**
 * Validates every step with the shared `RequirementInput` schema, plus the one
 * check the schema cannot know: a `video_watched` minimum above the topic's
 * known video count. `videoCountOf` answers `undefined` while unknown, and an
 * unknown count never blocks — the server stays the authority.
 */
export function validateSteps(
  steps: StepDraft[],
  videoCountOf: (topicId: string) => number | undefined,
): StepValidation {
  const issues: Record<number, StepIssue> = {};
  const inputs: MissionRequirementInput[] = [];
  steps.forEach((step, index) => {
    const parsed = RequirementInput.safeParse(stepToInput(step));
    if (!parsed.success) {
      const path = parsed.error.issues[0]?.path ?? [];
      const field = path[path.length - 1];
      if (field === 'title') issues[index] = { code: 'title' };
      else if (field === 'topicId') issues[index] = { code: 'topic' };
      else if (field === 'eventId') issues[index] = { code: 'event' };
      else if (field === 'minCount') issues[index] = { code: 'minCount' };
      else if (field === 'xpReward') issues[index] = { code: 'xp' };
      else if (field === 'instructions') issues[index] = { code: 'instructions' };
      else issues[index] = { code: 'other', field: path.join('.') };
      return;
    }
    if (parsed.data.kind === 'video_watched') {
      const count = videoCountOf(parsed.data.topicId);
      if (count !== undefined && parsed.data.params.minCount > count) {
        issues[index] = { code: 'videoCap', count };
        return;
      }
    }
    inputs.push(parsed.data);
  });
  return Object.keys(issues).length > 0 ? { ok: false, issues } : { ok: true, inputs };
}

export const STEP_LIMITS = {
  minCountMax: REQUIREMENT_MIN_COUNT_MAX,
  instructionsMax: MANUAL_CHECK_INSTRUCTIONS_MAX,
} as const;

/** Mission-card problems, checked before any request. */
export type MissionIssue = 'title' | 'description' | 'window' | 'windowOrder' | 'xp' | 'steps';

/**
 * `requireSteps` is false only when editing a legacy predicate mission that has
 * no steps: its card (title, active, …) stays editable without adding any.
 */
export function validateMission(draft: MissionDraft, requireSteps = true): MissionIssue | null {
  if (!draft.title.trim()) return 'title';
  if (!draft.description.trim()) return 'description';
  const start = localInputToIso(draft.startAt);
  const end = localInputToIso(draft.endAt);
  if (!start || !end) return 'window';
  if (Date.parse(end) <= Date.parse(start)) return 'windowOrder';
  const xp = toNumber(draft.xpReward, 0);
  if (!Number.isInteger(xp) || xp < 0) return 'xp';
  if (requireSteps && draft.steps.length === 0) return 'steps';
  return null;
}

/** The `POST /admin/missions` body (`MissionCreateBody`); call after both validations pass. */
export function toCreateInput(draft: MissionDraft, requirements: MissionRequirementInput[]): CreateMissionInput {
  const input: CreateMissionInput = {
    title: draft.title.trim(),
    description: draft.description.trim(),
    startAt: localInputToIso(draft.startAt) ?? '',
    endAt: localInputToIso(draft.endAt) ?? '',
    mode: draft.mode,
    enrollmentMode: draft.enrollmentMode,
    xpReward: toNumber(draft.xpReward, 0),
    badgeId: draft.badgeId || null,
    requirements,
  };
  if (draft.enrollmentMode === 'assigned') input.audience = draft.audience;
  return input;
}

/**
 * The `PATCH /admin/missions/{id}` body: only the fields that differ from the
 * stored mission. After start, the locked fields are never sent.
 */
export function toPatchInput(draft: MissionDraft, original: MissionDraft, started: boolean): UpdateMissionInput {
  const patch: UpdateMissionInput = {};
  if (draft.title.trim() !== original.title) patch.title = draft.title.trim();
  if (draft.description.trim() !== original.description) patch.description = draft.description.trim();
  if (draft.endAt !== original.endAt) patch.endAt = localInputToIso(draft.endAt) ?? undefined;
  if (draft.active !== original.active) patch.active = draft.active;
  if (started) return patch;
  if (draft.startAt !== original.startAt) patch.startAt = localInputToIso(draft.startAt) ?? undefined;
  if (draft.mode !== original.mode) patch.mode = draft.mode;
  if (draft.enrollmentMode !== original.enrollmentMode) patch.enrollmentMode = draft.enrollmentMode;
  const xp = toNumber(draft.xpReward, 0);
  if (xp !== Number(original.xpReward)) patch.xpReward = xp;
  if (draft.badgeId !== original.badgeId) patch.badgeId = draft.badgeId || null;
  return patch;
}

/** True when the ordered step payloads differ (order included). */
export function stepsChanged(draft: StepDraft[], original: StepDraft[]): boolean {
  if (draft.length !== original.length) return true;
  return draft.some((step, i) => JSON.stringify(stepToInput(step)) !== JSON.stringify(stepToInput(original[i])));
}

export function audienceChanged(a: MissionAudience, b: MissionAudience): boolean {
  const same = (x: string[], y: string[]) => x.length === y.length && [...x].sort().join() === [...y].sort().join();
  return !same(a.groupIds, b.groupIds) || !same(a.userIds, b.userIds);
}

/**
 * XP pre-filled on a `shared_only` demonstrations step when an `any` step on the
 * same topic exists (RFC 0022 Open Question 2): 1.5× the private step's XP,
 * rounded up, and never less than +10 — so it is higher even from 0.
 */
export function sharedStepXp(privateXp: number): number {
  return Math.max(Math.ceil(privateXp * 1.5), privateXp + 10);
}

/**
 * The XP a `shared_only` step should start with, or `null` when it keeps its own:
 * only when another `any` demonstrations step targets the same topic and the
 * step's XP is not already above that step's.
 */
export function prefillSharedXp(steps: StepDraft[], index: number): number | null {
  const step = steps[index];
  if (step.kind !== 'submissions_on_topic' || step.visibility !== 'shared_only' || !step.topicId) return null;
  const sibling = steps.find(
    (s, i) =>
      i !== index && s.kind === 'submissions_on_topic' && s.visibility === 'any' && s.topicId === step.topicId,
  );
  if (!sibling) return null;
  const privateXp = toNumber(sibling.xpReward, 0);
  if (!Number.isFinite(privateXp)) return null;
  const current = toNumber(step.xpReward, 0);
  if (Number.isFinite(current) && current > privateXp) return null;
  return sharedStepXp(privateXp);
}
