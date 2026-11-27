import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { buildContainer } from '@api/container';
import { AppRouter } from '@api/routes';
import { D1GatewayRepository, SYSTEM_PAYMENT_ACTOR_ID } from '@api/adapters/db/d1-gateway-repository';
import { MercadoPagoGatewayAdapter } from '@api/adapters/payment/mercadopago-gateway-adapter';
import { DISPUTE_HOLD_REASON } from '@api/core/billing/billing-service';
import type { PaymentGatewayFactoryMap } from '@api/core/payments/gateway-registry';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';
import { seedGatewayWorld, type GatewayWorld } from '../db/gateway-fixtures';
import {
  MP_FIXTURE_WEBHOOK_AT,
  MP_FIXTURE_WEBHOOK_SECRET,
  mpDelivery,
  mpFakeProvider,
  mpFixture,
  mpReply,
  signMpDelivery,
  type MpDelivery,
  type MpFakeProvider,
} from '../fixtures/mercadopago';

/**
 * M30 Task 05 — the scenarios Tasks 06, 07, 08 and 09 proved on the stub,
 * replayed through the real routers, services and D1 with the **real Mercado
 * Pago adapter**, its provider played back from `test/fixtures/mercadopago/`.
 *
 * Payment, preference, search and refund bodies are scrubbed sandbox
 * recordings unless their name starts with `derived-`. **Every notification is
 * derived**: no signed delivery could be recorded (it needs a public URL and
 * the panel's secret), so deliveries are built from the provider's published
 * `x-signature` scheme with a fixture-only secret. The adapter's clock is
 * pinned to the instant those deliveries carry.
 *
 * Not replayable with this provider's adapter, and left on the stub:
 * - a dispute *won* / *lost* (no chargeback could be observed, so the adapter
 *   emits no `dispute` event — a charged-back payment arrives as a `payment`
 *   notification and is treated as *opened*);
 * - a payment in another currency than its checkout ending as `mismatch` (the
 *   adapter refuses a non-BRL payment outright, so it ends `failed`);
 * - the same bare payment id under two providers.
 */

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

/** `APP_USR-` like every Mercado Pago key, test or live — accepted under key mode `test`. Not a credential. */
const SECRET_KEY = 'APP_USR-replay-spec-not-a-credential';

const CARD = { id: '191926322032', reference: 'aqrec-1795785192-E-card-approved' };
const MONEY = { id: '191919776844', reference: 'aqrec-1795783752-A-approved-keep' };
const BOLETO = { id: '191927173452', reference: 'aqrec-1795785652-G-boleto-pending' };
const PIX = { id: '191919776901', reference: 'aqrec-derived-P-pix' };
const REJECTED = { id: '191926322101', reference: 'aqrec-derived-H-card-rejected' };

let mp: MpFakeProvider;
let world: GatewayWorld;
let adminToken: string;
let studentToken: string;
let seq = 0;

interface ReplayApp {
  fetch(request: Request): Promise<Response>;
}

/** The Worker's app over the real adapter; a fresh container per request, as the Worker builds it. */
function replayApp(options: { timeoutMs?: number } = {}): ReplayApp {
  const appEnv = {
    ...env,
    PAYMENTS_PROVIDERS: 'mercadopago:pix+card+boleto',
    PAYMENTS_KEY_MODE: 'test',
    PAYMENTS_MERCADOPAGO_SECRET_KEY: SECRET_KEY,
    PAYMENTS_MERCADOPAGO_WEBHOOK_SECRET: MP_FIXTURE_WEBHOOK_SECRET,
  } as unknown as Env;
  const factories: PaymentGatewayFactoryMap = {
    mercadopago: input =>
      new MercadoPagoGatewayAdapter({
        secretKey: input.secretKey,
        webhookSecret: input.webhookSecret,
        fetch: mp.fetch,
        now: () => MP_FIXTURE_WEBHOOK_AT,
        timeoutMs: options.timeoutMs,
      }),
  };
  return {
    async fetch(request) {
      const app = new OpenAPIHono();
      AppRouter.register(app, buildContainer(appEnv, { paymentGatewayFactories: factories }));
      const ctx = createExecutionContext();
      const res = await app.fetch(request, appEnv, ctx);
      await waitOnExecutionContext(ctx);
      return res;
    },
  };
}

const repo = (): D1GatewayRepository => new D1GatewayRepository(env.DB);

