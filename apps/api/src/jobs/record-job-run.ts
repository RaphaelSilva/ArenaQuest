import type { IJobRunRepository, StartJobRunParams, FinishJobRunParams } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import type { ControllerResult } from '@api/core/result';
import { summarizeBillingRun, type BillingRunReport } from '@api/core/billing/billing-service';
import type { SweepReport } from '@api/jobs/sweep-pending-submissions';

/** Rows older than this are pruned by the daily run (RFC 0025 section 3.1). */
export const JOB_RUNS_RETENTION_DAYS = 180;

const { JobRunStatus } = Entities.Config;

/**
 * A `job_runs` write that failed is a log line, never an exception: the row is
 * an observation about the job, and losing the observation must not change
 * what the job did. Only counts and the error's message are logged.
 */
function logWriteFailure(phase: 'start' | 'finish' | 'prune', job: string | null, error: unknown): void {
  console.error(
    JSON.stringify({
      event: 'job_runs.write_failed',
      phase,
      job,
      error: error instanceof Error ? error.message : String(error),
      at: new Date().toISOString(),
    }),
  );
}

/**
 * Runs `fn` and records it as one `job_runs` row (RFC 0025 section 3.1):
 * `running` before, then `ok` with the counts `outcome` derives from the
 * result, or `failed` with the thrown error's message - which is rethrown, so
 * the caller sees exactly what it would have seen without the recording.
 *
 * Nothing about the job's own behaviour changes: a repository that throws on
 * `start` or `finish` is logged and the job still runs and still returns;
 * `outcome` is called inside the guard too, so a mapper bug cannot fail a job.
 */
export async function recordJobRun<T>(
  repo: IJobRunRepository,
  params: StartJobRunParams,
  fn: () => Promise<T>,
  outcome: (result: T) => FinishJobRunParams,
): Promise<T> {
  let runId: string | null = null;
  try {
    runId = (await repo.start(params)).id;
  } catch (error) {
    logWriteFailure('start', params.job, error);
  }

  let result: T;
  try {
    result = await fn();
  } catch (error) {
    if (runId !== null) {
      try {
        await repo.finish(runId, {
          status: JobRunStatus.FAILED,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch (writeError) {
        logWriteFailure('finish', params.job, writeError);
      }
    }
    throw error;
  }

  if (runId !== null) {
    try {
      await repo.finish(runId, outcome(result));
    } catch (writeError) {
      logWriteFailure('finish', params.job, writeError);
    }
  }
  return result;
}

/**
 * Deletes runs older than `days` days, logging the count. Guarded like the
 * recorder: a failing delete is a log line and the daily run carries on.
 */
export async function pruneJobRuns(repo: IJobRunRepository, days: number = JOB_RUNS_RETENTION_DAYS): Promise<number> {
  try {
    const pruned = await repo.pruneOlderThan(days);
    console.log(JSON.stringify({ event: 'job_runs.pruned', days, pruned, at: new Date().toISOString() }));
    return pruned;
  } catch (error) {
    logWriteFailure('prune', null, error);
    return 0;
  }
}

/**
 * The billing run's outcome. `runBillingCycle` reports a refusal as a
 * `ControllerResult` rather than by throwing, so a `!ok` result is a `failed`
 * row carrying the status and the error code - never the `meta`, which may
 * name a student.
 */
export function billingOutcome(result: ControllerResult<BillingRunReport>): FinishJobRunParams {
  if (result.ok) return { status: JobRunStatus.OK, summary: summarizeBillingRun(result.data) };
  return { status: JobRunStatus.FAILED, error: `${result.status} ${result.error}` };
}

/**
 * The sweep's outcome. The sweep never throws; it reports a storage failure
 * through `failed`, which becomes a `failed` row that still carries the count
 * of what was deleted before the failure.
 */
export function sweepOutcome(report: SweepReport): FinishJobRunParams {
  const summary = { deleted: report.deleted };
  if (!report.failed) return { status: JobRunStatus.OK, summary };
  return { status: JobRunStatus.FAILED, summary, error: 'storage failure stopped the sweep' };
}
