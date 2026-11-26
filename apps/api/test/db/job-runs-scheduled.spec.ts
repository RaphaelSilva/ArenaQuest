import { env, createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { DAILY_CRON, RECONCILE_PAYMENTS_CRON, scheduledPlan } from '@api/jobs/reconcile-payments';
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

async function runScheduled(cron: string = DAILY_CRON, overrides: Record<string, string> = {}) {
  const controller = createScheduledController({ scheduledTime: Date.now(), cron });
  const ctx = createExecutionContext();
  await worker.scheduled(controller, { ...env, ...overrides } as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
}

// `wrangler.jsonc` as text, inlined by Vite - the Workers pool has no filesystem.
const wranglerConfig = Object.values(
  import.meta.glob('../../wrangler.jsonc', { query: '?raw', import: 'default', eager: true }),
)[0] as string;

/** The `triggers.crons` array of `wrangler.jsonc`, read from the file itself (comments stripped). */
function configuredCrons(): string[] {
  const withoutComments = wranglerConfig.replace(/\/\*[\s\S]*?\*\//g, '');
  const block = /"triggers"\s*:\s*\{\s*"crons"\s*:\s*\[([^\]]*)\]/.exec(withoutComments);
  if (!block) throw new Error('wrangler.jsonc has no top-level triggers.crons');
  return [...block[1].matchAll(/"([^"]*)"/g)].map((match) => match[1]);
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

/**
 * The dispatch on `controller.cron` (RFC 0026 section 6; M30 Task 09): each
 * expression has its own invocation and its own jobs, and an expression the
 * Worker does not know runs nothing.
 */
describe('scheduled() - dispatch on controller.cron', () => {
  // A provider named in the list with no adapter in the production map is an
  // invalid configuration - the one way the real Worker's reconcile run
  // records a row without a stub: `failed`, `PAYMENTS_CONFIG_INVALID`.
  const BOUND = { PAYMENTS_PROVIDERS: 'mercadopago:pix', PAYMENTS_KEY_MODE: 'test' };

  it('the two expressions in wrangler.jsonc are exactly the dispatch constants', () => {
    expect(configuredCrons()).toEqual([DAILY_CRON, RECONCILE_PAYMENTS_CRON]);
    expect(DAILY_CRON).toBe('0 6 * * *');
    expect(RECONCILE_PAYMENTS_CRON).toBe('17 * * * *');
  });

  it('plans the daily jobs for one expression, the payment reconcile for the other, nothing for the rest', () => {
    expect(scheduledPlan(DAILY_CRON, 0)).toEqual({ daily: true, reconcilePayments: false });
    expect(scheduledPlan(RECONCILE_PAYMENTS_CRON, 0)).toEqual({ daily: false, reconcilePayments: true });
    for (const cron of ['0 3 * * *', '17 * * * * ', '* * * * *', '']) expect(scheduledPlan(cron, 0)).toBeNull();
  });

  it('the hourly expression runs no daily job, and under `none` writes no job_runs row at all', async () => {
    const billingSpy = vi.spyOn(BillingService.prototype, 'runBillingCycle');
    const stale = await insertStalePending();

    await runScheduled(RECONCILE_PAYMENTS_CRON);

    expect(await rows()).toEqual([]);
    expect(billingSpy).not.toHaveBeenCalled();
    expect(await submissionExists(stale.id)).toBe(true);
    await env.DB.prepare('DELETE FROM topic_submissions WHERE id = ?').bind(stale.id).run();
  });

  it('the hourly expression records exactly one reconcile_payments row when a provider is listed', async () => {
    const billingSpy = vi.spyOn(BillingService.prototype, 'runBillingCycle');

    await runScheduled(RECONCILE_PAYMENTS_CRON, BOUND);

    const all = await rows();
    expect(all.map((r) => [r.job, r.trigger, r.status, r.actor_id])).toEqual([
      ['reconcile_payments', 'cron', 'failed', null],
    ]);
    expect(all[0].error).toMatch(/^PAYMENTS_CONFIG_INVALID: no_adapter/);
    expect(all[0].finished_at).not.toBeNull();
    expect(billingSpy).not.toHaveBeenCalled();
  });

  it('the daily expression does not run the payment reconcile, even with a provider listed', async () => {
    await runScheduled(DAILY_CRON, BOUND);

    expect((await rows()).map((r) => r.job)).toEqual(['billing', 'sweep_submissions']);
  });

  it('an unknown expression logs an error and runs nothing', async () => {
    const billingSpy = vi.spyOn(BillingService.prototype, 'runBillingCycle');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runScheduled('0 3 * * *', BOUND);

    expect(await rows()).toEqual([]);
    expect(billingSpy).not.toHaveBeenCalled();
    const logged = error.mock.calls.map((call) => JSON.parse(String(call[0])));
    expect(logged).toEqual([expect.objectContaining({ event: 'scheduled.unknown_cron', cron: '0 3 * * *' })]);
  });
});