/** An open checkout whose id is the back-reference a fixture payment carries. */
async function openCheckout(id: string, options: { session?: string; kind?: 'invoice' | 'event_charge' } = {}) {
  const kind = options.kind ?? 'invoice';
  await repo().createCheckout({
    id,
    provider: 'mercadopago',
    receivableKind: kind,
    receivableId: kind === 'invoice' ? world.invoiceId : world.chargeId,
    userId: world.studentId,
    createdBy: world.studentId,
    amountMinor: kind === 'invoice' ? 15000 : 8000,
    currency: 'BRL',
    checkoutUrl: 'https://pay.invalid/pending',
    expiresAt: '2099-01-01T00:00:00.000Z',
  });
  await repo().updateCheckout(id, { providerSessionId: options.session ?? `1000000001-${crypto.randomUUID()}` });
}

/** A derived delivery about one payment, signed with the published scheme. */
async function notification(
  paymentId: string,
  options: { notificationId?: number; action?: string; secret?: string; at?: Date } = {},
): Promise<MpDelivery> {
  const notificationId = options.notificationId ?? 127382000000 + ++seq;
  const requestId = crypto.randomUUID();
  const ts = String((options.at ?? MP_FIXTURE_WEBHOOK_AT).getTime());
  return {
    query: { 'data.id': paymentId, type: 'payment' },
    headers: {
      'x-request-id': requestId,
      'x-signature': await signMpDelivery({ dataId: paymentId, requestId, ts, secret: options.secret }),
    },
    body: JSON.stringify({
      action: options.action ?? 'payment.updated',
      api_version: 'v1',
      data: { id: paymentId },
      date_created: '2026-11-27T13:33:21Z',
      id: notificationId,
      live_mode: true,
      type: 'payment',
      user_id: '1000000001',
    }),
  };
}

