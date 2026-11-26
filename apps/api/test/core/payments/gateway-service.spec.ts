import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GatewayService,
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
import { FakeBillingRepository } from '../../helpers/fake-billing-repository';
import { StubGatewayAdapter, stubPayment } from '../../adapters/payment/stub-gateway-adapter';

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

  async updateCheckout(id: string, patch: { failureDetail?: string | null; clearDismissal?: boolean }) {
    const row = this.checkouts.get(id);
    if (!row) return null;
    const next = { ...row };
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
