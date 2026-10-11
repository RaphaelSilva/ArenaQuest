import type { Entities } from '../types/entities';

/**
 * Job-run persistence contract (RFC 0025 section 3.1).
 *
 * This file **describes**; it names no store, no SQL and no provider type. The
 * implementation lives in `apps/api/src/adapters/db/`.
 *
 * Rules the implementation owes this contract:
 *
 * - **Writing a run never fails the job it describes.** That isolation lives in
 *   the caller (`recordJobRun` in `apps/api/src/jobs/`), which catches and logs
 *   a throwing repository; the port only persists and may throw like any other.
 * - **Counts, never payloads.** `summary` holds integers; `error` holds a message
 *   the adapter truncates to {@link JOB_RUN_ERROR_MAX_LENGTH} characters.
 * - **Newest first.** Every listing orders on `startedAt` descending.
 */

/** Longest `error` the store keeps; a longer message is cut, never rejected. */
export const JOB_RUN_ERROR_MAX_LENGTH = 1024;

/** Input of {@link IJobRunRepository.start}. */
export interface StartJobRunParams {
  job: Entities.Config.JobName;
  trigger: Entities.Config.JobTrigger;
  /** The admin behind a manual run; omitted or `null` for the cron. */
  actorId?: string | null;
}

/** Input of {@link IJobRunRepository.finish}. */
export interface FinishJobRunParams {
  status: Entities.Config.JobRunStatus.OK | Entities.Config.JobRunStatus.FAILED;
  /** Integer counts only. */
  summary?: Record<string, number> | null;
  /** The failure message; truncated by the adapter. */
  error?: string | null;
}

/** Options of {@link IJobRunRepository.list}. */
export interface ListJobRunsOptions {
  job?: Entities.Config.JobName;
  /** ISO timestamp; only runs started at or after it. */
  since?: string;
  /** Default 50, capped at 200. */
  limit?: number;
}

export const JOB_RUNS_LIST_DEFAULT_LIMIT = 50;
export const JOB_RUNS_LIST_MAX_LIMIT = 200;

export interface IJobRunRepository {
  /** Inserts a `running` row with `startedAt = now` and returns it. */
  start(params: StartJobRunParams): Promise<Entities.Ops.JobRun>;

  /**
   * Closes a run: sets `status`, `finishedAt = now`, `durationMs` from the stored
   * `startedAt`, and the given `summary` / `error`. An unknown id is a no-op.
   */
  finish(id: string, params: FinishJobRunParams): Promise<void>;

  /** Runs newest first, optionally filtered by job and start time (Task 06). */
  list(options?: ListJobRunsOptions): Promise<Entities.Ops.JobRun[]>;

  /** The newest run of every job that has one (Task 06 health). */
  latestPerJob(): Promise<Entities.Ops.JobRun[]>;

  /** Deletes runs started more than `days` days ago; returns how many. */
  pruneOlderThan(days: number): Promise<number>;
}
