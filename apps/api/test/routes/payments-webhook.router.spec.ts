import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import worker, { type AppEnv } from '../../src/index';
import { applyMigrations } from '../helpers/apply-migrations';
import { v1 } from '../helpers/v1';
import { seedGatewayWorld, type GatewayWorld } from '../db/gateway-fixtures';
import { buildPaymentsTestApp, type PaymentsTestApp } from '../adapters/payment/payments-test-app';
import { StubGatewayAdapter, stubPayment, stubSecretKey } from '../adapters/payment/stub-gateway-adapter';
import { D1GatewayRepository, SYSTEM_PAYMENT_ACTOR_ID } from '@api/adapters/db/d1-gateway-repository';
import { DISPUTE_HOLD_REASON } from '@api/core/billing/billing-service';
import { paymentSecretKeyVar } from '@api/core/payments/config';
import type { ProviderEvent, PaymentProviderName } from '@arenaquest/shared/ports/i-payment-gateway';
import type { GatewayCheckoutRecord } from '@arenaquest/shared/ports/i-gateway-repository';

/**
 * `POST /v1/webhooks/payments/{provider}` end to end (RFC 0026 §4, §5): the
 * real router, container, services and D1, with **stub** adapters bound under
 * real provider names — Task 05 (the Mercado Pago adapter and its recorded
 * fixtures) is deferred, so every "replay a delivery" scenario is driven
 * through the stub here.
 *
 * The stub "signs" with a header: a delivery is authentic when
 * `x-stub-signature` carries that provider's own webhook secret, and its
 * verified event is the `event` member of the JSON body. Everything else in
 * the body is noise the Worker must never believe, store or log.
 */

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

/** Sits in every delivery body; must never surface in a response, a log line or a stored error. */
const BODY_MARKER = 'BODY-MARKER-7f3c1e';

let mp: StubGatewayAdapter;
let stripe: StubGatewayAdapter;
let app: PaymentsTestApp;
let ipCounter = 0;
let seq = 0;

const uid = (prefix: string): string => `${prefix}-${++seq}-${crypto.randomUUID().slice(0, 8)}`;

function webhookSecret(provider: PaymentProviderName): string {
  return `whsec-stub-${provider}`;
}

function sign(stub: StubGatewayAdapter): void {
  stub.setWebhookVerdict((rawBody, headers) =>
    headers['x-stub-signature'] === webhookSecret(stub.provider)
      ? (JSON.parse(rawBody) as { event: ProviderEvent }).event
      : null,
  );
}

interface DeliverOptions {
  /** The secret the delivery is signed with; defaults to the path provider's own. */
  secret?: string;
  ip?: string;
  target?: PaymentsTestApp;
}

