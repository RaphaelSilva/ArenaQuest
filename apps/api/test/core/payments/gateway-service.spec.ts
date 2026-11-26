import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CHECKOUT_IN_PROGRESS,
  CHECKOUT_REUSE_MIN_MS,
  CHECKOUT_TTL_MS,
  GatewayService,
  PAYMENT_PROVIDER_REQUIRED,
  PAYMENTS_PROVIDER_ERROR,
  PAYMENTS_UNSUPPORTED_CURRENCY,
  RECEIVABLE_NOT_PAYABLE,
  disputeReference,
  eventFromRecord,
  isSettledEventOutcome,
  storedEventType,
  type GatewayContractLedger,
  type GatewayExtrasLedger,
} from '@api/core/payments/gateway-service';
import { BillingService, DISPUTE_HOLD_REASON } from '@api/core/billing/billing-service';
import { SYSTEM_PAYMENT_ACTOR_ID } from '@api/adapters/db/d1-gateway-repository';
import { Entities } from '@arenaquest/shared/types/entities';
import type {
  GatewayCheckoutRecord,
  GatewayEventRecord,
  IGatewayRepository,
  MarkGatewayEventInput,
} from '@arenaquest/shared/ports/i-gateway-repository';
import type { ProviderEvent, ProviderPayment } from '@arenaquest/shared/ports/i-payment-gateway';
import type { IRateLimiter } from '@arenaquest/shared/ports/i-rate-limiter';
import { PAYMENTS_CONFIG_INVALID } from '@api/core/payments/config';
import { buildPaymentsWiring } from '@api/core/payments/gateway-registry';
import { toPendingCheckout } from '@api/core/billing/accounting-service';
import { FakeBillingRepository } from '../../helpers/fake-billing-repository';
import {
  StubGatewayAdapter,
  stubGatewayFactories,
  stubPayment,
  stubPaymentsEnv,
} from '../../adapters/payment/stub-gateway-adapter';

/**
 * `GatewayService` against in-memory doubles: the rules that are awkward to
 * reach through the route — a store that fails at each step, an event row
 * replayed from storage, dispute ordering — and the dispute hold itself on the
 * real `BillingService`. The end-to-end scenarios (real D1, real entry points)
 * live in `test/routes/payments-webhook.router.spec.ts`.
 */

const { CheckoutStatus, GatewayEventOutcome } = Entities.Config;

const STUDENT = 'student-1';
const INVOICE = 'invoice-1';
const CHARGE = 'charge-1';

type Key = string;
const key = (provider: string, eventId: string): Key => `${provider}:${eventId}`;

/** Just enough of the port: checkouts by id, events by key, and switches that make a write throw. */
class MemoryGatewayRepo {
  readonly checkouts = new Map<string, GatewayCheckoutRecord>();
  readonly events = new Map<Key, GatewayEventRecord>();
  failRecord = false;
  /** Outcomes whose `markEvent` throws, as a store outage would. */
  failMarks = new Set<string>();

  addCheckout(overrides: Partial<GatewayCheckoutRecord> = {}): GatewayCheckoutRecord {
    const checkout: GatewayCheckoutRecord = {
      id: `checkout-${this.checkouts.size + 1}`,
      provider: 'mercadopago',
      receivableKind: 'invoice',
      receivableId: INVOICE,
      userId: STUDENT,
      createdBy: STUDENT,
      amountMinor: 15000,
      currency: 'BRL',
      status: CheckoutStatus.OPEN,
      providerSessionId: 'session-1',
      providerPaymentId: null,
      invoicePaymentId: null,
      chargePaymentId: null,
      checkoutUrl: 'https://pay.invalid/x',
      expiresAt: '2099-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      closedAt: null,
      lastCheckedAt: null,
      failureDetail: null,
      dismissedAt: null,
      dismissedBy: null,
      dismissNote: null,
      ...overrides,
    };
    this.checkouts.set(checkout.id, checkout);
    return checkout;
  }

  async getCheckout(id: string) {
    return this.checkouts.get(id) ?? null;
  }

  /** Makes the next `createCheckout` lose the one-open-row index to a twin written just before it. */
  raceWith: Partial<GatewayCheckoutRecord> | null = null;

  /** Plays `idx_gateway_checkouts_one_open`: a second open row for a receivable throws. */
  async createCheckout(input: {
    id: string;
    provider: GatewayCheckoutRecord['provider'];
    receivableKind: GatewayCheckoutRecord['receivableKind'];
    receivableId: string;
    userId: string;
    createdBy: string;
    amountMinor: number;
    currency: string;
    checkoutUrl: string;
    expiresAt: string;
  }) {
    if (this.raceWith) {
      this.addCheckout({ ...input, id: 'twin', providerSessionId: null, ...this.raceWith });
      this.raceWith = null;
    }
    if (await this.findOpenCheckout(input.receivableKind, input.receivableId)) {
      throw new Error('D1_ERROR: UNIQUE constraint failed: gateway_checkouts.receivable_kind');
    }
    return this.addCheckout({ ...input, providerSessionId: null });
  }

  async findOpenCheckout(kind: string, id: string) {
    return (
      [...this.checkouts.values()].find(
        (row) => row.receivableKind === kind && row.receivableId === id && row.status === CheckoutStatus.OPEN,
      ) ?? null
    );
  }

  open(): GatewayCheckoutRecord[] {
    return [...this.checkouts.values()].filter((row) => row.status === CheckoutStatus.OPEN);
  }

  async updateCheckout(
    id: string,
    patch: {
      failureDetail?: string | null;
      clearDismissal?: boolean;
      providerSessionId?: string;
      checkoutUrl?: string;
      expiresAt?: string;
    },
  ) {
    const row = this.checkouts.get(id);
    if (!row) return null;
    const next = { ...row };
    if (patch.providerSessionId !== undefined) next.providerSessionId = patch.providerSessionId;
    if (patch.checkoutUrl !== undefined) next.checkoutUrl = patch.checkoutUrl;
    if (patch.expiresAt !== undefined) next.expiresAt = patch.expiresAt;
    if (patch.failureDetail !== undefined) next.failureDetail = patch.failureDetail;
    if (patch.clearDismissal) next.dismissedAt = null;
    this.checkouts.set(id, next);
    return next;
  }

