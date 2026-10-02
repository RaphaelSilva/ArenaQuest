/**
 * Submission configuration — turns the four `SUBMISSIONS_*` environment vars
 * into a typed {@link SubmissionConfig}, per request (RFC 0020 section 3).
 *
 * - An **absent** var (undefined / null) takes its default from
 *   `@arenaquest/shared/domain/submissions/limits`.
 * - A **present but invalid** var is an error naming the var — never a silent
 *   fallback to the default. Integers must be positive (no sign, no decimals,
 *   no exponent); the switch accepts exactly `true` or `false`.
 * - `SUBMISSIONS_VIDEO_MAX_BYTES` may not exceed
 *   `SUBMISSIONS_STORAGE_PER_STUDENT_BYTES` (a single video could never fit).
 *
 * Returned, never thrown: the caller (Task 03) maps a failure to
 * `500 SUBMISSION_CONFIG_INVALID` and logs `variable`. Pure — no I/O and no
 * state beyond immutable schemas.
 *
 * Takes a structural env type rather than the generated `Env`: the vars are
 * optional per environment, and a wrangler JSON var may arrive as a number or a
 * boolean, so every value is normalised with `String()` before validation.
 */
import { z } from 'zod';
import {
  SUBMISSION_TUNABLE_DEFAULTS,
  type SubmissionTunables,
} from '@arenaquest/shared/domain/submissions/limits';

export const SUBMISSION_CONFIG_VARS = [
  'SUBMISSIONS_PER_TOPIC_MAX',
  'SUBMISSIONS_STORAGE_PER_STUDENT_BYTES',
  'SUBMISSIONS_VIDEO_MAX_BYTES',
  'SUBMISSIONS_SHARING_ENABLED',
] as const;

export type SubmissionConfigVar = (typeof SUBMISSION_CONFIG_VARS)[number];

/** The effective tunables for this request. */
export type SubmissionConfig = SubmissionTunables;

/** The slice of the Worker env this parser reads. */
export type SubmissionEnv = Partial<Record<SubmissionConfigVar, unknown>>;

export type SubmissionConfigResult =
  | { ok: true; config: SubmissionConfig }
  | { ok: false; variable: SubmissionConfigVar; reason: string };

const PositiveInteger = z
  .string()
  .regex(/^[1-9][0-9]*$/, 'must be a positive integer')
  .transform(Number)
  .refine(Number.isSafeInteger, 'is too large');

const Switch = z.enum(['true', 'false']).transform(v => v === 'true');

type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

function parseVar<T>(
  raw: unknown,
  schema: z.ZodType<T, z.ZodTypeDef, string>,
  fallback: T,
): Parsed<T> {
  if (raw === undefined || raw === null) return { ok: true, value: fallback };
  const result = schema.safeParse(String(raw).trim());
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, reason: result.error.issues[0]?.message ?? 'is invalid' };
}

export function parseSubmissionConfig(env: SubmissionEnv): SubmissionConfigResult {
  const d = SUBMISSION_TUNABLE_DEFAULTS;

  const perTopicMax = parseVar(env.SUBMISSIONS_PER_TOPIC_MAX, PositiveInteger, d.perTopicMax);
  if (!perTopicMax.ok) return fail('SUBMISSIONS_PER_TOPIC_MAX', perTopicMax.reason);

  const storage = parseVar(
    env.SUBMISSIONS_STORAGE_PER_STUDENT_BYTES,
    PositiveInteger,
    d.storagePerStudentBytes,
  );
  if (!storage.ok) return fail('SUBMISSIONS_STORAGE_PER_STUDENT_BYTES', storage.reason);

  const video = parseVar(env.SUBMISSIONS_VIDEO_MAX_BYTES, PositiveInteger, d.videoMaxBytes);
  if (!video.ok) return fail('SUBMISSIONS_VIDEO_MAX_BYTES', video.reason);

  const sharing = parseVar(env.SUBMISSIONS_SHARING_ENABLED, Switch, d.sharingEnabled);
  if (!sharing.ok) return fail('SUBMISSIONS_SHARING_ENABLED', "must be exactly 'true' or 'false'");

  if (video.value > storage.value) {
    return fail(
      'SUBMISSIONS_VIDEO_MAX_BYTES',
      `(${video.value}) must not exceed SUBMISSIONS_STORAGE_PER_STUDENT_BYTES (${storage.value})`,
    );
  }

  return {
    ok: true,
    config: {
      perTopicMax: perTopicMax.value,
      storagePerStudentBytes: storage.value,
      videoMaxBytes: video.value,
      sharingEnabled: sharing.value,
    },
  };
}

function fail(variable: SubmissionConfigVar, reason: string): SubmissionConfigResult {
  return { ok: false, variable, reason };
}
