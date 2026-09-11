import { describe, expect, it } from 'vitest';
import { Entities } from '../../types/entities';
import { resolveStanding, type StandingInput, type StandingInvoice } from './standing-resolver';

const { GOOD, DUE, DELINQUENT, EXEMPT } = Entities.Config.BillingStanding;

function invoice(overrides: Partial<StandingInvoice> = {}): StandingInvoice {
  return { dueDate: '2026-03-10', graceDays: 5, balanceMinor: 10_000, ...overrides };
}

function input(overrides: Partial<StandingInput> = {}): StandingInput {
  return { openInvoices: [invoice()], hold: null, today: '2026-03-01', ...overrides };
}

describe('resolveStanding', () => {
  describe('nothing owed', () => {
    it('returns good for a student with no open invoice', () => {
      expect(resolveStanding(input({ openInvoices: [] }))).toEqual({
        standing: GOOD,
        oldestOverdueDate: null,
        outstandingMinor: 0,
      });
    });

    it('returns good for a free contract, whose invoice is settled on arrival', () => {
      const settled = input({
        openInvoices: [invoice({ balanceMinor: 0, dueDate: '2026-01-10' })],
        today: '2026-06-01',
      });
      expect(resolveStanding(settled)).toEqual({
        standing: GOOD,
        oldestOverdueDate: null,
        outstandingMinor: 0,
      });
    });

    it('returns good for an overpaid invoice — a credit is not a debt', () => {
      const overpaid = input({
        openInvoices: [invoice({ balanceMinor: -2_500, dueDate: '2026-01-10' })],
        today: '2026-06-01',
      });
      expect(resolveStanding(overpaid).standing).toBe(GOOD);
      expect(resolveStanding(overpaid).outstandingMinor).toBe(0);
    });
  });

  describe('the grace boundaries, read from the invoice', () => {
    it('is good before the due date', () => {
      const result = resolveStanding(input({ today: '2026-03-09' }));
      expect(result.standing).toBe(GOOD);
      expect(result.oldestOverdueDate).toBeNull();
    });

    it('is due on the due date itself', () => {
      const result = resolveStanding(input({ today: '2026-03-10' }));
      expect(result.standing).toBe(DUE);
      expect(result.oldestOverdueDate).toBe('2026-03-10');
    });

    it('is still due on the last day of grace — the bound is inclusive', () => {
      // dueDate 2026-03-10 + graceDays 5 = 2026-03-15.
      expect(resolveStanding(input({ today: '2026-03-15' })).standing).toBe(DUE);
    });

    it('is delinquent the day after grace lapses — the bound is exclusive', () => {
      expect(resolveStanding(input({ today: '2026-03-16' })).standing).toBe(DELINQUENT);
    });

    it('crosses a month boundary when grace runs past month end', () => {
      const monthEnd = input({
        openInvoices: [invoice({ dueDate: '2026-01-28', graceDays: 5 })],
      });
      expect(resolveStanding({ ...monthEnd, today: '2026-02-02' }).standing).toBe(DUE);
      expect(resolveStanding({ ...monthEnd, today: '2026-02-03' }).standing).toBe(DELINQUENT);
    });

    it('is delinquent immediately when the invoice snapshotted zero grace', () => {
      const noGrace = input({
        openInvoices: [invoice({ graceDays: 0 })],
      });
      expect(resolveStanding({ ...noGrace, today: '2026-03-10' }).standing).toBe(DUE);
      expect(resolveStanding({ ...noGrace, today: '2026-03-11' }).standing).toBe(DELINQUENT);
    });
  });

  describe('the oldest unpaid invoice decides, against its own snapshot', () => {
    it('uses the oldest invoice grace, not the newest, when they differ', () => {
      // The older invoice snapshotted 30 days of grace; the newer one 0. A
      // policy change cannot retroactively suspend a charge issued last month.
      const twoInvoices = input({
        openInvoices: [
          invoice({ dueDate: '2026-04-10', graceDays: 0, balanceMinor: 5_000 }),
          invoice({ dueDate: '2026-03-10', graceDays: 30, balanceMinor: 7_000 }),
        ],
        today: '2026-04-05',
      });
      const result = resolveStanding(twoInvoices);
      expect(result.standing).toBe(DUE); // 2026-03-10 + 30 = 2026-04-09
      expect(result.oldestOverdueDate).toBe('2026-03-10');
      expect(result.outstandingMinor).toBe(12_000);
    });

    it('turns delinquent once the oldest invoice own grace lapses', () => {
      const twoInvoices = input({
        openInvoices: [
          invoice({ dueDate: '2026-04-10', graceDays: 0, balanceMinor: 5_000 }),
          invoice({ dueDate: '2026-03-10', graceDays: 30, balanceMinor: 7_000 }),
        ],
        today: '2026-04-10',
      });
      expect(resolveStanding(twoInvoices).standing).toBe(DELINQUENT);
    });

    it('ignores a settled older invoice when picking the oldest', () => {
      const mixed = input({
        openInvoices: [
          invoice({ dueDate: '2026-01-10', graceDays: 0, balanceMinor: 0 }),
          invoice({ dueDate: '2026-03-10', graceDays: 5, balanceMinor: 7_000 }),
        ],
        today: '2026-03-12',
      });
      const result = resolveStanding(mixed);
      expect(result.standing).toBe(DUE);
      expect(result.oldestOverdueDate).toBe('2026-03-10');
      expect(result.outstandingMinor).toBe(7_000);
    });
  });

  describe('holds suppress the label, never the debt', () => {
    const overdue = input({
      openInvoices: [invoice({ dueDate: '2026-03-10', graceDays: 5, balanceMinor: 10_000 })],
      today: '2026-04-01',
    });

    it('reports exempt for an unexpired hold while still reporting the debt', () => {
      const held = resolveStanding({ ...overdue, hold: { expiresAt: '2026-04-30' } });
      expect(held.standing).toBe(EXEMPT);
      expect(held.outstandingMinor).toBe(10_000);
      expect(held.oldestOverdueDate).toBe('2026-03-10');
    });

    it('reports exempt for a hold that never expires', () => {
      expect(resolveStanding({ ...overdue, hold: { expiresAt: null } }).standing).toBe(EXEMPT);
    });

    it('is still exempt on the hold expiry date itself', () => {
      expect(resolveStanding({ ...overdue, hold: { expiresAt: '2026-04-01' } }).standing).toBe(
        EXEMPT,
      );
    });

    it('returns exactly what no hold would return once the hold has expired', () => {
      const expired = resolveStanding({ ...overdue, hold: { expiresAt: '2026-03-31' } });
      expect(expired).toEqual(resolveStanding({ ...overdue, hold: null }));
      expect(expired.standing).toBe(DELINQUENT);
    });

    it('leaves outstandingMinor identical with and without a hold', () => {
      const withHold = resolveStanding({ ...overdue, hold: { expiresAt: null } });
      const without = resolveStanding({ ...overdue, hold: null });
      expect(withHold.outstandingMinor).toBe(without.outstandingMinor);
    });
  });

  describe('signed corrections move the standing through the same arithmetic', () => {
    // The balance is amountMinor + SUM(adjustments) - SUM(payments); this module
    // never touches a database, so a correction is simply a different balance.
    const amountMinor = 10_000;
    const base = {
      dueDate: '2026-03-10',
      graceDays: 5,
    };
    const today = '2026-04-01';

    it('moves delinquent to good when a discount clears the balance', () => {
      const before = resolveStanding(
        input({ openInvoices: [{ ...base, balanceMinor: amountMinor }], today }),
      );
      expect(before.standing).toBe(DELINQUENT);

      const discountMinor = -10_000; // an invoice_adjustments row
      const after = resolveStanding(
        input({
          openInvoices: [{ ...base, balanceMinor: amountMinor + discountMinor }],
          today,
        }),
      );
      expect(after).toEqual({ standing: GOOD, oldestOverdueDate: null, outstandingMinor: 0 });
    });

    it('moves good back to delinquent when a payment is reversed', () => {
      const paidMinor = 10_000;
      const settled = resolveStanding(
        input({ openInvoices: [{ ...base, balanceMinor: amountMinor - paidMinor }], today }),
      );
      expect(settled.standing).toBe(GOOD);

      const reversalMinor = -10_000; // a payments row with a negative amount
      const reopened = resolveStanding(
        input({
          openInvoices: [{ ...base, balanceMinor: amountMinor - paidMinor - reversalMinor }],
          today,
        }),
      );
      expect(reopened.standing).toBe(DELINQUENT);
      expect(reopened.outstandingMinor).toBe(10_000);
      expect(reopened.oldestOverdueDate).toBe('2026-03-10');
    });
  });

  describe('outstandingMinor', () => {
    it('sums only the invoices with a positive balance', () => {
      const result = resolveStanding(
        input({
          openInvoices: [
            invoice({ dueDate: '2026-03-10', balanceMinor: 7_000 }),
            invoice({ dueDate: '2026-04-10', balanceMinor: 3_000 }),
            invoice({ dueDate: '2026-05-10', balanceMinor: 0 }),
            invoice({ dueDate: '2026-06-10', balanceMinor: -1_000 }),
          ],
          today: '2026-03-01',
        }),
      );
      expect(result.outstandingMinor).toBe(10_000);
      expect(result.standing).toBe(GOOD);
      expect(result.oldestOverdueDate).toBeNull();
    });
  });
});
