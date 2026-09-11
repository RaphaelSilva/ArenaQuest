import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';

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
