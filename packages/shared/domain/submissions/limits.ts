/**
 * Submission limits — text limits, the sweep threshold and the defaults of the
 * env-configured tunables (RFC 0020 section 3).
 *
 * Pure: no I/O, no environment read, no framework import, no provider type.
 * The defaults apply ONLY when a `SUBMISSIONS_*` var is absent; a
 * present-but-invalid var is an error, parsed in
 * `apps/api/src/core/submissions/config.ts`. The environment is never read here.
 */

/** Title length, in characters after trim (RFC 0020 sections 3, 10). Not a tunable. */
export const SUBMISSION_TITLE_MAX = 120;

/** Description length, in characters after `sanitizeMarkdown` (RFC 0020 section 3). Not a tunable. */
export const SUBMISSION_DESCRIPTION_MAX = 2_000;

/**
 * Age after which a `pending` row is abandoned and swept with its object
 * (RFC 0020 section 9). The presigned PUT expires after 1 h; 24 h leaves ample margin.
 */
export const SUBMISSION_PENDING_SWEEP_HOURS = 24;

// ── Defaults of the env-configured tunables ─────────────────────────────────

/** Default of SUBMISSIONS_PER_TOPIC_MAX — pending + ready per student per topic. */
export const SUBMISSIONS_PER_TOPIC_MAX_DEFAULT = 10;

/** Default of SUBMISSIONS_STORAGE_PER_STUDENT_BYTES — 1 GiB across all topics. */
export const SUBMISSIONS_STORAGE_PER_STUDENT_BYTES_DEFAULT = 1024 * 1024 * 1024; // 1 073 741 824

/** Default of SUBMISSIONS_VIDEO_MAX_BYTES — 250 MB per video file. */
export const SUBMISSIONS_VIDEO_MAX_BYTES_DEFAULT = 250 * 1024 * 1024; // 262 144 000

/** Default of SUBMISSIONS_SHARING_ENABLED. */
export const SUBMISSIONS_SHARING_ENABLED_DEFAULT = true;

/** The four tunables, in the shape the API's submission config parses into. */
export interface SubmissionTunables {
  perTopicMax: number;
  storagePerStudentBytes: number;
  videoMaxBytes: number;
  sharingEnabled: boolean;
}

/** All four defaults, keyed as {@link SubmissionTunables}. Frozen. */
export const SUBMISSION_TUNABLE_DEFAULTS: Readonly<SubmissionTunables> = Object.freeze({
  perTopicMax: SUBMISSIONS_PER_TOPIC_MAX_DEFAULT,
  storagePerStudentBytes: SUBMISSIONS_STORAGE_PER_STUDENT_BYTES_DEFAULT,
  videoMaxBytes: SUBMISSIONS_VIDEO_MAX_BYTES_DEFAULT,
  sharingEnabled: SUBMISSIONS_SHARING_ENABLED_DEFAULT,
});