  async closeCheckout(
    id: string,
    input: {
      status: GatewayCheckoutRecord['status'];
      from?: ReadonlyArray<GatewayCheckoutRecord['status']>;
      providerPaymentId?: string;
      invoicePaymentId?: string;
      chargePaymentId?: string;
      failureDetail?: string | null;
    },
  ) {
    const row = this.checkouts.get(id);
    if (!row || !(input.from ?? [CheckoutStatus.OPEN]).includes(row.status)) return null;
    const next: GatewayCheckoutRecord = {
      ...row,
      status: input.status,
      providerPaymentId: input.providerPaymentId ?? row.providerPaymentId,
      invoicePaymentId: input.invoicePaymentId ?? row.invoicePaymentId,
      chargePaymentId: input.chargePaymentId ?? row.chargePaymentId,
      failureDetail: input.failureDetail !== undefined ? input.failureDetail : row.failureDetail,
    };
    this.checkouts.set(id, next);
    return next;
  }

  async recordEvent(input: { provider: 'mercadopago'; eventId: string; type: string; providerPaymentId?: string | null }) {
    if (this.failRecord) throw new Error('D1_ERROR: unavailable');
    const existing = this.events.get(key(input.provider, input.eventId));
    if (existing) return { inserted: false, event: existing };
    const event: GatewayEventRecord = {
      provider: input.provider,
      eventId: input.eventId,
      type: input.type,
      providerPaymentId: input.providerPaymentId ?? null,
      checkoutId: null,
      receivedAt: '2026-01-12T14:03:00.000Z',
      processedAt: null,
      outcome: GatewayEventOutcome.RECEIVED,
      attempts: 1,
      error: null,
      dismissedAt: null,
      dismissedBy: null,
      dismissNote: null,
    };
    this.events.set(key(input.provider, input.eventId), event);
    return { inserted: true, event };
  }

  async markEvent(provider: string, eventId: string, input: MarkGatewayEventInput) {
    if (this.failMarks.has(input.outcome)) throw new Error('D1_ERROR: unavailable');
    const row = this.events.get(key(provider, eventId));
    if (!row || isSettledEventOutcome(row.outcome)) return null;
    const next: GatewayEventRecord = {
      ...row,
      outcome: input.outcome,
      attempts: row.attempts + (input.countAttempt ? 1 : 0),
      checkoutId: input.checkoutId !== undefined ? input.checkoutId : row.checkoutId,
      error: input.error !== undefined ? input.error : row.error,
    };
    this.events.set(key(provider, eventId), next);
    return next;
  }
}

interface LedgerEntry {
  receivableId: string;
  amountMinor: number;
  externalReference: string;
  paidAt: string;
  kind?: string;
}

/** Both rails' entry points, idempotent on the reference like the real ones. */
function fakeLedger() {
  const rows: LedgerEntry[] = [];
  const holds = { raised: 0, released: 0 };
  let refuse: { status: number } | null = null;

  const write = (receivableId: string, command: Omit<LedgerEntry, 'receivableId'>, sign: 1 | -1) => {
    const known = rows.find((row) => row.externalReference === command.externalReference);
    if (known) return { ok: true as const, data: { payment: { id: `row-${rows.indexOf(known) + 1}` }, created: false } };
    rows.push({ ...command, receivableId, amountMinor: sign * command.amountMinor });
    return { ok: true as const, data: { payment: { id: `row-${rows.length}` }, created: true } };
  };

  const makeRail = () => ({
    recordGatewayPayment: vi.fn(async (id: string, command: Omit<LedgerEntry, 'receivableId'>) =>
      refuse ? { ok: false as const, status: refuse.status, error: 'Conflict' } : write(id, command, 1),
    ),
    recordGatewayRefund: vi.fn(async (id: string, command: Omit<LedgerEntry, 'receivableId'>) => write(id, command, -1)),
  });
  const billing = {
    ...makeRail(),
    raiseDisputeHold: vi.fn(async () => {
      holds.raised += 1;
      return { ok: true as const, data: { raised: true } };
    }),
    releaseDisputeHold: vi.fn(async () => {
      holds.released += 1;
      return { ok: true as const, data: { released: true } };
    }),
  };

  return {
    rows,
    holds,
    refuseWith: (status: number | null) => {
      refuse = status === null ? null : { status };
    },
    billing: billing as unknown as GatewayContractLedger,
    charges: makeRail() as unknown as GatewayExtrasLedger,
  };
}

