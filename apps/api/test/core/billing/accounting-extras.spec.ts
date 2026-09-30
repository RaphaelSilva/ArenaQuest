import { describe, it, expect, beforeEach } from 'vitest';
import {
  AccountingService,
  type EventTitleReader,
  type ExtrasLedgerReader,
} from '@api/core/billing/accounting-service';
import { FakeBillingRepository } from '../../helpers/fake-billing-repository';
import { Entities } from '@arenaquest/shared/types/entities';
import type {
  ChargeLedgerEntryRecord,
  ChargeLedgerFilter,
  EventChargeAdjustmentRecord,
  EventChargeFilter,
  EventChargePaymentRecord,
  EventChargeRecord,
  EventChargeWithBalanceRecord,
  InvoiceRecord,
  PaymentRecord,
  SubscriptionRecord,
} from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';

const {
  BillingCycle,
  BillingStanding,
  ChargeStatus,
  ContractStatus,
  ContractTermsSource,
  InvoiceStatus,
  AdjustmentKind,
  PaymentMethod,
} = Entities.Config;

/**
 * The extras rail in the three reports (RFC 0015 §7), against in-memory data.
 *
 * Every case asserts one of two things: the extras rail is reported **beside**
 * the contract figures and never inside them, or a pre-existing contract field
 * reads exactly what it read before the charge tables held anything.
 */

const ADMIN = 'admin-1';
const STUDENT = 'student-1';
const OTHER = 'student-2';

