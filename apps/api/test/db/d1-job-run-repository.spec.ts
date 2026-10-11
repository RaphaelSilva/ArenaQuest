import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { D1JobRunRepository } from '@api/adapters/db/d1-job-run-repository';
import { JOB_RUN_ERROR_MAX_LENGTH } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { applyMigrations } from '../helpers/apply-migrations';

/**
 * `job_runs` through its D1 adapter (RFC 0025 section 3.1): the start/finish
 * round trip, the error truncation the port promises, newest-first listings
 * with their filters, one latest row per job, and pruning by `started_at`.
 */

const { JobName, JobTrigger, JobRunStatus } = Entities.Config;

/** Inserts a finished row whose `started_at` is `daysAgo` days in the past. */
async function insertAged(job: Entities.Config.JobName, daysAgo: number): Promise<string> {
  const id = crypto.randomUUID();
  const startedAt = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  await env.DB
    .prepare(
      `INSERT INTO job_runs (id, job, trigger, status, started_at, finished_at, duration_ms, summary)
       VALUES (?, ?, 'cron', 'ok', ?, ?, 1, '{}')`,
    )
    .bind(id, job, startedAt, startedAt)
    .run();
  return id;
}

describe('D1JobRunRepository', () => {
  let repo: D1JobRunRepository;

  beforeAll(async () => {
    await applyMigrations(env.DB);
    repo = new D1JobRunRepository(env.DB);
  });

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM job_runs');
  });

  it('start inserts a running row and finish closes it with counts and a duration', async () => {
    const run = await repo.start({ job: JobName.BILLING, trigger: JobTrigger.MANUAL, actorId: 'admin-1' });
    expect(run).toMatchObject({
      job: 'billing',
      trigger: 'manual',
      status: 'running',
      actorId: 'admin-1',
      finishedAt: null,
      durationMs: null,
      summary: null,
      error: null,
    });

    const [running] = await repo.list();
    expect(running.id).toBe(run.id);
    expect(running.status).toBe(JobRunStatus.RUNNING);

    await repo.finish(run.id, { status: JobRunStatus.OK, summary: { issued: 2, absorbed: 1 } });

    const [finished] = await repo.list();
    expect(finished.status).toBe(JobRunStatus.OK);
    expect(finished.summary).toEqual({ issued: 2, absorbed: 1 });
    expect(finished.error).toBeNull();
    expect(finished.finishedAt).not.toBeNull();
    expect(finished.durationMs).toBeGreaterThanOrEqual(0);
    expect(finished.startedAt).toBe(run.startedAt);
  });

  it('a cron run has no actor', async () => {
    const run = await repo.start({ job: JobName.SWEEP_SUBMISSIONS, trigger: JobTrigger.CRON });
    expect(run.actorId).toBeNull();
    expect((await repo.list())[0].actorId).toBeNull();
  });

  it('finish truncates the error to the port maximum', async () => {
    const run = await repo.start({ job: JobName.BILLING, trigger: JobTrigger.CRON });
    const long = 'x'.repeat(JOB_RUN_ERROR_MAX_LENGTH + 500);
    await repo.finish(run.id, { status: JobRunStatus.FAILED, error: long });

    const [failed] = await repo.list();
    expect(failed.status).toBe(JobRunStatus.FAILED);
    expect(failed.error).toHaveLength(JOB_RUN_ERROR_MAX_LENGTH);
    expect(failed.summary).toBeNull();
  });

  it('finish on an unknown id is a no-op', async () => {
    await expect(repo.finish('nope', { status: JobRunStatus.OK })).resolves.toBeUndefined();
    expect(await repo.list()).toEqual([]);
  });

  it('list is newest first and honours job, since and limit', async () => {
    const old = await insertAged(JobName.BILLING, 3);
    const mid = await insertAged(JobName.SWEEP_SUBMISSIONS, 2);
    const recent = await insertAged(JobName.BILLING, 1);

    expect((await repo.list()).map((r) => r.id)).toEqual([recent, mid, old]);
    expect((await repo.list({ job: JobName.BILLING })).map((r) => r.id)).toEqual([recent, old]);
    expect((await repo.list({ limit: 2 })).map((r) => r.id)).toEqual([recent, mid]);

    const since = new Date(Date.now() - 2.5 * 86_400_000).toISOString();
    expect((await repo.list({ since })).map((r) => r.id)).toEqual([recent, mid]);
  });

  it('list caps the limit at 200 and floors it at 1', async () => {
    await insertAged(JobName.BILLING, 2);
    await insertAged(JobName.BILLING, 1);
    expect(await repo.list({ limit: 0 })).toHaveLength(1);
    expect(await repo.list({ limit: 10_000 })).toHaveLength(2);
  });

  it('latestPerJob returns the newest row of each job', async () => {
    await insertAged(JobName.BILLING, 5);
    const latestBilling = await insertAged(JobName.BILLING, 1);
    const latestSweep = await insertAged(JobName.SWEEP_SUBMISSIONS, 4);

    const latest = await repo.latestPerJob();
    expect(latest.map((r) => [r.job, r.id])).toEqual([
      ['billing', latestBilling],
      ['sweep_submissions', latestSweep],
    ]);
  });

  it('latestPerJob is empty with no rows', async () => {
    expect(await repo.latestPerJob()).toEqual([]);
  });

  it('pruneOlderThan deletes by started_at and keeps newer rows', async () => {
    const stale = await insertAged(JobName.BILLING, 200);
    const kept = await insertAged(JobName.SWEEP_SUBMISSIONS, 10);

    expect(await repo.pruneOlderThan(180)).toBe(1);
    expect((await repo.list()).map((r) => r.id)).toEqual([kept]);
    expect(await env.DB.prepare('SELECT id FROM job_runs WHERE id = ?').bind(stale).first()).toBeNull();
    expect(await repo.pruneOlderThan(180)).toBe(0);
  });

  it('databaseProbe answers null when wrangler has not created the migration ledger', async () => {
    await env.DB.exec('DROP TABLE IF EXISTS d1_migrations');
    expect(await repo.databaseProbe()).toEqual({ latestMigration: null });
  });

  it('databaseProbe reports the newest applied migration name', async () => {
    // Wrangler's own ledger shape; the suite's applyMigrations does not write it.
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    );
    await env.DB.batch([
      env.DB.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind('0030_create_topic_submissions.sql'),
      env.DB.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind('0032_create_job_runs.sql'),
    ]);
    expect(await repo.databaseProbe()).toEqual({ latestMigration: '0032_create_job_runs.sql' });
    expect(await repo.list()).toEqual([]);
  });

  it('a malformed stored summary reads back as null rather than throwing', async () => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB
      .prepare(
        `INSERT INTO job_runs (id, job, trigger, status, started_at, finished_at, summary)
         VALUES (?, 'billing', 'cron', 'ok', ?, ?, 'not json')`,
      )
      .bind(id, now, now)
      .run();
    const [row] = await repo.list();
    expect(row.summary).toBeNull();
  });
});