async function deliver(provider: string, event: ProviderEvent, options: DeliverOptions = {}): Promise<Response> {
  const request = new IncomingRequest(`http://example.com${v1(`/webhooks/payments/${provider}`)}?source=test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': options.ip ?? `203.0.113.${++ipCounter % 250}-${ipCounter}`,
      'X-Stub-Signature': options.secret ?? webhookSecret(provider as PaymentProviderName),
    },
    body: JSON.stringify({ event, marker: BODY_MARKER }),
  });
  const ctx = createExecutionContext();
  const res = await (options.target ?? app).fetch(request, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function outcomeOf(res: Response): Promise<string> {
  return (await res.json<{ outcome: string }>()).outcome;
}

function paymentEvent(paymentId: string, eventId = uid('evt')): ProviderEvent {
  return { kind: 'payment', eventId, paymentId, occurredAt: '2026-01-12T14:03:00.000Z' };
}

function disputeEvent(paymentId: string, outcome: 'opened' | 'won' | 'lost'): ProviderEvent {
  return { kind: 'dispute', eventId: uid('evt'), paymentId, outcome, occurredAt: '2026-01-20T09:00:00.000Z' };
}

const gatewayRepo = (): D1GatewayRepository => new D1GatewayRepository(env.DB);

async function openCheckout(
  world: GatewayWorld,
  options: { provider?: PaymentProviderName; kind?: 'invoice' | 'event_charge' } = {},
): Promise<GatewayCheckoutRecord> {
  const kind = options.kind ?? 'invoice';
  const id = crypto.randomUUID();
  const checkout = await gatewayRepo().createCheckout({
    id,
    provider: options.provider ?? 'mercadopago',
    receivableKind: kind,
    receivableId: kind === 'invoice' ? world.invoiceId : world.chargeId,
    userId: world.studentId,
    createdBy: world.studentId,
    amountMinor: kind === 'invoice' ? 15000 : 8000,
    currency: 'BRL',
    checkoutUrl: 'https://pay.invalid/pending',
    expiresAt: '2099-01-01T00:00:00.000Z',
  });
  await gatewayRepo().updateCheckout(id, { providerSessionId: `session-${id}` });
  return checkout;
}

interface LedgerRow {
  id: string;
  amount_minor: number;
  method: string;
  external_reference: string | null;
  reverses_id: string | null;
  recorded_by: string;
  note: string | null;
}

async function invoicePayments(invoiceId: string): Promise<LedgerRow[]> {
  const { results } = await env.DB
    .prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY amount_minor DESC')
    .bind(invoiceId)
    .all<LedgerRow>();
  return results;
}

async function chargePayments(chargeId: string): Promise<LedgerRow[]> {
  const { results } = await env.DB
    .prepare('SELECT * FROM event_charge_payments WHERE charge_id = ? ORDER BY amount_minor DESC')
    .bind(chargeId)
    .all<LedgerRow>();
  return results;
}

interface EventRow {
  outcome: string;
  attempts: number;
  error: string | null;
  checkout_id: string | null;
  type: string;
}

async function eventRows(provider: string, eventId: string): Promise<EventRow[]> {
  const { results } = await env.DB
    .prepare('SELECT * FROM gateway_events WHERE provider = ? AND event_id = ?')
    .bind(provider, eventId)
    .all<EventRow>();
  return results;
}

async function countRows(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

async function holdOf(userId: string): Promise<{ reason: string; set_by: string } | null> {
  return env.DB
    .prepare('SELECT reason, set_by FROM billing_standing_holds WHERE user_id = ?')
    .bind(userId)
    .first<{ reason: string; set_by: string }>();
}

/** A paid checkout on the world's invoice: the usual starting point for refunds and disputes. */
async function paidInvoiceCheckout(world: GatewayWorld): Promise<{ checkout: GatewayCheckoutRecord; paymentId: string }> {
  const checkout = await openCheckout(world);
  const paymentId = uid('pay');
  mp.setPayment(stubPayment({ id: paymentId, amountMinor: 15000, checkoutId: checkout.id }));
  expect(await outcomeOf(await deliver('mercadopago', paymentEvent(paymentId)))).toBe('applied');
  return { checkout, paymentId };
}

beforeAll(async () => {
  await applyMigrations(env.DB);
  await env.DB.exec('PRAGMA foreign_keys = ON');
});

beforeEach(() => {
  mp = new StubGatewayAdapter('mercadopago');
  stripe = new StubGatewayAdapter('stripe');
  sign(mp);
  sign(stripe);
  app = buildPaymentsTestApp(env as Env, 'mercadopago:pix+card,stripe:boleto', [mp, stripe]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a verified delivery for a paid payment', () => {
  it('lands exactly one gateway row, closes the checkout as paid and settles the event applied', async () => {
    const world = await seedGatewayWorld();
    const checkout = await openCheckout(world);
    const paymentId = uid('pay');
    mp.setPayment(stubPayment({ id: paymentId, amountMinor: 15000, checkoutId: checkout.id }));
    const event = paymentEvent(paymentId);

    const res = await deliver('mercadopago', event);

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ outcome: 'applied' });

    const rows = await invoicePayments(world.invoiceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amount_minor: 15000,
      method: 'gateway',
      external_reference: `mercadopago:${paymentId}`,
      recorded_by: SYSTEM_PAYMENT_ACTOR_ID,
      reverses_id: null,
    });

    expect(await gatewayRepo().getCheckout(checkout.id)).toMatchObject({
      status: 'paid',
      providerPaymentId: paymentId,
      invoicePaymentId: rows[0].id,
      chargePaymentId: null,
    });
    expect(await eventRows('mercadopago', event.eventId)).toEqual([
      expect.objectContaining({ outcome: 'applied', attempts: 1, checkout_id: checkout.id, type: 'payment', error: null }),
    ]);

    const invoice = await env.DB.prepare('SELECT status FROM invoices WHERE id = ?').bind(world.invoiceId).first<{ status: string }>();
    expect(invoice?.status).toBe('paid');
  });

  it('hands the adapter the raw body, lower-cased headers and the flattened query', async () => {
    const event = paymentEvent(uid('pay'));
    await deliver('mercadopago', event);

    const [call] = mp.callsTo('verifyWebhook');
    expect(JSON.parse(call.rawBody)).toEqual({ event, marker: BODY_MARKER });
    expect(call.headers['x-stub-signature']).toBe(webhookSecret('mercadopago'));
    expect(Object.keys(call.headers).every((name) => name === name.toLowerCase())).toBe(true);
    expect(call.query).toEqual({ source: 'test' });
  });

  it('lands what the provider captured, not what the checkout asked for', async () => {
    const world = await seedGatewayWorld();
    const checkout = await openCheckout(world);
    const paymentId = uid('pay');
    mp.setPayment(stubPayment({ id: paymentId, amountMinor: 16000, checkoutId: checkout.id }));

    expect(await outcomeOf(await deliver('mercadopago', paymentEvent(paymentId)))).toBe('applied');
    expect((await invoicePayments(world.invoiceId)).map((row) => row.amount_minor)).toEqual([16000]);
  });

  it('lands an event-charge payment on the extras ledger', async () => {
    const world = await seedGatewayWorld();
    const checkout = await openCheckout(world, { kind: 'event_charge' });
    const paymentId = uid('pay');
    mp.setPayment(stubPayment({ id: paymentId, amountMinor: 8000, checkoutId: checkout.id }));

    expect(await outcomeOf(await deliver('mercadopago', paymentEvent(paymentId)))).toBe('applied');

    const rows = await chargePayments(world.chargeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ external_reference: `mercadopago:${paymentId}`, method: 'gateway' });
    expect(await gatewayRepo().getCheckout(checkout.id)).toMatchObject({
      status: 'paid',
      chargePaymentId: rows[0].id,
      invoicePaymentId: null,
    });
    expect(await invoicePayments(world.invoiceId)).toHaveLength(0);
  });

  it.each(['expired', 'cancelled'] as const)('still lands on a checkout already %s, which becomes paid', async (status) => {
    const world = await seedGatewayWorld();
    const checkout = await openCheckout(world);
    await gatewayRepo().closeCheckout(checkout.id, { status: status as never });
    const paymentId = uid('pay');
    mp.setPayment(stubPayment({ id: paymentId, amountMinor: 15000, checkoutId: checkout.id }));

    expect(await outcomeOf(await deliver('mercadopago', paymentEvent(paymentId)))).toBe('applied');
    expect(await invoicePayments(world.invoiceId)).toHaveLength(1);
    expect((await gatewayRepo().getCheckout(checkout.id))?.status).toBe('paid');
  });
});

describe('idempotency', () => {
  it('answers a replay as duplicate any number of times, with one event row and one ledger row', async () => {
    const world = await seedGatewayWorld();
    const checkout = await openCheckout(world);
    const paymentId = uid('pay');
    mp.setPayment(stubPayment({ id: paymentId, amountMinor: 15000, checkoutId: checkout.id }));
    const event = paymentEvent(paymentId);

    expect(await outcomeOf(await deliver('mercadopago', event))).toBe('applied');
    const lookups = mp.callsTo('getPayment').length;
    for (let i = 0; i < 3; i += 1) {
      const res = await deliver('mercadopago', event);
      expect(res.status).toBe(200);
      expect(await outcomeOf(res)).toBe('duplicate');
    }

    expect(await eventRows('mercadopago', event.eventId)).toEqual([
      expect.objectContaining({ outcome: 'applied', attempts: 1 }),
    ]);
    expect(await invoicePayments(world.invoiceId)).toHaveLength(1);
    // A settled event is answered from the stored row: the provider is not asked again.
    expect(mp.callsTo('getPayment')).toHaveLength(lookups);
  });

  it('settles a second event about an already-landed payment as duplicate, adding no row', async () => {
    const world = await seedGatewayWorld();
    const { paymentId } = await paidInvoiceCheckout(world);
    const again = paymentEvent(paymentId);

    expect(await outcomeOf(await deliver('mercadopago', again))).toBe('duplicate');
    expect(await invoicePayments(world.invoiceId)).toHaveLength(1);
    expect((await eventRows('mercadopago', again.eventId))[0].outcome).toBe('duplicate');
  });

  it('leaves one ledger row when two deliveries about one payment race', async () => {
    const world = await seedGatewayWorld();
    const checkout = await openCheckout(world);
    const paymentId = uid('pay');
    mp.setPayment(stubPayment({ id: paymentId, amountMinor: 15000, checkoutId: checkout.id }));

    const responses = await Promise.all([
      deliver('mercadopago', paymentEvent(paymentId)),
      deliver('mercadopago', paymentEvent(paymentId)),
    ]);

    expect(responses.map((res) => res.status)).toEqual([200, 200]);
    expect((await Promise.all(responses.map(outcomeOf))).sort()).toEqual(['applied', 'duplicate']);
    expect(await invoicePayments(world.invoiceId)).toHaveLength(1);
    expect((await gatewayRepo().getCheckout(checkout.id))?.status).toBe('paid');
  });

  it('leaves one ledger row and one event row when the same delivery arrives twice at once', async () => {
    const world = await seedGatewayWorld();
    const checkout = await openCheckout(world);
    const paymentId = uid('pay');
    mp.setPayment(stubPayment({ id: paymentId, amountMinor: 15000, checkoutId: checkout.id }));
    const event = paymentEvent(paymentId);

    const responses = await Promise.all([deliver('mercadopago', event), deliver('mercadopago', event)]);

    expect(responses.map((res) => res.status)).toEqual([200, 200]);
    expect(await invoicePayments(world.invoiceId)).toHaveLength(1);
    const rows = await eventRows('mercadopago', event.eventId);
    expect(rows).toHaveLength(1);
    expect(['applied', 'duplicate']).toContain(rows[0].outcome);
  });

  it('lands the same bare payment id from two providers as two rows', async () => {
    const worldA = await seedGatewayWorld();
    const worldB = await seedGatewayWorld();
    const checkoutA = await openCheckout(worldA, { provider: 'mercadopago' });
    const checkoutB = await openCheckout(worldB, { provider: 'stripe' });
    const paymentId = uid('shared');
    mp.setPayment(stubPayment({ id: paymentId, amountMinor: 15000, checkoutId: checkoutA.id }));
    stripe.setPayment(stubPayment({ id: paymentId, amountMinor: 15000, checkoutId: checkoutB.id }));
    // Even the event id may coincide: events are keyed per provider too.
    const eventId = uid('evt');

    expect(await outcomeOf(await deliver('mercadopago', paymentEvent(paymentId, eventId)))).toBe('applied');
    expect(await outcomeOf(await deliver('stripe', paymentEvent(paymentId, eventId)))).toBe('applied');

    expect((await invoicePayments(worldA.invoiceId)).map((row) => row.external_reference)).toEqual([`mercadopago:${paymentId}`]);
    expect((await invoicePayments(worldB.invoiceId)).map((row) => row.external_reference)).toEqual([`stripe:${paymentId}`]);
  });
});

describe('a delivery that is not authentic', () => {
  it('answers 401 for a tampered delivery and writes nothing to any table', async () => {
    const world = await seedGatewayWorld();
    const checkout = await openCheckout(world);
    const paymentId = uid('pay');
    mp.setPayment(stubPayment({ id: paymentId, amountMinor: 15000, checkoutId: checkout.id }));
    const before = {
      events: await countRows('gateway_events'),
      payments: await countRows('payments'),
      chargePayments: await countRows('event_charge_payments'),
      holds: await countRows('billing_standing_holds'),
    };
    const logs = [
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'log').mockImplementation(() => {}),
    ];
    const event = paymentEvent(paymentId);

    const res = await deliver('mercadopago', event, { secret: 'forged' });

    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.text();
    expect(body).not.toContain(BODY_MARKER);
    expect(body).not.toContain(paymentId);

    expect({
      events: await countRows('gateway_events'),
      payments: await countRows('payments'),
      chargePayments: await countRows('event_charge_payments'),
      holds: await countRows('billing_standing_holds'),
    }).toEqual(before);
    expect(await gatewayRepo().getCheckout(checkout.id)).toMatchObject({
      status: 'open',
      failureDetail: null,
      providerPaymentId: null,
    });
    expect(mp.callsTo('getPayment')).toHaveLength(0);

    const logged = logs.flatMap((spy) => spy.mock.calls.map((call) => call.map(String).join(' '))).join('\n');
    expect(logged).not.toContain(BODY_MARKER);
    expect(logged).not.toContain(paymentId);
    expect(logged).not.toContain('forged');
  });

  it("answers 401 for a delivery signed with another provider's secret", async () => {
    const world = await seedGatewayWorld();
    const checkout = await openCheckout(world, { provider: 'stripe' });
    const paymentId = uid('pay');
    stripe.setPayment(stubPayment({ id: paymentId, amountMinor: 15000, checkoutId: checkout.id }));
    const event = paymentEvent(paymentId);

    const res = await deliver('stripe', event, { secret: webhookSecret('mercadopago') });

    expect(res.status).toBe(401);
    expect(await eventRows('stripe', event.eventId)).toHaveLength(0);
    expect(await invoicePayments(world.invoiceId)).toHaveLength(0);
    // Each provider's URL is verified by its own adapter only.
    expect(mp.callsTo('verifyWebhook')).toHaveLength(0);
    expect(stripe.callsTo('verifyWebhook')).toHaveLength(1);
  });
});

describe('verified but unusable', () => {
  it('records an orphan when the provider does not know the payment', async () => {
    const event = paymentEvent(uid('ghost'));

    const res = await deliver('mercadopago', event);

    expect(res.status).toBe(200);
    expect(await outcomeOf(res)).toBe('orphan');
    expect(await eventRows('mercadopago', event.eventId)).toEqual([
      expect.objectContaining({ outcome: 'orphan', checkout_id: null }),
    ]);
  });

  it('records an orphan when the payment names no checkout, or a checkout of another provider', async () => {
    const world = await seedGatewayWorld();
    const stripeCheckout = await openCheckout(world, { provider: 'stripe' });
    const bare = uid('pay');
    const foreign = uid('pay');
    mp.setPayment(stubPayment({ id: bare, checkoutId: null }));
    mp.setPayment(stubPayment({ id: foreign, amountMinor: 15000, checkoutId: stripeCheckout.id }));

    expect(await outcomeOf(await deliver('mercadopago', paymentEvent(bare)))).toBe('orphan');
    expect(await outcomeOf(await deliver('mercadopago', paymentEvent(foreign)))).toBe('orphan');

    expect(await invoicePayments(world.invoiceId)).toHaveLength(0);
    expect((await gatewayRepo().getCheckout(stripeCheckout.id))?.status).toBe('open');
    const exceptions = await gatewayRepo().listExceptions();
    expect(exceptions.filter((row) => row.kind === 'event' && row.event.providerPaymentId === foreign)).toHaveLength(1);
  });

  it('lands nothing on a currency mismatch: checkout and event are both mismatch', async () => {
    const world = await seedGatewayWorld();
    const checkout = await openCheckout(world);
    const paymentId = uid('pay');
    mp.setPayment(stubPayment({ id: paymentId, amountMinor: 15000, currency: 'USD', checkoutId: checkout.id }));
    const event = paymentEvent(paymentId);

    const res = await deliver('mercadopago', event);

    expect(res.status).toBe(200);
    expect(await outcomeOf(res)).toBe('mismatch');
    expect(await invoicePayments(world.invoiceId)).toHaveLength(0);
    const stored = await gatewayRepo().getCheckout(checkout.id);
    expect(stored?.status).toBe('mismatch');
    expect(stored?.failureDetail).toContain('currency mismatch');
    expect((await eventRows('mercadopago', event.eventId))[0]).toMatchObject({ outcome: 'mismatch', checkout_id: checkout.id });
  });

  it('turns a payment for a void invoice into an exception instead of a ledger row', async () => {
    const world = await seedGatewayWorld();
    const checkout = await openCheckout(world);
    await env.DB.prepare("UPDATE invoices SET status = 'void' WHERE id = ?").bind(world.invoiceId).run();
    const paymentId = uid('pay');
    mp.setPayment(stubPayment({ id: paymentId, amountMinor: 15000, checkoutId: checkout.id }));

    const res = await deliver('mercadopago', paymentEvent(paymentId));

    expect(res.status).toBe(200);
    expect(await outcomeOf(res)).toBe('mismatch');
    expect(await invoicePayments(world.invoiceId)).toHaveLength(0);
    expect(await gatewayRepo().getCheckout(checkout.id)).toMatchObject({
      status: 'mismatch',
      providerPaymentId: paymentId,
      failureDetail: 'payment not landed: the receivable is void',
    });
  });

  it('settles an event kind the adapter ignores as ignored, without asking the provider', async () => {
    const event: ProviderEvent = { kind: 'ignored', eventId: uid('evt'), type: 'merchant_order' };

    const res = await deliver('mercadopago', event);

    expect(await outcomeOf(res)).toBe('ignored');
    expect((await eventRows('mercadopago', event.eventId))[0]).toMatchObject({ outcome: 'ignored', type: 'merchant_order' });
    expect(mp.callsTo('getPayment')).toHaveLength(0);
  });
});

describe('the fetched status decides', () => {
  it('ignores a pending payment, and lands the later approval delivered as another event', async () => {
    const world = await seedGatewayWorld();
    const checkout = await openCheckout(world);
    const paymentId = uid('pay');
    mp.setPayment(stubPayment({ id: paymentId, status: 'pending', paidAt: null, amountMinor: 15000, checkoutId: checkout.id }));

    expect(await outcomeOf(await deliver('mercadopago', paymentEvent(paymentId)))).toBe('ignored');
    expect(await invoicePayments(world.invoiceId)).toHaveLength(0);
    expect((await gatewayRepo().getCheckout(checkout.id))?.status).toBe('open');

    mp.setPayment(stubPayment({ id: paymentId, amountMinor: 15000, checkoutId: checkout.id }));
    expect(await outcomeOf(await deliver('mercadopago', paymentEvent(paymentId)))).toBe('applied');
    expect(await invoicePayments(world.invoiceId)).toHaveLength(1);
    expect((await gatewayRepo().getCheckout(checkout.id))?.status).toBe('paid');
  });

  it.each(['failed', 'expired'] as const)('ignores a %s payment, keeps the checkout open and notes the status', async (status) => {
    const world = await seedGatewayWorld();
    const checkout = await openCheckout(world);
    const paymentId = uid('pay');
    mp.setPayment(stubPayment({ id: paymentId, status, paidAt: null, checkoutId: checkout.id }));

    expect(await outcomeOf(await deliver('mercadopago', paymentEvent(paymentId)))).toBe('ignored');
    expect(await gatewayRepo().getCheckout(checkout.id)).toMatchObject({ status: 'open', failureDetail: `payment ${status}` });
    expect(await invoicePayments(world.invoiceId)).toHaveLength(0);
  });

  it('books a paid payment that carries no paidAt on the day the event occurred', async () => {
    const world = await seedGatewayWorld();
    const checkout = await openCheckout(world);
    const paymentId = uid('pay');
    mp.setPayment(stubPayment({ id: paymentId, paidAt: null, amountMinor: 15000, checkoutId: checkout.id }));

    expect(await outcomeOf(await deliver('mercadopago', paymentEvent(paymentId)))).toBe('applied');
    const row = await env.DB.prepare('SELECT paid_at FROM payments WHERE invoice_id = ?').bind(world.invoiceId).first<{ paid_at: string }>();
    expect(row?.paid_at).toBe('2026-01-12');
  });
});

describe('our own failure', () => {
  it('answers 503 with the event stored failed, and a redelivery ends applied with attempts = 2', async () => {
    const world = await seedGatewayWorld();
    const checkout = await openCheckout(world);
    const paymentId = uid('pay');
    mp.setPayment(stubPayment({ id: paymentId, amountMinor: 15000, checkoutId: checkout.id }));
    mp.failLookups(new Error(`provider 502: ${BODY_MARKER} ${stubSecretKey('mercadopago')}`));
    const event = paymentEvent(paymentId);
    const logs = [
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
    ];

    const failed = await deliver('mercadopago', event);

    expect(failed.status).toBe(503);
    expect(failed.headers.get('Cache-Control')).toBe('no-store');
    const body = await failed.text();
    expect(JSON.parse(body)).toEqual({ error: 'PAYMENTS_EVENT_FAILED' });
    const [stored] = await eventRows('mercadopago', event.eventId);
    expect(stored).toMatchObject({ outcome: 'failed', attempts: 1 });
    // Neither the stored error nor a log line repeats what the provider said.
    expect(stored.error).not.toContain(BODY_MARKER);
    expect(stored.error).not.toContain(stubSecretKey('mercadopago'));
    const logged = logs.flatMap((spy) => spy.mock.calls.map((call) => call.map(String).join(' '))).join('\n');
    expect(logged).not.toContain(BODY_MARKER);
    expect(logged).not.toContain(stubSecretKey('mercadopago'));
    expect(await invoicePayments(world.invoiceId)).toHaveLength(0);

    mp.failLookups(null);
    const retried = await deliver('mercadopago', event);

    expect(retried.status).toBe(200);
    expect(await outcomeOf(retried)).toBe('applied');
    expect(await eventRows('mercadopago', event.eventId)).toEqual([
      expect.objectContaining({ outcome: 'applied', attempts: 2, error: null }),
    ]);
    expect(await invoicePayments(world.invoiceId)).toHaveLength(1);
  });
});

describe('provider-side refunds', () => {
  it('lands a refund reported as one more payment update as its own negative row', async () => {
    const world = await seedGatewayWorld();
    const { checkout, paymentId } = await paidInvoiceCheckout(world);
    const refundId = uid('refund');
    mp.setPayment(
      stubPayment({
        id: paymentId,
        amountMinor: 15000,
        checkoutId: checkout.id,
        refunds: [{ id: refundId, amountMinor: 5000, createdAt: '2026-01-15T10:00:00.000Z' }],
      }),
    );

    // The event calls itself a payment update; the fetched refunds decide.
    expect(await outcomeOf(await deliver('mercadopago', paymentEvent(paymentId)))).toBe('applied');

    const rows = await invoicePayments(world.invoiceId);
    expect(rows.map((row) => row.amount_minor)).toEqual([15000, -5000]);
    expect(rows[1]).toMatchObject({
      method: 'gateway',
      external_reference: `mercadopago:${refundId}`,
      reverses_id: null,
      recorded_by: SYSTEM_PAYMENT_ACTOR_ID,
      note: `provider refund ${refundId}`,
    });

    // The refund event that follows finds everything already there.
    const refundEvent: ProviderEvent = { kind: 'refund', eventId: uid('evt'), paymentId, refundId, occurredAt: '2026-01-15T10:00:05.000Z' };
    expect(await outcomeOf(await deliver('mercadopago', refundEvent))).toBe('duplicate');
    expect(await invoicePayments(world.invoiceId)).toHaveLength(2);
  });

  it('lands a refunded payment that never landed first, then each of its refunds', async () => {
    const world = await seedGatewayWorld();
    const checkout = await openCheckout(world, { kind: 'event_charge' });
    const paymentId = uid('pay');
    mp.setPayment(
      stubPayment({
        id: paymentId,
        status: 'refunded',
        amountMinor: 8000,
        checkoutId: checkout.id,
        refunds: [
          { id: uid('refund'), amountMinor: 3000, createdAt: '2026-01-15T10:00:00.000Z' },
          { id: uid('refund'), amountMinor: 5000, createdAt: '2026-01-16T10:00:00.000Z' },
        ],
      }),
    );

    expect(await outcomeOf(await deliver('mercadopago', paymentEvent(paymentId)))).toBe('applied');

    expect((await chargePayments(world.chargeId)).map((row) => row.amount_minor)).toEqual([8000, -3000, -5000]);
    expect((await gatewayRepo().getCheckout(checkout.id))?.status).toBe('paid');
  });
});

describe('disputes', () => {
  it('opened raises the contract hold by the system actor and writes no ledger row; won releases it', async () => {
    const world = await seedGatewayWorld();
    const { checkout, paymentId } = await paidInvoiceCheckout(world);

    expect(await outcomeOf(await deliver('mercadopago', disputeEvent(paymentId, 'opened')))).toBe('applied');

    expect(await holdOf(world.studentId)).toEqual({ reason: DISPUTE_HOLD_REASON, set_by: SYSTEM_PAYMENT_ACTOR_ID });
    const standing = await app.container().billing.billingService.getStanding(world.studentId);
    expect(standing.ok && standing.data.standing).toBe('exempt');
    expect(await invoicePayments(world.invoiceId)).toHaveLength(1);
    expect((await gatewayRepo().getCheckout(checkout.id))?.failureDetail).toBe('dispute opened');
    expect((await gatewayRepo().listExceptions()).some((row) => row.kind === 'checkout' && row.checkout.id === checkout.id)).toBe(true);

    expect(await outcomeOf(await deliver('mercadopago', disputeEvent(paymentId, 'won')))).toBe('applied');

    expect(await holdOf(world.studentId)).toBeNull();
    expect(await invoicePayments(world.invoiceId)).toHaveLength(1);
    expect((await gatewayRepo().getCheckout(checkout.id))?.failureDetail).toBe('dispute won');
  });

  it('lost books a negative row keyed on the dispute and releases the hold', async () => {
    const world = await seedGatewayWorld();
    const { paymentId } = await paidInvoiceCheckout(world);
    await deliver('mercadopago', disputeEvent(paymentId, 'opened'));
    expect(await holdOf(world.studentId)).not.toBeNull();

    expect(await outcomeOf(await deliver('mercadopago', disputeEvent(paymentId, 'lost')))).toBe('applied');

    const rows = await invoicePayments(world.invoiceId);
    expect(rows.map((row) => row.amount_minor)).toEqual([15000, -15000]);
    expect(rows[1]).toMatchObject({
      external_reference: `mercadopago:dispute-${paymentId}`,
      reverses_id: null,
      note: `provider dispute dispute-${paymentId}`,
    });
    expect(await holdOf(world.studentId)).toBeNull();

    // A second `lost` under another event id adds nothing.
    expect(await outcomeOf(await deliver('mercadopago', disputeEvent(paymentId, 'lost')))).toBe('duplicate');
    expect(await invoicePayments(world.invoiceId)).toHaveLength(2);
  });

  it('treats a fetched status of disputed as an opened dispute, whatever the event is called', async () => {
    const world = await seedGatewayWorld();
    const checkout = await openCheckout(world);
    const paymentId = uid('pay');
    mp.setPayment(stubPayment({ id: paymentId, status: 'disputed', amountMinor: 15000, checkoutId: checkout.id }));

    expect(await outcomeOf(await deliver('mercadopago', paymentEvent(paymentId)))).toBe('applied');

    // The captured money lands first; the dispute itself writes no row.
    expect((await invoicePayments(world.invoiceId)).map((row) => row.amount_minor)).toEqual([15000]);
    expect(await gatewayRepo().getCheckout(checkout.id)).toMatchObject({ status: 'paid', failureDetail: 'dispute opened' });
    expect((await holdOf(world.studentId))?.set_by).toBe(SYSTEM_PAYMENT_ACTOR_ID);
  });

  it('never raises a hold for an event charge: the dispute is the exception row only', async () => {
    const world = await seedGatewayWorld();
    const checkout = await openCheckout(world, { kind: 'event_charge' });
    const paymentId = uid('pay');
    mp.setPayment(stubPayment({ id: paymentId, amountMinor: 8000, checkoutId: checkout.id }));
    await deliver('mercadopago', paymentEvent(paymentId));

    expect(await outcomeOf(await deliver('mercadopago', disputeEvent(paymentId, 'opened')))).toBe('applied');

    expect(await holdOf(world.studentId)).toBeNull();
    expect((await gatewayRepo().getCheckout(checkout.id))?.failureDetail).toBe('dispute opened');
  });

  it("leaves an admin's own hold in place, on open and on close", async () => {
    const world = await seedGatewayWorld();
    const { paymentId } = await paidInvoiceCheckout(world);
    await env.DB
      .prepare('INSERT INTO billing_standing_holds (user_id, reason, expires_at, set_by) VALUES (?, ?, NULL, ?)')
      .bind(world.studentId, 'scholarship', world.adminId)
      .run();

    await deliver('mercadopago', disputeEvent(paymentId, 'opened'));
    expect(await holdOf(world.studentId)).toEqual({ reason: 'scholarship', set_by: world.adminId });

    await deliver('mercadopago', disputeEvent(paymentId, 'won'));
    expect(await holdOf(world.studentId)).toEqual({ reason: 'scholarship', set_by: world.adminId });
  });

  it('returns a dismissed checkout to the exceptions list on a new dispute state', async () => {
    const world = await seedGatewayWorld();
    const { checkout, paymentId } = await paidInvoiceCheckout(world);
    await deliver('mercadopago', disputeEvent(paymentId, 'opened'));
    await gatewayRepo().dismissException({ kind: 'checkout', checkoutId: checkout.id }, { dismissedBy: world.adminId, note: 'seen' });
    const listed = async (): Promise<boolean> =>
      (await gatewayRepo().listExceptions()).some((row) => row.kind === 'checkout' && row.checkout.id === checkout.id);
    expect(await listed()).toBe(false);

    // The same state again is not news: the dismissal stands.
    expect(await outcomeOf(await deliver('mercadopago', disputeEvent(paymentId, 'opened')))).toBe('duplicate');
    expect(await listed()).toBe(false);

    await deliver('mercadopago', disputeEvent(paymentId, 'lost'));
    expect(await listed()).toBe(true);
    expect((await gatewayRepo().getCheckout(checkout.id))?.dismissedAt).toBeNull();
  });
});

describe('the pipeline before verification', () => {
  it('answers 404 for every provider name while PAYMENTS_PROVIDERS is none', async () => {
    for (const provider of ['mercadopago', 'stripe', 'asaas', 'pagarme', 'unknown']) {
      const request = new IncomingRequest(`http://example.com${v1(`/webhooks/payments/${provider}`)}`, {
        method: 'POST',
        headers: { 'CF-Connecting-IP': `198.51.100.${++ipCounter % 250}-${ipCounter}` },
        body: '{}',
      });
      const ctx = createExecutionContext();
      // The Worker itself: the production factory map and the committed `none`.
      const res = await worker.fetch(request, env as AppEnv, ctx);
      await waitOnExecutionContext(ctx);

      expect(res.status, provider).toBe(404);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('answers 404 for a provider this label does not bind, without reading or verifying anything', async () => {
    const before = await countRows('gateway_events');

    expect((await deliver('asaas', paymentEvent(uid('pay')))).status).toBe(404);
    expect((await deliver('not-a-provider', paymentEvent(uid('pay')))).status).toBe(404);

    expect(await countRows('gateway_events')).toBe(before);
    expect(mp.callsTo('verifyWebhook')).toHaveLength(0);
    expect(stripe.callsTo('verifyWebhook')).toHaveLength(0);
  });

  it('answers 500 PAYMENTS_CONFIG_INVALID when the configuration is invalid, verifying nothing', async () => {
    const broken = buildPaymentsTestApp(env as Env, 'mercadopago:pix+card', [mp], {
      // A live key under PAYMENTS_KEY_MODE = test.
      [paymentSecretKeyVar('mercadopago')]: stubSecretKey('mercadopago', 'live'),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await deliver('mercadopago', paymentEvent(uid('pay')), { target: broken });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'PAYMENTS_CONFIG_INVALID' });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(mp.callsTo('verifyWebhook')).toHaveLength(0);
    // A name the platform does not know is still a plain 404.
    expect((await deliver('unknown', paymentEvent(uid('pay')), { target: broken })).status).toBe(404);
  });

  it('answers 413 for a body above 64 KiB, before any verification', async () => {
    const body = JSON.stringify({ event: paymentEvent(uid('pay')), padding: 'x'.repeat(70 * 1024) });
    const request = new IncomingRequest(`http://example.com${v1('/webhooks/payments/mercadopago')}`, {
      method: 'POST',
      headers: {
        'CF-Connecting-IP': `198.51.100.${++ipCounter % 250}-${ipCounter}`,
        'Content-Length': String(body.length),
        'X-Stub-Signature': webhookSecret('mercadopago'),
      },
      body,
    });
    const before = await countRows('gateway_events');

    const res = await app.fetch(request, createExecutionContext());

    expect(res.status).toBe(413);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(mp.callsTo('verifyWebhook')).toHaveLength(0);
    expect(await countRows('gateway_events')).toBe(before);
  });

  it('lets 120 deliveries a minute through from one IP and answers 429 on the next, reading nothing', async () => {
    const ip = '192.0.2.77';
    const event: ProviderEvent = { kind: 'ignored', eventId: uid('evt'), type: 'noise' };

    for (let i = 0; i < 120; i += 1) {
      expect((await deliver('mercadopago', event, { ip })).status, `delivery ${i + 1}`).toBe(200);
    }
    const verified = mp.callsTo('verifyWebhook').length;

    const blocked = await deliver('mercadopago', event, { ip });

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).not.toBeNull();
    expect(blocked.headers.get('Cache-Control')).toBe('no-store');
    expect(mp.callsTo('verifyWebhook')).toHaveLength(verified);
    // Another address is not affected.
    expect((await deliver('mercadopago', event)).status).toBe(200);
  });

  it('never resolves a user: a bearer token on the delivery changes nothing', async () => {
    const event: ProviderEvent = { kind: 'ignored', eventId: uid('evt'), type: 'noise' };
    const request = new IncomingRequest(`http://example.com${v1('/webhooks/payments/mercadopago')}`, {
      method: 'POST',
      headers: {
        'CF-Connecting-IP': `198.51.100.${++ipCounter % 250}-${ipCounter}`,
        Authorization: 'Bearer not-a-token',
        'X-Stub-Signature': webhookSecret('mercadopago'),
      },
      body: JSON.stringify({ event }),
    });

    const res = await app.fetch(request, createExecutionContext());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: 'ignored' });
  });
});
