import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';

/**
 * The extras rail over HTTP, against real SQLite (RFC 0015 §7): the student's
 * own `extras` object on `GET /v1/me/billing`, the admin statement of an
 * extras-only buyer, and the `rail` switch on the aging report.
 *
 * Everything is written through the admin lifecycle endpoints, so the
 * container wiring — the charge adapter and the event reader injected into
 * `AccountingService` — is what is actually exercised.
 */

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const ADMIN_ID = 'me-extras-admin';
const PAID_UP_ID = 'me-extras-paid-up';
const BUYER_ID = 'me-extras-buyer';
const EVENT_A = 'me-extras-event-a';
const EVENT_B = 'me-extras-event-b';

let adminToken: string;
let paidUpToken: string;
let buyerToken: string;

async function call(method: string, path: string, token: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const request = new IncomingRequest(`http://example.com${v1(path)}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
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

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

type StatementCharge = {
  id: string;
  userId: string;
  eventId: string;
  eventTitle: string;
  eventStartsAt: string | null;
  dueDate: string;
  amountMinor: number;
  balanceMinor: number;
  payments: unknown[];
  adjustments: unknown[];
};
type Statement = {
  userId: string;
  standing?: string;
  outstandingMinor: number;
  invoices: unknown[];
  extras: {
    standing: string;
    oldestOverdueDate: string | null;
    outstandingMinor: number;
    charges: StatementCharge[];
  };
};

beforeAll(async () => {
  await applyMigrations(env.DB);

  await env.DB.batch([
    ...[
      [ADMIN_ID, 'Extras Admin'],
      [PAID_UP_ID, 'Paid Up Student'],
      [BUYER_ID, 'Extras Only Buyer'],
    ].map(([id, name]) =>
      env.DB.prepare(
        'INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)',
      ).bind(id, name, `${id}@me-extras.test`, 'hash'),
    ),
    ...[
      [EVENT_A, 'Winter Seminar'],
      [EVENT_B, 'Spring Workshop'],
    ].map(([id, title]) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO events (id, slug, title, starts_at, status, created_by)
         VALUES (?, ?, ?, '2030-01-01 19:00:00', 'published', ?)`,
      ).bind(id, id, title, ADMIN_ID),
    ),
  ]);

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [adminToken, paidUpToken, buyerToken] = await Promise.all([
    adapter.signAccessToken({ sub: ADMIN_ID, email: 'a@me-extras.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: PAID_UP_ID, email: 'p@me-extras.test', roles: ['student'] }),
    adapter.signAccessToken({ sub: BUYER_ID, email: 'b@me-extras.test', roles: ['student'] }),
  ]);

  // A paid-up contract for PAID_UP_ID: one invoice, settled in full.
  const plan = await jsonOf<{ id: string }>(
    await call('POST', '/admin/billing/plans', adminToken, {
      name: 'Me extras plan',
      amountMinor: 15000,
      currency: 'BRL',
      cycle: 'monthly',
      graceDays: 5,
    }),
    201,
  );
  const contract = await jsonOf<{ id: string }>(
    await call('POST', '/admin/billing/subscriptions', adminToken, {
      userId: PAID_UP_ID,
      planId: plan.id,
      dueDay: 10,
      startDate: '2026-01-01',
    }),
    201,
  );
  const invoice = await jsonOf<{ id: string }>(
    await call('POST', '/admin/billing/invoices', adminToken, {
      subscriptionId: contract.id,
      dueDate: daysAgo(40),
      referenceDate: '2026-01-01',
    }),
    201,
  );
  await jsonOf(
    await call('POST', `/admin/billing/invoices/${invoice.id}/payments`, adminToken, {
      amountMinor: 15000,
      method: 'pix',
      paidAt: daysAgo(41),
    }),
    201,
  );

  // One overdue charge each: PAID_UP_ID for event A, BUYER_ID (no contract) for event B.
  for (const [eventId, userId, amountMinor] of [
    [EVENT_A, PAID_UP_ID, 12000],
    [EVENT_B, BUYER_ID, 8000],
  ] as const) {
    await jsonOf(
      await call('POST', '/admin/billing/charges', adminToken, {
        eventId,
        userIds: [userId],
        amountMinor,
        dueDate: daysAgo(30),
        graceDays: 0,
        termsNote: 'fixture price',
      }),
      201,
    );
  }
});

