import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';
import { seedGatewayWorld, type GatewayWorld } from '../db/gateway-fixtures';
import { buildPaymentsTestApp, type PaymentsTestApp } from '../adapters/payment/payments-test-app';
import { StubGatewayAdapter, stubPayment } from '../adapters/payment/stub-gateway-adapter';
import type { ProviderEvent } from '@arenaquest/shared/ports/i-payment-gateway';

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
  options: { token?: string; body?: unknown; headers?: Record<string, string>; app?: PaymentsTestApp } = {},
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
  // `app` is the same Worker app with stub payment adapters bound; without it
  // the real Worker answers, whose provider list is always `none`.
  const res = options.app
    ? await options.app.fetch(request, ctx)
    : await worker.fetch(request, env as AppEnv, ctx);
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

// ---------------------------------------------------------------------------
// Checkouts and pay options (RFC 0026 §3, §7)
// ---------------------------------------------------------------------------

/**
 * `POST /v1/me/billing/checkouts`, `GET /v1/me/billing/checkouts/{id}` and the
 * statement's `payOptions` / `pendingCheckout`, over HTTP against real D1.
 *
 * The real Worker binds no provider (the production adapter map is empty), so
 * it is what "a label under `none`" is tested on. Everything that needs a
 * provider goes through the same app with **stub** adapters bound under real
 * provider names. The rules themselves — reuse, the five-minute boundary, the
 * stored expiry — are asserted in `test/core/payments/gateway-service.spec.ts`;
 * here it is the HTTP contract, the wiring and the real unique index.
 */

type Session = {
  checkoutId: string;
  provider: string;
  url: string;
  expiresAt: string;
  amountMinor: number;
  currency: string;
  status: string;
};

type CheckoutStatus = {
  checkoutId: string;
  provider: string;
  kind: string;
  receivableId: string;
  status: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
  expiresAt: string;
  closedAt: string | null;
};

type Pending = { checkoutId: string; provider: string; createdAt: string; expiresAt: string; createdBy: string };

type PayStatement = {
  payOptions: Array<{ provider: string; methods: string[] }>;
  invoices: Array<{ id: string; pendingCheckout: Pending | null }>;
  extras: { charges: Array<{ id: string; pendingCheckout: Pending | null }> };
};

