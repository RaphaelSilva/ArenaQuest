import { describe, it, expect, vi, afterEach } from 'vitest';
import type { IJobRunRepository, StartJobRunParams, FinishJobRunParams } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import {
  recordJobRun,
  pruneJobRuns,
  billingOutcome,
  sweepOutcome,
  JOB_RUNS_RETENTION_DAYS,
} from '@api/jobs/record-job-run';
import type { BillingRunReport } from '@api/core/billing/billing-service';

/**
 * The recorder in isolation (RFC 0025 section 3.1): a run is `running` then
 * `ok` or `failed`; a thrown job is recorded and rethrown; and a throwing
 * repository never changes what the job did or returned.
 */

const { JobName, JobTrigger, JobRunStatus } = Entities.Config;
const PARAMS: StartJobRunParams = { job: JobName.BILLING, trigger: JobTrigger.CRON };

type Fake = IJobRunRepository & {
  starts: StartJobRunParams[];
  finishes: Array<[string, FinishJobRunParams]>;
};

function fakeRepo(overrides: Partial<IJobRunRepository> = {}): Fake {
  const starts: StartJobRunParams[] = [];
  const finishes: Array<[string, FinishJobRunParams]> = [];
  return {
    starts,
    finishes,
    start: async (params) => {
      starts.push(params);
      return {
        id: 'run-1',
        job: params.job,
        trigger: params.trigger,
        status: JobRunStatus.RUNNING,
        actorId: params.actorId ?? null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        durationMs: null,
        summary: null,
        error: null,
      };
    },
    finish: async (id, params) => {
      finishes.push([id, params]);
    },
    list: async () => [],
    latestPerJob: async () => [],
    pruneOlderThan: async () => 0,
    databaseProbe: async () => ({ latestMigration: null }),
    ...overrides,
  };
}

const loggedErrors = () => vi.spyOn(console, 'error').mockImplementation(() => {});

afterEach(() => vi.restoreAllMocks());

