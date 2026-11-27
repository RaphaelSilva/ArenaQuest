import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CHECKOUT_IN_PROGRESS,
  CHECKOUT_REUSE_MIN_MS,
  CHECKOUT_TTL_MS,
  GatewayService,
  PAYMENT_PROVIDER_REQUIRED,
  PAYMENTS_PROVIDER_BUSY,
  PAYMENTS_PROVIDER_ERROR,
  PAYMENTS_PROVIDER_NOT_ENABLED,
  PAYMENTS_REFUND_REFUSED,
  PAYMENTS_REFUND_UNRECORDED,
  PAYMENTS_UNSUPPORTED_CURRENCY,
  RECEIVABLE_NOT_PAYABLE,
  checkoutNotificationUrl,
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
import type { PaymentRecord, RecordPaymentInput } from '@arenaquest/shared/ports';
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
      paidMethod: null,
      paidMethodLabel: null,
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

  async listOpenCheckouts() {
    return this.open();
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
      paidMethod?: GatewayCheckoutRecord['paidMethod'];
      paidMethodLabel?: string | null;
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
      // First writer wins, as in the D1 adapter.
      paidMethod: row.paidMethod ?? input.paidMethod ?? null,
      paidMethodLabel: row.paidMethodLabel ?? input.paidMethodLabel ?? null,
      failureDetail: input.failureDetail !== undefined ? input.failureDetail : row.failureDetail,
    };
    this.checkouts.set(id, next);
    return next;
  }

  /** Plays the join of `listPaidMethods`: paid checkouts of one rail, by the ledger row they produced. */
  async listPaidMethods(kind: GatewayCheckoutRecord['receivableKind'], paymentIds: ReadonlyArray<string>) {
    this.paidMethodReads += 1;
    return [...this.checkouts.values()]
      .filter((row) => row.receivableKind === kind && row.status === CheckoutStatus.PAID)
      .map((row) => ({
        paymentId: (kind === 'invoice' ? row.invoicePaymentId : row.chargePaymentId) ?? '',
        method: row.paidMethod,
        methodLabel: row.paidMethodLabel,
      }))
      .filter((record) => paymentIds.includes(record.paymentId));
  }
  paidMethodReads = 0;

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

    // M30 Task 17: the provider's own method name is kept beside the normalised one.
    it('stores how the payment was made on the paid checkout: method and the provider\'s label', async () => {
      const checkout = repo.addCheckout();
      paid(checkout, { method: 'other', methodLabel: 'account_money' });

      await service.handleEvent('mercadopago', paymentEvent('pay-1'));

      expect(repo.checkouts.get(checkout.id)).toMatchObject({
        status: 'paid',
        paidMethod: 'other',
        paidMethodLabel: 'account_money',
      });
      // The ledger command carries neither: no money table knows a method label.
      expect(Object.keys(ledger.rows[0]).sort()).toEqual(
        ['amountMinor', 'currency', 'externalReference', 'paidAt', 'receivableId'].sort(),
      );
      expect(await service.paidMethodsOf('invoice', ['row-1', 'row-unknown'])).toEqual(
        new Map([['row-1', { gatewayMethod: 'other', gatewayMethodLabel: 'account_money' }]]),
      );
      expect(await service.paidMethodsOf('event_charge', ['row-1'])).toEqual(new Map());
    });

    it.each([
      ['free text', 'João da Silva <joao@example.com>'],
      ['upper case', 'CREDIT_CARD/VISA'],
      ['too long', 'a'.repeat(65)],
      ['empty', ''],
    ])('never stores a label that is not a provider identifier (%s): the method alone is kept', async (_name, label) => {
      const checkout = repo.addCheckout();
      paid(checkout, { method: 'card', methodLabel: label });

      await service.handleEvent('mercadopago', paymentEvent('pay-1'));

      expect(repo.checkouts.get(checkout.id)).toMatchObject({ status: 'paid', paidMethod: 'card', paidMethodLabel: null });
    });

    it('reads no checkout at all for an empty list of rows', async () => {
      expect(await service.paidMethodsOf('invoice', [])).toEqual(new Map());
      expect(repo.paidMethodReads).toBe(0);
    });

    // M30 Task 17 (R14): a checkout is for the full balance, but nothing stops a
    // payer from paying the same link twice. Both captures land; the second is a
    // credit on the receivable, and the checkout keeps the first payment's ids.
    it('lands two payments made on one checkout as two ledger rows — the second a credit', async () => {
      const checkout = repo.addCheckout();
      mp.setPayment(stubPayment({ id: 'pay-1', amountMinor: 15000, checkoutId: checkout.id, method: 'card', methodLabel: 'credit_card/visa' }));
      mp.setPayment(stubPayment({ id: 'pay-2', amountMinor: 15000, checkoutId: checkout.id, method: 'other', methodLabel: 'account_money' }));

      const first = await service.handleEvent('mercadopago', paymentEvent('pay-1'));
      const second = await service.handleEvent('mercadopago', paymentEvent('pay-2'));

      expect([first.outcome, second.outcome]).toEqual(['applied', 'applied']);
      expect(ledger.rows.map((row) => [row.receivableId, row.externalReference, row.amountMinor])).toEqual([
        [INVOICE, 'mercadopago:pay-1', 15000],
        [INVOICE, 'mercadopago:pay-2', 15000],
      ]);
      // 30 000 received against the 15 000 the checkout asked for: the surplus is a credit.
      const received = ledger.rows.reduce((sum, row) => sum + row.amountMinor, 0);
      expect(received - checkout.amountMinor).toBe(15000);
      // The checkout stays `paid` on the first payment; the second changes nothing on it.
      expect(repo.checkouts.get(checkout.id)).toMatchObject({
        status: 'paid',
        providerPaymentId: 'pay-1',
        invoicePaymentId: 'row-1',
        paidMethod: 'card',
        paidMethodLabel: 'credit_card/visa',
      });
      // Only the row the checkout points at has a label; the credit row reads as unknown.
      expect(await service.paidMethodsOf('invoice', ['row-1', 'row-2'])).toEqual(
        new Map([['row-1', { gatewayMethod: 'card', gatewayMethodLabel: 'credit_card/visa' }]]),
      );
      // A redelivery of either is a duplicate: still two rows.
      expect((await service.handleEvent('mercadopago', paymentEvent('pay-2'))).outcome).toBe('duplicate');
      expect(ledger.rows).toHaveLength(2);
    });

    it('settles a payment in another currency as a mismatch: nothing lands, the checkout says why', async () => {
      const checkout = repo.addCheckout();
      paid(checkout, { currency: 'USD' });
      const event = paymentEvent('pay-1');

      const result = await service.handleEvent('mercadopago', event);

      expect(result.outcome).toBe('mismatch');
      expect(ledger.rows).toEqual([]);
      expect(repo.checkouts.get(checkout.id)).toMatchObject({
        status: 'mismatch',
        paidMethod: null,
        failureDetail: 'currency mismatch: the payment is in USD, the checkout in BRL',
      });
      expect(stored(event.eventId)).toMatchObject({ outcome: 'mismatch' });
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
      // No API origin was given: the provider falls back to its dashboard registration.
      notificationUrl: null,
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

  // M30 Task 17: every checkout tells the provider where to notify — the API that created it.
  describe('the notification URL', () => {
    it('is <origin of the API request>/v1/webhooks/payments/<provider>', async () => {
      const service = build('mercadopago:pix+card');

      await service.createCheckout({ ...invoice, apiOrigin: 'https://api.example.test' }, mine);

      expect(mp.callsTo('createCheckout')[0].req.notificationUrl).toBe(
        'https://api.example.test/v1/webhooks/payments/mercadopago',
      );
    });

    it('names the provider that was chosen, and is the same on the admin\'s door', async () => {
      const service = build('mercadopago:pix,stripe:card');

      await service.createCheckoutOnBehalf(
        { ...invoice, provider: 'stripe', apiOrigin: 'https://m30.api-preview.example.test' },
        'admin-1',
      );

      expect(stripe.callsTo('createCheckout')[0].req.notificationUrl).toBe(
        'https://m30.api-preview.example.test/v1/webhooks/payments/stripe',
      );
    });

    it('is still handed to the adapter for a loopback origin (the adapter decides what the provider can reach)', async () => {
      const service = build('mercadopago:pix');

      await service.createCheckout({ ...invoice, apiOrigin: 'http://localhost:8787' }, mine);

      expect(mp.callsTo('createCheckout')[0].req.notificationUrl).toBe(
        'http://localhost:8787/v1/webhooks/payments/mercadopago',
      );
    });

    it('is the current request\'s origin when an open row without a session is called again', async () => {
      const service = build('mercadopago:pix');
      // A row left open without a session (the first provider call never completed).
      repo.addCheckout({ id: 'stuck', providerSessionId: null, expiresAt: new Date(NOW.getTime() + CHECKOUT_TTL_MS).toISOString() });

      await service.createCheckout({ ...invoice, apiOrigin: 'https://api.example.test' }, mine);

      expect(mp.callsTo('createCheckout')[0].req).toMatchObject({
        checkoutId: 'stuck',
        notificationUrl: 'https://api.example.test/v1/webhooks/payments/mercadopago',
      });
    });

    it.each([
      ['a path, a query and credentials are dropped', 'https://user:pw@api.example.test:8443/v1/x?y=1#z', 'https://api.example.test:8443/v1/webhooks/payments/mercadopago'],
      ['an http origin is kept as given', 'http://api.example.test', 'http://api.example.test/v1/webhooks/payments/mercadopago'],
    ])('keeps only the origin: %s', (_name, origin, expected) => {
      expect(checkoutNotificationUrl(origin, 'mercadopago')).toBe(expected);
    });

    it.each([undefined, null, '', 'not a url', 'ftp://api.example.test', 'javascript:alert(1)', 'api.example.test'])(
      'is null for the origin %j',
      (origin) => {
        expect(checkoutNotificationUrl(origin, 'mercadopago')).toBeNull();
      },
    );
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

// ---------------------------------------------------------------------------
// On behalf of a student, and the payments in progress (RFC 0026 §3, §7)
// ---------------------------------------------------------------------------

describe('GatewayService — the admin\'s side of a checkout', () => {
  const NOW = new Date('2026-03-01T12:00:00.000Z');
  const ADMIN = 'admin-1';

  let repo: MemoryGatewayRepo;
  let mp: StubGatewayAdapter;
  let hits: string[];
  let payers: string[];
  let info: ReturnType<typeof vi.spyOn>;

  function build(owner = STUDENT) {
    const wiring = buildPaymentsWiring(stubPaymentsEnv('mercadopago:pix+card'), stubGatewayFactories(mp));
    const receivable = { id: INVOICE, userId: owner, status: 'open', balanceMinor: 15000, currency: 'BRL', periodStart: '2026-03-01' };
    const limiter: IRateLimiter = {
      peek: async (key) => {
        hits.push(`peek:${key}`);
        return { allowed: false, remaining: 0, retryAfterSeconds: 60 };
      },
      hit: async (key) => {
        hits.push(`hit:${key}`);
        return { allowed: true, remaining: 0 };
      },
      reset: async () => {},
    };
    return new GatewayService({
      gateways: wiring.gateways,
      gatewayRepo: repo as unknown as IGatewayRepository,
      billing: {
        getInvoice: async (id: string) =>
          id === INVOICE ? { ok: true as const, data: receivable } : { ok: false as const, status: 404, error: 'NotFound' },
      } as unknown as GatewayContractLedger,
      charges: {} as GatewayExtrasLedger,
      checkout: {
        config: wiring.config,
        registry: wiring.gateways,
        payer: async (userId) => {
          payers.push(userId);
          return { id: userId, name: 'Ana', email: 'ana@example.com' };
        },
        webBaseUrl: 'https://app.example.com',
        limiter,
      },
      now: () => NOW,
    });
  }

  beforeEach(() => {
    repo = new MemoryGatewayRepo();
    mp = new StubGatewayAdapter('mercadopago');
    hits = [];
    payers = [];
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the checkout for the receivable\'s own student, with the admin as its creator', async () => {
    const result = await build().createCheckoutOnBehalf({ kind: 'invoice', id: INVOICE }, ADMIN);

    expect(result.ok && result.data.reused).toBe(false);
    const [row] = repo.open();
    expect(row).toMatchObject({ userId: STUDENT, createdBy: ADMIN, amountMinor: 15000, receivableId: INVOICE });
    // The hosted page is opened for the student, never for the admin.
    expect(payers).toEqual([STUDENT]);
    expect(mp.callsTo('createCheckout')[0].req.payer.id).toBe(STUDENT);
    const audit = info.mock.calls.map((call) => JSON.parse(call[0] as string));
    expect(audit.find((line) => line.event === 'payments.checkout_created')).toMatchObject({
      actor: ADMIN,
      userId: STUDENT,
    });
  });

  it('never consults or charges the student\'s budget — not even for an admin who owes the receivable', async () => {
    // The limiter above refuses everyone it is asked about.
    expect((await build().createCheckoutOnBehalf({ kind: 'invoice', id: INVOICE }, ADMIN)).ok).toBe(true);
    expect((await build(ADMIN).createCheckoutOnBehalf({ kind: 'invoice', id: INVOICE }, ADMIN)).ok).toBe(true);
    expect(hits).toEqual([]);

    // The student's own door still draws on it.
    repo.checkouts.clear();
    const own = await build().createCheckout({ kind: 'invoice', id: INVOICE }, { userId: STUDENT, createdBy: STUDENT });
    expect(own.ok).toBe(false);
    expect(hits).toEqual([`peek:${STUDENT}`]);
  });

  it('hands the admin\'s open checkout back to the admin and to the student alike', async () => {
    const service = build();
    const first = await service.createCheckoutOnBehalf({ kind: 'invoice', id: INVOICE }, ADMIN);
    const again = await service.createCheckoutOnBehalf({ kind: 'invoice', id: INVOICE }, 'admin-2');

    expect(first.ok && again.ok && again.data.reused).toBe(true);
    expect(first.ok && again.ok && again.data.checkout.checkoutId === first.data.checkout.checkoutId).toBe(true);
    expect(repo.open()).toHaveLength(1);
    expect(repo.open()[0].createdBy).toBe(ADMIN);
    expect(mp.callsTo('createCheckout')).toHaveLength(1);
  });

  it('answers 404 for a receivable that does not exist, after the provider is resolved', async () => {
    const service = build();
    expect(await service.createCheckoutOnBehalf({ kind: 'invoice', id: 'nope' }, ADMIN)).toMatchObject({ status: 404 });
    expect(await service.createCheckoutOnBehalf({ kind: 'invoice', id: 'nope', provider: 'stripe' }, ADMIN)).toMatchObject({
      status: 400,
      error: PAYMENT_PROVIDER_REQUIRED,
    });
  });

  it('lists the payments in progress in one read, by the statement\'s own rule', async () => {
    repo.addCheckout({ id: 'live', receivableId: 'inv-live', expiresAt: '2026-03-02T12:00:00.000Z' });
    repo.addCheckout({ id: 'no-session', receivableId: 'inv-a', providerSessionId: null });
    repo.addCheckout({ id: 'past', receivableId: 'inv-b', expiresAt: NOW.toISOString() });
    repo.addCheckout({ id: 'paid', receivableId: 'inv-c', status: CheckoutStatus.PAID });
    repo.addCheckout({ id: 'charge', receivableKind: 'event_charge', receivableId: CHARGE, userId: 'student-2' });
    const read = vi.spyOn(repo, 'listOpenCheckouts');
    const service = build();

    const live = await service.listLiveCheckouts();

    expect(read).toHaveBeenCalledTimes(1);
    expect(live.map((row) => [row.receivableKind, row.receivableId, row.userId, row.pending.checkoutId])).toEqual([
      ['invoice', 'inv-live', STUDENT, 'live'],
      ['event_charge', CHARGE, 'student-2', 'charge'],
    ]);
    expect(await service.findLiveCheckout('invoice', 'inv-live')).toMatchObject({ checkoutId: 'live' });
    expect(await service.findLiveCheckout('invoice', 'inv-a')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Admin refunds (RFC 0026 §5) — on the real contract-rail entry points
// ---------------------------------------------------------------------------

describe('GatewayService.refundInvoicePayment', () => {
  const ADMIN = 'admin-1';
  const NOW = new Date('2026-02-01T10:00:00.000Z');
  const { BillingCycle, ContractTermsSource, PaymentMethod } = Entities.Config;

  /** The fake ledger, with a store that can fail the next inserts. */
  class FlakyRepository extends FakeBillingRepository {
    failWrites = 0;
    override async recordPayment(input: RecordPaymentInput): Promise<PaymentRecord> {
      if (this.failWrites > 0) {
        this.failWrites -= 1;
        throw new Error('D1_ERROR: unavailable');
      }
      return super.recordPayment(input);
    }
  }

  let ledger: FlakyRepository;
  let billing: BillingService;
  let mp: StubGatewayAdapter;
  let service: GatewayService;
  let info: ReturnType<typeof vi.spyOn>;
  let invoiceId: string;
  let original: PaymentRecord;

  function ok<T>(result: { ok: true; data: T } | { ok: false; status: number; error: string }): T {
    if (!result.ok) throw new Error(`expected ok, got ${result.status} ${result.error}`);
    return result.data;
  }
  const rows = () => ledger.payments.filter((payment) => payment.invoiceId === invoiceId);
  const audits = (name: string) =>
    info.mock.calls.map((call) => JSON.parse(call[0] as string)).filter((line) => line.event === name);
  const refund = (paymentId = original.id, reason = 'Asked for it back.') =>
    service.refundInvoicePayment(paymentId, { reason }, ADMIN);

  function build(list: string) {
    const wiring = buildPaymentsWiring(stubPaymentsEnv(list), stubGatewayFactories(mp));
    return new GatewayService({
      gateways: wiring.gateways,
      gatewayRepo: new MemoryGatewayRepo() as unknown as IGatewayRepository,
      billing,
      charges: {} as GatewayExtrasLedger,
      checkout: {
        config: wiring.config,
        registry: wiring.gateways,
        payer: async () => null,
        webBaseUrl: 'https://app.example.com',
      },
      now: () => NOW,
    });
  }

  beforeEach(async () => {
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    ledger = new FlakyRepository();
    billing = new BillingService(ledger);
    mp = new StubGatewayAdapter('mercadopago');
    mp.now = () => new Date('2026-01-20T08:00:00.000Z');
    service = build('mercadopago:pix+card');

    const plan = ok(
      await billing.createPlan(
        { name: 'Monthly', amountMinor: 15000, currency: 'BRL', cycle: BillingCycle.MONTHLY, graceDays: 5 },
        ADMIN,
      ),
    );
    const contract = ok(
      await billing.signContract(
        { userId: STUDENT, planId: plan.id, dueDay: 10, startDate: '2026-01-01', termsSource: ContractTermsSource.STANDARD },
        ADMIN,
      ),
    );
    invoiceId = ok(await billing.issueAdHocInvoice({ subscriptionId: contract.id, referenceDate: '2026-01-15' }, ADMIN)).id;
    original = ok(
      await billing.recordGatewayPayment(invoiceId, {
        amountMinor: 15000,
        currency: 'BRL',
        paidAt: '2026-01-12T14:03:00.000Z',
        externalReference: 'mercadopago:pay-1',
      }),
    ).payment;
    mp.setPayment(stubPayment({ id: 'pay-1', amountMinor: 15000 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks the provider first, then refunds the full amount and writes the reversal under the refund id', async () => {
    const result = ok(await refund());

    expect(mp.calls.map((call) => call.method)).toEqual(['getPayment', 'refund']);
    expect(mp.callsTo('refund')[0]).toMatchObject({
      paymentId: 'pay-1',
      amountMinor: 15000,
      idempotencyKey: `rev:${original.id}`,
    });
    expect(result).toMatchObject({ created: true, refundId: 'mercadopago-refund-1' });
    expect(result.payment).toMatchObject({
      amountMinor: -15000,
      method: PaymentMethod.GATEWAY,
      reversesId: original.id,
      externalReference: 'mercadopago:mercadopago-refund-1',
      note: 'Asked for it back.',
      recordedBy: ADMIN,
      paidAt: '2026-02-01',
    });
    expect(rows()).toHaveLength(2);
    expect(audits('payments.refund_requested')).toEqual([
      { event: 'payments.refund_requested', actor: ADMIN, rail: 'contract', provider: 'mercadopago', paymentId: original.id, at: NOW.toISOString() },
    ]);
    expect(audits('payments.gateway_reversed')).toHaveLength(1);
  });

  it('writes nothing when the provider refuses: 409 PAYMENTS_REFUND_REFUSED', async () => {
    const before = JSON.stringify(ledger.payments);
    mp.failRefunds(new Error('insufficient funds — a provider message that must not travel'));

    const result = await refund();

    expect(result).toEqual({ ok: false, status: 409, error: PAYMENTS_REFUND_REFUSED });
    expect(JSON.stringify(ledger.payments)).toBe(before);
    expect(audits('payments.gateway_reversed')).toHaveLength(0);
  });

  // M30 Task 17: Mercado Pago answers `429` to refunds fired back to back. That
  // is "not now", never "no" — and never a reason to tell an admin it was refused.
  it('answers 503 PAYMENTS_PROVIDER_BUSY for a retryable provider error, writes nothing, and the repeat completes', async () => {
    const before = JSON.stringify(ledger.payments);
    const rateLimited = Object.assign(new Error('429 — a provider message that must not travel'), { retryable: true });
    mp.failRefunds(rateLimited);

    const busy = await refund();

    expect(busy).toEqual({ ok: false, status: 503, error: PAYMENTS_PROVIDER_BUSY });
    expect(JSON.stringify(ledger.payments)).toBe(before);
    expect(audits('payments.gateway_reversed')).toHaveLength(0);

    // A few seconds later the same request goes through: one refund, one reversal row.
    mp.failRefunds(null);
    const result = ok(await refund());

    expect(result).toMatchObject({ created: true, refundId: 'mercadopago-refund-1' });
    expect(result.payment).toMatchObject({ amountMinor: -15000, reversesId: original.id });
    expect(rows()).toHaveLength(2);
    expect(mp.callsTo('refund').map((call) => call.idempotencyKey)).toEqual([`rev:${original.id}`, `rev:${original.id}`]);
  });

  it('is 503 PAYMENTS_PROVIDER_BUSY too when the read before the refund is rate-limited: no refund is requested', async () => {
    mp.failLookups(Object.assign(new Error('timeout'), { retryable: true }));

    expect(await refund()).toEqual({ ok: false, status: 503, error: PAYMENTS_PROVIDER_BUSY });
    expect(mp.callsTo('refund')).toHaveLength(0);
    expect(rows()).toHaveLength(1);
  });

  it('finds a refund the provider did accept before timing out, and records it instead of asking again', async () => {
    // The first call reaches the provider, which refunds — and the answer is lost.
    const realRefund = mp.refund.bind(mp);
    mp.refund = async (...args) => {
      await realRefund(...args);
      mp.refund = realRefund;
      throw Object.assign(new Error('timeout'), { retryable: true });
    };

    expect(await refund()).toEqual({ ok: false, status: 503, error: PAYMENTS_PROVIDER_BUSY });
    expect(rows()).toHaveLength(1);

    const result = ok(await refund());

    expect(result).toMatchObject({ created: true, refundId: 'mercadopago-refund-1' });
    expect(rows()).toHaveLength(2);
    // The repeat read the payment, saw the refund and never asked for a second one.
    expect(mp.callsTo('refund')).toHaveLength(1);
  });

  it('records a refund the provider already holds instead of asking for another', async () => {
    mp.setPayment(
      stubPayment({
        id: 'pay-1',
        amountMinor: 15000,
        status: 'refunded',
        refunds: [{ id: 'dash-9', amountMinor: 15000, createdAt: '2026-01-25T18:30:00.000Z' }],
      }),
    );

    const result = ok(await refund());

    expect(mp.callsTo('refund')).toHaveLength(0);
    expect(result).toMatchObject({ created: true, refundId: 'dash-9' });
    expect(result.payment).toMatchObject({
      reversesId: original.id,
      externalReference: 'mercadopago:dash-9',
      paidAt: '2026-01-25',
    });
    expect(rows()).toHaveLength(2);
    expect(audits('payments.refund_requested')).toHaveLength(0);
  });

  it('returns the row the notification already landed, unlinked, and writes nothing', async () => {
    mp.setPayment(
      stubPayment({
        id: 'pay-1',
        amountMinor: 15000,
        refunds: [{ id: 'dash-9', amountMinor: 15000, createdAt: '2026-01-25T18:30:00.000Z' }],
      }),
    );
    const landed = ok(
      await billing.recordGatewayRefund(invoiceId, {
        amountMinor: 15000,
        currency: 'BRL',
        paidAt: '2026-01-25T18:30:00.000Z',
        externalReference: 'mercadopago:dash-9',
      }),
    ).payment;

    const result = ok(await refund());

    expect(result).toMatchObject({ created: false, refundId: 'dash-9' });
    expect(result.payment.id).toBe(landed.id);
    expect(result.payment.reversesId).toBeNull();
    expect(rows()).toHaveLength(2);
    expect(mp.callsTo('refund')).toHaveLength(0);
  });

  it('answers the same row twice and refunds once', async () => {
    const first = ok(await refund());
    const second = ok(await refund());

    expect(second.payment.id).toBe(first.payment.id);
    expect(second.created).toBe(false);
    expect(mp.callsTo('refund')).toHaveLength(1);
    expect(rows()).toHaveLength(2);
  });

  it('says a lost write out loud (503, naming the refund), and the same request completes it', async () => {
    ledger.failWrites = 1;

    const lost = await refund();

    expect(lost).toEqual({
      ok: false,
      status: 503,
      error: PAYMENTS_REFUND_UNRECORDED,
      meta: { refundId: 'mercadopago-refund-1' },
    });
    expect(rows()).toHaveLength(1);

    const retried = ok(await refund());

    expect(retried).toMatchObject({ created: true, refundId: 'mercadopago-refund-1' });
    expect(retried.payment).toMatchObject({ reversesId: original.id, externalReference: 'mercadopago:mercadopago-refund-1' });
    // One refund at the provider, however many requests it took.
    expect(mp.callsTo('refund')).toHaveLength(1);
    expect(rows()).toHaveLength(2);
  });

  it('is 503 too when the write fails for a refund that was already at the provider', async () => {
    ok(await refund());
    ledger.payments.pop();
    ledger.failWrites = 1;

    expect(await refund()).toMatchObject({ status: 503, error: PAYMENTS_REFUND_UNRECORDED, meta: { refundId: 'mercadopago-refund-1' } });
    expect(mp.callsTo('refund')).toHaveLength(1);
  });

  it('refuses a provider that is not bound any more, before any provider call', async () => {
    // Under `none`, and on a label that moved to another provider.
    for (const list of ['none', 'stripe:card']) {
      const wiring = buildPaymentsWiring(
        stubPaymentsEnv(list),
        stubGatewayFactories(mp, new StubGatewayAdapter('stripe')),
      );
      service = new GatewayService({
        gateways: wiring.gateways,
        gatewayRepo: new MemoryGatewayRepo() as unknown as IGatewayRepository,
        billing,
        charges: {} as GatewayExtrasLedger,
        checkout: { config: wiring.config, registry: wiring.gateways, payer: async () => null, webBaseUrl: 'https://x' },
        now: () => NOW,
      });

      expect(await refund()).toEqual({ ok: false, status: 409, error: PAYMENTS_PROVIDER_NOT_ENABLED });
    }
    expect(mp.calls).toHaveLength(0);
    expect(rows()).toHaveLength(1);
  });

  it('still refunds through a retired provider (bound, offering no method)', async () => {
    service = build('mercadopago:');

    expect(ok(await refund()).created).toBe(true);
  });

  it('is loud about an invalid provider list: 500 PAYMENTS_CONFIG_INVALID', async () => {
    service = build('mercadopago:pix,mercadopago:card');

    expect(await refund()).toEqual({ ok: false, status: 500, error: PAYMENTS_CONFIG_INVALID });
    expect(mp.calls).toHaveLength(0);
  });

  it('requests nothing when the provider cannot be asked (502) or does not know the payment (409)', async () => {
    mp.failLookups(new Error('timeout'));
    expect(await refund()).toEqual({ ok: false, status: 502, error: PAYMENTS_PROVIDER_ERROR });

    mp.failLookups(null).removePayment('pay-1');
    expect(await refund()).toMatchObject({ status: 409, error: PAYMENTS_REFUND_REFUSED });

    expect(mp.callsTo('refund')).toHaveLength(0);
    expect(rows()).toHaveLength(1);
  });

  it('refuses when the provider holds only a partial refund: the mirror row would count it twice', async () => {
    mp.setPayment(
      stubPayment({
        id: 'pay-1',
        amountMinor: 15000,
        refunds: [{ id: 'part-1', amountMinor: 5000, createdAt: '2026-01-25T18:30:00.000Z' }],
      }),
    );

    expect(await refund()).toMatchObject({ status: 409, error: PAYMENTS_REFUND_REFUSED });
    expect(mp.callsTo('refund')).toHaveLength(0);
    expect(rows()).toHaveLength(1);
  });

  it('never reaches a provider for a reversal row, a cash row, a missing row or a blank reason', async () => {
    const reversal = ok(await refund()).payment;
    const cash = ok(await billing.recordPayment(invoiceId, { amountMinor: 100, method: PaymentMethod.CASH }, ADMIN));
    mp.calls.length = 0;

    expect(await refund(reversal.id)).toMatchObject({ status: 409, error: 'Conflict' });
    expect(await refund(cash.id)).toMatchObject({ status: 409, error: 'Conflict' });
    expect(await refund('nope')).toMatchObject({ status: 404 });
    expect(await refund(original.id, '   ')).toMatchObject({ status: 400, error: 'ValidationError' });
    expect(mp.calls).toHaveLength(0);
  });
});

describe('BillingService.reversePayment — gateway rows', () => {
  it('refuses a gateway row: the provider returns the money first', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const ledger = new FakeBillingRepository();
    const billing = new BillingService(ledger);
    const { BillingCycle, ContractTermsSource } = Entities.Config;
    const plan = await billing.createPlan(
      { name: 'Monthly', amountMinor: 15000, currency: 'BRL', cycle: BillingCycle.MONTHLY, graceDays: 5 },
      'admin-1',
    );
    if (!plan.ok) throw new Error('plan');
    const contract = await billing.signContract(
      { userId: STUDENT, planId: plan.data.id, dueDay: 10, startDate: '2026-01-01', termsSource: ContractTermsSource.STANDARD },
      'admin-1',
    );
    if (!contract.ok) throw new Error('contract');
    const invoice = await billing.issueAdHocInvoice({ subscriptionId: contract.data.id, referenceDate: '2026-01-15' }, 'admin-1');
    if (!invoice.ok) throw new Error('invoice');
    const landed = await billing.recordGatewayPayment(invoice.data.id, {
      amountMinor: 15000,
      currency: 'BRL',
      paidAt: '2026-01-12',
      externalReference: 'mercadopago:pay-1',
    });
    if (!landed.ok) throw new Error('landed');

    const result = await billing.reversePayment(landed.data.payment.id, { reason: 'by hand' }, 'admin-1');

    expect(result).toMatchObject({ ok: false, status: 409, error: 'Conflict' });
    expect(ledger.payments).toHaveLength(1);
    vi.restoreAllMocks();
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
