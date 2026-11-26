import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';
import { buildPaymentsTestApp, type PaymentsTestApp } from '../adapters/payment/payments-test-app';
import { StubGatewayAdapter, stubPayment } from '../adapters/payment/stub-gateway-adapter';
import { insertInvoicePayment, seedGatewayWorld, type GatewayWorld } from '../db/gateway-fixtures';

/**
 * `/v1/admin/billing` over HTTP.
 *
 * Two things are asserted here that no cheaper layer can: the whole lifecycle
 * really is operable end to end through the router, and **every route** in it
 * is ADMIN-only. The role matrix loops over an enumerated route list rather
 * than probing one endpoint, so a route added later without the guard fails
 * this spec instead of shipping the dojo's finances to every content creator.
 */

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const ADMIN_ID = 'billing-admin';
const STUDENT_ID = 'billing-student';
const SECOND_STUDENT_ID = 'billing-student-2';

let adminToken: string;
let creatorToken: string;
let tutorToken: string;
let studentToken: string;

beforeAll(async () => {
  await applyMigrations(env.DB);

  await env.DB.batch(
    [
      [ADMIN_ID, 'Billing Admin'],
      [STUDENT_ID, 'Billing Student'],
      [SECOND_STUDENT_ID, 'Second Student'],
    ].map(([id, name]) =>
      env.DB.prepare(
        'INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)',
      ).bind(id, name, `${id}@billing.test`, 'hash'),
    ),
  );

  const adapter = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [adminToken, creatorToken, tutorToken, studentToken] = await Promise.all([
    adapter.signAccessToken({ sub: ADMIN_ID, email: 'admin@billing.test', roles: ['admin'] }),
    adapter.signAccessToken({ sub: 'cc', email: 'cc@billing.test', roles: ['content_creator'] }),
    adapter.signAccessToken({ sub: 'tutor', email: 'tutor@billing.test', roles: ['tutor'] }),
    adapter.signAccessToken({ sub: STUDENT_ID, email: 's@billing.test', roles: ['student'] }),
  ]);
});