describe('checkouts and pay options', () => {
  let mp: StubGatewayAdapter;
  let stripe: StubGatewayAdapter;
  /** One provider offering two methods. */
  let one: PaymentsTestApp;
  /** Two providers, listed with Stripe first. */
  let two: PaymentsTestApp;
  /** A list that names a provider twice. */
  let invalid: PaymentsTestApp;
  let world: GatewayWorld;
  let token: string;
  let other: GatewayWorld;
  let otherWorldToken: string;

  const signer = () => new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  const tokenFor = (userId: string, roles: string[] = ['student']) =>
    signer().signAccessToken({ sub: userId, email: `${userId}@example.com`, roles });

  const rowsFor = async (receivableId: string) =>
    (
      await env.DB.prepare(
        'SELECT id, provider, status, provider_session_id AS session, failure_detail AS detail FROM gateway_checkouts WHERE receivable_id = ? ORDER BY created_at, id',
      )
        .bind(receivableId)
        .all<{ id: string; provider: string; status: string; session: string | null; detail: string | null }>()
    ).results;

  const pay = (app: PaymentsTestApp | undefined, bearer: string, body: unknown) =>
    call('POST', '/me/billing/checkouts', { token: bearer, body, app });

  beforeEach(async () => {
    mp = new StubGatewayAdapter('mercadopago');
    stripe = new StubGatewayAdapter('stripe');
    one = buildPaymentsTestApp(env as Env, 'mercadopago:pix+card', [mp]);
    two = buildPaymentsTestApp(env as Env, 'stripe:card,mercadopago:pix', [mp, stripe]);
    invalid = buildPaymentsTestApp(env as Env, 'mercadopago:pix,mercadopago:card', [mp]);
    world = await seedGatewayWorld();
    other = await seedGatewayWorld();
    [token, otherWorldToken] = await Promise.all([tokenFor(world.studentId), tokenFor(other.studentId)]);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('a label with no provider (`none`)', () => {
    it('404s both checkout routes, whatever the request', async () => {
      for (const body of [{ kind: 'invoice', id: world.invoiceId }, { nonsense: true }, undefined]) {
        const res = await pay(undefined, token, body);
        expect(res.status).toBe(404);
        expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      }
      expect((await call('GET', '/me/billing/checkouts/anything', { token })).status).toBe(404);
      expect(await rowsFor(world.invoiceId)).toEqual([]);
    });

    it('still answers the statement, with no pay option and nothing pending', async () => {
      const mine = await jsonOf<PayStatement>(await call('GET', '/me/billing', { token }), 200);
      expect(mine.payOptions).toEqual([]);
      expect(mine.invoices.map((invoice) => invoice.pendingCheckout)).toEqual([null]);
      expect(mine.extras.charges.map((charge) => charge.pendingCheckout)).toEqual([null]);
    });
  });

  it('401s an anonymous caller on both routes', async () => {
    expect((await pay(one, '', { kind: 'invoice', id: world.invoiceId })).status).toBe(401);
    expect((await call('GET', '/me/billing/checkouts/x', { app: one })).status).toBe(401);
    expect(mp.calls).toHaveLength(0);
  });

  describe('with one provider', () => {
    it('lists the pay option on the student’s and the admin’s statement', async () => {
      const mine = await jsonOf<PayStatement>(await call('GET', '/me/billing', { token, app: one }), 200);
      const admin = await jsonOf<PayStatement>(
        await call('GET', `/admin/billing/students/${world.studentId}/statement`, {
          token: await tokenFor(world.adminId, ['admin']),
          app: one,
        }),
        200,
      );
      expect(mine.payOptions).toEqual([{ provider: 'mercadopago', methods: ['pix', 'card'] }]);
      expect(admin.payOptions).toEqual(mine.payOptions);
    });

    it('opens a hosted checkout for the full balance, then hands the same one back', async () => {
      const first = await pay(one, token, { kind: 'invoice', id: world.invoiceId });
      expect(first.headers.get('Cache-Control')).toBe('private, no-store');
      const created = await jsonOf<Session>(first, 201);

      expect(created).toEqual({
        checkoutId: expect.any(String),
        provider: 'mercadopago',
        url: `https://pay.mercadopago.invalid/checkout/${created.checkoutId}`,
        expiresAt: expect.any(String),
        amountMinor: 15000,
        currency: 'BRL',
        status: 'open',
      });
      // About 24 hours ahead, never more.
      const ahead = Date.parse(created.expiresAt) - Date.now();
      expect(ahead).toBeGreaterThan(23.9 * 3_600_000);
      expect(ahead).toBeLessThanOrEqual(24 * 3_600_000);

      const again = await jsonOf<Session>(await pay(one, token, { kind: 'invoice', id: world.invoiceId }), 200);
      expect(again).toEqual(created);

      expect(mp.callsTo('createCheckout')).toHaveLength(1);
      const request = mp.callsTo('createCheckout')[0].req;
      expect(request).toMatchObject({
        checkoutId: created.checkoutId,
        amountMinor: 15000,
        currency: 'BRL',
        methods: ['pix', 'card'],
        payer: { id: world.studentId, name: 'Student', email: `s-${world.studentId}@example.com` },
      });
      expect(request.returnUrls.success).toMatch(
        new RegExp(`/settings/billing\\?checkout=${created.checkoutId}&outcome=success$`),
      );
      expect(request.returnUrls.cancel).toMatch(/&outcome=cancel$/);
      expect(await rowsFor(world.invoiceId)).toEqual([
        {
          id: created.checkoutId,
          provider: 'mercadopago',
          status: 'open',
          session: `mercadopago-session-${created.checkoutId}`,
          detail: null,
        },
      ]);
    });

    it('reports the checkout’s status from the database, without calling the provider', async () => {
      const created = await jsonOf<Session>(await pay(one, token, { kind: 'invoice', id: world.invoiceId }), 201);
      const callsBefore = mp.calls.length;

      const res = await call('GET', `/me/billing/checkouts/${created.checkoutId}`, { token, app: one });
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      const status = await jsonOf<CheckoutStatus>(res, 200);

      expect(status).toEqual({
        checkoutId: created.checkoutId,
        provider: 'mercadopago',
        kind: 'invoice',
        receivableId: world.invoiceId,
        status: 'open',
        amountMinor: 15000,
        currency: 'BRL',
        createdAt: expect.any(String),
        expiresAt: created.expiresAt,
        closedAt: null,
      });
      // Polled five times, as the return page does: still not one provider call.
      for (let i = 0; i < 5; i++) {
        await call('GET', `/me/billing/checkouts/${created.checkoutId}`, { token, app: one });
      }
      expect(mp.calls).toHaveLength(callsBefore);
    });

    it('shows the pending checkout on the receivable, in both statements, and on nothing else', async () => {
      const created = await jsonOf<Session>(await pay(one, token, { kind: 'invoice', id: world.invoiceId }), 201);

      const mine = await jsonOf<PayStatement>(await call('GET', '/me/billing', { token, app: one }), 200);
      const admin = await jsonOf<PayStatement>(
        await call('GET', `/admin/billing/students/${world.studentId}/statement`, {
          token: await tokenFor(world.adminId, ['admin']),
          app: one,
        }),
        200,
      );

      const pending = {
        checkoutId: created.checkoutId,
        provider: 'mercadopago',
        createdAt: expect.any(String),
        expiresAt: created.expiresAt,
        createdBy: world.studentId,
      };
      expect(mine.invoices.map((invoice) => invoice.pendingCheckout)).toEqual([pending]);
      expect(admin.invoices.map((invoice) => invoice.pendingCheckout)).toEqual([pending]);
      expect(mine.extras.charges.map((charge) => charge.pendingCheckout)).toEqual([null]);
      // The statement never carries the hosted URL.
      expect(JSON.stringify(mine)).not.toContain(created.url);

      const theirs = await jsonOf<PayStatement>(await call('GET', '/me/billing', { token: otherWorldToken, app: one }), 200);
      expect(theirs.invoices.map((invoice) => invoice.pendingCheckout)).toEqual([null]);
    });

    it('closes the checkout when the payment lands: status `paid`, nothing pending', async () => {
      const created = await jsonOf<Session>(await pay(one, token, { kind: 'invoice', id: world.invoiceId }), 201);

      mp.setPayment(stubPayment({ id: 'pay-landed', amountMinor: 15000, checkoutId: created.checkoutId }));
      const event: ProviderEvent = {
        kind: 'payment',
        eventId: `evt-${created.checkoutId}`,
        paymentId: 'pay-landed',
        occurredAt: new Date().toISOString(),
      };
      mp.setWebhookVerdict(event);
      const delivery = await call('POST', '/webhooks/payments/mercadopago', {
        body: {},
        headers: { 'CF-Connecting-IP': '203.0.113.77' },
        app: one,
      });
      expect(await jsonOf<{ outcome: string }>(delivery, 200)).toEqual({ outcome: 'applied' });

      const status = await jsonOf<CheckoutStatus>(
        await call('GET', `/me/billing/checkouts/${created.checkoutId}`, { token, app: one }),
        200,
      );
      expect(status).toMatchObject({ status: 'paid', closedAt: expect.any(String) });

      const mine = await jsonOf<PayStatement & { outstandingMinor: number }>(
        await call('GET', '/me/billing', { token, app: one }),
        200,
      );
      expect(mine.outstandingMinor).toBe(0);
      expect(mine.invoices.map((invoice) => invoice.pendingCheckout)).toEqual([null]);

      // A settled invoice is no longer payable.
      const refused = await pay(one, token, { kind: 'invoice', id: world.invoiceId });
      expect(await jsonOf<{ error: string }>(refused, 409)).toEqual({ error: 'RECEIVABLE_NOT_PAYABLE' });
    });

    it('refuses a void receivable with 409 RECEIVABLE_NOT_PAYABLE', async () => {
      await env.DB.prepare(`UPDATE invoices SET status = 'void' WHERE id = ?`).bind(world.invoiceId).run();
      const refused = await pay(one, token, { kind: 'invoice', id: world.invoiceId });
      expect(await jsonOf<{ error: string }>(refused, 409)).toEqual({ error: 'RECEIVABLE_NOT_PAYABLE' });
      expect(mp.calls).toHaveLength(0);
    });

    it('refuses a currency the provider cannot settle, before calling it', async () => {
      await env.DB.prepare(`UPDATE invoices SET currency = 'USD' WHERE id = ?`).bind(world.invoiceId).run();
      const refused = await pay(one, token, { kind: 'invoice', id: world.invoiceId });
      expect(await jsonOf<{ error: string }>(refused, 409)).toEqual({ error: 'PAYMENTS_UNSUPPORTED_CURRENCY' });
      expect(mp.calls).toHaveLength(0);
      expect(await rowsFor(world.invoiceId)).toEqual([]);
    });

    it('stores the provider’s expiry when it is earlier than the 24 hours asked for', async () => {
      const thirtyMinutes = new Date(Date.now() + 30 * 60_000).toISOString();
      mp.setCheckoutResult({ expiresAt: thirtyMinutes });

      const created = await jsonOf<Session>(await pay(one, token, { kind: 'invoice', id: world.invoiceId }), 201);

      expect(created.expiresAt).toBe(thirtyMinutes);
      const stored = await env.DB.prepare('SELECT expires_at FROM gateway_checkouts WHERE id = ?')
        .bind(created.checkoutId)
        .first<{ expires_at: string }>();
      expect(stored!.expires_at).toBe(thirtyMinutes);
    });

    it('answers 502 and leaves a failed row, no open one, when the provider fails', async () => {
      mp.setCheckoutResult(new Error('PROVIDER-SAID-SOMETHING'));

      const res = await pay(one, token, { kind: 'invoice', id: world.invoiceId });
      const text = await res.text();

      expect(res.status).toBe(502);
      expect(JSON.parse(text)).toEqual({ error: 'PAYMENTS_PROVIDER_ERROR' });
      expect(text).not.toContain('PROVIDER-SAID-SOMETHING');
      expect(await rowsFor(world.invoiceId)).toEqual([
        { id: expect.any(String), provider: 'mercadopago', status: 'failed', session: null, detail: 'provider call failed (Error)' },
      ]);

      // The index is free again: the next Pay opens a new one.
      mp.setCheckoutResult(null);
      await jsonOf<Session>(await pay(one, token, { kind: 'invoice', id: world.invoiceId }), 201);
      expect((await rowsFor(world.invoiceId)).map((row) => row.status).sort()).toEqual(['failed', 'open']);
    });

    it('replaces an open checkout that has less than five minutes left', async () => {
      const created = await jsonOf<Session>(await pay(one, token, { kind: 'invoice', id: world.invoiceId }), 201);
      await env.DB.prepare('UPDATE gateway_checkouts SET expires_at = ? WHERE id = ?')
        .bind(new Date(Date.now() + 4 * 60_000).toISOString(), created.checkoutId)
        .run();

      const replaced = await jsonOf<Session>(await pay(one, token, { kind: 'invoice', id: world.invoiceId }), 201);

      expect(replaced.checkoutId).not.toBe(created.checkoutId);
      expect((await rowsFor(world.invoiceId)).map((row) => [row.id, row.status]).sort()).toEqual(
        [
          [created.checkoutId, 'expired'],
          [replaced.checkoutId, 'open'],
        ].sort(),
      );
    });

    it('opens exactly one checkout when two requests race', async () => {
      const [a, b] = await Promise.all([
        pay(one, token, { kind: 'invoice', id: world.invoiceId }),
        pay(one, token, { kind: 'invoice', id: world.invoiceId }),
      ]);

      // One opened it; the other got it back, or was told it is being opened.
      const statuses = [a.status, b.status].sort();
      expect(statuses[0]).toBe(201);
      expect([200, 409]).toContain(statuses[1]);
      expect(mp.callsTo('createCheckout')).toHaveLength(1);
      expect((await rowsFor(world.invoiceId)).filter((row) => row.status === 'open')).toHaveLength(1);
    });
  });

  describe('nothing here reaches another student', () => {
    it('404s another student’s invoice and charge exactly as a missing one', async () => {
      const missing = await pay(one, token, { kind: 'invoice', id: 'no-such-invoice' });
      const theirInvoice = await pay(one, token, { kind: 'invoice', id: other.invoiceId });
      const theirCharge = await pay(one, token, { kind: 'event_charge', id: other.chargeId });

      const body = await missing.text();
      expect(missing.status).toBe(404);
      for (const res of [theirInvoice, theirCharge]) {
        expect(res.status).toBe(404);
        expect(await res.text()).toBe(body);
      }
      expect(mp.calls).toHaveLength(0);
      expect(await rowsFor(other.invoiceId)).toEqual([]);
      expect(await rowsFor(other.chargeId)).toEqual([]);
    });

    it('404s another student’s checkout id exactly as a missing one', async () => {
      const theirs = await jsonOf<Session>(
        await pay(one, otherWorldToken, { kind: 'invoice', id: other.invoiceId }),
        201,
      );

      const peek = await call('GET', `/me/billing/checkouts/${theirs.checkoutId}`, { token, app: one });
      const missing = await call('GET', '/me/billing/checkouts/no-such-checkout', { token, app: one });

      expect(peek.status).toBe(404);
      expect(await peek.text()).toBe(await missing.text());
      // …while its owner reads it.
      expect((await call('GET', `/me/billing/checkouts/${theirs.checkoutId}`, { token: otherWorldToken, app: one })).status).toBe(200);
    });

    it('refuses a body that names a user instead of ignoring it', async () => {
      for (const extra of [{ userId: other.studentId }, { user_id: other.studentId }, { createdBy: other.studentId }]) {
        const res = await pay(one, token, { kind: 'invoice', id: world.invoiceId, ...extra });
        expect(res.status).toBe(400);
      }
      expect(await rowsFor(world.invoiceId)).toEqual([]);
    });

    it('does not let an admin pay a student’s invoice through the student route', async () => {
      const res = await pay(one, await tokenFor(world.adminId, ['admin']), { kind: 'invoice', id: world.invoiceId });
      expect(res.status).toBe(404);
    });

    it('400s a malformed body', async () => {
      for (const body of [{}, { kind: 'subscription', id: world.invoiceId }, { kind: 'invoice' }, { kind: 'invoice', id: '' }]) {
        expect((await pay(one, token, body)).status).toBe(400);
      }
    });
  });

  describe('with two providers', () => {
    it('lists them in the label’s order', async () => {
      const mine = await jsonOf<PayStatement>(await call('GET', '/me/billing', { token, app: two }), 200);
      expect(mine.payOptions).toEqual([
        { provider: 'stripe', methods: ['card'] },
        { provider: 'mercadopago', methods: ['pix'] },
      ]);
    });

    it('requires the provider to be named, and refuses one that is not offered', async () => {
      for (const provider of [undefined, 'asaas', 'paypal']) {
        const res = await pay(two, token, { kind: 'invoice', id: world.invoiceId, provider });
        expect(await jsonOf<{ error: string }>(res, 400)).toEqual({ error: 'PAYMENT_PROVIDER_REQUIRED' });
      }
      // Asked before the receivable is looked up: a missing invoice gets the same answer.
      const res = await pay(two, token, { kind: 'invoice', id: 'no-such-invoice' });
      expect(await jsonOf<{ error: string }>(res, 400)).toEqual({ error: 'PAYMENT_PROVIDER_REQUIRED' });
    });

    it('cancels the first checkout when the student switches provider: one open row, one cancelled', async () => {
      const pix = await jsonOf<Session>(
        await pay(two, token, { kind: 'invoice', id: world.invoiceId, provider: 'mercadopago' }),
        201,
      );
      const card = await jsonOf<Session>(
        await pay(two, token, { kind: 'invoice', id: world.invoiceId, provider: 'stripe' }),
        201,
      );

      expect(card.provider).toBe('stripe');
      expect(stripe.callsTo('createCheckout')[0].req.methods).toEqual(['card']);
      expect((await rowsFor(world.invoiceId)).map((row) => [row.id, row.provider, row.status]).sort()).toEqual(
        [
          [pix.checkoutId, 'mercadopago', 'cancelled'],
          [card.checkoutId, 'stripe', 'open'],
        ].sort(),
      );

      // The cancelled one is still readable by its owner.
      const old = await jsonOf<CheckoutStatus>(
        await call('GET', `/me/billing/checkouts/${pix.checkoutId}`, { token, app: two }),
        200,
      );
      expect(old.status).toBe('cancelled');

      const mine = await jsonOf<PayStatement>(await call('GET', '/me/billing', { token, app: two }), 200);
      expect(mine.invoices[0].pendingCheckout).toMatchObject({ checkoutId: card.checkoutId, provider: 'stripe' });
    });

    it('answers 429 with Retry-After after ten new checkouts in the hour', async () => {
      // Switching provider makes every call a new checkout.
      for (let i = 0; i < 10; i++) {
        const res = await pay(two, token, {
          kind: 'invoice',
          id: world.invoiceId,
          provider: i % 2 === 0 ? 'mercadopago' : 'stripe',
        });
        expect(res.status).toBe(201);
      }

      const limited = await pay(two, token, { kind: 'invoice', id: world.invoiceId, provider: 'mercadopago' });
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
      expect(await limited.json()).toEqual({ error: 'TooManyRequests' });

      // The open one is still handed back, and nobody else is limited.
      const open = await pay(two, token, { kind: 'invoice', id: world.invoiceId, provider: 'stripe' });
      expect(open.status).toBe(200);
      expect((await pay(two, otherWorldToken, { kind: 'invoice', id: other.invoiceId, provider: 'stripe' })).status).toBe(201);
      expect((await rowsFor(world.invoiceId)).filter((row) => row.status === 'open')).toHaveLength(1);
    });
  });

  describe('an invalid provider list', () => {
    it('keeps both statements answering, with no pay option', async () => {
      const mine = await jsonOf<PayStatement>(await call('GET', '/me/billing', { token, app: invalid }), 200);
      const admin = await jsonOf<PayStatement>(
        await call('GET', `/admin/billing/students/${world.studentId}/statement`, {
          token: await tokenFor(world.adminId, ['admin']),
          app: invalid,
        }),
        200,
      );
      expect(mine.payOptions).toEqual([]);
      expect(admin.payOptions).toEqual([]);
    });

    it('is loud on the checkout routes: 500 PAYMENTS_CONFIG_INVALID', async () => {
      for (const res of [
        await pay(invalid, token, { kind: 'invoice', id: world.invoiceId }),
        await pay(invalid, token, { nonsense: true }),
        await call('GET', '/me/billing/checkouts/anything', { token, app: invalid }),
      ]) {
        expect(await jsonOf<{ error: string }>(res, 500)).toEqual({ error: 'PAYMENTS_CONFIG_INVALID' });
      }
      expect(mp.calls).toHaveLength(0);
    });
  });
});