describe('recordJobRun', () => {
  it('records running then ok with the mapped outcome, and returns the result', async () => {
    const repo = fakeRepo();
    const result = await recordJobRun(repo, PARAMS, async () => 42, (n) => ({
      status: JobRunStatus.OK,
      summary: { n },
    }));

    expect(result).toBe(42);
    expect(repo.starts).toEqual([PARAMS]);
    expect(repo.finishes).toEqual([['run-1', { status: JobRunStatus.OK, summary: { n: 42 } }]]);
  });

  it('a thrown job is recorded as failed with its message and rethrown', async () => {
    const repo = fakeRepo();
    await expect(
      recordJobRun(repo, PARAMS, async () => { throw new Error('boom'); }, () => ({ status: JobRunStatus.OK })),
    ).rejects.toThrow('boom');
    expect(repo.finishes).toEqual([['run-1', { status: JobRunStatus.FAILED, error: 'boom' }]]);
  });

  it('a non-Error throw is stringified', async () => {
    const repo = fakeRepo();
    await expect(
      recordJobRun(repo, PARAMS, async () => { throw 'plain'; }, () => ({ status: JobRunStatus.OK })),
    ).rejects.toBe('plain');
    expect(repo.finishes[0][1].error).toBe('plain');
  });

  it('a throwing start is logged; the job still runs, returns, and nothing is finished', async () => {
    const error = loggedErrors();
    const repo = fakeRepo({ start: () => Promise.reject(new Error('D1 down')) });
    const fn = vi.fn(async () => 'ran');

    expect(await recordJobRun(repo, PARAMS, fn, () => ({ status: JobRunStatus.OK }))).toBe('ran');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(repo.finishes).toEqual([]);
    expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({
      event: 'job_runs.write_failed',
      phase: 'start',
      job: 'billing',
      error: 'D1 down',
    });
  });

  it('a throwing finish is logged and the result is still returned', async () => {
    const error = loggedErrors();
    const repo = fakeRepo({ finish: () => Promise.reject(new Error('write lost')) });

    expect(await recordJobRun(repo, PARAMS, async () => 7, () => ({ status: JobRunStatus.OK }))).toBe(7);
    expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({ event: 'job_runs.write_failed', phase: 'finish' });
  });

  it('a throwing finish after a thrown job still rethrows the job error', async () => {
    loggedErrors();
    const repo = fakeRepo({ finish: () => Promise.reject(new Error('write lost')) });
    await expect(
      recordJobRun(repo, PARAMS, async () => { throw new Error('job'); }, () => ({ status: JobRunStatus.OK })),
    ).rejects.toThrow('job');
  });

  it('a throwing outcome mapper does not fail the job', async () => {
    const error = loggedErrors();
    const repo = fakeRepo();
    expect(
      await recordJobRun(repo, PARAMS, async () => 1, () => { throw new Error('mapper'); }),
    ).toBe(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('pruneJobRuns', () => {
  it('prunes with the default retention and logs the count', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const prune = vi.fn(async () => 3);
    expect(await pruneJobRuns(fakeRepo({ pruneOlderThan: prune }))).toBe(3);
    expect(prune).toHaveBeenCalledWith(JOB_RUNS_RETENTION_DAYS);
    expect(JOB_RUNS_RETENTION_DAYS).toBe(180);
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ event: 'job_runs.pruned', pruned: 3, days: 180 });
  });

  it('a throwing prune is logged and returns 0', async () => {
    const error = loggedErrors();
    expect(await pruneJobRuns(fakeRepo({ pruneOlderThan: () => Promise.reject(new Error('nope')) }))).toBe(0);
    expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({ event: 'job_runs.write_failed', phase: 'prune' });
  });
});

describe('outcome mappers', () => {
  const report: BillingRunReport = {
    asOf: '2026-10-11',
    since: '2026-10-10',
    eligibleContracts: 4,
    issued: [{ invoiceId: 'i', subscriptionId: 's', userId: 'u', periodStart: '2026-10-01', dueDate: '2026-10-10', amountMinor: 100, currency: 'BRL', status: 'open' }] as BillingRunReport['issued'],
    absorbed: 3,
    reminders: [],
    crossings: [],
    suppressedByHold: [{ userId: 'u', outstandingMinor: 100 }],
    divergences: [],
    extrasReminders: [],
    extrasCrossings: [],
    reminderCounts: { contract: { sent: 1, suppressed: 0, undeliverable: 2 }, extras: { sent: 0, suppressed: 0, undeliverable: 0 } },
    mailsSent: 1,
    adminsNotified: 1,
  };

  it('billingOutcome maps an ok result to counts only - no ids, no amounts', () => {
    const outcome = billingOutcome({ ok: true, data: report });
    expect(outcome.status).toBe(JobRunStatus.OK);
    expect(outcome.summary).toMatchObject({
      eligibleContracts: 4,
      issued: 1,
      absorbed: 3,
      suppressedByHold: 1,
      contractRemindersSent: 1,
      contractRemindersUndeliverable: 2,
      mailsSent: 1,
      adminsNotified: 1,
    });
    for (const value of Object.values(outcome.summary ?? {})) expect(typeof value).toBe('number');
    expect(JSON.stringify(outcome)).not.toContain('"u"');
  });

  it('billingOutcome maps a refusal to failed with status and error, never meta', () => {
    const outcome = billingOutcome({ ok: false, status: 400, error: 'BadRequest', meta: { userId: 'secret' } });
    expect(outcome).toEqual({ status: JobRunStatus.FAILED, error: '400 BadRequest' });
  });

  it('sweepOutcome maps a clean sweep to ok with its count and a storage failure to failed', () => {
    expect(sweepOutcome({ deleted: 2, failed: false })).toEqual({ status: JobRunStatus.OK, summary: { deleted: 2 } });
    expect(sweepOutcome({ deleted: 1, failed: true })).toEqual({
      status: JobRunStatus.FAILED,
      summary: { deleted: 1 },
      error: 'storage failure stopped the sweep',
    });
  });
});
