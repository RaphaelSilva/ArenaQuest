import { env, createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { BillingService } from '@api/core/billing/billing-service';
import { D1JobRunRepository } from '@api/adapters/db/d1-job-run-repository';
import { JOB_RUN_ERROR_MAX_LENGTH } from '@arenaquest/shared/ports';
import { applyMigrations } from '../helpers/apply-migrations';

/**
 * `job_runs` through the real `scheduled()` handler (RFC 0025 section 3.1;
 * M28 Task 05), against a real D1 and R2: two `ok` rows on a quiet day, a
 * `failed` billing row that does not stop the sweep, a throwing ledger that
 * changes nothing about the jobs, and the 180-day prune.
 */

const STUDENT = 'job-runs-student';
const TOPIC = 'job-runs-topic';

type JobRunRow = {
  id: string;
  job: string;
  trigger: string;
  status: string;
  actor_id: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  summary: string | null;
  error: string | null;
};

beforeAll(async () => {
  await applyMigrations(env.DB);
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .bind(STUDENT, 'Job Runs Student', 'jobruns@student.test', 'hash'),
    env.DB.prepare(
      `INSERT OR IGNORE INTO topic_nodes (id, title, status, archived, visibility) VALUES (?, 'Job Runs', 'published', 0, 'restricted')`,
    ).bind(TOPIC),
  ]);
});

beforeEach(async () => {
  await env.DB.exec('DELETE FROM job_runs');
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

async function insertStalePending(): Promise<{ id: string; key: string }> {
  const id = crypto.randomUUID();
  const key = `submissions/${STUDENT}/${id}-kata.mp4`;
  await env.DB.prepare(
    `INSERT INTO topic_submissions
       (id, topic_node_id, author_id, title, storage_key, original_name, content_type, size_bytes,
        status, visibility, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'Kata', ?4, 'kata.mp4', 'video/mp4', 10, 'pending', 'private', datetime('now', '-25 hours'), datetime('now', '-25 hours'))`,
  )
    .bind(id, TOPIC, STUDENT, key)
    .run();
  await env.R2.put(key, new Uint8Array(10));
  return { id, key };
}

const submissionExists = async (id: string) =>
  (await env.DB.prepare('SELECT id FROM topic_submissions WHERE id = ?').bind(id).first()) !== null;

async function rows(): Promise<JobRunRow[]> {
  const { results } = await env.DB.prepare('SELECT * FROM job_runs ORDER BY job ASC').all<JobRunRow>();
  return results;
}

async function insertAged(job: string, daysAgo: number): Promise<string> {
  const id = crypto.randomUUID();
  const startedAt = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  await env.DB
    .prepare(`INSERT INTO job_runs (id, job, trigger, status, started_at, finished_at) VALUES (?, ?, 'cron', 'ok', ?, ?)`)
    .bind(id, job, startedAt, startedAt)
    .run();
  return id;
}

async function runScheduled() {
  const controller = createScheduledController({ scheduledTime: Date.now(), cron: '0 3 * * *' });
  const ctx = createExecutionContext();
  await worker.scheduled(controller, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
}

describe('scheduled() - job_runs recording', () => {
  it('a quiet day writes two ok cron rows with zero-ish counts', async () => {
    await runScheduled();

    const all = await rows();
    expect(all.map((r) => [r.job, r.trigger, r.status, r.actor_id])).toEqual([
      ['billing', 'cron', 'ok', null],
      ['sweep_submissions', 'cron', 'ok', null],
    ]);
    for (const row of all) {
      expect(row.finished_at).not.toBeNull();
      expect(row.duration_ms).toBeGreaterThanOrEqual(0);
      expect(row.error).toBeNull();
    }

    const billing = JSON.parse(all[0].summary ?? 'null');
    expect(billing).toMatchObject({ eligibleContracts: 0, issued: 0, absorbed: 0 });
    for (const value of Object.values(billing)) expect(typeof value).toBe('number');
    expect(JSON.parse(all[1].summary ?? 'null')).toEqual({ deleted: 0 });
  });

  it('a throwing billing is a failed row with a truncated message, and the sweep still runs and is ok', async () => {
    const stale = await insertStalePending();
    vi.spyOn(BillingService.prototype, 'runBillingCycle').mockRejectedValue(new Error('x'.repeat(5000)));

    await expect(runScheduled()).rejects.toThrow();

    const all = await rows();
    expect(all.map((r) => [r.job, r.status])).toEqual([
      ['billing', 'failed'],
      ['sweep_submissions', 'ok'],
    ]);
    expect(all[0].error).toHaveLength(JOB_RUN_ERROR_MAX_LENGTH);
    expect(all[0].summary).toBeNull();
    expect(JSON.parse(all[1].summary ?? 'null')).toEqual({ deleted: 1 });
    expect(await submissionExists(stale.id)).toBe(false);
    expect(await env.R2.head(stale.key)).toBeNull();
  });

  it('a throwing job_runs ledger leaves no row, and billing and the sweep still run', async () => {
    const stale = await insertStalePending();
    const billingSpy = vi.spyOn(BillingService.prototype, 'runBillingCycle');
    vi.spyOn(D1JobRunRepository.prototype, 'start').mockRejectedValue(new Error('ledger down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runScheduled()).resolves.toBeUndefined();

    expect(await rows()).toEqual([]);
    expect(billingSpy).toHaveBeenCalledTimes(1);
    expect(await submissionExists(stale.id)).toBe(false);
    const logged = error.mock.calls.map((call) => JSON.parse(String(call[0])));
    expect(logged.filter((e) => e.event === 'job_runs.write_failed' && e.phase === 'start')).toHaveLength(2);
  });

  it('the daily run prunes a 200-day-old row and keeps a 10-day-old one', async () => {
    const old = await insertAged('billing', 200);
    const kept = await insertAged('sweep_submissions', 10);

    await runScheduled();

    const ids = (await rows()).map((r) => r.id);
    expect(ids).not.toContain(old);
    expect(ids).toContain(kept);
    expect(ids).toHaveLength(3);
  });
});
