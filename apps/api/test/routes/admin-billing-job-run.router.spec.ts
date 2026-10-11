import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';

/**
 * The manual billing run leaves a `job_runs` row (RFC 0025 section 3.1): one
 * `billing` row with `trigger = 'manual'` and the admin as its actor, and the
 * response of `POST /v1/admin/billing/invoices/run` is unchanged by it.
 */

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const ADMIN_ID = 'job-run-admin';

let adminToken: string;

beforeAll(async () => {
  await applyMigrations(env.DB);
  await env.DB
    .prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .bind(ADMIN_ID, 'Job Run Admin', 'jobrun@admin.test', 'hash')
    .run();
  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  adminToken = await adapter.signAccessToken({ sub: ADMIN_ID, email: 'jobrun@admin.test', roles: ['admin'] });
});

beforeEach(async () => {
  await env.DB.exec('DELETE FROM job_runs');
});

async function runInvoices(body: unknown): Promise<Response> {
  const request = new IncomingRequest(`http://example.com${v1('/admin/billing/invoices/run')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(body),
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('POST /v1/admin/billing/invoices/run - job_runs', () => {
  it('writes one billing row with trigger manual and the admin as actor', async () => {
    const res = await runInvoices({});
    expect(res.status).toBe(200);
    const report = await res.json<{ eligibleContracts: number }>();
    expect(report.eligibleContracts).toBe(0);

    const { results } = await env.DB.prepare('SELECT * FROM job_runs').all<Record<string, unknown>>();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ job: 'billing', trigger: 'manual', status: 'ok', actor_id: ADMIN_ID });
    expect(results[0].finished_at).not.toBeNull();
    expect(JSON.parse(String(results[0].summary))).toMatchObject({ eligibleContracts: 0, issued: 0 });
  });

  it('a refused run is a failed row and the 400 is unchanged', async () => {
    const res = await runInvoices({ asOf: 'not-a-date' });
    expect(res.status).toBe(400);

    const { results } = await env.DB.prepare('SELECT * FROM job_runs').all<Record<string, unknown>>();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ job: 'billing', trigger: 'manual', status: 'failed', actor_id: ADMIN_ID });
    expect(String(results[0].error)).toMatch(/^400 /);
  });
});
