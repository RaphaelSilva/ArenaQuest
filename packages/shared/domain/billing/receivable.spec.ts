import { describe, expect, it } from 'vitest';
import { Entities } from '../../types/entities';
import type { InvoiceWithBalanceRecord } from '../../ports/i-billing-repository';
import type { EventChargeWithBalanceRecord } from '../../ports/i-event-charge-repository';
import { resolveStanding, type StandingInvoice } from './standing-resolver';
import { fromCharge, fromInvoice, resolveRailStanding, type Receivable } from './receivable';

const { GOOD, DELINQUENT } = Entities.Config.BillingStanding;

let seq = 0;

function invoiceRecord(overrides: Partial<InvoiceWithBalanceRecord> = {}): InvoiceWithBalanceRecord {
  seq += 1;
  return {
    id: `inv-${seq}`,
    subscriptionId: 'sub-1',
    userId: 'user-1',
    periodStart: '2026-03-01',
    periodEnd: '2026-04-01',
    dueDate: '2026-03-10',
    amountMinor: 10_000,
    currency: 'BRL',
    graceDays: 5,
    status: Entities.Config.InvoiceStatus.OPEN,
    issuedAt: '2026-03-01 00:00:00',
    voidedAt: null,
    voidReason: null,
    balanceMinor: 10_000,
    ...overrides,
  };
}

function chargeRecord(
  overrides: Partial<EventChargeWithBalanceRecord> = {},
): EventChargeWithBalanceRecord {
  seq += 1;
  return {
    id: `chg-${seq}`,
    eventId: 'event-1',
    userId: 'user-1',
    description: 'Spring Seminar',
    amountMinor: 20_000,
    currency: 'BRL',
    termsSource: Entities.Config.ContractTermsSource.STANDARD,
    termsNote: '',
    dueDate: '2026-03-10',
    graceDays: 3,
    status: Entities.Config.ChargeStatus.OPEN,
    issuedBy: 'admin-1',
    issuedAt: '2026-03-01 00:00:00',
    voidedAt: null,
    voidReason: null,
    balanceMinor: 20_000,
    ...overrides,
  };
}

/** Lifts a standing-resolver fixture into a full invoice record. */
function fromStanding(item: StandingInvoice): InvoiceWithBalanceRecord {
  return invoiceRecord({
    dueDate: item.dueDate,
    graceDays: item.graceDays,
    balanceMinor: item.balanceMinor,
  });
}

type Hold = { expiresAt: string | null } | null;

interface StandingCase {
  name: string;
  invoices: StandingInvoice[];
  hold: Hold;
  today: string;
}

const inv = (dueDate: string, graceDays: number, balanceMinor: number): StandingInvoice => ({
  dueDate,
  graceDays,
  balanceMinor,
});

