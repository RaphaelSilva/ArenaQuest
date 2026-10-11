import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';

/**
 * `/v1/admin/ops` over HTTP, against miniflare D1, KV and R2 (RFC 0025
 * section 3.2): the staff role matrix on both routes, a measured health body
 * with every binding answering, the job-run listing with its filters, and the
 * query validation. Status classification is covered in the controller spec.
 */

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const NEWEST_MIGRATION = '0032_create_job_runs.sql';

let adminToken: string;
let creatorToken: string;
let studentToken: string;
let tutorToken: string;

const T0 = Date.parse('2026-10-01T00:00:00.000Z');
const iso = (daysAfterT0: number) => new Date(T0 + daysAfterT0 * 86_400_000).toISOString();

async function insertRun(id: string, job: string, startedAt: string, status = 'ok') {
  await env.DB
    .prepare(
      `INSERT INTO job_runs (id, job, trigger, status, started_at, finished_at, duration_ms, summary)
       VALUES (?, ?, 'cron', ?, ?, ?, 5, '{"n":1}')`,
    )
    .bind(id, job, status, startedAt, startedAt)
    .run();
}

beforeAll(async () => {
  await applyMigrations(env.DB);

  // Wrangler's own ledger, which the suite's applyMigrations never writes.
  await env.DB.exec(
    'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  );
  await env.DB.batch([
    env.DB.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind('0030_create_topic_submissions.sql'),
    env.DB.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(NEWEST_MIGRATION),
  ]);

  await insertRun('ops-billing-old', 'billing', iso(1));
  await insertRun('ops-sweep', 'sweep_submissions', iso(2));
  await insertRun('ops-billing-new', 'billing', iso(3), 'failed');

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900, pbkdf2Iterations: 1 });
  adminToken = await adapter.signAccessToken({ sub: 'ops-admin', email: 'ops-admin@example.com', roles: ['admin'] });
  creatorToken = await adapter.signAccessToken({ sub: 'ops-creator', email: 'ops-cc@example.com', roles: ['content_creator'] });
  studentToken = await adapter.signAccessToken({ sub: 'ops-student', email: 'ops-student@example.com', roles: ['student'] });
  tutorToken = await adapter.signAccessToken({ sub: 'ops-tutor', email: 'ops-tutor@example.com', roles: ['tutor'] });
});

async function get(path: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const request = new IncomingRequest(`http://example.com${v1(path)}`, { method: 'GET', headers });
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const ROUTES = ['/admin/ops/health', '/admin/ops/job-runs'];

describe('role matrix', () => {
  for (const route of ROUTES) {
    it(`${route}: anonymous 401, student and tutor 403, admin and content_creator 200`, async () => {
      expect((await get(route)).status).toBe(401);
      expect((await get(route, studentToken)).status).toBe(403);
      expect((await get(route, tutorToken)).status).toBe(403);
      expect((await get(route, adminToken)).status).toBe(200);
      expect((await get(route, creatorToken)).status).toBe(200);
    });
  }
});

describe('GET /admin/ops/health', () => {
  it('measures every binding ok and reports the newest migration and the last run per job with its age', async () => {
    const before = Date.now();
    const res = await get('/admin/ops/health', adminToken);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      status: string;
      checkedAt: string;
      dependencies: Array<{ name: string; status: string; latencyMs: number; error?: string }>;
      latestMigration: string | null;
      jobs: Array<{ job: string; lastRun: { id: string; status: string; ageMs: number } | null }>;
    };

    expect(body.status).toBe('ok');
    expect(Date.parse(body.checkedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(body.dependencies.map((d) => [d.name, d.status])).toEqual([
      ['d1', 'ok'],
      ['kv', 'ok'],
      ['r2', 'ok'],
    ]);
    for (const dep of body.dependencies) {
      expect(Number.isInteger(dep.latencyMs)).toBe(true);
      expect(dep.error).toBeUndefined();
    }
    expect(body.latestMigration).toBe(NEWEST_MIGRATION);

    expect(body.jobs.map((j) => j.job)).toEqual(['billing', 'sweep_submissions']);
    const billing = body.jobs[0].lastRun;
    const sweep = body.jobs[1].lastRun;
    expect(billing).toMatchObject({ id: 'ops-billing-new', status: 'failed' });
    expect(sweep).toMatchObject({ id: 'ops-sweep', status: 'ok' });
    expect(billing!.ageMs).toBeGreaterThan(0);
    expect(sweep!.ageMs).toBeGreaterThan(billing!.ageMs);
  });

  it('leaves no object under the storage probe key and no counter under the KV probe key', async () => {
    await get('/admin/ops/health', adminToken);
    expect(await env.R2.head('ops/health-probe')).toBeNull();
    expect(await env.RATE_LIMIT_KV.get('ops:health-probe')).toBeNull();
    const { results } = await env.RATE_LIMIT_KV.list({ prefix: 'ops:' }).then((l) => ({ results: l.keys }));
    expect(results).toEqual([]);
  });
});

describe('GET /admin/ops/job-runs', () => {
  type Body = { runs: Array<{ id: string; job: string; startedAt: string }> };

  it('lists every run newest first', async () => {
    const res = await get('/admin/ops/job-runs', adminToken);
    expect(res.status).toBe(200);
    const body = await res.json() as Body;
    expect(body.runs.map((r) => r.id)).toEqual(['ops-billing-new', 'ops-sweep', 'ops-billing-old']);
  });

  it('filters by job and since, newest first', async () => {
    const since = encodeURIComponent(iso(0.5));
    const res = await get(`/admin/ops/job-runs?job=billing&since=${since}`, creatorToken);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Body).runs.map((r) => r.id)).toEqual(['ops-billing-new', 'ops-billing-old']);

    const later = encodeURIComponent(iso(2.5));
    const res2 = await get(`/admin/ops/job-runs?job=billing&since=${later}`, adminToken);
    expect(((await res2.json()) as Body).runs.map((r) => r.id)).toEqual(['ops-billing-new']);
  });

  it('honours limit', async () => {
    const res = await get('/admin/ops/job-runs?limit=1', adminToken);
    expect(((await res.json()) as Body).runs.map((r) => r.id)).toEqual(['ops-billing-new']);
  });

  it('rejects a malformed since, an unknown job and an out-of-range limit with 400', async () => {
    expect((await get('/admin/ops/job-runs?since=not-a-date', adminToken)).status).toBe(400);
    expect((await get('/admin/ops/job-runs?job=backup', adminToken)).status).toBe(400);
    expect((await get('/admin/ops/job-runs?limit=999', adminToken)).status).toBe(400);
    expect((await get('/admin/ops/job-runs?limit=0', adminToken)).status).toBe(400);
  });
});