describe('GatewayService', () => {
  let repo: MemoryGatewayRepo;
  let mp: StubGatewayAdapter;
  let ledger: ReturnType<typeof fakeLedger>;
  let service: GatewayService;
  let info: ReturnType<typeof vi.spyOn>;
  let seq = 0;

  const paymentEvent = (paymentId: string, eventId = `evt-${++seq}`): ProviderEvent => ({
    kind: 'payment',
    eventId,
    paymentId,
    occurredAt: '2026-01-12T14:03:00.000Z',
  });
  const disputeEvent = (paymentId: string, outcome: 'opened' | 'won' | 'lost'): ProviderEvent => ({
    kind: 'dispute',
    eventId: `evt-${++seq}`,
    paymentId,
    outcome,
    occurredAt: '2026-01-20T09:00:00.000Z',
  });
  const paid = (checkout: GatewayCheckoutRecord, overrides: Partial<ProviderPayment> = {}): ProviderPayment => {
    const payment = stubPayment({ id: 'pay-1', amountMinor: 15000, checkoutId: checkout.id, ...overrides });
    mp.setPayment(payment);
    return payment;
  };
  const stored = (eventId: string): GatewayEventRecord => repo.events.get(key('mercadopago', eventId))!;

  beforeEach(() => {
    repo = new MemoryGatewayRepo();
    mp = new StubGatewayAdapter('mercadopago');
    ledger = fakeLedger();
    service = new GatewayService({
      gateways: { get: (provider) => (provider === 'mercadopago' ? mp : null) },
      gatewayRepo: repo as unknown as IGatewayRepository,
      billing: ledger.billing,
      charges: ledger.charges,
      now: () => new Date('2026-02-01T00:00:00.000Z'),
    });
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleEvent', () => {
    it('lands a paid payment, closes the checkout and settles the event', async () => {
      const checkout = repo.addCheckout();
      paid(checkout);
      const event = paymentEvent('pay-1');

      const result = await service.handleEvent('mercadopago', event);

      expect(result).toEqual({
        outcome: 'applied',
        provider: 'mercadopago',
        eventId: event.eventId,
        checkoutId: checkout.id,
        providerPaymentId: 'pay-1',
      });
      expect(ledger.rows).toEqual([
        { receivableId: INVOICE, amountMinor: 15000, currency: 'BRL', paidAt: '2026-01-01T00:00:00.000Z', externalReference: 'mercadopago:pay-1' },
      ]);
      expect(repo.checkouts.get(checkout.id)).toMatchObject({ status: 'paid', providerPaymentId: 'pay-1', invoicePaymentId: 'row-1' });
      expect(stored(event.eventId)).toMatchObject({ outcome: 'applied', attempts: 1, checkoutId: checkout.id });
    });

    it('answers a settled event from the stored row: no fetch, no write', async () => {
      const checkout = repo.addCheckout();
      paid(checkout);
      const event = paymentEvent('pay-1');
      await service.handleEvent('mercadopago', event);
      const snapshot = { ...stored(event.eventId) };
      const lookups = mp.callsTo('getPayment').length;

      const result = await service.handleEvent('mercadopago', event);

      expect(result.outcome).toBe('duplicate');
      expect(result.checkoutId).toBe(checkout.id);
      expect(stored(event.eventId)).toEqual(snapshot);
      expect(mp.callsTo('getPayment')).toHaveLength(lookups);
      expect(ledger.rows).toHaveLength(1);
    });

    it.each(['received', 'failed'] as const)('processes an event stored %s again, counting the attempt', async (outcome) => {
      const checkout = repo.addCheckout();
      paid(checkout);
      const event = paymentEvent('pay-1');
      await repo.recordEvent({ provider: 'mercadopago', eventId: event.eventId, type: 'payment', providerPaymentId: 'pay-1' });
      if (outcome === 'failed') await repo.markEvent('mercadopago', event.eventId, { outcome: GatewayEventOutcome.FAILED, error: 'processing failed (Error)' });

      const result = await service.handleEvent('mercadopago', event);

      expect(result.outcome).toBe('applied');
      expect(stored(event.eventId)).toMatchObject({ outcome: 'applied', attempts: 2, error: null });
    });

    it('stores a failure as the error class only, never what the provider said', async () => {
      const checkout = repo.addCheckout();
      paid(checkout);
      mp.failLookups(new TypeError('upstream said: {"card":"4111"} secret=TEST-abc'));
      const event = paymentEvent('pay-1');

      const result = await service.handleEvent('mercadopago', event);

      expect(result.outcome).toBe('failed');
      expect(stored(event.eventId)).toMatchObject({ outcome: 'failed', error: 'processing failed (TypeError)' });
      const logged = info.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).not.toContain('4111');
      expect(logged).not.toContain('TEST-abc');
    });

    it('answers failed when the event cannot even be recorded, and writes nothing', async () => {
      const checkout = repo.addCheckout();
      paid(checkout);
      repo.failRecord = true;

      const result = await service.handleEvent('mercadopago', paymentEvent('pay-1'));

      expect(result.outcome).toBe('failed');
      expect(repo.events.size).toBe(0);
      expect(ledger.rows).toHaveLength(0);
      expect(mp.callsTo('getPayment')).toHaveLength(0);
    });

    it('leaves the row received when even the failure cannot be written, so a redelivery retries', async () => {
      const checkout = repo.addCheckout();
      paid(checkout);
      mp.failLookups(new Error('timeout'));
      repo.failMarks.add(GatewayEventOutcome.FAILED);
      const event = paymentEvent('pay-1');

      expect((await service.handleEvent('mercadopago', event)).outcome).toBe('failed');
      expect(stored(event.eventId).outcome).toBe('received');

      mp.failLookups(null);
      repo.failMarks.clear();
      expect((await service.handleEvent('mercadopago', event)).outcome).toBe('applied');
      expect(stored(event.eventId)).toMatchObject({ outcome: 'applied', attempts: 2 });
    });

    it('finishes a landing that died before the checkout closed: the row is found, the checkout closes', async () => {
      const checkout = repo.addCheckout();
      paid(checkout);
      repo.failMarks.add(GatewayEventOutcome.APPLIED);
      const event = paymentEvent('pay-1');
      // The first attempt lands and closes, then dies writing the outcome.
      expect((await service.handleEvent('mercadopago', event)).outcome).toBe('failed');
      expect(ledger.rows).toHaveLength(1);
      repo.checkouts.set(checkout.id, { ...repo.checkouts.get(checkout.id)!, status: CheckoutStatus.OPEN, invoicePaymentId: null });
      repo.failMarks.clear();

      const retried = await service.handleEvent('mercadopago', event);

      expect(retried.outcome).toBe('duplicate');
      expect(ledger.rows).toHaveLength(1);
      expect(repo.checkouts.get(checkout.id)).toMatchObject({ status: 'paid', invoicePaymentId: 'row-1' });
    });

    it('routes an event-charge checkout to the extras rail', async () => {
      const checkout = repo.addCheckout({ receivableKind: 'event_charge', receivableId: CHARGE, amountMinor: 8000 });
      paid(checkout, { amountMinor: 8000 });

      await service.handleEvent('mercadopago', paymentEvent('pay-1'));

      expect(ledger.charges.recordGatewayPayment).toHaveBeenCalledTimes(1);
      expect(ledger.billing.recordGatewayPayment).not.toHaveBeenCalled();
      expect(repo.checkouts.get(checkout.id)).toMatchObject({ status: 'paid', chargePaymentId: 'row-1', invoicePaymentId: null });
    });

    it.each([
      [409, 'payment not landed: the receivable is void'],
      [404, 'payment not landed: refused by the ledger (404)'],
    ])('turns a %i from the ledger into a mismatch, landing no refund either', async (status, detail) => {
      const checkout = repo.addCheckout();
      paid(checkout, { refunds: [{ id: 'refund-1', amountMinor: 5000, createdAt: '2026-01-15T00:00:00.000Z' }] });
      ledger.refuseWith(status);

      const result = await service.handleEvent('mercadopago', paymentEvent('pay-1'));

      expect(result.outcome).toBe('mismatch');
      expect(ledger.rows).toHaveLength(0);
      expect(repo.checkouts.get(checkout.id)).toMatchObject({ status: 'mismatch', failureDetail: detail });
    });
  });

  describe('disputes', () => {
    it('subtracts what was already refunded from a lost dispute', async () => {
      const checkout = repo.addCheckout();
      paid(checkout, { refunds: [{ id: 'refund-1', amountMinor: 5000, createdAt: '2026-01-15T00:00:00.000Z' }] });

      await service.handleEvent('mercadopago', disputeEvent('pay-1', 'lost'));

      expect(ledger.rows.map((row) => [row.externalReference, row.amountMinor, row.kind])).toEqual([
        ['mercadopago:pay-1', 15000, undefined],
        ['mercadopago:refund-1', -5000, undefined],
        [disputeReference('mercadopago', 'pay-1'), -10000, 'dispute'],
      ]);
      expect(ledger.rows[2].paidAt).toBe('2026-01-20T09:00:00.000Z');
      expect(ledger.holds).toEqual({ raised: 0, released: 1 });
    });

    it('does not re-raise the hold when the same opened state is delivered again', async () => {
      const checkout = repo.addCheckout();
      paid(checkout);

      expect((await service.handleEvent('mercadopago', disputeEvent('pay-1', 'opened'))).outcome).toBe('applied');
      expect((await service.handleEvent('mercadopago', disputeEvent('pay-1', 'opened'))).outcome).toBe('duplicate');

      expect(ledger.holds.raised).toBe(1);
    });

    it('never reopens a dispute the provider already closed', async () => {
      const checkout = repo.addCheckout();
      paid(checkout);
      await service.handleEvent('mercadopago', disputeEvent('pay-1', 'won'));

      const late = await service.handleEvent('mercadopago', disputeEvent('pay-1', 'opened'));

      expect(late.outcome).toBe('duplicate');
      expect(repo.checkouts.get(checkout.id)?.failureDetail).toBe('dispute won');
      expect(ledger.holds.raised).toBe(0);
    });

    it('writes payments.dispute_opened and payments.dispute_closed with ids only', async () => {
      const checkout = repo.addCheckout();
      paid(checkout);
      await service.handleEvent('mercadopago', disputeEvent('pay-1', 'opened'));
      await service.handleEvent('mercadopago', disputeEvent('pay-1', 'won'));

      const audit = info.mock.calls
        .map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
        .filter((line) => String(line.event).startsWith('payments.dispute_'));
      expect(audit.map((line) => [line.event, line.outcome])).toEqual([
        ['payments.dispute_opened', 'opened'],
        ['payments.dispute_closed', 'won'],
      ]);
      expect(audit[0]).toMatchObject({
        actor: SYSTEM_PAYMENT_ACTOR_ID,
        provider: 'mercadopago',
        rail: 'contract',
        userId: STUDENT,
        checkoutId: checkout.id,
      });
    });
  });

  describe('stored events', () => {
    it('stores the kind, a dispute with its outcome, and an ignored event under the provider name for it', () => {
      expect(storedEventType(paymentEvent('p'))).toBe('payment');
      expect(storedEventType({ kind: 'refund', eventId: 'e', paymentId: 'p', refundId: 'r', occurredAt: 'x' })).toBe('refund');
      expect(storedEventType(disputeEvent('p', 'lost'))).toBe('dispute.lost');
      expect(storedEventType({ kind: 'ignored', eventId: 'e', type: 'merchant_order' })).toBe('merchant_order');
    });

    it('rebuilds a replayable event from a stored row', async () => {
      const row = (type: string, providerPaymentId: string | null = 'pay-9'): GatewayEventRecord => ({
        ...(repo.events.values().next().value as GatewayEventRecord),
        provider: 'mercadopago',
        eventId: 'evt-9',
        type,
        providerPaymentId,
        receivedAt: '2026-01-12T14:03:00.000Z',
      });
      await repo.recordEvent({ provider: 'mercadopago', eventId: 'seed', type: 'payment', providerPaymentId: 'x' });
      const base = { eventId: 'evt-9', paymentId: 'pay-9', occurredAt: '2026-01-12T14:03:00.000Z' };

      expect(eventFromRecord(row('payment'))).toEqual({ kind: 'payment', ...base });
      expect(eventFromRecord(row('refund'))).toEqual({ kind: 'payment', ...base });
      expect(eventFromRecord(row('dispute.won'))).toEqual({ kind: 'dispute', outcome: 'won', ...base });
      expect(eventFromRecord(row('merchant_order'))).toBeNull();
      expect(eventFromRecord(row('payment', null))).toBeNull();
    });

    it('knows which stored outcomes are final', () => {
      expect(['applied', 'duplicate', 'ignored', 'orphan', 'mismatch'].every(isSettledEventOutcome)).toBe(true);
      expect(['received', 'failed'].some(isSettledEventOutcome)).toBe(false);
    });
  });
});