// The scenarios of standing-resolver.spec.ts, restated as data.
const standingCases: StandingCase[] = [
  { name: 'no open invoice', invoices: [], hold: null, today: '2026-03-01' },
  { name: 'free contract settled on arrival', invoices: [inv('2026-01-10', 5, 0)], hold: null, today: '2026-06-01' },
  { name: 'overpaid invoice', invoices: [inv('2026-01-10', 5, -2_500)], hold: null, today: '2026-06-01' },
  { name: 'before the due date', invoices: [inv('2026-03-10', 5, 10_000)], hold: null, today: '2026-03-09' },
  { name: 'on the due date', invoices: [inv('2026-03-10', 5, 10_000)], hold: null, today: '2026-03-10' },
  { name: 'last day of grace', invoices: [inv('2026-03-10', 5, 10_000)], hold: null, today: '2026-03-15' },
  { name: 'day after grace', invoices: [inv('2026-03-10', 5, 10_000)], hold: null, today: '2026-03-16' },
  { name: 'grace across month end (due)', invoices: [inv('2026-01-28', 5, 10_000)], hold: null, today: '2026-02-02' },
  { name: 'grace across month end (delinquent)', invoices: [inv('2026-01-28', 5, 10_000)], hold: null, today: '2026-02-03' },
  { name: 'zero grace on the due date', invoices: [inv('2026-03-10', 0, 10_000)], hold: null, today: '2026-03-10' },
  { name: 'zero grace the day after', invoices: [inv('2026-03-10', 0, 10_000)], hold: null, today: '2026-03-11' },
  {
    name: 'oldest invoice grace decides (due)',
    invoices: [inv('2026-04-10', 0, 5_000), inv('2026-03-10', 30, 7_000)],
    hold: null,
    today: '2026-04-05',
  },
  {
    name: 'oldest invoice grace decides (delinquent)',
    invoices: [inv('2026-04-10', 0, 5_000), inv('2026-03-10', 30, 7_000)],
    hold: null,
    today: '2026-04-10',
  },
  {
    name: 'settled older invoice ignored',
    invoices: [inv('2026-01-10', 0, 0), inv('2026-03-10', 5, 7_000)],
    hold: null,
    today: '2026-03-12',
  },
  { name: 'unexpired hold', invoices: [inv('2026-03-10', 5, 10_000)], hold: { expiresAt: '2026-04-30' }, today: '2026-04-01' },
  { name: 'never-expiring hold', invoices: [inv('2026-03-10', 5, 10_000)], hold: { expiresAt: null }, today: '2026-04-01' },
  { name: 'hold on its expiry date', invoices: [inv('2026-03-10', 5, 10_000)], hold: { expiresAt: '2026-04-01' }, today: '2026-04-01' },
  { name: 'expired hold', invoices: [inv('2026-03-10', 5, 10_000)], hold: { expiresAt: '2026-03-31' }, today: '2026-04-01' },
  { name: 'discount clears the balance', invoices: [inv('2026-03-10', 5, 0)], hold: null, today: '2026-04-01' },
  { name: 'reversal reopens the balance', invoices: [inv('2026-03-10', 5, 10_000)], hold: null, today: '2026-04-01' },
  {
    name: 'outstanding sums positive balances only',
    invoices: [
      inv('2026-03-10', 5, 7_000),
      inv('2026-04-10', 5, 3_000),
      inv('2026-05-10', 5, 0),
      inv('2026-06-10', 5, -1_000),
    ],
    hold: null,
    today: '2026-03-01',
  },
];