function ok<T>(result: ControllerResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.status} ${result.error}`);
  return result.data;
}

function daysBefore(asOf: string, days: number): string {
  return new Date(Date.parse(`${asOf}T00:00:00.000Z`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** An in-memory extras ledger with the adapter's filter semantics. */
class FakeExtrasLedger implements ExtrasLedgerReader {
  readonly charges = new Map<string, EventChargeRecord>();
  readonly payments: EventChargePaymentRecord[] = [];
  readonly adjustments: EventChargeAdjustmentRecord[] = [];

  async listCharges(filter: EventChargeFilter): Promise<EventChargeWithBalanceRecord[]> {
    return [...this.charges.values()]
      .filter((charge) => filter.userId === undefined || charge.userId === filter.userId)
      .filter((charge) => filter.eventId === undefined || charge.eventId === filter.eventId)
      .map((charge) => ({ ...charge, balanceMinor: this.balance(charge) }));
  }

  async listLedger(filter: ChargeLedgerFilter): Promise<ChargeLedgerEntryRecord[]> {
    const keep = (chargeId: string, at: string): boolean => {
      const charge = this.charges.get(chargeId)!;
      if (filter.userId !== undefined && charge.userId !== filter.userId) return false;
      if (filter.eventId !== undefined && charge.eventId !== filter.eventId) return false;
      if (filter.chargeId !== undefined && chargeId !== filter.chargeId) return false;
      const day = at.slice(0, 10);
      if (filter.from !== undefined && day < filter.from) return false;
      if (filter.to !== undefined && day > filter.to) return false;
      return true;
    };
    return [
      ...this.payments
        .filter((p) => keep(p.chargeId, p.paidAt))
        .map((payment): ChargeLedgerEntryRecord => ({ entry: 'payment', payment, occurredAt: payment.paidAt })),
      ...this.adjustments
        .filter((a) => keep(a.chargeId, a.appliedAt))
        .map((adjustment): ChargeLedgerEntryRecord => ({
          entry: 'adjustment',
          adjustment,
          occurredAt: adjustment.appliedAt,
        })),
    ];
  }

  private balance(charge: EventChargeRecord): number {
    let balance = charge.amountMinor;
    for (const a of this.adjustments) if (a.chargeId === charge.id) balance += a.amountMinor;
    for (const p of this.payments) if (p.chargeId === charge.id) balance -= p.amountMinor;
    return balance;
  }
}

describe('AccountingService — extras rail', () => {
  let repo: FakeBillingRepository;
  let ledger: FakeExtrasLedger;
  let events: Map<string, { title: string; startsAt: Date }>;
  let service: AccountingService;
  /** The same data, read by a service that knows nothing of charges. */
  let contractOnly: AccountingService;
  let sequence = 0;

  beforeEach(() => {
    repo = new FakeBillingRepository();
    ledger = new FakeExtrasLedger();
    events = new Map([
      ['event-1', { title: 'Winter Seminar', startsAt: new Date('2026-07-18T13:00:00.000Z') }],
    ]);
    const eventReader: EventTitleReader = {
      findById: async (id) =>
        (events.has(id) ? ({ id, ...events.get(id)! } as unknown as Entities.Events.Event) : null),
    };
    const users = new Set([ADMIN, STUDENT, OTHER]);
    const exists = async (userId: string) => users.has(userId);
    service = new AccountingService(repo, exists, ledger, eventReader);
    contractOnly = new AccountingService(repo, exists);
    sequence = 0;
  });

  function addContract(id = 'sub-1', userId = STUDENT): SubscriptionRecord {
    const contract: SubscriptionRecord = {
      id,
      userId,
      planId: 'plan-1',
      contractGroupId: id,
      supersedesId: null,
      termsSource: ContractTermsSource.STANDARD,
      amountMinor: 15000,
      currency: 'BRL',
      cycle: BillingCycle.MONTHLY,
      graceDays: 5,
      dueDay: 10,
      status: ContractStatus.ACTIVE,
      startDate: '2026-01-01',
      endDate: null,
      termsNote: '',
      signedBy: ADMIN,
      signedAt: '2026-01-01 00:00:00',
      updatedAt: '2026-01-01 00:00:00',
    };
    repo.subscriptions.set(id, contract);
    return contract;
  }

  function addInvoice(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
    const invoice: InvoiceRecord = {
      id: `inv-${++sequence}`,
      subscriptionId: 'sub-1',
      userId: STUDENT,
      periodStart: '2026-08-01',
      periodEnd: '2026-09-01',
      dueDate: '2026-08-10',
      amountMinor: 15000,
      currency: 'BRL',
      graceDays: 5,
      status: InvoiceStatus.OPEN,
      issuedAt: '2026-08-01 09:00:00',
      voidedAt: null,
      voidReason: null,
      ...over,
    };
    repo.invoices.set(invoice.id, invoice);
    return invoice;
  }

  function payInvoice(invoiceId: string, amountMinor: number, paidAt: string): void {
    const payment: PaymentRecord = {
      id: `pay-${++sequence}`,
      invoiceId,
      amountMinor,
      currency: 'BRL',
      method: PaymentMethod.PIX,
      paidAt,
      externalReference: null,
      note: '',
      reversesId: null,
      recordedBy: ADMIN,
      recordedAt: `${paidAt} 12:00:00`,
    };
    repo.payments.push(payment);
  }

  function addCharge(over: Partial<EventChargeRecord> = {}): EventChargeRecord {
    const charge: EventChargeRecord = {
      id: `chg-${++sequence}`,
      eventId: 'event-1',
      userId: STUDENT,
      description: 'Seminar (snapshot)',
      amountMinor: 15000,
      currency: 'BRL',
      termsSource: ContractTermsSource.STANDARD,
      termsNote: '',
      dueDate: '2026-08-20',
      graceDays: 5,
      status: ChargeStatus.OPEN,
      issuedBy: ADMIN,
      issuedAt: '2026-08-05 09:00:00',
      voidedAt: null,
      voidReason: null,
      ...over,
    };
    ledger.charges.set(charge.id, charge);
    return charge;
  }

  function payCharge(chargeId: string, amountMinor: number, paidAt: string, currency = 'BRL') {
    ledger.payments.push({
      id: `cpay-${++sequence}`,
      chargeId,
      amountMinor,
      currency,
      method: PaymentMethod.PIX,
      paidAt,
      externalReference: null,
      note: '',
      reversesId: null,
      recordedBy: ADMIN,
      recordedAt: `${paidAt} 12:00:00`,
    });
  }

  function adjustCharge(chargeId: string, amountMinor: number, appliedAt: string) {
    ledger.adjustments.push({
      id: `cadj-${++sequence}`,
      chargeId,
      kind: AdjustmentKind.DISCOUNT,
      amountMinor,
      reason: 'fixture',
      appliedBy: ADMIN,
      appliedAt,
    });
  }

  /** 30000 of fees received in August, over two invoices. */
  function seedFees(): void {
    addContract();
    const a = addInvoice();
    const b = addInvoice({ userId: OTHER, dueDate: '2026-08-12' });
    payInvoice(a.id, 15000, '2026-08-09');
    payInvoice(b.id, 15000, '2026-08-11');
    // One more open invoice so outstanding is non-zero.
    addInvoice({ amountMinor: 7000 });
  }

  // -------------------------------------------------------------------------
  // Movement
  // -------------------------------------------------------------------------

  describe('getMonthlyMovement', () => {
    it('reports fees, extras and the till apart: 30000 + 15000 = 45000 cash', async () => {
      seedFees();
      const charge = addCharge();
      payCharge(charge.id, 15000, '2026-08-15');

      const report = ok(await service.getMonthlyMovement('2026-08'));

      expect(report.receivedMinor).toBe(30000);
      expect(report.extras.receivedMinor).toBe(15000);
      expect(report.cashReceivedMinor).toBe(45000);
    });

    it('keeps every pre-existing field identical when the charge tables hold data', async () => {
      seedFees();
      const before = ok(await contractOnly.getMonthlyMovement('2026-08'));

      const charge = addCharge({ amountMinor: 20000 });
      payCharge(charge.id, 5000, '2026-08-15');
      adjustCharge(charge.id, -1000, '2026-08-16');
      addCharge({ userId: OTHER, issuedAt: '2026-08-20 10:00:00' });

      const after = ok(await service.getMonthlyMovement('2026-08'));
      const { extras, cashReceivedMinor, ...contractFields } = after;
      const { extras: _e, cashReceivedMinor: _c, ...beforeFields } = before;

      expect(contractFields).toEqual(beforeFields);
      expect(extras).toEqual({
        chargedMinor: 35000,
        adjustmentsMinor: -1000,
        receivedMinor: 5000,
        chargesIssued: 2,
        receivableAtCloseMinor: 20000 - 1000 - 5000 + 15000,
      });
      expect(cashReceivedMinor).toBe(before.receivedMinor + 5000);
      // Without a charge reader the extras block is empty, not absent.
      expect(before.extras).toEqual({
        chargedMinor: 0,
        adjustmentsMinor: 0,
        receivedMinor: 0,
        chargesIssued: 0,
        receivableAtCloseMinor: 0,
      });
    });

    it('keys charged on issue, received on paid_at and receivable on the close', async () => {
      const july = addCharge({ issuedAt: '2026-07-20 09:00:00', amountMinor: 10000 });
      payCharge(july.id, 4000, '2026-08-02');
      const september = addCharge({ issuedAt: '2026-09-02 09:00:00' });
      payCharge(september.id, 15000, '2026-09-03');

      const report = ok(await service.getMonthlyMovement('2026-08'));

      expect(report.extras).toMatchObject({
        chargedMinor: 0,
        chargesIssued: 0,
        receivedMinor: 4000,
        receivableAtCloseMinor: 6000,
      });
    });

    it('leaves a voided charge and its ledger rows out of every total', async () => {
      const voided = addCharge({ status: ChargeStatus.VOID, voidedAt: '2026-08-10 00:00:00' });
      payCharge(voided.id, 3000, '2026-08-06');
      payCharge(voided.id, -3000, '2026-08-07');
      adjustCharge(voided.id, -500, '2026-08-08');

      const report = ok(await service.getMonthlyMovement('2026-08'));

      expect(report.extras).toEqual({
        chargedMinor: 0,
        adjustmentsMinor: 0,
        receivedMinor: 0,
        chargesIssued: 0,
        receivableAtCloseMinor: 0,
      });
      expect(report.cashReceivedMinor).toBe(0);
    });

    it('409s a month whose rails span two currencies', async () => {
      seedFees();
      addCharge({ currency: 'JPY' });

      const result = await service.getMonthlyMovement('2026-08');

      expect(result).toMatchObject({ ok: false, status: 409, error: 'Conflict' });
    });
  });

  // -------------------------------------------------------------------------
  // Aging
  // -------------------------------------------------------------------------

  describe('getReceivablesAging', () => {
    const asOf = '2026-10-01';

    it('defaults to the contract rail, identical to the pre-task aging', async () => {
      addContract();
      addInvoice({ dueDate: daysBefore(asOf, 45), amountMinor: 9000 });
      const before = ok(await contractOnly.getReceivablesAging(asOf));

      addCharge({ dueDate: daysBefore(asOf, 10), amountMinor: 3000 });

      const byDefault = ok(await service.getReceivablesAging(asOf));
      const explicit = ok(await service.getReceivablesAging(asOf, 'contract'));

      expect(byDefault).toEqual(explicit);
      expect(byDefault).toEqual(before);
      expect(byDefault.rail).toBe('contract');
      expect(byDefault.totalMinor).toBe(9000);
    });

    it('buckets only charges on the extras rail', async () => {
      addContract();
      addInvoice({ dueDate: daysBefore(asOf, 45), amountMinor: 9000 });
      addCharge({ dueDate: daysBefore(asOf, 10), amountMinor: 3000 });
      const late = addCharge({ userId: OTHER, dueDate: daysBefore(asOf, 95), amountMinor: 8000 });
      payCharge(late.id, 2000, '2026-09-01');

      const report = ok(await service.getReceivablesAging(asOf, 'extras'));

      expect(report.rail).toBe('extras');
      const totals = Object.fromEntries(report.buckets.map((b) => [b.bucket, b.totalMinor]));
      expect(totals).toEqual({ '0-30': 3000, '31-60': 0, '61-90': 0, '90+': 6000 });
      expect(report).toMatchObject({ totalMinor: 9000, invoiceCount: 2, studentCount: 2 });
    });

    it('drops a voided charge from every bucket', async () => {
      addCharge({ dueDate: daysBefore(asOf, 40), status: ChargeStatus.VOID });

      const report = ok(await service.getReceivablesAging(asOf, 'extras'));

      expect(report.totalMinor).toBe(0);
      expect(report.buckets.every((bucket) => bucket.invoiceCount === 0)).toBe(true);
    });

    it('409s an extras aging spanning two currencies', async () => {
      addCharge({ dueDate: daysBefore(asOf, 10) });
      addCharge({ userId: OTHER, dueDate: daysBefore(asOf, 10), currency: 'JPY' });

      const result = await service.getReceivablesAging(asOf, 'extras');

      expect(result).toMatchObject({ ok: false, status: 409 });
    });
  });

  // -------------------------------------------------------------------------
  // Statement
  // -------------------------------------------------------------------------

  describe('getStudentStatement', () => {
    it('lists the extras beside the contract, never inside its outstanding', async () => {
      addContract();
      const invoice = addInvoice({ dueDate: '2026-01-10', issuedAt: '2026-01-01 09:00:00' });
      payInvoice(invoice.id, 15000, '2026-01-09');
      const overdue = addCharge({ dueDate: '2026-01-20', issuedAt: '2026-01-02 09:00:00' });
      adjustCharge(overdue.id, -1000, '2026-01-05');
      payCharge(overdue.id, 4000, '2026-01-06');
      addCharge({
        eventId: 'gone-event',
        description: 'Deleted Workshop',
        status: ChargeStatus.VOID,
        issuedAt: '2026-01-03 09:00:00',
      });
      // Another student's charge must never appear.
      addCharge({ userId: OTHER, dueDate: '2026-01-15' });

      const statement = ok(await service.getStudentStatement(STUDENT));

      expect(statement.outstandingMinor).toBe(0);
      expect(statement.extras.standing).toBe(BillingStanding.DELINQUENT);
      expect(statement.extras.outstandingMinor).toBe(10000);
      expect(statement.extras.oldestOverdueDate).toBe('2026-01-20');
      expect(statement.extras.charges).toHaveLength(2);
      expect(statement.extras.charges.every((charge) => charge.userId === STUDENT)).toBe(true);

      const [live, voided] = statement.extras.charges;
      expect(live).toMatchObject({
        id: overdue.id,
        eventTitle: 'Winter Seminar',
        eventStartsAt: '2026-07-18T13:00:00.000Z',
        dueDate: '2026-01-20',
        amountMinor: 15000,
        balanceMinor: 10000,
      });
      expect(live.adjustments).toHaveLength(1);
      expect(live.payments).toHaveLength(1);
      // A charge whose event is gone keeps the title it was issued under.
      expect(voided).toMatchObject({ eventTitle: 'Deleted Workshop', eventStartsAt: null, balanceMinor: 0 });
    });

    it('answers a member with nothing at all with an empty extras rail in good standing', async () => {
      const statement = ok(await service.getStudentStatement(OTHER));

      expect(statement.extras).toEqual({
        standing: BillingStanding.GOOD,
        oldestOverdueDate: null,
        outstandingMinor: 0,
        charges: [],
      });
      expect(statement.invoices).toEqual([]);
    });

    it('409s a statement whose rails span two currencies', async () => {
      addContract();
      addInvoice();
      addCharge({ currency: 'JPY' });

      const result = await service.getStudentStatement(STUDENT);

      expect(result).toMatchObject({ ok: false, status: 409 });
    });
  });
});