async function deliver(delivery: MpDelivery, app: ReplayApp = replayApp()): Promise<Response> {
  const query = new URLSearchParams(delivery.query).toString();
  return app.fetch(
    new IncomingRequest(`http://example.com${v1('/webhooks/payments/mercadopago')}?${query}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': `198.51.100.${++seq % 250}-${seq}`,
        ...delivery.headers,
      },
      body: delivery.body,
    }),
  );
}

const outcomeOf = async (res: Response): Promise<string> => (await res.json<{ outcome: string }>()).outcome;

/** Delivers a fresh notification about `paymentId` and returns the outcome. */
async function notify(paymentId: string, app?: ReplayApp): Promise<string> {
  const res = await deliver(await notification(paymentId), app);
  expect(res.status).toBe(200);
  return outcomeOf(res);
}

async function api(method: string, path: string, token: string, body?: unknown, app: ReplayApp = replayApp()) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return app.fetch(
    new IncomingRequest(`http://example.com${v1(path)}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
}

interface LedgerRow {
  id: string;
  amount_minor: number;
  method: string;
  external_reference: string | null;
  reverses_id: string | null;
  recorded_by: string;
}

async function ledger(): Promise<LedgerRow[]> {
  const { results } = await env.DB
    .prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY amount_minor DESC, external_reference')
    .bind(world.invoiceId)
    .all<LedgerRow>();
  return results;
}

const amounts = async (): Promise<Array<[string | null, number]>> =>
  (await ledger()).map(row => [row.external_reference, row.amount_minor]);

interface EventRow {
  event_id: string;
  type: string;
  outcome: string;
  attempts: number;
  error: string | null;
  checkout_id: string | null;
  provider_payment_id: string | null;
}

async function events(): Promise<EventRow[]> {
  const { results } = await env.DB
    .prepare("SELECT * FROM gateway_events WHERE provider = 'mercadopago' ORDER BY received_at, event_id")
    .all<EventRow>();
  return results;
}

const providerCalls = (): string[] => mp.calls.map(call => `${call.method} ${call.path}`);

beforeAll(async () => {
  await applyMigrations(env.DB);
  await env.DB.exec('PRAGMA foreign_keys = ON');
});

beforeEach(async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // Each test starts from an empty gateway: the fixture ids are fixed, so
  // nothing may survive from the test before.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM gateway_events'),
    env.DB.prepare('DELETE FROM gateway_checkouts'),
    env.DB.prepare("DELETE FROM payments WHERE method = 'gateway'"),
    env.DB.prepare("DELETE FROM event_charge_payments WHERE method = 'gateway'"),
  ]);
  mp = mpFakeProvider();
  world = await seedGatewayWorld();
  const signer = new JwtAuthAdapter({ secret: env.JWT_SECRET, accessTokenExpiresInSeconds: 900 });
  [adminToken, studentToken] = await Promise.all([
    signer.signAccessToken({ sub: world.adminId, email: 'admin@replay.test', roles: ['admin'] }),
    signer.signAccessToken({ sub: world.studentId, email: 'student@replay.test', roles: ['student'] }),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The webhook route (Task 06's scenarios)
// ---------------------------------------------------------------------------

describe('POST /v1/webhooks/payments/mercadopago with the real adapter', () => {
  it('1: an approved card payment lands one gateway row, closes the checkout paid, settles the event applied', async () => {
    await openCheckout(CARD.reference);
    mp.on('GET', `/v1/payments/${CARD.id}`, mpReply(200, 'payment-approved-card'));

    const res = await deliver(mpDelivery('derived-webhook-payment-updated'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: 'applied' });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const rows = await ledger();
    expect(rows).toHaveLength(1);
    // What the provider captured (R$ 12,34), not what the checkout asked for.
    expect(rows[0]).toMatchObject({
      amount_minor: 1234,
      method: 'gateway',
      external_reference: `mercadopago:${CARD.id}`,
      recorded_by: SYSTEM_PAYMENT_ACTOR_ID,
      reverses_id: null,
    });
    expect(await repo().getCheckout(CARD.reference)).toMatchObject({ status: 'paid', providerPaymentId: CARD.id });
    expect(await events()).toMatchObject([
      { event_id: '127381900002', type: 'payment', outcome: 'applied', attempts: 1, checkout_id: CARD.reference, provider_payment_id: CARD.id },
    ]);
    // The delivery was a trigger: one authenticated read of the payment, nothing else.
    expect(providerCalls()).toEqual([`GET /v1/payments/${CARD.id}`]);
    expect(mp.calls[0].headers.Authorization).toBe(`Bearer ${SECRET_KEY}`);
  });

  it('2: the same delivery replayed is a duplicate; another notification about the payment adds no row', async () => {
    await openCheckout(CARD.reference);
    mp.on('GET', `/v1/payments/${CARD.id}`, mpReply(200, 'payment-approved-card'));
    const updated = mpDelivery('derived-webhook-payment-updated');

    expect(await outcomeOf(await deliver(updated))).toBe('applied');
    expect(await outcomeOf(await deliver(updated))).toBe('duplicate');
    expect(await outcomeOf(await deliver(updated))).toBe('duplicate');
    // `payment.created` of the same payment: its own notification id, so its own event.
    expect(await outcomeOf(await deliver(mpDelivery('derived-webhook-payment-created')))).toBe('duplicate');

    expect(await ledger()).toHaveLength(1);
    expect((await events()).map(e => e.event_id).sort()).toEqual(['127381900001', '127381900002']);
  });

  it('3, 7: a tampered body, a stale ts, another secret and no signature are 401 and write nothing', async () => {
    await openCheckout(CARD.reference);
    mp.on('GET', `/v1/payments/${CARD.id}`, mpReply(200, 'payment-approved-card'));
    const good = mpDelivery('derived-webhook-payment-updated');
    const sixMinutesAgo = new Date(MP_FIXTURE_WEBHOOK_AT.getTime() - 6 * 60_000);

    const rejected: MpDelivery[] = [
      { ...good, body: good.body.replace(`"data":{"id":"${CARD.id}"}`, `"data":{"id":"${MONEY.id}"}`) },
      { ...good, query: { ...good.query, 'data.id': MONEY.id } },
      { ...good, headers: { ...good.headers, 'x-signature': good.headers['x-signature'].replace('ts=1795786401000', 'ts=1795786401001') } },
      await notification(CARD.id, { at: sixMinutesAgo }),
      await notification(CARD.id, { secret: 'whsec-stub-stripe' }),
      { ...good, headers: { 'x-request-id': good.headers['x-request-id'] } },
    ];
    for (const delivery of rejected) {
      const res = await deliver(delivery);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
    }

    expect(await events()).toEqual([]);
    expect(await ledger()).toEqual([]);
    expect((await repo().getCheckout(CARD.reference))?.status).toBe('open');
    expect(mp.calls).toEqual([]);
  });

  it('4: a payment the provider does not know (recorded 404) is an orphan', async () => {
    mp.on('GET', '/v1/payments/999999999999', mpReply(404, 'payment-unknown-404'));

    expect(await notify('999999999999')).toBe('orphan');

    expect(await ledger()).toEqual([]);
    expect(await events()).toMatchObject([{ outcome: 'orphan', provider_payment_id: '999999999999', checkout_id: null }]);
  });

  it('4: a recorded payment that names no checkout created here is an orphan', async () => {
    await openCheckout(CARD.reference);
    mp.on('GET', '/v1/payments/190809194863', mpReply(200, 'payment-approved-foreign-reference'));

    expect(await notify('190809194863')).toBe('orphan');

    expect(await ledger()).toEqual([]);
    expect((await repo().getCheckout(CARD.reference))?.status).toBe('open');
    expect((await repo().listExceptions()).some(row => row.kind === 'event' && row.event.providerPaymentId === '190809194863')).toBe(true);
  });

  it('6: two notifications about one payment arriving at once leave one ledger row', async () => {
    await openCheckout(CARD.reference);
    mp.on('GET', `/v1/payments/${CARD.id}`, mpReply(200, 'payment-approved-card'));

    const responses = await Promise.all([
      deliver(mpDelivery('derived-webhook-payment-created')),
      deliver(mpDelivery('derived-webhook-payment-updated')),
    ]);

    const outcomes = await Promise.all(responses.map(outcomeOf));
    expect(outcomes.sort()).toEqual(['applied', 'duplicate']);
    expect(await ledger()).toHaveLength(1);
    expect((await repo().getCheckout(CARD.reference))?.status).toBe('paid');
  });

  it('8: a provider 5xx on the fetch is 503 with the event failed; the redelivery is applied with attempts = 2', async () => {
    await openCheckout(CARD.reference);
    const replies = [{ status: 502, body: '<html>bad gateway BODY-MARKER</html>' }, mpReply(200, 'payment-approved-card')];
    mp.on('GET', `/v1/payments/${CARD.id}`, () => replies.shift() ?? new Error('unexpected call'));
    const delivery = mpDelivery('derived-webhook-payment-updated');

    const first = await deliver(delivery);

    expect(first.status).toBe(503);
    expect(await first.json()).toEqual({ error: 'PAYMENTS_EVENT_FAILED' });
    const [failed] = await events();
    expect(failed).toMatchObject({ outcome: 'failed', attempts: 1, error: 'processing failed (MercadoPagoUnavailableError)' });
    expect(await ledger()).toEqual([]);

    expect(await outcomeOf(await deliver(delivery))).toBe('applied');
    expect(await events()).toMatchObject([{ outcome: 'applied', attempts: 2 }]);
    expect(await ledger()).toHaveLength(1);
  });

  it('8: a provider that does not answer in time is 503 with the event failed, as a timeout', async () => {
    await openCheckout(CARD.reference);
    const hanging: MpFakeProvider = mpFakeProvider();
    hanging.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })) as typeof fetch;
    mp = hanging;

    const res = await deliver(mpDelivery('derived-webhook-payment-updated'), replayApp({ timeoutMs: 25 }));

    expect(res.status).toBe(503);
    expect(await events()).toMatchObject([{ outcome: 'failed', error: 'processing failed (MercadoPagoTimeoutError)' }]);
    expect(await ledger()).toEqual([]);
  });

  it('9: a recorded pending boleto is ignored and leaves the checkout open', async () => {
    await openCheckout(BOLETO.reference);
    mp.on('GET', `/v1/payments/${BOLETO.id}`, mpReply(200, 'payment-pending-boleto'));

    expect(await notify(BOLETO.id)).toBe('ignored');

    expect(await ledger()).toEqual([]);
    expect((await repo().getCheckout(BOLETO.reference))?.status).toBe('open');
  });

  it('9: the first Pix notification (pending) is ignored; the approval, another notification, lands [derived]', async () => {
    await openCheckout(PIX.reference);
    mp.on('GET', `/v1/payments/${PIX.id}`, mpReply(200, 'derived-payment-pending-pix'));
    expect(await notify(PIX.id)).toBe('ignored');
    expect(await ledger()).toEqual([]);

    mp.on('GET', `/v1/payments/${PIX.id}`, mpReply(200, 'derived-payment-approved-pix'));
    expect(await notify(PIX.id)).toBe('applied');

    expect(await amounts()).toEqual([[`mercadopago:${PIX.id}`, 1234]]);
    expect((await repo().getCheckout(PIX.reference))?.status).toBe('paid');
    expect((await events()).map(e => e.outcome).sort()).toEqual(['applied', 'ignored']);
  });

  it('a rejected card is ignored: the checkout stays open and keeps the last status [derived]', async () => {
    await openCheckout(REJECTED.reference);
    mp.on('GET', `/v1/payments/${REJECTED.id}`, mpReply(200, 'derived-payment-rejected-card'));

    expect(await notify(REJECTED.id)).toBe('ignored');

    expect(await ledger()).toEqual([]);
    expect(await repo().getCheckout(REJECTED.reference)).toMatchObject({ status: 'open', failureDetail: 'payment failed' });
  });

  it('10: refunds reported as further updates of the payment land as negative rows keyed on the refund id', async () => {
    // The three recorded states of one sandbox payment: approved, partially refunded, refunded.
    await openCheckout(MONEY.reference);
    mp.on('GET', `/v1/payments/${MONEY.id}`, mpReply(200, 'payment-approved-account-money'));
    expect(await notify(MONEY.id)).toBe('applied');
    expect(await amounts()).toEqual([[`mercadopago:${MONEY.id}`, 1234]]);

    mp.on('GET', `/v1/payments/${MONEY.id}`, mpReply(200, 'payment-partially-refunded'));
    expect(await notify(MONEY.id)).toBe('applied');
    expect(await amounts()).toEqual([
      [`mercadopago:${MONEY.id}`, 1234],
      ['mercadopago:3546618035', -234],
    ]);
    // Told again, nothing changes.
    expect(await notify(MONEY.id)).toBe('duplicate');

    mp.on('GET', `/v1/payments/${MONEY.id}`, mpReply(200, 'payment-refunded'));
    expect(await notify(MONEY.id)).toBe('applied');
    expect(await amounts()).toEqual([
      [`mercadopago:${MONEY.id}`, 1234],
      ['mercadopago:3546618035', -234],
      ['mercadopago:3611872278', -1000],
    ]);
    expect((await ledger()).reduce((sum, row) => sum + row.amount_minor, 0)).toBe(0);
    expect((await ledger()).every(row => row.recorded_by === SYSTEM_PAYMENT_ACTOR_ID)).toBe(true);
  });

  it('10: a refunded payment that never landed lands first, then each of its refunds', async () => {
    await openCheckout(MONEY.reference);
    mp.on('GET', `/v1/payments/${MONEY.id}`, mpReply(200, 'payment-refunded'));

    expect(await notify(MONEY.id)).toBe('applied');

    expect(await amounts()).toEqual([
      [`mercadopago:${MONEY.id}`, 1234],
      ['mercadopago:3546618035', -234],
      ['mercadopago:3611872278', -1000],
    ]);
  });

  it('12: a charged-back payment raises the contract hold by the system actor and books nothing more [derived]', async () => {
    await openCheckout(CARD.reference);
    mp.on('GET', `/v1/payments/${CARD.id}`, mpReply(200, 'payment-approved-card'));
    expect(await notify(CARD.id)).toBe('applied');

    mp.on('GET', `/v1/payments/${CARD.id}`, mpReply(200, 'derived-payment-charged-back'));
    expect(await notify(CARD.id)).toBe('applied');

    const hold = await env.DB
      .prepare('SELECT reason, set_by FROM billing_standing_holds WHERE user_id = ?')
      .bind(world.studentId)
      .first<{ reason: string; set_by: string }>();
    expect(hold).toEqual({ reason: DISPUTE_HOLD_REASON, set_by: SYSTEM_PAYMENT_ACTOR_ID });
    expect(await ledger()).toHaveLength(1);
    expect((await repo().getCheckout(CARD.reference))?.failureDetail).toBe('dispute opened');
    // A redelivery of the same state does not raise it again.
    expect(await notify(CARD.id)).toBe('duplicate');
  });

  it('13: a topic the adapter does not act on is ignored, without asking the provider [derived]', async () => {
    const res = await deliver(mpDelivery('derived-webhook-merchant-order'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: 'ignored' });
    expect(await events()).toMatchObject([{ event_id: '127381900003', type: 'topic_merchant_order_wh', outcome: 'ignored' }]);
    expect(mp.calls).toEqual([]);
  });

  it('5: a payment in a currency the adapter does not charge is refused by the adapter: failed, not mismatch [derived]', async () => {
    await openCheckout(CARD.reference);
    mp.on('GET', `/v1/payments/${CARD.id}`, mpReply(200, 'derived-payment-usd'));

    const res = await deliver(mpDelivery('derived-webhook-payment-updated'));

    expect(res.status).toBe(503);
    expect(await events()).toMatchObject([{ outcome: 'failed', error: 'processing failed (MercadoPagoResponseError)' }]);
    expect(await ledger()).toEqual([]);
    expect((await repo().getCheckout(CARD.reference))?.status).toBe('open');
  });
});

// ---------------------------------------------------------------------------
// The checkout routes (Task 07's re-run list)
// ---------------------------------------------------------------------------

describe('POST /v1/me/billing/checkouts with the real adapter', () => {
  /** The recorded preference, re-dated to one hour before whatever expiry the request asked for. */
  function preferenceGrantingLess() {
    return (call: { body: string | null }) => {
      const asked = Date.parse(JSON.parse(call.body ?? '{}').expiration_date_to);
      const granted = new Date(asked - 3_600_000).toISOString().replace('Z', '+00:00');
      const body = mpFixture('preference-created').replace(
        '"expiration_date_to":"2026-11-28T13:46:28.231+00:00"',
        `"expiration_date_to":"${granted}"`,
      );
      return { status: 201, body };
    };
  }

  it('1, 2: the checkout id reaches the provider as reference, metadata and key; the earlier provider expiry is stored', async () => {
    mp.on('POST', '/checkout/preferences', preferenceGrantingLess());

    const res = await api('POST', '/me/billing/checkouts', studentToken, { kind: 'invoice', id: world.invoiceId });

    expect(res.status).toBe(201);
    const session = await res.json<{ checkoutId: string; provider: string; url: string; expiresAt: string; amountMinor: number }>();
    expect(session).toMatchObject({
      provider: 'mercadopago',
      amountMinor: 15000,
      url: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=1000000001-76a3350c-d4f6-4c0c-9a76-f170d37f7775',
    });

    expect(providerCalls()).toEqual(['POST /checkout/preferences']);
    const call = mp.calls[0];
    const sent = JSON.parse(call.body ?? '{}');
    expect(sent.external_reference).toBe(session.checkoutId);
    expect(sent.metadata).toEqual({ checkout_id: session.checkoutId });
    expect(call.headers['X-Idempotency-Key']).toBe(session.checkoutId);
    expect(call.body).toContain('"currency_id":"BRL","unit_price":150.00}');
    // The label offers all three methods: only what no method stands for is excluded.
    expect(sent.payment_methods.excluded_payment_types).toEqual([{ id: 'atm' }]);
    expect(sent.payer.email).toMatch(/^s-.*@example\.com$/);
    expect(sent.back_urls.success).toContain(`/settings/billing?checkout=${session.checkoutId}&outcome=success`);
    expect(sent.back_urls.failure).toContain(`checkout=${session.checkoutId}&outcome=cancel`);

    // The provider granted one hour less than the 24 h asked for: that is the stored expiry.
    expect(Date.parse(session.expiresAt)).toBe(Date.parse(sent.expiration_date_to) - 3_600_000);
    expect(await repo().getCheckout(session.checkoutId)).toMatchObject({
      status: 'open',
      providerSessionId: '1000000001-76a3350c-d4f6-4c0c-9a76-f170d37f7775',
      expiresAt: session.expiresAt,
    });
  });

  it('5: create, pay, notification: the checkout reads paid', async () => {
    mp.on('POST', '/checkout/preferences', preferenceGrantingLess());
    const created = await api('POST', '/me/billing/checkouts', studentToken, { kind: 'invoice', id: world.invoiceId });
    const { checkoutId } = await created.json<{ checkoutId: string }>();
    // The recorded card payment, its back-reference pointed at the checkout just created.
    const paid = mpFixture('payment-approved-card').replaceAll(CARD.reference, checkoutId);
    mp.on('GET', `/v1/payments/${CARD.id}`, { status: 200, body: paid });

    expect(await notify(CARD.id)).toBe('applied');

    const status = await api('GET', `/me/billing/checkouts/${checkoutId}`, studentToken);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ checkoutId, status: 'paid', provider: 'mercadopago' });
    expect(await amounts()).toEqual([[`mercadopago:${CARD.id}`, 1234]]);
  });

  it.each([
    ['a refusal (recorded 400)', () => mpReply(400, 'preference-invalid-400'), 'MercadoPagoRefusalError'],
    ['a 503', () => ({ status: 503, body: 'unavailable' }), 'MercadoPagoUnavailableError'],
    ['a body without a session', () => ({ status: 201, body: '{}' }), 'MercadoPagoResponseError'],
  ])('3: %s is 502 and closes the row failed with the adapter error name', async (_label, reply, errorName) => {
    mp.on('POST', '/checkout/preferences', reply());

    const res = await api('POST', '/me/billing/checkouts', studentToken, { kind: 'invoice', id: world.invoiceId });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'PAYMENTS_PROVIDER_ERROR' });
    const row = await env.DB
      .prepare('SELECT status, failure_detail FROM gateway_checkouts WHERE receivable_id = ?')
      .bind(world.invoiceId)
      .first<{ status: string; failure_detail: string }>();
    expect(row).toEqual({ status: 'failed', failure_detail: `provider call failed (${errorName})` });
  });
});