describe('BillingService — the dispute hold', () => {
  let repo: FakeBillingRepository;
  let service: BillingService;
  let audit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    repo = new FakeBillingRepository();
    service = new BillingService(repo);
    audit = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('raises a hold authored by the system actor, with no expiry, and audits it', async () => {
    const result = await service.raiseDisputeHold(STUDENT);

    expect(result.ok && result.data.raised).toBe(true);
    expect(await repo.getHold(STUDENT)).toMatchObject({
      reason: DISPUTE_HOLD_REASON,
      setBy: SYSTEM_PAYMENT_ACTOR_ID,
      expiresAt: null,
    });
    expect(JSON.parse(String(audit.mock.calls[0][0]))).toMatchObject({ event: 'billing.set_hold', actor: SYSTEM_PAYMENT_ACTOR_ID, userId: STUDENT });
  });

  it("keeps an admin's hold that is in force, and never releases it", async () => {
    await service.setHold(STUDENT, { reason: 'scholarship' }, 'admin-1');

    const raised = await service.raiseDisputeHold(STUDENT);
    const released = await service.releaseDisputeHold(STUDENT);

    expect(raised.ok && raised.data.raised).toBe(false);
    expect(released.ok && released.data.released).toBe(false);
    expect(await repo.getHold(STUDENT)).toMatchObject({ reason: 'scholarship', setBy: 'admin-1' });
  });

  it('replaces a hold that already expired', async () => {
    await service.setHold(STUDENT, { reason: 'old', expiresAt: '2000-01-01' }, 'admin-1');

    const raised = await service.raiseDisputeHold(STUDENT);

    expect(raised.ok && raised.data.raised).toBe(true);
    expect((await repo.getHold(STUDENT))?.setBy).toBe(SYSTEM_PAYMENT_ACTOR_ID);
  });

  it('releases its own hold, and finds nothing once an admin lifted it early', async () => {
    await service.raiseDisputeHold(STUDENT);
    expect((await service.releaseDisputeHold(STUDENT)).ok).toBe(true);
    expect(await repo.getHold(STUDENT)).toBeNull();

    await service.raiseDisputeHold(STUDENT);
    await service.clearHold(STUDENT, 'admin-1');
    const again = await service.releaseDisputeHold(STUDENT);

    expect(again.ok && again.data.released).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Checkout creation (RFC 0026 §3)
// ---------------------------------------------------------------------------

describe('GatewayService.createCheckout', () => {
  const NOW = new Date('2026-03-01T12:00:00.000Z');
  const OTHER = 'student-2';

  type Receivable = { id: string; userId: string; status: string; balanceMinor: number; currency: string };

  let repo: MemoryGatewayRepo;
  let mp: StubGatewayAdapter;
  let stripe: StubGatewayAdapter;
  let invoices: Map<string, Receivable>;
  let charges: Map<string, Receivable>;
  let clock: Date;
  let hits: Map<string, number>;
  let info: ReturnType<typeof vi.spyOn>;

  /** Ten an hour, like the container's `rl:checkouts:`. */
  const limiter: IRateLimiter = {
    peek: async (key) => {
      const used = hits.get(key) ?? 0;
      return used >= 10 ? { allowed: false, remaining: 0, retryAfterSeconds: 1800 } : { allowed: true, remaining: 10 - used };
    },
    hit: async (key) => {
      hits.set(key, (hits.get(key) ?? 0) + 1);
      return { allowed: true, remaining: 10 - (hits.get(key) ?? 0) };
    },
    reset: async (key) => {
      hits.delete(key);
    },
  };

  function build(list: string, options: { overrides?: Record<string, string>; limiter?: IRateLimiter | null } = {}) {
    const env = { ...stubPaymentsEnv(list), ...(options.overrides ?? {}) };
    const wiring = buildPaymentsWiring(env, stubGatewayFactories(mp, stripe));
    const read = (store: Map<string, Receivable>, id: string) => {
      const row = store.get(id);
      return row
        ? { ok: true as const, data: { ...row, periodStart: '2026-02-01', subscriptionId: 'sub-1', eventId: 'event-1', description: 'Winter Seminar' } }
        : { ok: false as const, status: 404, error: 'NotFound' };
    };
    return new GatewayService({
      gateways: wiring.gateways,
      gatewayRepo: repo as unknown as IGatewayRepository,
      billing: { getInvoice: async (id: string) => read(invoices, id) } as unknown as GatewayContractLedger,
      charges: { getCharge: async (id: string) => read(charges, id) } as unknown as GatewayExtrasLedger,
      checkout: {
        config: wiring.config,
        registry: wiring.gateways,
        payer: async (userId) => (userId === 'ghost' ? null : { id: userId, name: 'Ana', email: 'ana@example.com' }),
        webBaseUrl: 'https://app.example.com/',
        limiter: options.limiter === null ? undefined : (options.limiter ?? limiter),
      },
      now: () => clock,
    });
  }

  const mine = { userId: STUDENT, createdBy: STUDENT };
  const invoice = { kind: 'invoice' as const, id: INVOICE };

  function created<T>(result: { ok: true; data: T } | { ok: false; status: number; error: string }): T {
    if (!result.ok) throw new Error(`expected ok, got ${result.status} ${result.error}`);
    return result.data;
  }

  beforeEach(() => {
    repo = new MemoryGatewayRepo();
    mp = new StubGatewayAdapter('mercadopago');
    stripe = new StubGatewayAdapter('stripe');
    invoices = new Map([[INVOICE, { id: INVOICE, userId: STUDENT, status: 'open', balanceMinor: 15000, currency: 'BRL' }]]);
    charges = new Map([[CHARGE, { id: CHARGE, userId: STUDENT, status: 'open', balanceMinor: 8000, currency: 'BRL' }]]);
    clock = NOW;
    hits = new Map();
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens a checkout for the full open balance: row first, provider second', async () => {
    const service = build('mercadopago:pix+card');

    const { checkout, reused } = created(await service.createCheckout(invoice, mine));

    expect(reused).toBe(false);
    expect(checkout).toEqual({
      checkoutId: expect.any(String),
      provider: 'mercadopago',
      url: `https://pay.mercadopago.invalid/checkout/${checkout.checkoutId}`,
      expiresAt: new Date(NOW.getTime() + CHECKOUT_TTL_MS).toISOString(),
      amountMinor: 15000,
      currency: 'BRL',
      status: 'open',
    });

    const [call] = mp.callsTo('createCheckout');
    expect(call.req).toEqual({
      checkoutId: checkout.checkoutId,
      amountMinor: 15000,
      currency: 'BRL',
      description: 'Mensalidade 2026-02',
      payer: { id: STUDENT, name: 'Ana', email: 'ana@example.com' },
      methods: ['pix', 'card'],
      returnUrls: {
        success: `https://app.example.com/settings/billing?checkout=${checkout.checkoutId}&outcome=success`,
        cancel: `https://app.example.com/settings/billing?checkout=${checkout.checkoutId}&outcome=cancel`,
      },
      expiresAt: checkout.expiresAt,
    });

    expect(repo.checkouts.get(checkout.checkoutId)).toMatchObject({
      status: CheckoutStatus.OPEN,
      receivableKind: 'invoice',
      receivableId: INVOICE,
      userId: STUDENT,
      createdBy: STUDENT,
      providerSessionId: `mercadopago-session-${checkout.checkoutId}`,
      checkoutUrl: checkout.url,
    });
  });

  it('audits the creation with ids only', async () => {
    const service = build('mercadopago:pix');
    const { checkout } = created(await service.createCheckout(invoice, mine));

    const line = info.mock.calls.map(([text]) => JSON.parse(String(text))).find((l) => l.event === 'payments.checkout_created');
    expect(line).toEqual({
      event: 'payments.checkout_created',
      actor: STUDENT,
      userId: STUDENT,
      checkoutId: checkout.checkoutId,
      provider: 'mercadopago',
      rail: 'contract',
      receivableId: INVOICE,
      at: NOW.toISOString(),
    });
  });

  it('opens one for an event charge, described by the event', async () => {
    const service = build('mercadopago:pix');
    const { checkout } = created(await service.createCheckout({ kind: 'event_charge', id: CHARGE }, mine));

    expect(checkout.amountMinor).toBe(8000);
    expect(mp.callsTo('createCheckout')[0].req.description).toBe('Winter Seminar');
    expect(repo.checkouts.get(checkout.checkoutId)).toMatchObject({ receivableKind: 'event_charge', receivableId: CHARGE });
  });

  describe('the order of refusals', () => {
    it('404s under `none`, whatever is asked', async () => {
      const service = build('none');
      expect(await service.createCheckout({ kind: 'invoice', id: 'missing', provider: 'nope' }, mine)).toMatchObject({
        ok: false,
        status: 404,
      });
      expect(service.checkoutGate()).toMatchObject({ status: 404 });
    });

    it('answers 500 PAYMENTS_CONFIG_INVALID for an invalid list — not the empty registry’s 404', async () => {
      const service = build('mercadopago:pix,mercadopago:card');
      const refused = await service.createCheckout({ kind: 'invoice', id: 'missing' }, mine);
      expect(refused).toMatchObject({ ok: false, status: 500, error: PAYMENTS_CONFIG_INVALID });
      expect(service.checkoutGate()).toMatchObject({ status: 500, error: PAYMENTS_CONFIG_INVALID });
    });

    it('404s on a service wired without checkout dependencies', async () => {
      const service = new GatewayService({
        gateways: { get: () => mp },
        gatewayRepo: repo as unknown as IGatewayRepository,
        billing: {} as GatewayContractLedger,
        charges: {} as GatewayExtrasLedger,
      });
      expect(await service.createCheckout(invoice, mine)).toMatchObject({ ok: false, status: 404 });
    });

    it('asks for the provider before it looks for the receivable', async () => {
      const service = build('mercadopago:pix,stripe:card');
      for (const provider of [undefined, 'asaas', 'nope']) {
        const refused = await service.createCheckout({ kind: 'invoice', id: 'missing', provider }, mine);
        expect(refused).toMatchObject({ ok: false, status: 400, error: PAYMENT_PROVIDER_REQUIRED });
      }
    });

    it('refuses a named provider that is bound but offers no method', async () => {
      const service = build('mercadopago:pix,stripe:');
      expect(await service.createCheckout({ ...invoice, provider: 'stripe' }, mine)).toMatchObject({
        status: 400,
        error: PAYMENT_PROVIDER_REQUIRED,
      });
      // …while the only offering one needs no name.
      expect(created(await service.createCheckout(invoice, mine)).checkout.provider).toBe('mercadopago');
    });

    it('404s a missing receivable and one owed by someone else, identically', async () => {
      const service = build('mercadopago:pix');
      invoices.set('theirs', { id: 'theirs', userId: OTHER, status: 'paid', balanceMinor: 0, currency: 'XXX' });

      const missing = await service.createCheckout({ kind: 'invoice', id: 'missing' }, mine);
      const theirs = await service.createCheckout({ kind: 'invoice', id: 'theirs' }, mine);

      expect(missing).toEqual({ ok: false, status: 404, error: 'NotFound' });
      expect(theirs).toEqual(missing);
      // An invoice id is not a charge id.
      expect(await service.createCheckout({ kind: 'event_charge', id: INVOICE }, mine)).toEqual(missing);
    });

    it.each([
      ['void', { status: 'void', balanceMinor: 0 }],
      ['settled', { status: 'paid', balanceMinor: 0 }],
      ['open with nothing left to pay', { status: 'open', balanceMinor: 0 }],
      ['overpaid', { status: 'open', balanceMinor: -500 }],
    ])('refuses a receivable that is %s with 409 RECEIVABLE_NOT_PAYABLE', async (_what, patch) => {
      const service = build('mercadopago:pix');
      // An unsupported currency too: "not payable" is decided first.
      invoices.set(INVOICE, { ...invoices.get(INVOICE)!, ...patch, currency: 'USD' });

      expect(await service.createCheckout(invoice, mine)).toMatchObject({ status: 409, error: RECEIVABLE_NOT_PAYABLE });
      expect(repo.checkouts.size).toBe(0);
    });

    it('refuses a currency the provider cannot settle before the provider is called', async () => {
      const service = build('mercadopago:pix');
      invoices.set(INVOICE, { ...invoices.get(INVOICE)!, currency: 'USD' });
      hits.set(STUDENT, 10);

      const refused = await service.createCheckout(invoice, mine);

      // Decided before the budget is looked at, and before anything is written.
      expect(refused).toMatchObject({ status: 409, error: PAYMENTS_UNSUPPORTED_CURRENCY });
      expect(mp.calls).toHaveLength(0);
      expect(repo.checkouts.size).toBe(0);
    });

    it('answers 429 once ten checkouts were opened in the hour, writing nothing', async () => {
      const service = build('mercadopago:pix');
      hits.set(STUDENT, 10);

      const refused = await service.createCheckout(invoice, mine);

      expect(refused).toEqual({ ok: false, status: 429, error: 'TooManyRequests', meta: { retryAfterSeconds: 1800 } });
      expect(mp.calls).toHaveLength(0);
      expect(repo.checkouts.size).toBe(0);
    });

    it('404s when the payer cannot be read, before any row', async () => {
      const service = build('mercadopago:pix');
      invoices.set('ghostly', { id: 'ghostly', userId: 'ghost', status: 'open', balanceMinor: 100, currency: 'BRL' });

      const refused = await service.createCheckout({ kind: 'invoice', id: 'ghostly' }, { userId: 'ghost', createdBy: 'ghost' });
      expect(refused).toMatchObject({ status: 404 });
      expect(repo.checkouts.size).toBe(0);
    });
  });

  describe('the budget', () => {
    it('counts a new checkout and not a reused one', async () => {
      const service = build('mercadopago:pix');
      await service.createCheckout(invoice, mine);
      await service.createCheckout(invoice, mine);
      await service.createCheckout(invoice, mine);
      expect(hits.get(STUDENT)).toBe(1);
    });

    it('still hands back the open checkout when the budget is spent', async () => {
      const service = build('mercadopago:pix');
      const first = created(await service.createCheckout(invoice, mine));
      hits.set(STUDENT, 10);

      const again = created(await service.createCheckout(invoice, mine));
      expect(again).toEqual({ checkout: first.checkout, reused: true });
    });

    it('does not draw on the student’s budget for a checkout an admin opens on their behalf', async () => {
      const service = build('mercadopago:pix');
      hits.set(STUDENT, 10);

      const { checkout } = created(await service.createCheckout(invoice, { userId: STUDENT, createdBy: 'admin-1' }));
      expect(repo.checkouts.get(checkout.checkoutId)).toMatchObject({ userId: STUDENT, createdBy: 'admin-1' });
      expect(hits.get(STUDENT)).toBe(10);
    });

    it('fails open when the limiter is down', async () => {
      const down: IRateLimiter = {
        peek: async () => {
          throw new Error('KV unavailable');
        },
        hit: async () => {
          throw new Error('KV unavailable');
        },
        reset: async () => {},
      };
      const service = build('mercadopago:pix', { limiter: down });
      expect((await service.createCheckout(invoice, mine)).ok).toBe(true);
    });
  });

  describe('one live attempt', () => {
    it('hands back the open checkout without calling the provider again', async () => {
      const service = build('mercadopago:pix');
      const first = created(await service.createCheckout(invoice, mine));
      clock = new Date(NOW.getTime() + 60 * 60_000);

      const second = created(await service.createCheckout(invoice, mine));

      expect(second).toEqual({ checkout: first.checkout, reused: true });
      expect(mp.callsTo('createCheckout')).toHaveLength(1);
      expect(repo.checkouts.size).toBe(1);
    });

    it('reuses with more than five minutes left and replaces at exactly five', async () => {
      const service = build('mercadopago:pix');
      const first = created(await service.createCheckout(invoice, mine)).checkout;
      const expiry = Date.parse(first.expiresAt);

      clock = new Date(expiry - CHECKOUT_REUSE_MIN_MS - 1);
      expect(created(await service.createCheckout(invoice, mine)).reused).toBe(true);

      clock = new Date(expiry - CHECKOUT_REUSE_MIN_MS);
      const replaced = created(await service.createCheckout(invoice, mine));

      expect(replaced.reused).toBe(false);
      expect(replaced.checkout.checkoutId).not.toBe(first.checkoutId);
      expect(repo.checkouts.get(first.checkoutId)!.status).toBe(CheckoutStatus.EXPIRED);
      expect(repo.open().map((row) => row.id)).toEqual([replaced.checkout.checkoutId]);
    });

    it('replaces a checkout that is already past its expiry', async () => {
      const service = build('mercadopago:pix');
      const first = created(await service.createCheckout(invoice, mine)).checkout;
      clock = new Date(Date.parse(first.expiresAt) + 60_000);

      const replaced = created(await service.createCheckout(invoice, mine));

      expect(replaced.reused).toBe(false);
      expect(repo.checkouts.get(first.checkoutId)!.status).toBe(CheckoutStatus.EXPIRED);
      expect(repo.open()).toHaveLength(1);
    });

    it('cancels the first when the student picks another provider: one open row, one cancelled', async () => {
      const service = build('mercadopago:pix,stripe:card');
      const first = created(await service.createCheckout({ ...invoice, provider: 'mercadopago' }, mine)).checkout;

      const second = created(await service.createCheckout({ ...invoice, provider: 'stripe' }, mine));

      expect(second.reused).toBe(false);
      expect(second.checkout.provider).toBe('stripe');
      expect(stripe.callsTo('createCheckout')[0].req.methods).toEqual(['card']);
      expect([...repo.checkouts.values()].map((row) => [row.provider, row.status]).sort()).toEqual([
        ['mercadopago', CheckoutStatus.CANCELLED],
        ['stripe', CheckoutStatus.OPEN],
      ]);
      expect(repo.checkouts.get(first.checkoutId)!.status).toBe(CheckoutStatus.CANCELLED);

      // …and back again: still exactly one open row.
      await service.createCheckout({ ...invoice, provider: 'mercadopago' }, mine);
      expect(repo.open().map((row) => row.provider)).toEqual(['mercadopago']);
    });

    it('replaces an open checkout whose amount is no longer the open balance', async () => {
      const service = build('mercadopago:pix');
      const first = created(await service.createCheckout(invoice, mine)).checkout;
      // A partial cash payment was recorded in the meantime.
      invoices.set(INVOICE, { ...invoices.get(INVOICE)!, balanceMinor: 5000 });

      const second = created(await service.createCheckout(invoice, mine));

      expect(second.reused).toBe(false);
      expect(second.checkout.amountMinor).toBe(5000);
      expect(repo.checkouts.get(first.checkoutId)!.status).toBe(CheckoutStatus.CANCELLED);
      expect(repo.open()).toHaveLength(1);
    });

    it('keeps the two receivables of one student apart', async () => {
      const service = build('mercadopago:pix');
      const a = created(await service.createCheckout(invoice, mine)).checkout;
      const b = created(await service.createCheckout({ kind: 'event_charge', id: CHARGE }, mine)).checkout;

      expect(a.checkoutId).not.toBe(b.checkoutId);
      expect(repo.open()).toHaveLength(2);
    });

    it('calls the provider again under the same id for an open row that never got its session', async () => {
      const service = build('mercadopago:pix');
      const stranded = repo.addCheckout({
        id: 'stranded',
        providerSessionId: null,
        checkoutUrl: 'about:blank',
        expiresAt: new Date(NOW.getTime() + CHECKOUT_TTL_MS).toISOString(),
      });

      const { checkout, reused } = created(await service.createCheckout(invoice, mine));

      expect(reused).toBe(false);
      expect(checkout.checkoutId).toBe(stranded.id);
      expect(mp.callsTo('createCheckout')[0].req.checkoutId).toBe(stranded.id);
      expect(repo.checkouts.size).toBe(1);
      expect(repo.checkouts.get(stranded.id)).toMatchObject({
        status: CheckoutStatus.OPEN,
        providerSessionId: 'mercadopago-session-stranded',
        checkoutUrl: checkout.url,
      });
    });

    it('answers the winner of a concurrent creation, or 409 while it is still being opened', async () => {
      const service = build('mercadopago:pix');

      // The twin already has its session: it is the answer.
      repo.raceWith = { providerSessionId: 'twin-session', checkoutUrl: 'https://pay.invalid/twin' };
      const reused = created(await service.createCheckout(invoice, mine));
      expect(reused).toMatchObject({ reused: true, checkout: { checkoutId: 'twin', url: 'https://pay.invalid/twin' } });
      expect(mp.calls).toHaveLength(0);

      // The twin is mid-flight: nothing usable yet, and no second open row.
      repo.checkouts.clear();
      repo.raceWith = { providerSessionId: null };
      const racing = await service.createCheckout(invoice, mine);
      expect(racing).toMatchObject({ ok: false, status: 409, error: CHECKOUT_IN_PROGRESS });
      expect(repo.open()).toHaveLength(1);
      expect(mp.calls).toHaveLength(0);
    });
  });

  describe('the stored expiry', () => {
    it('is the provider’s when the provider grants less than was asked', async () => {
      const service = build('mercadopago:pix');
      const thirtyMinutes = new Date(NOW.getTime() + 30 * 60_000).toISOString();
      mp.setCheckoutResult({ expiresAt: thirtyMinutes });

      const { checkout } = created(await service.createCheckout(invoice, mine));

      // Asked for 24 hours, stored 30 minutes.
      expect(mp.callsTo('createCheckout')[0].req.expiresAt).toBe(new Date(NOW.getTime() + CHECKOUT_TTL_MS).toISOString());
      expect(checkout.expiresAt).toBe(thirtyMinutes);
      expect(repo.checkouts.get(checkout.checkoutId)!.expiresAt).toBe(thirtyMinutes);

      // 26 minutes later it has four left: not handed back.
      clock = new Date(NOW.getTime() + 26 * 60_000);
      expect(created(await service.createCheckout(invoice, mine)).reused).toBe(false);
    });

    it('never exceeds the 24 hours asked for, and survives a provider that reports no usable date', async () => {
      const service = build('mercadopago:pix');
      const requested = new Date(NOW.getTime() + CHECKOUT_TTL_MS).toISOString();

      mp.setCheckoutResult({ expiresAt: new Date(NOW.getTime() + 72 * 60 * 60_000).toISOString() });
      expect(created(await service.createCheckout(invoice, mine)).checkout.expiresAt).toBe(requested);

      mp.setCheckoutResult({ expiresAt: 'not a date' });
      expect(created(await service.createCheckout({ kind: 'event_charge', id: CHARGE }, mine)).checkout.expiresAt).toBe(requested);
    });
  });

  describe('a provider failure', () => {
    it('leaves a failed row and no open one, and answers 502', async () => {
      const service = build('mercadopago:pix');
      const failure = new Error('SECRET-PROVIDER-MESSAGE upstream 500');
      failure.name = 'ProviderHttpError';
      mp.setCheckoutResult(failure);

      const refused = await service.createCheckout(invoice, mine);

      expect(refused).toEqual({ ok: false, status: 502, error: PAYMENTS_PROVIDER_ERROR });
      expect(repo.open()).toHaveLength(0);
      const [row] = [...repo.checkouts.values()];
      expect(row).toMatchObject({
        status: CheckoutStatus.FAILED,
        providerSessionId: null,
        failureDetail: 'provider call failed (ProviderHttpError)',
      });
      // Nothing of the provider's message is stored or audited.
      expect(JSON.stringify([...repo.checkouts.values()])).not.toContain('SECRET-PROVIDER-MESSAGE');
      expect(info.mock.calls.some(([text]) => String(text).includes('payments.checkout_created'))).toBe(false);
    });

    it('lets the next Pay start a new attempt', async () => {
      const service = build('mercadopago:pix');
      mp.setCheckoutResult(new Error('down'));
      await service.createCheckout(invoice, mine);
      mp.setCheckoutResult(null);

      const { checkout, reused } = created(await service.createCheckout(invoice, mine));

      expect(reused).toBe(false);
      expect(repo.checkouts.size).toBe(2);
      expect(repo.open().map((row) => row.id)).toEqual([checkout.checkoutId]);
    });

    it('treats a session with no id or URL as a failure', async () => {
      const service = build('mercadopago:pix');
      mp.setCheckoutResult({ url: '' });
      expect(await service.createCheckout(invoice, mine)).toMatchObject({ status: 502, error: PAYMENTS_PROVIDER_ERROR });
      expect(repo.open()).toHaveLength(0);
    });
  });

  describe('getCheckoutStatus', () => {
    it('reads the caller’s own row and never the provider', async () => {
      const service = build('mercadopago:pix');
      const { checkout } = created(await service.createCheckout(invoice, mine));
      const callsBefore = mp.calls.length;

      const status = created(await service.getCheckoutStatus(checkout.checkoutId, STUDENT));

      expect(status).toEqual({
        checkoutId: checkout.checkoutId,
        provider: 'mercadopago',
        kind: 'invoice',
        receivableId: INVOICE,
        status: 'open',
        amountMinor: 15000,
        currency: 'BRL',
        createdAt: expect.any(String),
        expiresAt: checkout.expiresAt,
        closedAt: null,
      });
      expect(mp.calls).toHaveLength(callsBefore);
    });

    it('404s someone else’s checkout exactly as a missing one', async () => {
      const service = build('mercadopago:pix');
      const { checkout } = created(await service.createCheckout(invoice, mine));

      const theirs = await service.getCheckoutStatus(checkout.checkoutId, OTHER);
      const missing = await service.getCheckoutStatus('no-such-checkout', OTHER);

      expect(theirs).toEqual({ ok: false, status: 404, error: 'NotFound' });
      expect(missing).toEqual(theirs);
    });
  });
});

describe('toPendingCheckout', () => {
  const now = new Date('2026-03-01T12:00:00.000Z');
  const row = (overrides: Partial<GatewayCheckoutRecord> = {}): GatewayCheckoutRecord =>
    new MemoryGatewayRepo().addCheckout({ expiresAt: '2026-03-02T12:00:00.000Z', createdBy: 'admin-1', ...overrides });

  it('reports a live checkout by ids and dates, with no URL', () => {
    expect(toPendingCheckout(row(), now)).toEqual({
      checkoutId: 'checkout-1',
      provider: 'mercadopago',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-03-02T12:00:00.000Z',
      createdBy: 'admin-1',
    });
  });

  it('is null for no row, a closed one, one without a session and one past its expiry', () => {
    expect(toPendingCheckout(null, now)).toBeNull();
    expect(toPendingCheckout(row({ status: CheckoutStatus.PAID }), now)).toBeNull();
    expect(toPendingCheckout(row({ providerSessionId: null }), now)).toBeNull();
    expect(toPendingCheckout(row({ expiresAt: now.toISOString() }), now)).toBeNull();
  });
});