async function billing(
  method: string,
  path: string,
  body?: unknown,
  token = adminToken,
  /** The same Worker app with stub payment adapters bound; without it the real Worker (`none`) answers. */
  app?: PaymentsTestApp,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const request = new IncomingRequest(`http://example.com${v1(`/admin/billing${path}`)}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const ctx = createExecutionContext();
  const res = app ? await app.fetch(request, ctx) : await worker.fetch(request, env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function jsonOf<T>(res: Response, expected: number): Promise<T> {
  if (res.status !== expected) {
    throw new Error(`expected ${expected}, got ${res.status}: ${await res.text()}`);
  }
  return res.json<T>();
}

type Plan = { id: string; amountMinor: number; graceDays: number; archived: boolean };
type Subscription = {
  id: string;
  amountMinor: number;
  currency: string;
  cycle: string;
  graceDays: number;
  status: string;
  endDate: string | null;
  termsSource: string;
  termsNote: string;
  contractGroupId: string;
  supersedesId: string | null;
};
type Invoice = {
  id: string;
  amountMinor: number;
  graceDays: number;
  currency: string;
  status: string;
  periodStart: string;
  dueDate: string;
  voidReason: string | null;
  balanceMinor?: number;
};
type Payment = { id: string; amountMinor: number; reversesId: string | null };

async function createPlan(amountMinor = 15000, graceDays = 5): Promise<Plan> {
  return jsonOf<Plan>(
    await billing('POST', '/plans', {
      name: `Plan ${crypto.randomUUID()}`,
      amountMinor,
      currency: 'BRL',
      cycle: 'monthly',
      graceDays,
    }),
    201,
  );
}

// ---------------------------------------------------------------------------
// The lifecycle, end to end
// ---------------------------------------------------------------------------

describe('/v1/admin/billing — the whole lifecycle over HTTP', () => {
  it('creates, signs, issues, adjusts, pays, reverses and voids', async () => {
    const plan = await createPlan();

    // Sign a standard contract — the plan's terms are snapshotted.
    const contract = await jsonOf<Subscription>(
      await billing('POST', '/subscriptions', {
        userId: STUDENT_ID,
        planId: plan.id,
        dueDay: 10,
        startDate: '2026-01-01',
      }),
      201,
    );
    expect(contract).toMatchObject({
      amountMinor: 15000,
      currency: 'BRL',
      cycle: 'monthly',
      graceDays: 5,
      status: 'active',
      termsSource: 'standard',
    });
    expect(contract.contractGroupId).toBe(contract.id);

    // A second active contract for the same student is a conflict.
    const duplicate = await billing('POST', '/subscriptions', {
      userId: STUDENT_ID,
      planId: plan.id,
      dueDay: 10,
      startDate: '2026-02-01',
    });
    expect(duplicate.status).toBe(409);

    // Sign a negotiated contract for a second student.
    const negotiated = await jsonOf<Subscription>(
      await billing('POST', '/subscriptions', {
        userId: SECOND_STUDENT_ID,
        planId: plan.id,
        dueDay: 5,
        startDate: '2026-01-01',
        termsSource: 'negotiated',
        amountMinor: 9000,
        graceDays: 15,
        termsNote: 'Sibling discount.',
      }),
      201,
    );
    expect(negotiated).toMatchObject({
      termsSource: 'negotiated',
      amountMinor: 9000,
      graceDays: 15,
    });

    // The same request without a reason is refused.
    const reasonless = await billing('POST', '/subscriptions', {
      userId: SECOND_STUDENT_ID,
      planId: plan.id,
      dueDay: 5,
      startDate: '2026-01-01',
      termsSource: 'negotiated',
      amountMinor: 100,
    });
    expect(reasonless.status).toBe(400);

    // Issue an ad-hoc invoice against the contract's snapshot.
    const invoice = await jsonOf<Invoice>(
      await billing('POST', '/invoices', {
        subscriptionId: contract.id,
        referenceDate: '2026-03-05',
      }),
      201,
    );
    expect(invoice).toMatchObject({
      amountMinor: 15000,
      graceDays: 5,
      currency: 'BRL',
      status: 'open',
      periodStart: '2026-03-01',
      dueDate: '2026-03-10',
    });

    // A discount is appended, and the balance moves.
    await jsonOf(
      await billing('POST', `/invoices/${invoice.id}/adjustments`, {
        kind: 'discount',
        amountMinor: -5000,
        reason: 'Camp week missed.',
      }),
      201,
    );
    const afterDiscount = await jsonOf<Invoice[]>(
      await billing('GET', `/invoices?userId=${STUDENT_ID}`),
      200,
    );
    expect(afterDiscount.find((i) => i.id === invoice.id)?.balanceMinor).toBe(10000);

    // Record the payment: the invoice settles.
    const payment = await jsonOf<Payment>(
      await billing('POST', `/invoices/${invoice.id}/payments`, {
        amountMinor: 10000,
        method: 'pix',
        paidAt: '2026-03-09',
      }),
      201,
    );
    expect(payment.reversesId).toBeNull();
    const settled = await jsonOf<Invoice[]>(
      await billing('GET', `/invoices?userId=${STUDENT_ID}&status=paid`),
      200,
    );
    expect(settled.map((i) => i.id)).toContain(invoice.id);

    // Reverse it: an appended mirror row, not a deletion.
    const reversal = await jsonOf<Payment>(
      await billing('POST', `/payments/${payment.id}/reverse`, { reason: 'Transfer bounced.' }),
      201,
    );
    expect(reversal.amountMinor).toBe(-10000);
    expect(reversal.reversesId).toBe(payment.id);

    const reopened = await jsonOf<Invoice[]>(
      await billing('GET', `/invoices?userId=${STUDENT_ID}&status=open`),
      200,
    );
    expect(reopened.find((i) => i.id === invoice.id)?.balanceMinor).toBe(10000);

    // A second reversal of the same payment is a conflict.
    const twice = await billing('POST', `/payments/${payment.id}/reverse`, { reason: 'Again.' });
    expect(twice.status).toBe(409);

    // Void requires a reason.
    const noReason = await billing('POST', `/invoices/${invoice.id}/void`, { reason: '' });
    expect(noReason.status).toBe(400);

    const voided = await jsonOf<Invoice>(
      await billing('POST', `/invoices/${invoice.id}/void`, { reason: 'Reissued next month.' }),
      200,
    );
    expect(voided.status).toBe('void');
    expect(voided.voidReason).toBe('Reissued next month.');

    // A payment against a void invoice is refused.
    const lateMoney = await billing('POST', `/invoices/${invoice.id}/payments`, {
      amountMinor: 10000,
      method: 'cash',
    });
    expect(lateMoney.status).toBe(409);
  });

  it('gateway payments: 400 on a malformed reference, 409 PAYMENT_REFERENCE_EXISTS on a duplicate', async () => {
    const userId = `billing-gateway-${crypto.randomUUID()}`;
    await env.DB
      .prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .bind(userId, 'Gateway Student', `${userId}@billing.test`, 'hash')
      .run();
    const plan = await createPlan();
    const contract = await jsonOf<Subscription>(
      await billing('POST', '/subscriptions', { userId, planId: plan.id, dueDay: 10, startDate: '2026-01-01' }),
      201,
    );
    const invoice = await jsonOf<Invoice>(
      await billing('POST', '/invoices', { subscriptionId: contract.id, referenceDate: '2026-05-05' }),
      201,
    );
    const path = `/invoices/${invoice.id}/payments`;
    const reference = `mercadopago:${crypto.randomUUID()}`;

    // Not `<known provider>:<id>` — including no reference at all.
    for (const externalReference of [undefined, null, 'receipt 12', 'paypal:1', 'mercadopago:']) {
      const res = await billing('POST', path, { amountMinor: 5000, method: 'gateway', externalReference });
      expect(res.status).toBe(400);
    }

    const first = await jsonOf<Payment & { method: string; externalReference: string; recordedBy: string }>(
      await billing('POST', path, { amountMinor: 5000, method: 'gateway', externalReference: reference }),
      201,
    );
    expect(first).toMatchObject({ method: 'gateway', externalReference: reference, recordedBy: ADMIN_ID });

    const duplicate = await billing('POST', path, { amountMinor: 5000, method: 'gateway', externalReference: reference });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ error: 'PAYMENT_REFERENCE_EXISTS', paymentId: first.id });

    // One row landed; a free-form reference on another method may still repeat.
    const rows = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?')
      .bind(invoice.id)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
    for (let i = 0; i < 2; i += 1) {
      await jsonOf(await billing('POST', path, { amountMinor: 100, method: 'pix', externalReference: reference }), 201);
    }
  });

  it('pauses, resumes, cancels and refuses a terms change through PATCH', async () => {
    const plan = await createPlan();
    const contract = await jsonOf<Subscription>(
      await billing('POST', '/subscriptions', {
        userId: STUDENT_ID,
        planId: plan.id,
        dueDay: 10,
        startDate: '2026-01-01',
      }),
      201,
    );

    const paused = await jsonOf<Subscription>(
      await billing('PATCH', `/subscriptions/${contract.id}`, { action: 'pause' }),
      200,
    );
    expect(paused.status).toBe('paused');

    const resumed = await jsonOf<Subscription>(
      await billing('PATCH', `/subscriptions/${contract.id}`, { action: 'resume' }),
      200,
    );
    expect(resumed.status).toBe('active');

    // Terms do not move through here.
    const termsAttempt = await billing('PATCH', `/subscriptions/${contract.id}`, {
      action: 'pause',
      amountMinor: 1,
    });
    expect(termsAttempt.status).toBe(400);
    expect(JSON.stringify(await termsAttempt.json())).toContain('/amend');

    const cancelled = await jsonOf<Subscription>(
      await billing('PATCH', `/subscriptions/${contract.id}`, {
        action: 'cancel',
        endDate: '2026-06-30',
      }),
      200,
    );
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.endDate).toBe('2026-06-30');
  });

  it('amends by superseding, and refuses amending the superseded version', async () => {
    const plan = await createPlan();
    const original = await jsonOf<Subscription>(
      await billing('POST', '/subscriptions', {
        userId: STUDENT_ID,
        planId: plan.id,
        dueDay: 10,
        startDate: '2026-01-01',
      }),
      201,
    );

    const amended = await jsonOf<Subscription>(
      await billing('POST', `/subscriptions/${original.id}/amend`, {
        startDate: '2026-07-01',
        termsNote: 'Annual readjustment.',
        amountMinor: 17000,
      }),
      201,
    );
    expect(amended).toMatchObject({
      status: 'active',
      supersedesId: original.id,
      contractGroupId: original.contractGroupId,
      amountMinor: 17000,
    });

    const group = await jsonOf<Subscription[]>(
      await billing('GET', `/subscriptions?contractGroupId=${original.contractGroupId}`),
      200,
    );
    expect(group).toHaveLength(2);
    const closed = group.find((s) => s.id === original.id)!;
    expect(closed.status).toBe('superseded');
    expect(closed.endDate).toBe('2026-07-01');

    const again = await billing('POST', `/subscriptions/${original.id}/amend`, {
      startDate: '2026-08-01',
      termsNote: 'Second.',
    });
    expect(again.status).toBe(409);
  });

  it('leaves a signed contract and its invoices untouched when the plan is edited', async () => {
    const plan = await createPlan();
    const contract = await jsonOf<Subscription>(
      await billing('POST', '/subscriptions', {
        userId: STUDENT_ID,
        planId: plan.id,
        dueDay: 10,
        startDate: '2026-01-01',
      }),
      201,
    );
    const invoice = await jsonOf<Invoice>(
      await billing('POST', '/invoices', {
        subscriptionId: contract.id,
        referenceDate: '2026-04-05',
      }),
      201,
    );

    const edited = await jsonOf<Plan>(
      await billing('PATCH', `/plans/${plan.id}`, { amountMinor: 99900, graceDays: 30 }),
      200,
    );
    expect(edited).toMatchObject({ amountMinor: 99900, graceDays: 30 });

    const [reread] = await jsonOf<Subscription[]>(
      await billing('GET', `/subscriptions?userId=${STUDENT_ID}&status=active`),
      200,
    );
    expect(reread).toMatchObject({ id: contract.id, amountMinor: 15000, graceDays: 5 });

    const invoices = await jsonOf<Invoice[]>(
      await billing('GET', `/invoices?userId=${STUDENT_ID}`),
      200,
    );
    expect(invoices.find((i) => i.id === invoice.id)).toMatchObject({
      amountMinor: 15000,
      graceDays: 5,
    });
  });

  it('lists and filters plans', async () => {
    const plan = await createPlan(2500, 0);
    const archived = await jsonOf<Plan>(
      await billing('PATCH', `/plans/${plan.id}`, { archived: true }),
      200,
    );
    expect(archived.archived).toBe(true);

    const live = await jsonOf<Plan[]>(await billing('GET', '/plans?archived=false'), 200);
    expect(live.map((p) => p.id)).not.toContain(plan.id);

    const shelved = await jsonOf<Plan[]>(await billing('GET', '/plans?archived=true'), 200);
    expect(shelved.map((p) => p.id)).toContain(plan.id);
  });

  it('404s an unknown plan and 400s an unknown currency', async () => {
    expect((await billing('PATCH', '/plans/nope', { amountMinor: 1 })).status).toBe(404);
    expect(
      (
        await billing('POST', '/plans', {
          name: 'Bad',
          amountMinor: 1,
          currency: 'XYZ',
          cycle: 'monthly',
          graceDays: 0,
        })
      ).status,
    ).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// The role matrix — asserted PER ROUTE, not once
// ---------------------------------------------------------------------------

/**
 * Every route the billing sub-router mounts. A route added to `billing.ts`
 * without being added here is the regression this list exists to make
 * impossible to land quietly — keep the two in step.
 */
const ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
  { method: 'GET', path: '/plans' },
  { method: 'POST', path: '/plans', body: {} },
  { method: 'PATCH', path: '/plans/some-id', body: {} },
  { method: 'GET', path: '/subscriptions' },
  { method: 'POST', path: '/subscriptions', body: {} },
  { method: 'PATCH', path: '/subscriptions/some-id', body: {} },
  { method: 'POST', path: '/subscriptions/some-id/amend', body: {} },
  { method: 'GET', path: '/invoices' },
  { method: 'POST', path: '/invoices', body: {} },
  { method: 'POST', path: '/invoices/some-id/void', body: {} },
  { method: 'POST', path: '/invoices/some-id/adjustments', body: {} },
  { method: 'POST', path: '/invoices/some-id/payments', body: {} },
  { method: 'POST', path: '/payments/some-id/reverse', body: {} },
  // Task 04's read-only reports. They carry no body and still sit behind the
  // same guard — the whole point of enumerating every route here.
  { method: 'GET', path: '/reports/movement?month=2026-08' },
  { method: 'GET', path: '/reports/aging' },
  { method: 'GET', path: '/students/some-id/statement' },
  // Task 05's roster and holds. The roster is a listing and a hold is a label;
  // neither gates anything, and both are still ADMIN-only because they are the
  // dojo's money.
  { method: 'GET', path: '/students' },
  { method: 'POST', path: '/holds/some-id', body: {} },
  { method: 'DELETE', path: '/holds/some-id' },
  // Task 06's manual twin of the cron. It is the one route here that writes
  // across every student at once, so it is the last one that should be
  // reachable by a content_creator.
  { method: 'POST', path: '/invoices/run', body: {} },
  // M30 Task 08: a checkout on a student's behalf hands out a link that
  // collects money, so it is the admin's alone.
  { method: 'POST', path: '/invoices/some-id/checkouts', body: {} },
];

describe('/v1/admin/billing — ADMIN-only on every route', () => {
  // The blanket `/v1/admin/*` guard is requireRole(ADMIN, CONTENT_CREATOR), so
  // content_creator is the role this sub-router's own guard exists to stop.
  const forbidden: Array<[string, () => string]> = [
    ['content_creator', () => creatorToken],
    ['tutor', () => tutorToken],
    ['student', () => studentToken],
  ];

  for (const [role, tokenOf] of forbidden) {
    for (const route of ROUTES) {
      it(`403s a ${role} on ${route.method} ${route.path}`, async () => {
        const res = await billing(route.method, route.path, route.body, tokenOf());
        expect(res.status).toBe(403);
      });
    }
  }

  it('401s an anonymous caller on every route', async () => {
    for (const route of ROUTES) {
      const res = await billing(route.method, route.path, route.body, '');
      expect(res.status).toBe(401);
    }
  });

  it('lets an admin through', async () => {
    expect((await billing('GET', '/plans')).status).toBe(200);
    expect((await billing('GET', '/subscriptions')).status).toBe(200);
    expect((await billing('GET', '/invoices')).status).toBe(200);
    expect((await billing('GET', '/students')).status).toBe(200);
  });

  /**
   * The other half of the matrix. A student is refused every admin billing
   * route above and is *not* refused their own statement — the two live behind
   * different guards on purpose, and neither is a guard on anything else.
   */
  it('still lets the same student read their own statement', async () => {
    const request = new IncomingRequest(`http://example.com${v1('/me/billing')}`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(request, env as AppEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    expect((await res.json<{ userId: string }>()).userId).toBe(STUDENT_ID);
  });
});

describe('/v1/admin/billing/invoices/run — the extras rail in the report', () => {
  it('carries extrasReminders, extrasCrossings and per-rail reminderCounts', async () => {
    const eventId = crypto.randomUUID();
    await env.DB
      .prepare(
        `INSERT INTO events (id, slug, title, starts_at, status, audience, created_by)
         VALUES (?, ?, 'Run Seminar', '2031-01-01 19:00:00', 'published', 'members', ?)`,
      )
      .bind(eventId, `run-seminar-${eventId}`, ADMIN_ID)
      .run();

    await jsonOf(
      await billing('PUT', `/event-prices/${eventId}`, { amountMinor: 8000, graceDays: 2 }),
      200,
    );
    const issued = await jsonOf<{ created: Array<{ id: string }> }>(
      await billing('POST', '/charges', {
        eventId,
        userIds: [SECOND_STUDENT_ID],
        dueDate: '2031-02-10',
      }),
      201,
    );
    const chargeId = issued.created[0].id;

    type RunReport = {
      reminders: Array<{ kind: string }>;
      extrasReminders: Array<{ chargeId: string; kind: string; description: string; sent: boolean }>;
      extrasCrossings: Array<{ userId: string; from: string; to: string }>;
      reminderCounts: {
        contract: { sent: number; suppressed: number; undeliverable: number };
        extras: { sent: number; suppressed: number; undeliverable: number };
      };
    };
    const report = await jsonOf<RunReport>(
      await billing('POST', '/invoices/run', { asOf: '2031-02-10' }),
      200,
    );

    const ours = report.extrasReminders.filter((line) => line.chargeId === chargeId);
    expect(ours).toEqual([
      expect.objectContaining({ kind: 'extras_due_date', description: 'Run Seminar', sent: true }),
    ]);
    expect(report.reminders.every((line) => !line.kind.startsWith('extras_'))).toBe(true);
    expect(report.extrasCrossings).toContainEqual(
      expect.objectContaining({ userId: SECOND_STUDENT_ID, from: 'good', to: 'due' }),
    );
    expect(report.reminderCounts.extras.suppressed).toBe(0);
    expect(report.reminderCounts.extras.sent).toBeGreaterThanOrEqual(1);
    expect(Object.keys(report.reminderCounts.contract).sort()).toEqual([
      'sent',
      'suppressed',
      'undeliverable',
    ]);
  });
});

// ---------------------------------------------------------------------------
// The payment gateway, admin side (RFC 0026 §3, §5, §7) — contract rail
// ---------------------------------------------------------------------------

describe('/v1/admin/billing — checkouts on behalf and gateway refunds', () => {
  type Session = { checkoutId: string; provider: string; url: string; expiresAt: string; amountMinor: number; status: string };
  type LedgerRow = {
    id: string;
    amountMinor: number;
    method: string;
    externalReference: string | null;
    reversesId: string | null;
    recordedBy: string;
    note: string;
  };

  let mp: StubGatewayAdapter;
  let app: PaymentsTestApp;
  let world: GatewayWorld;

  const viaApp = (method: string, path: string, body?: unknown, token = adminToken) =>
    billing(method, path, body, token, app);

  /** The invoice's whole ledger, exactly as stored — for "byte-for-byte unchanged". */
  async function ledger(): Promise<string> {
    const { results } = await env.DB
      .prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY id')
      .bind(world.invoiceId)
      .all();
    return JSON.stringify(results);
  }

  async function reversalsOf(paymentId: string): Promise<Array<{ id: string; external_reference: string }>> {
    const { results } = await env.DB
      .prepare('SELECT id, external_reference FROM payments WHERE reverses_id = ?')
      .bind(paymentId)
      .all<{ id: string; external_reference: string }>();
    return results;
  }

  /** A landed gateway payment of the invoice, known to the provider under the same id. */
  async function landed(): Promise<{ id: string; providerId: string }> {
    const providerId = `pay-${crypto.randomUUID()}`;
    const id = await insertInvoicePayment(world, { method: 'gateway', externalReference: `mercadopago:${providerId}` });
    mp.setPayment(stubPayment({ id: providerId, amountMinor: 15000 }));
    return { id, providerId };
  }

  const reverse = (paymentId: string, token = adminToken) =>
    viaApp('POST', `/payments/${paymentId}/reverse`, { reason: 'Asked for it back.' }, token);

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mp = new StubGatewayAdapter('mercadopago');
    app = buildPaymentsTestApp(env as Env, 'mercadopago:pix+card', [mp]);
    world = await seedGatewayWorld();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /invoices/{id}/checkouts', () => {
    it('opens the checkout for the invoice\'s student, records the admin as its creator, and hands it back on a second call', async () => {
      const res = await viaApp('POST', `/invoices/${world.invoiceId}/checkouts`, {});
      const session = await jsonOf<Session>(res, 201);

      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(session).toMatchObject({
        provider: 'mercadopago',
        url: `https://pay.mercadopago.invalid/checkout/${session.checkoutId}`,
        amountMinor: 15000,
        status: 'open',
      });
      const row = await env.DB
        .prepare('SELECT user_id, created_by, receivable_kind, receivable_id FROM gateway_checkouts WHERE id = ?')
        .bind(session.checkoutId)
        .first();
      expect(row).toEqual({
        user_id: world.studentId,
        created_by: ADMIN_ID,
        receivable_kind: 'invoice',
        receivable_id: world.invoiceId,
      });
      // The hosted page is opened for the student, not the admin.
      expect(mp.callsTo('createCheckout')[0].req.payer.id).toBe(world.studentId);

      const again = await jsonOf<Session>(
        await viaApp('POST', `/invoices/${world.invoiceId}/checkouts`, { provider: 'mercadopago' }),
        200,
      );
      expect(again.checkoutId).toBe(session.checkoutId);
      expect(mp.callsTo('createCheckout')).toHaveLength(1);

      // The student's hourly budget was never touched.
      const budget = await env.RATE_LIMIT_KV.list({ prefix: 'rl:checkouts:' });
      expect(budget.keys.filter((key) => key.name.includes(world.studentId))).toEqual([]);

      // The admin statement lists it under the invoice.
      const statement = await jsonOf<{ invoices: Array<{ id: string; pendingCheckout: { createdBy: string } | null }> }>(
        await viaApp('GET', `/students/${world.studentId}/statement`),
        200,
      );
      expect(statement.invoices.find((invoice) => invoice.id === world.invoiceId)?.pendingCheckout).toMatchObject({
        checkoutId: session.checkoutId,
        createdBy: ADMIN_ID,
      });
    });

    it('refuses in the student route\'s order: 400 body, 400 provider, 404 invoice, 409 not payable, 502 provider', async () => {
      const path = `/invoices/${world.invoiceId}/checkouts`;
      expect((await viaApp('POST', path, { userId: world.studentId })).status).toBe(400);

      const unknown = await viaApp('POST', path, { provider: 'stripe' });
      expect(unknown.status).toBe(400);
      expect(await unknown.json()).toEqual({ error: 'PAYMENT_PROVIDER_REQUIRED' });

      expect((await viaApp('POST', '/invoices/nope/checkouts', {})).status).toBe(404);
      // An event charge id is not an invoice.
      expect((await viaApp('POST', `/invoices/${world.chargeId}/checkouts`, {})).status).toBe(404);

      mp.setCheckoutResult(new Error('boom'));
      const failed = await viaApp('POST', path, {});
      expect(failed.status).toBe(502);
      expect(await failed.json()).toEqual({ error: 'PAYMENTS_PROVIDER_ERROR' });
      mp.setCheckoutResult(null);

      await jsonOf(await viaApp('POST', `/invoices/${world.invoiceId}/void`, { reason: 'mistake' }), 200);
      const voided = await viaApp('POST', path, {});
      expect(voided.status).toBe(409);
      expect(await voided.json()).toEqual({ error: 'RECEIVABLE_NOT_PAYABLE' });
    });

    it('does not exist on a label with no provider (404), and is loud on an invalid list (500)', async () => {
      const none = await billing('POST', `/invoices/${world.invoiceId}/checkouts`, { nonsense: true });
      expect(none.status).toBe(404);

      const invalid = buildPaymentsTestApp(env as Env, 'mercadopago:pix,mercadopago:card', [mp]);
      const res = await billing('POST', `/invoices/${world.invoiceId}/checkouts`, {}, adminToken, invalid);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'PAYMENTS_CONFIG_INVALID' });
    });

    it('403s a content_creator and a tutor before the gate, with a provider bound', async () => {
      for (const token of [creatorToken, tutorToken, studentToken]) {
        expect((await viaApp('POST', `/invoices/${world.invoiceId}/checkouts`, {}, token)).status).toBe(403);
      }
      expect(mp.calls).toHaveLength(0);
    });
  });

  describe('POST /payments/{id}/reverse on a gateway payment', () => {
    it('refunds at the provider, then writes one reversal whose reference is the refund id (200)', async () => {
      const { id, providerId } = await landed();

      const reversal = await jsonOf<LedgerRow>(await reverse(id), 200);

      expect(mp.calls.map((call) => call.method)).toEqual(['getPayment', 'refund']);
      expect(mp.callsTo('refund')[0]).toMatchObject({ paymentId: providerId, amountMinor: 15000, idempotencyKey: `rev:${id}` });
      expect(reversal).toMatchObject({
        amountMinor: -15000,
        method: 'gateway',
        reversesId: id,
        externalReference: 'mercadopago:mercadopago-refund-1',
        recordedBy: ADMIN_ID,
        note: 'Asked for it back.',
      });
      expect(await reversalsOf(id)).toEqual([{ id: reversal.id, external_reference: 'mercadopago:mercadopago-refund-1' }]);
    });

    it('answers 200 twice for the same payment and leaves one reversal row', async () => {
      const { id } = await landed();

      const first = await jsonOf<LedgerRow>(await reverse(id), 200);
      const second = await jsonOf<LedgerRow>(await reverse(id), 200);

      expect(second.id).toBe(first.id);
      expect(await reversalsOf(id)).toHaveLength(1);
      expect(mp.callsTo('refund')).toHaveLength(1);
    });

    it('leaves the ledger byte-for-byte unchanged when the provider refuses (409)', async () => {
      const { id } = await landed();
      const before = await ledger();
      mp.failRefunds(new Error('funds unavailable'));

      const res = await reverse(id);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'PAYMENTS_REFUND_REFUSED' });
      expect(await ledger()).toBe(before);
    });

    it('records a refund already made at the provider without asking for another (200, one row)', async () => {
      const { id, providerId } = await landed();
      mp.setPayment(
        stubPayment({
          id: providerId,
          amountMinor: 15000,
          status: 'refunded',
          refunds: [{ id: 'dash-1', amountMinor: 15000, createdAt: '2026-01-25T18:30:00.000Z' }],
        }),
      );

      const reversal = await jsonOf<LedgerRow & { paidAt: string }>(await reverse(id), 200);

      expect(mp.callsTo('refund')).toHaveLength(0);
      expect(reversal).toMatchObject({ reversesId: id, externalReference: 'mercadopago:dash-1', paidAt: '2026-01-25' });
      expect(await reversalsOf(id)).toHaveLength(1);
    });

    it('says an unrecorded refund out loud (503), and the same request then completes it', async () => {
      const { id } = await landed();
      const before = await ledger();
      // The store refuses the reversal insert, as an outage between the two steps would.
      await env.DB
        .prepare(
          `CREATE TRIGGER fail_reversal BEFORE INSERT ON payments WHEN NEW.reverses_id IS NOT NULL
           BEGIN SELECT RAISE(ABORT, 'store unavailable'); END`,
        )
        .run();
      let lost: Response;
      try {
        lost = await reverse(id);
      } finally {
        await env.DB.prepare('DROP TRIGGER fail_reversal').run();
      }

      expect(lost.status).toBe(503);
      expect(await lost.json()).toEqual({ error: 'PAYMENTS_REFUND_UNRECORDED', refundId: 'mercadopago-refund-1' });
      expect(await ledger()).toBe(before);

      const reversal = await jsonOf<LedgerRow>(await reverse(id), 200);

      expect(reversal).toMatchObject({ reversesId: id, externalReference: 'mercadopago:mercadopago-refund-1' });
      expect(mp.callsTo('refund')).toHaveLength(1);
      expect(await reversalsOf(id)).toHaveLength(1);
    });

    it('409s PAYMENTS_PROVIDER_NOT_ENABLED when the provider is no longer bound, writing nothing', async () => {
      const { id } = await landed();
      const before = await ledger();

      // The real Worker: `PAYMENTS_PROVIDERS = none`.
      const res = await billing('POST', `/payments/${id}/reverse`, { reason: 'x' });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'PAYMENTS_PROVIDER_NOT_ENABLED' });
      expect(await ledger()).toBe(before);
      expect(mp.calls).toHaveLength(0);
    });

    it('still demands a reason, and 404s an unknown payment', async () => {
      const { id } = await landed();
      expect((await viaApp('POST', `/payments/${id}/reverse`, { reason: ' ' })).status).toBe(400);
      expect((await viaApp('POST', '/payments/nope/reverse', { reason: 'x' })).status).toBe(404);
      expect(mp.calls).toHaveLength(0);
    });

    it('403s a content_creator and a tutor, with no provider call', async () => {
      const { id } = await landed();
      for (const token of [creatorToken, tutorToken]) {
        expect((await reverse(id, token)).status).toBe(403);
      }
      expect(mp.calls).toHaveLength(0);
    });
  });

  describe('every other method', () => {
    it('reverses a cash payment exactly as before: 201, the mirror row, and no provider call', async () => {
      const cash = await jsonOf<LedgerRow>(
        await viaApp('POST', `/invoices/${world.invoiceId}/payments`, {
          amountMinor: 5000,
          method: 'cash',
          externalReference: 'receipt 12',
        }),
        201,
      );

      const reversal = await jsonOf<LedgerRow>(await reverse(cash.id), 201);

      expect(reversal).toMatchObject({
        amountMinor: -5000,
        method: 'cash',
        reversesId: cash.id,
        externalReference: 'receipt 12',
      });
      expect((await reverse(cash.id)).status).toBe(409);
      expect(mp.calls).toHaveLength(0);
    });

    it('records a cash payment on an invoice with an open checkout, and says the checkout is open', async () => {
      const path = `/invoices/${world.invoiceId}/payments`;
      const without = await jsonOf<LedgerRow & { pendingCheckout: unknown }>(
        await viaApp('POST', path, { amountMinor: 1000, method: 'cash' }),
        201,
      );
      expect(without.pendingCheckout).toBeNull();

      const session = await jsonOf<Session>(await viaApp('POST', `/invoices/${world.invoiceId}/checkouts`, {}), 201);
      const paid = await jsonOf<LedgerRow & { pendingCheckout: Record<string, unknown> | null }>(
        await viaApp('POST', path, { amountMinor: 14000, method: 'cash' }),
        201,
      );

      expect(paid).toMatchObject({ amountMinor: 14000, method: 'cash' });
      expect(paid.pendingCheckout).toEqual({
        checkoutId: session.checkoutId,
        provider: 'mercadopago',
        createdAt: expect.any(String),
        expiresAt: session.expiresAt,
        createdBy: ADMIN_ID,
      });
      // The checkout is left for the reconcile run; recording cash closes nothing.
      const row = await env.DB.prepare('SELECT status FROM gateway_checkouts WHERE id = ?').bind(session.checkoutId).first();
      expect(row).toEqual({ status: 'open' });
    });
  });
});
