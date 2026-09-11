import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';

/**
 * `GET /v1/me/billing` over HTTP.
 *
 * The assertion that matters here is a negative one: **there is no request
 * that makes this endpoint return another student's statement.** The route
 * declares no path parameter, no query, no header and no body, so the tests
 * below try each of those in turn and expect either the caller's own statement
 * or a `404` for a path that does not exist.
 *
 * The second is that the endpoint carries no role guard of its own. It rides
 * the `/v1/me/*` `authGuard` and nothing more — a student reads their own
 * money, and reading it changes no permission of theirs.
 */

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const ADMIN_ID = 'me-billing-admin';
const STUDENT_ID = 'me-billing-student';
const RICH_ID = 'me-billing-other';

let adminToken: string;
let studentToken: string;
let otherToken: string;

async function call(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;

  const request = new IncomingRequest(`http://example.com${v1(path)}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function jsonOf<T>(res: Response, expected: number): Promise<T> {
  if (res.status !== expected) {
    throw new Error(`expected ${expected}, got ${res.status}: ${await res.text()}`);
  }
  return res.json<T>();
}

type Statement = {
  userId: string;
  standing: string;
  outstandingMinor: number;
  asOf: string;
  oldestOverdueDate: string | null;
  invoices: Array<{ id: string; userId: string; dueDate: string; balanceMinor: number }>;
  contractGroups: unknown[];
  currency: { code: string; exponent: number; symbol: string };
};

/** `YYYY-MM-DD`, `days` before today — how a test puts an invoice past its grace. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

beforeAll(async () => {
  await applyMigrations(env.DB);

  await env.DB.batch(
    [
      [ADMIN_ID, 'Me Billing Admin'],
      [STUDENT_ID, 'Me Billing Student'],
      [RICH_ID, 'Me Billing Other'],
    ].map(([id, name]) =>
      env.DB.prepare(
        'INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)',
      ).bind(id, name, `${id}@me-billing.test`, 'hash'),
    ),
  );

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [adminToken, studentToken, otherToken] = await Promise.all([
    adapter.signAccessToken({ sub: ADMIN_ID, email: 'a@me-billing.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: STUDENT_ID, email: 's@me-billing.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: RICH_ID, email: 'o@me-billing.test', roles: ['student'] }),
  ]);

  // One student owes 15000 and is well past grace; the other owes 99000. Both
  // are driven entirely through the admin lifecycle endpoints.
  const plan = await jsonOf<{ id: string }>(
    await call('POST', '/admin/billing/plans', {
      token: adminToken,
      body: {
        name: 'Me billing plan',
        amountMinor: 15000,
        currency: 'BRL',
        cycle: 'monthly',
        graceDays: 5,
      },
    }),
    201,
  );

  for (const [userId, amountMinor] of [
    [STUDENT_ID, 15000],
    [RICH_ID, 99000],
  ] as const) {
    const contract = await jsonOf<{ id: string }>(
      await call('POST', '/admin/billing/subscriptions', {
        token: adminToken,
        body: { userId, planId: plan.id, dueDay: 10, startDate: '2026-01-01' },
      }),
      201,
    );
    await jsonOf(
      await call('POST', '/admin/billing/invoices', {
        token: adminToken,
        body: {
          subscriptionId: contract.id,
          amountMinor,
          dueDate: daysAgo(60),
          referenceDate: '2026-01-01',
        },
      }),
      201,
    );
  }
});

describe('GET /v1/me/billing', () => {
  it('returns the caller their own statement with their standing', async () => {
    const statement = await jsonOf<Statement>(
      await call('GET', '/me/billing', { token: studentToken }),
      200,
    );

    expect(statement.userId).toBe(STUDENT_ID);
    expect(statement.standing).toBe('delinquent');
    expect(statement.outstandingMinor).toBe(15000);
    expect(statement.oldestOverdueDate).toBe(daysAgo(60));
    expect(statement.invoices).toHaveLength(1);
    expect(statement.contractGroups).toHaveLength(1);
    expect(statement.currency).toMatchObject({ code: 'BRL', exponent: 2 });
  });

  it('401s an anonymous caller', async () => {
    expect((await call('GET', '/me/billing')).status).toBe(401);
  });

  it('answers a member with no contract with an empty statement, not a 404', async () => {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)',
    )
      .bind('me-billing-fresh', 'Fresh', 'fresh@me-billing.test', 'hash')
      .run();

    const adapter = new JwtAuthAdapter({
      secret: env.JWT_SECRET,
      accessTokenExpiresInSeconds: 900,
    });
    const token = await adapter.signAccessToken({
      sub: 'me-billing-fresh',
      email: 'fresh@me-billing.test',
      roles: ['student'],
    });

    const statement = await jsonOf<Statement>(
      await call('GET', '/me/billing', { token }),
      200,
    );
    expect(statement).toMatchObject({
      userId: 'me-billing-fresh',
      standing: 'good',
      outstandingMinor: 0,
      invoices: [],
      contractGroups: [],
    });
  });

  // -------------------------------------------------------------------------
  // Self-only by construction
  // -------------------------------------------------------------------------

  describe('there is no path to another student', () => {
    it('has no sub-path taking a user id', async () => {
      for (const path of [
        `/me/billing/${RICH_ID}`,
        `/me/billing/statement/${RICH_ID}`,
        `/me/billing/students/${RICH_ID}`,
      ]) {
        expect((await call('GET', path, { token: studentToken })).status).toBe(404);
      }
    });

    it('ignores a user id offered in the query string', async () => {
      for (const query of [`?userId=${RICH_ID}`, `?user_id=${RICH_ID}`, `?sub=${RICH_ID}`]) {
        const statement = await jsonOf<Statement>(
          await call('GET', `/me/billing${query}`, { token: studentToken }),
          200,
        );
        expect(statement.userId).toBe(STUDENT_ID);
        expect(statement.outstandingMinor).toBe(15000);
      }
    });

    it('ignores a user id offered in a header', async () => {
      const statement = await jsonOf<Statement>(
        await call('GET', '/me/billing', {
          token: studentToken,
          headers: { 'X-User-Id': RICH_ID, 'X-Impersonate': RICH_ID },
        }),
        200,
      );
      expect(statement.userId).toBe(STUDENT_ID);
    });

    it("does not let an admin read a student's statement through it", async () => {
      // The admin route exists for that, behind requireRole(ADMIN); this one
      // only ever answers about the caller, even when the caller is an admin.
      const mine = await jsonOf<Statement>(
        await call('GET', '/me/billing', { token: adminToken }),
        200,
      );
      expect(mine.userId).toBe(ADMIN_ID);
      expect(mine.invoices).toHaveLength(0);
    });

    it('gives each student a different answer for the same request', async () => {
      const first = await jsonOf<Statement>(
        await call('GET', '/me/billing', { token: studentToken }),
        200,
      );
      const second = await jsonOf<Statement>(
        await call('GET', '/me/billing', { token: otherToken }),
        200,
      );

      expect(first.userId).toBe(STUDENT_ID);
      expect(second.userId).toBe(RICH_ID);
      expect(second.outstandingMinor).toBe(99000);
      expect(JSON.stringify(first)).not.toContain(RICH_ID);
    });
  });

  // -------------------------------------------------------------------------
  // A hold, seen from the student's side
  // -------------------------------------------------------------------------

  it('reports a hold as `exempt` while still showing the full balance', async () => {
    expect(
      (
        await call('POST', `/admin/billing/holds/${RICH_ID}`, {
          token: adminToken,
          body: { reason: 'Agreed to settle in March.' },
        })
      ).status,
    ).toBe(201);

    const held = await jsonOf<Statement>(
      await call('GET', '/me/billing', { token: otherToken }),
      200,
    );
    expect(held.standing).toBe('exempt');
    expect(held.outstandingMinor).toBe(99000);
    // The admins' note about them is not part of the student's statement.
    expect(JSON.stringify(held)).not.toContain('Agreed to settle');

    expect(
      (await call('DELETE', `/admin/billing/holds/${RICH_ID}`, { token: adminToken })).status,
    ).toBe(204);

    const cleared = await jsonOf<Statement>(
      await call('GET', '/me/billing', { token: otherToken }),
      200,
    );
    expect(cleared.standing).toBe('delinquent');
  });
});