// ---------------------------------------------------------------------------
// The admin refund (Task 08's re-run list)
// ---------------------------------------------------------------------------

describe('POST /v1/admin/billing/payments/{id}/reverse with the real adapter', () => {
  const REFUNDS = `/v1/payments/${MONEY.id}/refunds`;

  /** The recorded account-money payment, landed through the webhook. */
  async function landed(): Promise<LedgerRow> {
    await openCheckout(MONEY.reference);
    mp.on('GET', `/v1/payments/${MONEY.id}`, mpReply(200, 'payment-approved-account-money'));
    expect(await notify(MONEY.id)).toBe('applied');
    mp.calls.length = 0;
    return (await ledger())[0];
  }

  const reverse = (paymentId: string) =>
    api('POST', `/admin/billing/payments/${paymentId}/reverse`, adminToken, { reason: 'Asked for it back.' });

  it('1, 2: refunds the full amount under the key rev:<row id>, and a repeat adds neither a refund nor a row', async () => {
    const original = await landed();
    // The recorded refund answer (the adapter reads its id only; the recording itself was for R$ 10,00).
    mp.on('POST', REFUNDS, mpReply(201, 'refund-rest-201'));

    const res = await reverse(original.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      method: 'gateway',
      amountMinor: -1234,
      reversesId: original.id,
      externalReference: 'mercadopago:3611872278',
      recordedBy: world.adminId,
    });
    expect(providerCalls()).toEqual([`GET /v1/payments/${MONEY.id}`, `POST ${REFUNDS}`]);
    expect(mp.calls[1].body).toBe('{"amount":12.34}');
    expect(mp.calls[1].headers['X-Idempotency-Key']).toBe(`rev:${original.id}`);

    // The provider now shows the payment refunded in one refund [derived].
    mp.on('GET', `/v1/payments/${MONEY.id}`, mpReply(200, 'derived-payment-refunded-single-refund'));
    mp.on('POST', REFUNDS, new Error('a second refund must never be requested'));
    const again = await reverse(original.id);
    expect(again.status).toBe(200);
    expect(await amounts()).toEqual([
      [`mercadopago:${MONEY.id}`, 1234],
      ['mercadopago:3611872278', -1234],
    ]);

    // 5 — the provider's own notification about that refund settles duplicate.
    expect(await notify(MONEY.id)).toBe('duplicate');
    expect(await ledger()).toHaveLength(2);
  });

  it('1, 4: a full refund already at the provider is recorded without asking for another [derived]', async () => {
    const original = await landed();
    mp.on('GET', `/v1/payments/${MONEY.id}`, mpReply(200, 'derived-payment-refunded-single-refund'));

    const res = await reverse(original.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ amountMinor: -1234, externalReference: 'mercadopago:3611872278' });
    expect(providerCalls()).toEqual([`GET /v1/payments/${MONEY.id}`]);
  });

  it.each([
    ['the recorded refusal (400, cause 120013)', () => mpReply(400, 'refund-over-balance-400')],
    ['the recorded 401 (cause 7)', () => mpReply(401, 'refund-unauthorized-401')],
    // The service cannot tell a retryable provider error from a refusal (the port only throws): same answer.
    ['the recorded 429 refund_quota_exceeded', () => mpReply(429, 'refund-quota-429')],
  ])('3: %s throws from the adapter: 409 PAYMENTS_REFUND_REFUSED and nothing written', async (_label, reply) => {
    const original = await landed();
    mp.on('POST', REFUNDS, reply());

    const res = await reverse(original.id);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'PAYMENTS_REFUND_REFUSED' });
    expect(await ledger()).toHaveLength(1);
  });

  it('4: a payment the provider holds a partial refund for is refused without a refund call', async () => {
    const original = await landed();
    mp.on('GET', `/v1/payments/${MONEY.id}`, mpReply(200, 'payment-partially-refunded'));

    const res = await reverse(original.id);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'PAYMENTS_REFUND_REFUSED' });
    expect(providerCalls()).toEqual([`GET /v1/payments/${MONEY.id}`]);
    expect(await ledger()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The reconcile run (Task 09's re-run list)
// ---------------------------------------------------------------------------

describe('POST /v1/admin/billing/payments/reconcile with the real adapter', () => {
  const SESSION = '1000000001-deaaa0c1-cce7-4556-a775-9cea42b239ef';
  const SEARCH = `/v1/payments/search?external_reference=${CARD.reference}`;

  /** An open checkout old enough to be asked about, bound to the recorded preference. */
  async function dueCheckout(): Promise<void> {
    const createdAt = new Date(Date.now() - 40 * 60_000).toISOString();
    await env.DB
      .prepare(
        `INSERT INTO gateway_checkouts
           (id, provider, receivable_kind, receivable_id, user_id, created_by, amount_minor, currency, status,
            provider_session_id, checkout_url, expires_at, created_at, updated_at)
         VALUES (?, 'mercadopago', 'invoice', ?, ?, ?, 15000, 'BRL', 'open', ?, 'https://pay.invalid/x', ?, ?, ?)`,
      )
      .bind(CARD.reference, world.invoiceId, world.studentId, world.studentId, SESSION, new Date(Date.now() + 36_000_000).toISOString(), createdAt, createdAt)
      .run();
  }

  const reconcile = async () => {
    const res = await api('POST', '/admin/billing/payments/reconcile', adminToken);
    expect(res.status).toBe(200);
    return res.json<{ status: string; summary: Record<string, number> }>();
  };

  it('1: a missed webhook: the session is found through its preference and the payment lands', async () => {
    await dueCheckout();
    mp.on('GET', `/checkout/preferences/${SESSION}`, mpReply(200, 'preference-paid-card')).on('GET', SEARCH, mpReply(200, 'search-by-reference-card'));

    const run = await reconcile();

    expect(run.status).toBe('ok');
    expect(run.summary).toMatchObject({ checkoutsAsked: 1, landed: 1, checkoutErrors: 0 });
    expect(await amounts()).toEqual([[`mercadopago:${CARD.id}`, 1234]]);
    expect(await repo().getCheckout(CARD.reference)).toMatchObject({ status: 'paid', providerPaymentId: CARD.id });
    expect(providerCalls()).toEqual([`GET /checkout/preferences/${SESSION}`, `GET ${SEARCH}`]);
    expect(await events()).toEqual([]);
  });

  it('2: a session nobody paid answers [] (recorded): the checkout stays open and nothing fails', async () => {
    await dueCheckout();
    mp.on('GET', `/checkout/preferences/${SESSION}`, mpReply(200, 'preference-paid-card')).on('GET', SEARCH, mpReply(200, 'search-empty'));

    const run = await reconcile();

    expect(run.status).toBe('ok');
    expect(run.summary).toMatchObject({ checkoutsAsked: 1, landed: 0, stillOpen: 1, checkoutErrors: 0 });
    expect(await ledger()).toEqual([]);
    expect((await repo().getCheckout(CARD.reference))?.status).toBe('open');
  });

  it('3: a rejected card then an approved one on the same session: one lands [derived]', async () => {
    await dueCheckout();
    mp.on('GET', `/checkout/preferences/${SESSION}`, mpReply(200, 'preference-paid-card')).on('GET', SEARCH, mpReply(200, 'derived-search-two-payments'));

    const run = await reconcile();

    expect(run.summary).toMatchObject({ checkoutsAsked: 1, landed: 1 });
    expect(await amounts()).toEqual([[`mercadopago:${CARD.id}`, 1234]]);
    expect((await repo().getCheckout(CARD.reference))?.status).toBe('paid');
  });

  it('a provider failure during the search is counted and asked again, never a failed run', async () => {
    await dueCheckout();
    mp.on('GET', `/checkout/preferences/${SESSION}`, { status: 503, body: 'unavailable' });

    const run = await reconcile();

    expect(run.status).toBe('ok');
    expect(run.summary).toMatchObject({ checkoutsAsked: 1, landed: 0, checkoutErrors: 1 });
    expect((await repo().getCheckout(CARD.reference))?.status).toBe('open');
  });

  it('4: the key mode: an APP_USR- key passes under test, so the run reaches the provider', async () => {
    // The key the replay app binds starts with APP_USR- and PAYMENTS_KEY_MODE is `test`:
    // before Task 05 this was `key_mode_mismatch` and every payment route answered 500.
    await dueCheckout();
    mp.on('GET', `/checkout/preferences/${SESSION}`, mpReply(404, 'preference-unknown-404'));

    const run = await reconcile();

    expect(run.status).toBe('ok');
    expect(mp.calls).toHaveLength(1);
  });
});
