import { z } from 'zod';

/**
 * Mission requirements (RFC 0022 §2) — the one definition of what a mission step
 * can be. The API validates and evaluates with it; the web builds the step editor
 * and the step labels from it. A kind's params are defined here and nowhere else.
 */

export const REQUIREMENT_KINDS = [
  'submissions_on_topic',
  'topic_visited',
  'video_watched',
  'manual_check',
  'event_participation',
] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

/** Kinds whose target is a topic (`topicId` required, `eventId` refused). */
export const TOPIC_REQUIREMENT_KINDS = [
  'submissions_on_topic',
  'topic_visited',
  'video_watched',
] as const satisfies readonly RequirementKind[];

export const MISSION_STEPS_MAX = 20;
export const REQUIREMENT_TITLE_MAX = 120;
export const REQUIREMENT_MIN_COUNT_MAX = 50;
export const MANUAL_CHECK_INSTRUCTIONS_MAX = 500;

/**
 * `predicate_kind` written for every mission defined by requirements. Any other
 * value marks a legacy M7 predicate mission (RFC 0022 §1, §3.7).
 */
export const REQUIREMENTS_PREDICATE_KIND = 'requirements';

const MinCount = z.number().int().min(1).max(REQUIREMENT_MIN_COUNT_MAX);

/** Per-kind params. Strict objects: an unknown key is rejected, never stripped. */
export const RequirementParams = {
  submissions_on_topic: z
    .object({
      minCount: MinCount,
      // Counts only submissions whose description is not empty.
      requireDescription: z.boolean().default(false),
      visibility: z.enum(['any', 'shared_only']).default('any'),
      // A force-unshared (moderated) submission counts only when true.
      countModerated: z.boolean().default(false),
    })
    .strict(),
  topic_visited: z.object({}).strict(),
  video_watched: z.object({ minCount: MinCount }).strict(),
  manual_check: z
    .object({
      instructions: z.string().trim().max(MANUAL_CHECK_INSTRUCTIONS_MAX).default(''),
    })
    .strict(),
  event_participation: z.object({}).strict(),
} as const;

/** Parsed (defaults applied) params of one kind. */
export type RequirementParamsOf<K extends RequirementKind> = z.output<(typeof RequirementParams)[K]>;

const base = {
  title: z.string().trim().min(1).max(REQUIREMENT_TITLE_MAX),
  xpReward: z.number().int().min(0).default(0),
};

/** One step as an admin submits it: discriminated on `kind`, every object strict. */
export const RequirementInput = z.discriminatedUnion('kind', [
  z
    .object({
      ...base,
      kind: z.literal('submissions_on_topic'),
      topicId: z.string().uuid(),
      params: RequirementParams.submissions_on_topic,
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('topic_visited'),
      topicId: z.string().uuid(),
      params: RequirementParams.topic_visited.default({}),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('video_watched'),
      topicId: z.string().uuid(),
      params: RequirementParams.video_watched,
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('manual_check'),
      params: RequirementParams.manual_check.default({}),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('event_participation'),
      eventId: z.string().uuid(),
      params: RequirementParams.event_participation.default({}),
    })
    .strict(),
]);
export type RequirementInput = z.infer<typeof RequirementInput>;

/** A mission's ordered step list: positions are the array order (1…MISSION_STEPS_MAX). */
export const RequirementInputList = z.array(RequirementInput).min(1).max(MISSION_STEPS_MAX);
export type RequirementInputList = z.infer<typeof RequirementInputList>;

/** How many qualifying items complete the step. */
export const targetCountOf = (r: { kind: RequirementKind; params: unknown }): number =>
  r.kind === 'submissions_on_topic' || r.kind === 'video_watched'
    ? (r.params as { minCount: number }).minCount
    : 1;

/**
 * Normalises stored or submitted params for `kind` (defaults applied).
 * Throws a `ZodError` when `raw` does not match the kind's schema.
 */
export function parseRequirementParams<K extends RequirementKind>(
  kind: K,
  raw: unknown,
): RequirementParamsOf<K> {
  const schema = RequirementParams[kind] as z.ZodType<RequirementParamsOf<K>, z.ZodTypeDef, unknown>;
  return schema.parse(raw);
}

export const MissionMode = z.enum(['parallel', 'sequential']);
export type MissionMode = z.infer<typeof MissionMode>;

export const MissionEnrollmentMode = z.enum(['auto', 'open', 'assigned']);
export type MissionEnrollmentMode = z.infer<typeof MissionEnrollmentMode>;

/** How an enrollment row came to exist: implicit (`auto`), Join (`self`), audience (`admin`). */
export type EnrollmentSource = 'auto' | 'self' | 'admin';

/** Which path wrote a step's write-once `completedAt`. */
export type CompletedBy = 'hook' | 'reconcile';

/** Which path captured a `topic_visited` / `video_watched` evidence row. */
export type EvidenceSource = 'hook' | 'backfill';