describe('resolveRailStanding', () => {
  describe('contract rail matches resolveStanding for the same invoices', () => {
    it.each(standingCases)('$name', ({ invoices, hold, today }) => {
      const receivables = invoices.map(fromStanding).map(fromInvoice);
      expect(resolveRailStanding('contract', receivables, hold, today)).toEqual(
        resolveStanding({ openInvoices: invoices, hold, today }),
      );
    });
  });

  describe('extras rail', () => {
    it('resolves a charge past its own grace as delinquent', () => {
      const charge = fromCharge(chargeRecord({ dueDate: '2026-03-10', graceDays: 3 }));
      const result = resolveRailStanding('extras', [charge], null, '2026-03-14');
      expect(result).toEqual({
        standing: DELINQUENT,
        oldestOverdueDate: '2026-03-10',
        outstandingMinor: 20_000,
      });
    });
  });

  describe('rails are never merged', () => {
    it('throws when an event charge is passed on the contract rail', () => {
      const items = [fromInvoice(invoiceRecord()), fromCharge(chargeRecord())];
      expect(() => resolveRailStanding('contract', items, null, '2026-03-01')).toThrow(/rail/);
    });

    it('throws when an invoice is passed on the extras rail', () => {
      const items = [fromCharge(chargeRecord()), fromInvoice(invoiceRecord())];
      expect(() => resolveRailStanding('extras', items, null, '2026-03-01')).toThrow(/rail/);
    });

    it('throws even when the stray item is void', () => {
      const stray = fromCharge(chargeRecord({ status: Entities.Config.ChargeStatus.VOID }));
      expect(() => resolveRailStanding('contract', [stray], null, '2026-03-01')).toThrow(/rail/);
    });

    it('throws when a receivable is tagged with a rail its kind does not belong to', () => {
      const forged: Receivable = { ...fromCharge(chargeRecord()), rail: 'contract' };
      expect(() => resolveRailStanding('contract', [forged], null, '2026-03-01')).toThrow(/rail/);
    });
  });

  describe('void receivables are excluded before resolution', () => {
    it('leaves standing good when the only overdue item is void', () => {
      const voided = fromCharge(
        chargeRecord({
          status: Entities.Config.ChargeStatus.VOID,
          dueDate: '2026-01-10',
          graceDays: 0,
          balanceMinor: 20_000,
          voidedAt: '2026-01-11 00:00:00',
          voidReason: 'issued by mistake',
        }),
      );
      expect(resolveRailStanding('extras', [voided], null, '2026-06-01')).toEqual({
        standing: GOOD,
        oldestOverdueDate: null,
        outstandingMinor: 0,
      });
    });

    it('counts only the live item next to a void one', () => {
      const voided = fromCharge(
        chargeRecord({
          status: Entities.Config.ChargeStatus.VOID,
          dueDate: '2026-01-10',
          balanceMinor: 20_000,
        }),
      );
      const live = fromCharge(chargeRecord({ dueDate: '2026-05-10', balanceMinor: 8_000 }));
      expect(resolveRailStanding('extras', [voided, live], null, '2026-05-01')).toEqual({
        standing: GOOD,
        oldestOverdueDate: null,
        outstandingMinor: 8_000,
      });
    });

    it('drops void invoices on the contract rail too', () => {
      const voided = fromInvoice(
        invoiceRecord({ status: Entities.Config.InvoiceStatus.VOID, dueDate: '2026-01-10' }),
      );
      expect(resolveRailStanding('contract', [voided], null, '2026-06-01').standing).toBe(GOOD);
    });
  });
});

describe('fromInvoice', () => {
  it('tags the contract rail and preserves the invoice own snapshot and balance', () => {
    const record = invoiceRecord({
      id: 'inv-x',
      periodStart: '2026-09-01',
      dueDate: '2026-09-05',
      graceDays: 12,
      amountMinor: 15_000,
      balanceMinor: 4_321,
      currency: 'USD',
    });
    expect(fromInvoice(record)).toEqual({
      rail: 'contract',
      kind: 'invoice',
      id: 'inv-x',
      userId: 'user-1',
      sourceId: 'sub-1',
      label: '2026-09',
      issuedAt: '2026-03-01 00:00:00',
      dueDate: '2026-09-05',
      graceDays: 12,
      amountMinor: 15_000,
      currency: 'USD',
      status: 'open',
      balanceMinor: 4_321,
    });
  });
});

describe('fromCharge', () => {
  it('tags the extras rail and preserves the charge own snapshot and balance', () => {
    const record = chargeRecord({
      id: 'chg-x',
      eventId: 'event-9',
      graceDays: 0,
      amountMinor: 30_000,
      balanceMinor: -500,
      status: Entities.Config.ChargeStatus.PAID,
    });
    expect(fromCharge(record)).toEqual({
      rail: 'extras',
      kind: 'event_charge',
      id: 'chg-x',
      userId: 'user-1',
      sourceId: 'event-9',
      label: 'Spring Seminar',
      issuedAt: '2026-03-01 00:00:00',
      dueDate: '2026-03-10',
      graceDays: 0,
      amountMinor: 30_000,
      currency: 'BRL',
      status: 'paid',
      balanceMinor: -500,
    });
  });

  it('labels with the given event title over the issue-time snapshot', () => {
    expect(fromCharge(chargeRecord(), 'Spring Seminar (renamed)').label).toBe(
      'Spring Seminar (renamed)',
    );
  });
});