describe('GET /v1/me/billing — extras', () => {
  it('keeps contract standing good while extras are delinquent, naming the event', async () => {
    const me = await jsonOf<Statement>(await call('GET', '/me/billing', paidUpToken), 200);

    expect(me.standing).toBe('good');
    expect(me.outstandingMinor).toBe(0);
    expect(me.extras.standing).toBe('delinquent');
    expect(me.extras.outstandingMinor).toBe(12000);
    expect(me.extras.oldestOverdueDate).toBe(daysAgo(30));
    expect(me.extras.charges).toHaveLength(1);
    expect(me.extras.charges[0]).toMatchObject({
      eventId: EVENT_A,
      eventTitle: 'Winter Seminar',
      dueDate: daysAgo(30),
      amountMinor: 12000,
      balanceMinor: 12000,
      payments: [],
      adjustments: [],
    });
    expect(me.extras.charges[0].eventStartsAt).not.toBeNull();
  });

  it("never returns another user's charge", async () => {
    const paidUp = await jsonOf<Statement>(await call('GET', '/me/billing', paidUpToken), 200);
    const buyer = await jsonOf<Statement>(await call('GET', '/me/billing', buyerToken), 200);

    expect(paidUp.extras.charges.map((c) => c.userId)).toEqual([PAID_UP_ID]);
    expect(buyer.extras.charges.map((c) => c.userId)).toEqual([BUYER_ID]);
    expect(buyer.extras.charges[0].eventTitle).toBe('Spring Workshop');
    expect(paidUp.extras.charges.some((c) => c.eventId === EVENT_B)).toBe(false);
  });

  it('answers an extras-only buyer with an empty contract and a resolved extras rail', async () => {
    const buyer = await jsonOf<Statement>(await call('GET', '/me/billing', buyerToken), 200);

    expect(buyer.invoices).toEqual([]);
    expect(buyer.standing).toBe('good');
    expect(buyer.outstandingMinor).toBe(0);
    expect(buyer.extras.standing).toBe('delinquent');
  });
});

describe('admin reports — extras', () => {
  it("returns the extras-only buyer's admin statement with the same extras object", async () => {
    const admin = await jsonOf<Statement>(
      await call('GET', `/admin/billing/students/${BUYER_ID}/statement`, adminToken),
      200,
    );
    const mine = await jsonOf<Statement>(await call('GET', '/me/billing', buyerToken), 200);

    expect(admin.extras).toEqual(mine.extras);
    expect(admin.outstandingMinor).toBe(0);
  });

  it('ages each rail on its own and 400s an unknown rail', async () => {
    type Aging = { rail: string; totalMinor: number };
    const byDefault = await jsonOf<Aging>(await call('GET', '/admin/billing/reports/aging', adminToken), 200);
    const contract = await jsonOf<Aging>(
      await call('GET', '/admin/billing/reports/aging?rail=contract', adminToken),
      200,
    );
    const extras = await jsonOf<Aging>(
      await call('GET', '/admin/billing/reports/aging?rail=extras', adminToken),
      200,
    );

    expect(byDefault).toEqual(contract);
    expect(contract.rail).toBe('contract');
    expect(extras.rail).toBe('extras');
    // Other specs share this database; at least the two charges above are aged.
    expect(extras.totalMinor).toBeGreaterThanOrEqual(20000);

    const bad = await call('GET', '/admin/billing/reports/aging?rail=both', adminToken);
    expect(bad.status).toBe(400);
  });

  it('adds the extras block and the till total to movement', async () => {
    // The charges above were issued today, so they land in the current month.
    const month = new Date().toISOString().slice(0, 7);
    const report = await jsonOf<{
      receivedMinor: number;
      cashReceivedMinor: number;
      extras: { receivedMinor: number; chargedMinor: number; chargesIssued: number };
    }>(await call('GET', `/admin/billing/reports/movement?month=${month}`, adminToken), 200);

    expect(report.cashReceivedMinor).toBe(report.receivedMinor + report.extras.receivedMinor);
    expect(report.extras.chargesIssued).toBeGreaterThanOrEqual(2);
    expect(report.extras.chargedMinor).toBeGreaterThanOrEqual(20000);
  });
});
