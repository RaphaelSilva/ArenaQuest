import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';
import { buildPaymentsTestApp, type PaymentsTestApp } from '../adapters/payment/payments-test-app';
import { StubGatewayAdapter, stubPayment, stubSecretKey } from '../adapters/payment/stub-gateway-adapter';
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
  // M30 Task 09: the reconcile run asks providers and lands money; the
  // exceptions list names students and what they paid.
  { method: 'POST', path: '/payments/reconcile' },
  { method: 'GET', path: '/payments/exceptions' },
  { method: 'POST', path: '/payments/exceptions/dismiss', body: {} },
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

// ---------------------------------------------------------------------------
// M30 Task 09 — the reconcile run and the exceptions list, on a real D1
// ---------------------------------------------------------------------------

describe('/v1/admin/billing/payments — reconcile and exceptions', () => {
  type Summary = Record<string, number>;
  type Run = { status: 'ok' | 'failed'; error: string | null; summary: Summary };
  type Exception = {
    ref: string;
    kind: string;
    source: string;
    provider: string;
    eventId: string | null;
    eventType: string | null;
    providerPaymentId: string | null;
    checkoutId: string | null;
    attempts: number | null;
    detail: string | null;
    occurredAt: string;
    receivable: { kind: string; id: string; userId: string; studentName: string | null; amountMinor: number; currency: string } | null;
  };
  type CheckoutRow = {
    status: string;
    provider_payment_id: string | null;
    invoice_payment_id: string | null;
    last_checked_at: string | null;
    closed_at: string | null;
    failure_detail: string | null;
    dismissed_at: string | null;
    dismissed_by: string | null;
    dismiss_note: string | null;
  };
  type EventRow = {
    outcome: string;
    attempts: number;
    error: string | null;
    checkout_id: string | null;
    dismissed_at: string | null;
    dismissed_by: string | null;
    dismiss_note: string | null;
  };

  let mp: StubGatewayAdapter;
  let app: PaymentsTestApp;
  let world: GatewayWorld;

  const viaApp = (method: string, path: string, body?: unknown, token = adminToken) =>
    billing(method, path, body, token, app);
  const reconcile = async (): Promise<Run> => jsonOf<Run>(await viaApp('POST', '/payments/reconcile'), 200);
  const exceptions = async (): Promise<Exception[]> =>
    (await jsonOf<{ exceptions: Exception[] }>(await viaApp('GET', '/payments/exceptions'), 200)).exceptions;
  const dismiss = (ref: unknown, note: unknown, token = adminToken) =>
    viaApp('POST', '/payments/exceptions/dismiss', { ref, note }, token);

  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const ahead = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

  /** A checkout row written straight to the table, so its age can be chosen. */
  async function insertCheckout(overrides: {
    id?: string;
    provider?: string;
    receivableId?: string;
    status?: string;
    session?: string | null;
    createdAt?: string;
    expiresAt?: string;
    closedAt?: string | null;
    lastCheckedAt?: string | null;
    failureDetail?: string | null;
    providerPaymentId?: string | null;
    updatedAt?: string;
  } = {}): Promise<{ id: string; session: string | null }> {
    const id = overrides.id ?? crypto.randomUUID();
    const session = overrides.session === undefined ? `session-${id}` : overrides.session;
    const createdAt = overrides.createdAt ?? ago(40);
    await env.DB
      .prepare(
        `INSERT INTO gateway_checkouts
           (id, provider, receivable_kind, receivable_id, user_id, created_by, amount_minor, currency, status,
            provider_session_id, provider_payment_id, checkout_url, expires_at, created_at, updated_at, closed_at,
            last_checked_at, failure_detail)
         VALUES (?, ?, 'invoice', ?, ?, ?, 15000, 'BRL', ?, ?, ?, 'https://pay.invalid/x', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        overrides.provider ?? 'mercadopago',
        overrides.receivableId ?? world.invoiceId,
        world.studentId,
        world.studentId,
        overrides.status ?? 'open',
        session,
        overrides.providerPaymentId ?? null,
        overrides.expiresAt ?? ahead(600),
        createdAt,
        overrides.updatedAt ?? createdAt,
        overrides.closedAt ?? null,
        overrides.lastCheckedAt ?? null,
        overrides.failureDetail ?? null,
      )
      .run();
    return { id, session };
  }

  async function insertEvent(overrides: {
    eventId?: string;
    provider?: string;
    type?: string;
    outcome?: string;
    providerPaymentId?: string | null;
    checkoutId?: string | null;
    receivedAt?: string;
    attempts?: number;
    error?: string | null;
  } = {}): Promise<string> {
    const eventId = overrides.eventId ?? `evt-${crypto.randomUUID()}`;
    await env.DB
      .prepare(
        `INSERT INTO gateway_events (provider, event_id, type, provider_payment_id, checkout_id, received_at, outcome, attempts, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        overrides.provider ?? 'mercadopago',
        eventId,
        overrides.type ?? 'payment',
        overrides.providerPaymentId === undefined ? `pay-${eventId}` : overrides.providerPaymentId,
        overrides.checkoutId ?? null,
        overrides.receivedAt ?? ago(20),
        overrides.outcome ?? 'failed',
        overrides.attempts ?? 1,
        overrides.error ?? null,
      )
      .run();
    return eventId;
  }

  const checkoutRow = (id: string) =>
    env.DB.prepare('SELECT * FROM gateway_checkouts WHERE id = ?').bind(id).first<CheckoutRow>();
  const eventRow = (eventId: string) =>
    env.DB.prepare('SELECT * FROM gateway_events WHERE event_id = ?').bind(eventId).first<EventRow>();
  async function gatewayLedger(): Promise<Array<{ id: string; amount_minor: number; external_reference: string; recorded_by: string }>> {
    const { results } = await env.DB
      .prepare(`SELECT id, amount_minor, external_reference, recorded_by FROM payments WHERE invoice_id = ? AND method = 'gateway'`)
      .bind(world.invoiceId)
      .all<{ id: string; amount_minor: number; external_reference: string; recorded_by: string }>();
    return results;
  }
  async function jobRuns(): Promise<Array<{ job: string; trigger: string; status: string; actor_id: string | null; summary: string | null; error: string | null }>> {
    const { results } = await env.DB
      .prepare('SELECT job, trigger, status, actor_id, summary, error FROM job_runs ORDER BY started_at, id')
      .all<{ job: string; trigger: string; status: string; actor_id: string | null; summary: string | null; error: string | null }>();
    return results;
  }

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // The work lists are global: start every case from empty gateway tables.
    await env.DB.exec('DELETE FROM gateway_events');
    await env.DB.exec('DELETE FROM gateway_checkouts');
    await env.DB.exec('DELETE FROM job_runs');
    mp = new StubGatewayAdapter('mercadopago');
    app = buildPaymentsTestApp(env as Env, 'mercadopago:pix+card', [mp]);
    world = await seedGatewayWorld();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /payments/reconcile', () => {
    it('lands a payment whose webhook never arrived, while its checkout is still unexpired', async () => {
      const { id, session } = await insertCheckout();
      mp.setPayment(stubPayment({ id: 'pay-missed', amountMinor: 15000, checkoutId: id }), session!);

      const res = await viaApp('POST', '/payments/reconcile');
      const run = await jsonOf<Run>(res, 200);

      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(run).toMatchObject({ status: 'ok', error: null });
      expect(run.summary).toMatchObject({ checkoutsDue: 1, checkoutsAsked: 1, landed: 1, checkoutsDeferred: 0 });
      expect(mp.calls).toEqual([{ method: 'findPaymentsForCheckout', sessionId: session }]);

      const ledger = await gatewayLedger();
      expect(ledger).toEqual([
        { id: expect.any(String), amount_minor: 15000, external_reference: 'mercadopago:pay-missed', recorded_by: 'system:payment-gateway' },
      ]);
      expect(await checkoutRow(id)).toMatchObject({
        status: 'paid',
        provider_payment_id: 'pay-missed',
        invoice_payment_id: ledger[0].id,
        last_checked_at: expect.any(String),
      });
      // No delivery was ever received: the run writes no gateway_events row.
      expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM gateway_events').first()).toEqual({ n: 0 });

      const runs = await jobRuns();
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ job: 'reconcile_payments', trigger: 'manual', status: 'ok', actor_id: ADMIN_ID, error: null });
      expect(JSON.parse(runs[0].summary ?? 'null')).toEqual(run.summary);

      // A second run finds the payment already on the ledger and changes nothing.
      const again = await reconcile();
      expect(again.summary).toMatchObject({ checkoutsDue: 0, landed: 0 });
      expect(await gatewayLedger()).toHaveLength(1);
    });

    it('with 30 due asks about 25, defers 5, and the next run takes those 5 first', async () => {
      const sessions: string[] = [];
      for (let i = 0; i < 30; i++) {
        // Distinct receivables (one open checkout each), oldest first.
        const { session } = await insertCheckout({ receivableId: `inv-${i}`, createdAt: ago(200 - i) });
        sessions.push(session!);
      }

      const first = await reconcile();

      expect(first.summary).toMatchObject({ checkoutsDue: 30, checkoutsAsked: 25, stillOpen: 25, checkoutsDeferred: 5 });
      expect(mp.callsTo('findPaymentsForCheckout').map((call) => call.sessionId)).toEqual(sessions.slice(0, 25));
      expect(mp.calls.length).toBeLessThanOrEqual(35);

      mp.calls.length = 0;
      const second = await reconcile();

      const asked = mp.callsTo('findPaymentsForCheckout').map((call) => call.sessionId);
      expect(asked.slice(0, 5)).toEqual(sessions.slice(25));
      expect(asked.slice(5)).toEqual(sessions.slice(0, 20));
      expect(second.summary).toMatchObject({ checkoutsDue: 30, checkoutsAsked: 25, checkoutsDeferred: 5 });
      expect(mp.calls.length).toBeLessThanOrEqual(35);
    });

    it('expires an open checkout past its expiry when the provider holds nothing, and does not ask again', async () => {
      const { id } = await insertCheckout({ createdAt: ago(1500), expiresAt: ago(60) });

      const run = await reconcile();

      expect(run.summary).toMatchObject({ checkoutsAsked: 1, expired: 1 });
      expect(await checkoutRow(id)).toMatchObject({ status: 'expired', closed_at: expect.any(String), last_checked_at: expect.any(String) });

      mp.calls.length = 0;
      expect((await reconcile()).summary).toMatchObject({ checkoutsDue: 0, checkoutsAsked: 0 });
      expect(mp.calls).toEqual([]);
    });

    it('lands a late payment on a checkout that was closed without being asked', async () => {
      const closed = await insertCheckout({ status: 'cancelled', createdAt: ago(120), closedAt: ago(90) });
      mp.setPayment(stubPayment({ id: 'pay-late', amountMinor: 15000, checkoutId: closed.id }), closed.session!);
      const quiet = await insertCheckout({ status: 'expired', receivableId: 'inv-quiet', createdAt: ago(120), closedAt: ago(90) });

      const run = await reconcile();

      expect(run.summary).toMatchObject({ checkoutsDue: 2, checkoutsAsked: 2, landed: 1, expired: 0 });
      expect(await checkoutRow(closed.id)).toMatchObject({ status: 'paid', provider_payment_id: 'pay-late' });
      expect(await gatewayLedger()).toEqual([expect.objectContaining({ external_reference: 'mercadopago:pay-late' })]);
      // The quiet one got its single final ask and keeps its status.
      expect(await checkoutRow(quiet.id)).toMatchObject({ status: 'expired', last_checked_at: expect.any(String) });
      expect((await reconcile()).summary.checkoutsDue).toBe(0);
    });

    it('expires a checkout whose provider is no longer bound without asking, and fails the run', async () => {
      const gone = await insertCheckout({ provider: 'stripe' });

      const run = await reconcile();

      expect(run.status).toBe('failed');
      expect(run.error).toMatch(/no longer bound/);
      expect(run.summary).toMatchObject({ unreachable: 1, checkoutsAsked: 0 });
      expect(mp.calls).toEqual([]);
      expect(await checkoutRow(gone.id)).toMatchObject({ status: 'expired', failure_detail: 'provider no longer bound' });
      expect(await jobRuns()).toEqual([
        expect.objectContaining({ job: 'reconcile_payments', trigger: 'manual', status: 'failed', error: run.error }),
      ]);

      // Counted once: the next run is clean.
      expect(await reconcile()).toMatchObject({ status: 'ok', summary: { unreachable: 0, checkoutsDue: 0 } });
    });

    it('closes an open checkout that never got its session as failed, with no provider call', async () => {
      const lost = await insertCheckout({ session: null, createdAt: ago(45) });

      const run = await reconcile();

      expect(run).toMatchObject({ status: 'ok', summary: { abandoned: 1, checkoutsAsked: 0 } });
      expect(mp.calls).toEqual([]);
      expect(await checkoutRow(lost.id)).toMatchObject({ status: 'failed', failure_detail: 'no provider session after 30 minutes' });
    });

    it('retries an event that failed once: it ends applied with attempts = 2', async () => {
      const { id } = await insertCheckout({ createdAt: ago(10) });
      mp.setPayment(stubPayment({ id: 'pay-retry', amountMinor: 15000, checkoutId: id }));
      const eventId = await insertEvent({ providerPaymentId: 'pay-retry', error: 'processing failed (Error)' });

      const run = await reconcile();

      expect(run.summary).toMatchObject({ eventsDue: 1, eventsRetried: 1, eventsSettled: 1, eventsFailed: 0 });
      expect(mp.callsTo('getPayment')).toEqual([{ method: 'getPayment', paymentId: 'pay-retry' }]);
      expect(await eventRow(eventId)).toMatchObject({ outcome: 'applied', attempts: 2, error: null, checkout_id: id });
      expect(await checkoutRow(id)).toMatchObject({ status: 'paid' });
      expect(await gatewayLedger()).toHaveLength(1);
    });

    it('leaves an event the provider still cannot answer as failed, and counts it', async () => {
      const eventId = await insertEvent({});
      mp.failLookups(new Error('provider 503'));

      const run = await reconcile();

      expect(run.summary).toMatchObject({ eventsRetried: 1, eventsFailed: 1, eventsSettled: 0 });
      expect(await eventRow(eventId)).toMatchObject({ outcome: 'failed', attempts: 2 });
    });

    it('a live key under key mode test is 500 PAYMENTS_CONFIG_INVALID, a failed run, and touches nothing', async () => {
      const { id } = await insertCheckout();
      const wrong = buildPaymentsTestApp(env as Env, 'mercadopago:pix+card', [mp], {
        PAYMENTS_MERCADOPAGO_SECRET_KEY: stubSecretKey('mercadopago', 'live'),
      });

      const res = await billing('POST', '/payments/reconcile', undefined, adminToken, wrong);

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'PAYMENTS_CONFIG_INVALID' });
      const runs = await jobRuns();
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ job: 'reconcile_payments', status: 'failed' });
      expect(runs[0].error).toMatch(/^PAYMENTS_CONFIG_INVALID: key_mode_mismatch/);
      expect(runs[0].error).not.toContain(stubSecretKey('mercadopago', 'live'));
      expect(mp.calls).toEqual([]);
      expect(await checkoutRow(id)).toMatchObject({ status: 'open', last_checked_at: null });
    });

    it('on a label with no provider it is 404 and writes no job_runs row', async () => {
      await insertCheckout();

      const res = await billing('POST', '/payments/reconcile');

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'NotFound' });
      expect(await jobRuns()).toEqual([]);
    });

    it('403s a content_creator and a tutor, with no provider call and no run', async () => {
      await insertCheckout();
      for (const token of [creatorToken, tutorToken]) {
        expect((await viaApp('POST', '/payments/reconcile', undefined, token)).status).toBe(403);
      }
      expect(mp.calls).toEqual([]);
      expect(await jobRuns()).toEqual([]);
    });
  });

  describe('GET /payments/exceptions', () => {
    it('lists orphan, mismatch, failed, stale received and disputed rows, oldest first, without calling a provider', async () => {
      const mismatched = await insertCheckout({
        status: 'mismatch',
        providerPaymentId: 'pay-mm',
        failureDetail: 'payment not landed: the receivable is void',
        closedAt: ago(300),
        updatedAt: ago(300),
      });
      const disputed = await insertCheckout({
        status: 'paid',
        receivableId: 'inv-disputed',
        providerPaymentId: 'pay-disp',
        failureDetail: 'dispute opened',
        closedAt: ago(500),
        updatedAt: ago(100),
      });
      const orphan = await insertEvent({ outcome: 'orphan', providerPaymentId: 'pay-orphan', receivedAt: ago(400) });
      const failed = await insertEvent({ outcome: 'failed', attempts: 3, error: 'processing failed (TypeError)', receivedAt: ago(200) });
      const stuck = await insertEvent({ outcome: 'received', receivedAt: ago(90) });
      // Not exceptions: a fresh `received`, and settled outcomes.
      await insertEvent({ outcome: 'received', receivedAt: ago(5) });
      await insertEvent({ outcome: 'applied', receivedAt: ago(600) });
      await insertEvent({ outcome: 'duplicate', receivedAt: ago(600) });
      await insertEvent({ outcome: 'ignored', receivedAt: ago(600) });

      const res = await viaApp('GET', '/payments/exceptions');
      const { exceptions: list } = await jsonOf<{ exceptions: Exception[] }>(res, 200);

      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(mp.calls).toEqual([]);
      expect(list.map((row) => [row.kind, row.source, row.ref])).toEqual([
        ['orphan', 'event', `event:mercadopago:${orphan}`],
        ['mismatch', 'checkout', `checkout:${mismatched.id}`],
        ['failed', 'event', `event:mercadopago:${failed}`],
        ['dispute', 'checkout', `checkout:${disputed.id}`],
        ['received', 'event', `event:mercadopago:${stuck}`],
      ]);

      expect(list[0]).toEqual({
        ref: `event:mercadopago:${orphan}`,
        kind: 'orphan',
        source: 'event',
        provider: 'mercadopago',
        eventId: orphan,
        eventType: 'payment',
        providerPaymentId: 'pay-orphan',
        checkoutId: null,
        attempts: 1,
        detail: null,
        occurredAt: expect.any(String),
        receivable: null,
      });
      expect(list[1]).toEqual({
        ref: `checkout:${mismatched.id}`,
        kind: 'mismatch',
        source: 'checkout',
        provider: 'mercadopago',
        eventId: null,
        eventType: null,
        providerPaymentId: 'pay-mm',
        checkoutId: mismatched.id,
        attempts: null,
        detail: 'payment not landed: the receivable is void',
        occurredAt: expect.any(String),
        receivable: {
          kind: 'invoice',
          id: world.invoiceId,
          userId: world.studentId,
          studentName: 'Student',
          amountMinor: 15000,
          currency: 'BRL',
        },
      });
      expect(list[2]).toMatchObject({ attempts: 3, detail: 'processing failed (TypeError)' });
      expect(list[3]).toMatchObject({ detail: 'dispute opened', providerPaymentId: 'pay-disp' });
    });

    it('answers on a label with no provider too — it only reads the database', async () => {
      const orphan = await insertEvent({ outcome: 'orphan', receivedAt: ago(400) });

      const res = await billing('GET', '/payments/exceptions');
      const { exceptions: list } = await jsonOf<{ exceptions: Exception[] }>(res, 200);

      expect(list.map((row) => row.ref)).toEqual([`event:mercadopago:${orphan}`]);
    });
  });

  describe('POST /payments/exceptions/dismiss', () => {
    it('stores who, when and the note, removes the row from the list, and changes nothing else', async () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      const orphan = await insertEvent({ outcome: 'orphan', receivedAt: ago(400) });
      const other = await insertEvent({ outcome: 'orphan', receivedAt: ago(300) });
      const ref = `event:mercadopago:${orphan}`;
      const ledgerBefore = await env.DB.prepare('SELECT COUNT(*) AS n FROM payments').first();

      const res = await dismiss(ref, '  Matched by hand to the November invoice.  ');
      const body = await jsonOf<{ ref: string; dismissedBy: string; dismissedAt: string }>(res, 200);

      expect(body).toEqual({ ref, dismissedBy: ADMIN_ID, dismissedAt: expect.any(String) });
      expect((await exceptions()).map((row) => row.ref)).toEqual([`event:mercadopago:${other}`]);
      expect(await eventRow(orphan)).toMatchObject({
        outcome: 'orphan',
        attempts: 1,
        dismissed_by: ADMIN_ID,
        dismissed_at: expect.any(String),
        dismiss_note: 'Matched by hand to the November invoice.',
      });
      expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM payments').first()).toEqual(ledgerBefore);
      expect(mp.calls).toEqual([]);

      const audit = info.mock.calls.map((call) => JSON.parse(String(call[0]))).filter((e) => e.event === 'payments.exception_dismissed');
      expect(audit).toEqual([{ event: 'payments.exception_dismissed', actor: ADMIN_ID, ref, at: body.dismissedAt }]);

      // Already dismissed: it is no longer on the list, so there is nothing to dismiss.
      expect((await dismiss(ref, 'again')).status).toBe(404);
    });

    it('dismisses a checkout row and keeps its status', async () => {
      const mismatched = await insertCheckout({ status: 'mismatch', failureDetail: 'currency mismatch', closedAt: ago(50) });

      await jsonOf(await dismiss(`checkout:${mismatched.id}`, 'Refunded at the provider.'), 200);

      expect(await exceptions()).toEqual([]);
      expect(await checkoutRow(mismatched.id)).toMatchObject({
        status: 'mismatch',
        failure_detail: 'currency mismatch',
        dismissed_by: ADMIN_ID,
        dismiss_note: 'Refunded at the provider.',
      });
    });

    it('takes a dismissed row out of the reconcile run\'s stale count', async () => {
      const stale = await insertEvent({ outcome: 'orphan', receivedAt: ago(8 * 24 * 60) });
      await insertEvent({ outcome: 'mismatch', receivedAt: ago(9 * 24 * 60) });
      await insertEvent({ outcome: 'orphan', receivedAt: ago(6 * 24 * 60) });

      expect((await reconcile()).summary).toMatchObject({ staleOrphans: 1, staleMismatches: 1 });

      await jsonOf(await dismiss(`event:mercadopago:${stale}`, 'Known test payment.'), 200);

      expect((await reconcile()).summary).toMatchObject({ staleOrphans: 0, staleMismatches: 1 });
      expect(await eventRow(stale)).toMatchObject({ outcome: 'orphan' });
    });

    it('400s a blank or over-long note, an unknown key and a malformed ref; 404s a ref that is not on the list', async () => {
      const orphan = await insertEvent({ outcome: 'orphan', receivedAt: ago(400) });
      const applied = await insertEvent({ outcome: 'applied', receivedAt: ago(400) });
      const ref = `event:mercadopago:${orphan}`;

      expect((await dismiss(ref, '')).status).toBe(400);
      expect((await dismiss(ref, '   ')).status).toBe(400);
      expect((await dismiss(ref, 'x'.repeat(501))).status).toBe(400);
      expect((await dismiss(ref, undefined)).status).toBe(400);
      expect((await viaApp('POST', '/payments/exceptions/dismiss', { ref, note: 'ok', status: 'applied' })).status).toBe(400);
      expect((await dismiss('not-a-ref', 'ok')).status).toBe(400);
      expect((await dismiss('event:paypal:1', 'ok')).status).toBe(400);

      expect((await dismiss('event:mercadopago:nope', 'ok')).status).toBe(404);
      expect((await dismiss('checkout:nope', 'ok')).status).toBe(404);
      // A settled event exists but is not an exception: it cannot be dismissed.
      expect((await dismiss(`event:mercadopago:${applied}`, 'ok')).status).toBe(404);
      expect(await eventRow(applied)).toMatchObject({ dismissed_at: null });

      expect((await dismiss(ref, 'x'.repeat(500))).status).toBe(200);
    });

    it('403s a content_creator and a tutor and dismisses nothing', async () => {
      const orphan = await insertEvent({ outcome: 'orphan', receivedAt: ago(400) });
      for (const token of [creatorToken, tutorToken]) {
        expect((await dismiss(`event:mercadopago:${orphan}`, 'ok', token)).status).toBe(403);
        expect((await viaApp('GET', '/payments/exceptions', undefined, token)).status).toBe(403);
      }
      expect(await eventRow(orphan)).toMatchObject({ dismissed_at: null });
    });
  });
});
