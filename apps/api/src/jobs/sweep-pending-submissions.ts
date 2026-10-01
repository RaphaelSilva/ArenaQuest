import type { IStorageAdapter, ISubmissionRepository } from '@arenaquest/shared/ports';

/** A `pending` row older than this is abandoned: its presigned PUT expired after 1 h (RFC 0020 §9). */
export const STALE_PENDING_HOURS = 24;

/** Rows handled per batch: one storage call and one round of row deletes each. */
export const SWEEP_BATCH_SIZE = 100;

/** Upper bound on batches per run, so one invocation stays well inside the cron's CPU budget. */
export const SWEEP_MAX_BATCHES = 50;

export interface SweepPendingSubmissionsDeps {
  submissions: ISubmissionRepository;
  storage: IStorageAdapter;
}

export interface SweepReport {
  /** Rows (and their objects) deleted. */
  deleted: number;
  /** True when a storage failure stopped the run early; the remaining rows wait for the next run. */
  failed: boolean;
}

/**
 * Deletes abandoned uploads (RFC 0020 §9; M23 Task 05): every `pending`
 * submission older than 24 h, in batches of 100 — the objects first, then the
 * rows, so a row is never dropped while it is the only pointer to its object.
 * A storage failure leaves the batch's rows in place and ends the run; the next
 * daily run retries them.
 *
 * Never throws (it runs next to billing in `scheduled()`), and logs only
 * counts — never titles, file names or storage keys.
 */
export async function sweepPendingSubmissions(deps: SweepPendingSubmissionsDeps): Promise<SweepReport> {
  let deleted = 0;
  let failed = false;

  try {
    for (let batch = 0; batch < SWEEP_MAX_BATCHES; batch++) {
      const stale = await deps.submissions.listStalePending(STALE_PENDING_HOURS, SWEEP_BATCH_SIZE);
      if (stale.length === 0) break;

      const keys = stale.map((r) => r.storageKey).filter((k): k is string => k !== null);
      try {
        await deps.storage.deleteObjects(keys);
      } catch {
        failed = true;
        break;
      }

      await Promise.all(stale.map((r) => deps.submissions.delete(r.id)));
      deleted += stale.length;
      if (stale.length < SWEEP_BATCH_SIZE) break;
    }
  } catch {
    failed = true;
  }

  const line = JSON.stringify({ event: 'submissions.sweep_pending', deleted, failed, at: new Date().toISOString() });
  if (failed) console.error(line);
  else console.log(line);
  return { deleted, failed };
}
