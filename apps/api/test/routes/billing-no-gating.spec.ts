import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';

/**
 * The no-gating regression — RFC 0013's central non-goal, asserted rather than
 * promised.
 *
 * **Billing never touches access.** A student sitting `delinquent` keeps
 * exactly the access they had the day before: the catalogue, their progress,
 * the comments on a topic they are enrolled in, and everything else. There is
 * no `402`, no read-only mode and no per-topic paywall anywhere in the product,
 * and the day money starts deciding what a student may open is the day this
 * file goes red.
 *
 * It is written from the student's side on purpose. The admin roster is
 * asserted here too, but only to prove the student really *is* delinquent while
 * every one of those calls returns `200` — an assertion that the content routes
 * answer for a student who owes nothing would prove nothing at all.
 *
 * Grants answer what a student may see; billing answers what they owe. No query
 * in this task joins the two, and `enrollments_user` is read and written here
 * only by the seed.
 */

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const ADMIN_ID = 'nogate-admin';
const DEBTOR_ID = 'nogate-debtor';
const PUBLIC_TOPIC_ID = '3f1b7a10-0000-4000-8000-000000000001';
const ENROLLED_TOPIC_ID = '3f1b7a10-0000-4000-8000-000000000002';

let adminToken: string;
let debtorToken: string;

/** `YYYY-MM-DD`, `days` before today. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

async function call(
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
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

type RosterEntry = {
  userId: string;
  standing: string;
  outstandingMinor: number;
  oldestOverdueDate: string | null;
  nextDueDate: string | null;
  negotiatedTerms: boolean;
  hold: { reason: string; setBy: string; expiresAt: string | null } | null;
};

type Statement = { userId: string; outstandingMinor: number; standing?: string };
type AgingReport = { totalMinor: number; invoiceCount: number; studentCount: number };
type MovementReport = { outstandingMinor: number; billedMinor: number };

const roster = async (query = ''): Promise<RosterEntry[]> =>
  jsonOf<RosterEntry[]>(
    await call('GET', `/admin/billing/students${query}`, { token: adminToken }),
    200,
  );

beforeAll(async () => {
  await applyMigrations(env.DB);

  await env.DB.batch([
    env.DB.prepare(
      'INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)',
    ).bind(ADMIN_ID, 'No-gate Admin', 'admin@nogate.test', 'hash'),
    env.DB.prepare(
      'INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)',
    ).bind(DEBTOR_ID, 'No-gate Debtor', 'debtor@nogate.test', 'hash'),
    env.DB.prepare(
      'INSERT OR IGNORE INTO topic_nodes (id, title, status, visibility) VALUES (?, ?, ?, ?)',
    ).bind(PUBLIC_TOPIC_ID, 'Open to all', 'published', 'public'),
    env.DB.prepare(
      'INSERT OR IGNORE INTO topic_nodes (id, title, status, visibility) VALUES (?, ?, ?, ?)',
    ).bind(ENROLLED_TOPIC_ID, 'Behind a grant', 'published', 'restricted'),
    // The grant. It is written once, here, and nothing in billing ever reads or
    // touches it again — which is the property the last test in this file
    // checks by reading the row back after the debt is in place.
    env.DB.prepare(
      'INSERT OR IGNORE INTO enrollments_user (id, user_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)',
    ).bind('nogate-enroll', DEBTOR_ID, ENROLLED_TOPIC_ID, ADMIN_ID),
  ]);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [adminToken, debtorToken] = await Promise.all([
    adapter.signAccessToken({ sub: ADMIN_ID, email: 'admin@nogate.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: DEBTOR_ID, email: 'debtor@nogate.test', roles: ['student'] }),
  ]);

  // Drive the student into `delinquent`: one invoice, due 60 days ago, with
  // five grace days. Nothing is backdated by hand — the whole state comes out
  // of the Task 03 endpoints.
  const plan = await jsonOf<{ id: string }>(
    await call('POST', '/admin/billing/plans', {
      token: adminToken,
      body: {
        name: 'No-gate plan',
        amountMinor: 25000,
        currency: 'BRL',
        cycle: 'monthly',
        graceDays: 5,
      },
    }),
    201,
  );

  const contract = await jsonOf<{ id: string }>(
    await call('POST', '/admin/billing/subscriptions', {
      token: adminToken,
      body: { userId: DEBTOR_ID, planId: plan.id, dueDay: 10, startDate: '2026-01-01' },
    }),
    201,
  );

  await jsonOf(
    await call('POST', '/admin/billing/invoices', {
      token: adminToken,
      body: {
        subscriptionId: contract.id,
        dueDate: daysAgo(60),
        referenceDate: '2026-01-01',
      },
    }),
    201,
  );
});

describe('a delinquent student is still a student', () => {
  it('really is delinquent — otherwise the rest of this file proves nothing', async () => {
    const entry = (await roster()).find((row) => row.userId === DEBTOR_ID)!;

    expect(entry).toMatchObject({
      standing: 'delinquent',
      outstandingMinor: 25000,
      oldestOverdueDate: daysAgo(60),
      negotiatedTerms: false,
      hold: null,
    });

    // And the roster agrees with the statement, line for line.
    const statement = await jsonOf<Statement>(
      await call('GET', `/admin/billing/students/${DEBTOR_ID}/statement`, { token: adminToken }),
      200,
    );
    expect(entry.outstandingMinor).toBe(statement.outstandingMinor);
  });

  /**
   * The list of everything a delinquent student may still do. Each entry is a
   * route someone could plausibly decide to put a paywall behind; every one of
   * them must answer as it did before any invoice existed.
   */
  const OPEN_TO_THEM: Array<{ what: string; method: string; path: string; body?: unknown }> = [
    { what: 'the catalogue', method: 'GET', path: '/topics' },
    { what: 'a public topic', method: 'GET', path: `/topics/${PUBLIC_TOPIC_ID}` },
    { what: 'a topic they are enrolled in', method: 'GET', path: `/topics/${ENROLLED_TOPIC_ID}` },
    { what: 'their progress summary', method: 'GET', path: '/me/progress/summary' },
    { what: 'their topic progress', method: 'GET', path: '/me/progress/topics' },
    { what: 'their task progress', method: 'GET', path: '/me/progress/tasks' },
    { what: 'their XP', method: 'GET', path: '/me/xp' },
    { what: 'their gamification dashboard', method: 'GET', path: '/me/dashboard' },
    {
      what: 'the comments on their topic',
      method: 'GET',
      path: `/topics/${ENROLLED_TOPIC_ID}/comments`,
    },
    { what: 'their own billing statement', method: 'GET', path: '/me/billing' },
  ];

  for (const route of OPEN_TO_THEM) {
    it(`200s ${route.what} (${route.method} ${route.path})`, async () => {
      const res = await call(route.method, route.path, {
        token: debtorToken,
        body: route.body,
      });
      expect(res.status).toBe(200);
    });
  }

  it('still lets them write a comment on a topic they are enrolled in', async () => {
    const res = await call('POST', `/topics/${ENROLLED_TOPIC_ID}/comments`, {
      token: debtorToken,
      body: { body: 'Owing money has not made me quiet.' },
    });
    expect(res.status).toBe(201);
  });

  it('never answers 402, on any of them', async () => {
    for (const route of OPEN_TO_THEM) {
      const res = await call(route.method, route.path, { token: debtorToken });
      // There is no payment-required branch anywhere in the product, so this is
      // stronger than asserting 200: it fails on a paywall of any status too.
      expect(res.status).not.toBe(402);
      expect(res.status).toBe(200);
    }
  });

  it('leaves their enrollment grant exactly as the seed wrote it', async () => {
    const grant = await env.DB.prepare(
      'SELECT id, user_id, topic_node_id, granted_by FROM enrollments_user WHERE user_id = ?',
    )
      .bind(DEBTOR_ID)
      .all();

    // Billing has run a contract, an invoice and a roster over this student and
    // has not touched the one row that decides what they may open.
    expect(grant.results).toEqual([
      {
        id: 'nogate-enroll',
        user_id: DEBTOR_ID,
        topic_node_id: ENROLLED_TOPIC_ID,
        granted_by: ADMIN_ID,
      },
    ]);
  });
});

describe('a hold suppresses the alert and nothing else', () => {
  it('takes the student out of the listing while every total stays put', async () => {
    const agingBefore = await jsonOf<AgingReport>(
      await call('GET', '/admin/billing/reports/aging', { token: adminToken }),
      200,
    );
    const movementBefore = await jsonOf<MovementReport>(
      await call('GET', '/admin/billing/reports/movement?month=2026-01', { token: adminToken }),
      200,
    );
    const statementBefore = await jsonOf<Statement>(
      await call('GET', `/admin/billing/students/${DEBTOR_ID}/statement`, { token: adminToken }),
      200,
    );

    expect((await roster('?standing=delinquent')).map((row) => row.userId)).toContain(DEBTOR_ID);

    const hold = await jsonOf<{ reason: string; setBy: string; expiresAt: string | null }>(
      await call('POST', `/admin/billing/holds/${DEBTOR_ID}`, {
        token: adminToken,
        body: { reason: 'Agreed a payment plan; stop chasing.' },
      }),
      201,
    );
    expect(hold).toMatchObject({
      reason: 'Agreed a payment plan; stop chasing.',
      setBy: ADMIN_ID,
      expiresAt: null,
    });

    // Out of the delinquency listing, into the exempt one.
    expect((await roster('?standing=delinquent')).map((row) => row.userId)).not.toContain(
      DEBTOR_ID,
    );
    const exempt = (await roster('?standing=exempt')).find((row) => row.userId === DEBTOR_ID)!;
    expect(exempt).toMatchObject({ standing: 'exempt', outstandingMinor: 25000 });
    expect(exempt.oldestOverdueDate).toBe(daysAgo(60));

    // And every total is byte-identical. A hold that moved one would be a hold
    // that lost the dojo money.
    expect(
      await jsonOf<AgingReport>(
        await call('GET', '/admin/billing/reports/aging', { token: adminToken }),
        200,
      ),
    ).toEqual(agingBefore);
    expect(
      await jsonOf<MovementReport>(
        await call('GET', '/admin/billing/reports/movement?month=2026-01', { token: adminToken }),
        200,
      ),
    ).toEqual(movementBefore);
    expect(
      await jsonOf<Statement>(
        await call('GET', `/admin/billing/students/${DEBTOR_ID}/statement`, { token: adminToken }),
        200,
      ),
    ).toEqual(statementBefore);
  });

  it('changes nothing about what they can open', async () => {
    await jsonOf(
      await call('POST', `/admin/billing/holds/${DEBTOR_ID}`, {
        token: adminToken,
        body: { reason: 'Agreed a payment plan; stop chasing.' },
      }),
      201,
    );

    for (const path of ['/topics', `/topics/${ENROLLED_TOPIC_ID}`, '/me/progress/summary']) {
      expect((await call('GET', path, { token: debtorToken })).status).toBe(200);
    }
  });

  it('refuses a hold with no reason, leaving the one already set alone', async () => {
    await jsonOf(
      await call('POST', `/admin/billing/holds/${DEBTOR_ID}`, {
        token: adminToken,
        body: { reason: 'Agreed a payment plan; stop chasing.' },
      }),
      201,
    );

    // Missing entirely — refused by the schema.
    expect(
      (
        await call('POST', `/admin/billing/holds/${DEBTOR_ID}`, {
          token: adminToken,
          body: { expiresAt: null },
        })
      ).status,
    ).toBe(400);

    // Present but blank — refused by the service, in the one place that rule lives.
    expect(
      (
        await call('POST', `/admin/billing/holds/${DEBTOR_ID}`, {
          token: adminToken,
          body: { reason: '   ' },
        })
      ).status,
    ).toBe(400);

    // Neither refusal disturbed the hold that was already in place.
    const exempt = (await roster('?standing=exempt')).find((row) => row.userId === DEBTOR_ID)!;
    expect(exempt.hold).toMatchObject({ reason: 'Agreed a payment plan; stop chasing.' });
  });

  it('refuses a hold on a student who does not exist', async () => {
    const res = await call('POST', '/admin/billing/holds/not-a-user', {
      token: adminToken,
      body: { reason: 'Whoever this is.' },
    });
    expect(res.status).toBe(404);
  });

  it('stops taking effect the day after it expires, with no job having run', async () => {
    // Re-set the hold with an expiry of yesterday. Nothing cleans it up, and
    // nothing needs to: `asOf` is the whole of the mechanism.
    await jsonOf(
      await call('POST', `/admin/billing/holds/${DEBTOR_ID}`, {
        token: adminToken,
        body: { reason: 'Paused for a fortnight.', expiresAt: daysAgo(1) },
      }),
      201,
    );

    const today = (await roster()).find((row) => row.userId === DEBTOR_ID)!;
    expect(today.standing).toBe('delinquent');
    // The row is still there, untouched — it simply stopped applying.
    expect(today.hold).toMatchObject({ reason: 'Paused for a fortnight.', expiresAt: daysAgo(1) });

    // On its last day it was still in force, read from those same rows.
    const lastDay = (await roster(`?asOf=${daysAgo(1)}`)).find((row) => row.userId === DEBTOR_ID)!;
    expect(lastDay.standing).toBe('exempt');

    const stored = await env.DB.prepare(
      'SELECT user_id, reason, expires_at FROM billing_standing_holds WHERE user_id = ?',
    )
      .bind(DEBTOR_ID)
      .first();
    expect(stored).toMatchObject({ user_id: DEBTOR_ID, expires_at: daysAgo(1) });
  });

  it('clears the hold and puts the student back in the listing', async () => {
    await jsonOf(
      await call('POST', `/admin/billing/holds/${DEBTOR_ID}`, {
        token: adminToken,
        body: { reason: 'Temporarily off the chase list.' },
      }),
      201,
    );
    expect((await roster('?standing=delinquent')).map((row) => row.userId)).not.toContain(
      DEBTOR_ID,
    );

    expect(
      (await call('DELETE', `/admin/billing/holds/${DEBTOR_ID}`, { token: adminToken })).status,
    ).toBe(204);
    expect((await roster('?standing=delinquent')).map((row) => row.userId)).toContain(DEBTOR_ID);
    // The debt was never what the hold was hiding.
    const back = (await roster('?standing=delinquent')).find((row) => row.userId === DEBTOR_ID)!;
    expect(back.outstandingMinor).toBe(25000);

    // Clearing one that is not set is a 404, not a silent success.
    expect(
      (await call('DELETE', `/admin/billing/holds/${DEBTOR_ID}`, { token: adminToken })).status,
    ).toBe(404);
  });
});
