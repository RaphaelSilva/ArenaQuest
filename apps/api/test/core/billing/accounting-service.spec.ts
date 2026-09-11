import { describe, it, expect, beforeEach } from 'vitest';
import { AccountingService } from '@api/core/billing/accounting-service';
import { FakeBillingRepository } from '../../helpers/fake-billing-repository';
import { Entities } from '@arenaquest/shared/types/entities';
import type {
  InvoiceAdjustmentRecord,
  InvoiceRecord,
  PaymentRecord,
  SubscriptionRecord,
} from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';

const {
  BillingCycle,
  ContractStatus,
  ContractTermsSource,
  InvoiceStatus,
  AdjustmentKind,
  PaymentMethod,
} = Entities.Config;

/**
 * The arithmetic of the three reports, against an in-memory repository.
 *
 * Every fixture here is written **directly** into the fake rather than through
 * `BillingService`, because that is the only way to control the three dates the
 * reports key off — `issued_at`, `applied_at` and `paid_at` — independently,
 * and to produce the one state the lifecycle can never produce on purpose: an
 * `invoices.status` cache that disagrees with the rows.
 */

const ADMIN = 'admin-1';
const STUDENT = 'student-1';

function ok<T>(result: ControllerResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.status} ${result.error}`);
  return result.data;
}

/** `asOf` minus `days`, so a boundary fixture states its intent in days. */
function daysBefore(asOf: string, days: number): string {
  return new Date(Date.parse(`${asOf}T00:00:00.000Z`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

describe('AccountingService', () => {
  let repo: FakeBillingRepository;
  let service: AccountingService;
  let users: Set<string>;
  let sequence = 0;

  beforeEach(() => {
    repo = new FakeBillingRepository();
    users = new Set([ADMIN, STUDENT]);
    service = new AccountingService(repo, async (userId) => users.has(userId));
    sequence = 0;
  });

  function addContract(over: Partial<SubscriptionRecord> & { id: string }): SubscriptionRecord {
    const contract: SubscriptionRecord = {
      userId: STUDENT,
      planId: 'plan-1',
      contractGroupId: over.contractGroupId ?? over.id,
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
      ...over,
    };
    repo.subscriptions.set(contract.id, contract);
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
      // The cache, written as given: several tests below rely on setting it to
      // a value the rows do not support.
      status: InvoiceStatus.OPEN,
      issuedAt: '2026-08-01 09:00:00',
      voidedAt: null,
      voidReason: null,
      ...over,
    };
    repo.invoices.set(invoice.id, invoice);
    return invoice;
  }

  function addAdjustment(
    invoiceId: string,
    amountMinor: number,
    appliedAt: string,
    kind: Entities.Config.AdjustmentKind = AdjustmentKind.DISCOUNT,
  ): InvoiceAdjustmentRecord {
    const adjustment: InvoiceAdjustmentRecord = {
      id: `adj-${++sequence}`,
      invoiceId,
      kind,
      amountMinor,
      reason: 'fixture',
      appliedBy: ADMIN,
      appliedAt,
    };
    repo.adjustments.push(adjustment);
    return adjustment;
  }

  function addPayment(invoiceId: string, amountMinor: number, paidAt: string, currency = 'BRL') {
    const payment: PaymentRecord = {
      id: `pay-${++sequence}`,
      invoiceId,
      amountMinor,
      currency,
      method: PaymentMethod.PIX,
      paidAt,
      externalReference: null,
      note: 'fixture',
      reversesId: null,
      recordedBy: ADMIN,
      recordedAt: `${paidAt} 12:00:00`,
    };
    repo.payments.push(payment);
    return payment;
  }

  // -------------------------------------------------------------------------
  // Monthly movement
  // -------------------------------------------------------------------------

  describe('getMonthlyMovement', () => {
    it('reconciles to the sum of the month ledger rows, discount and reversal included', async () => {
      addContract({ id: 'sub-1' });
      const a = addInvoice({ amountMinor: 15000, issuedAt: '2026-08-01 09:00:00' });
      addInvoice({ amountMinor: 10000, issuedAt: '2026-08-05 09:00:00', dueDate: '2026-08-15' });

      addAdjustment(a.id, -5000, '2026-08-07 10:00:00');
      addPayment(a.id, 10000, '2026-08-09');
      // The reversal lands in the same month and subtracts from received.
      addPayment(a.id, -10000, '2026-08-20');

      const report = ok(await service.getMonthlyMovement('2026-08'));

      expect(report).toMatchObject({
        month: '2026-08',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        invoicedMinor: 25000,
        adjustmentsMinor: -5000,
        billedMinor: 20000,
        receivedMinor: 0,
        outstandingMinor: 20000,
        invoicesIssued: 2,
      });
      // What was billed and never received is what is still outstanding.
      expect(report.billedMinor - report.receivedMinor).toBe(report.outstandingMinor);
      expect(report.currency).toEqual({ code: 'BRL', exponent: 2, symbol: 'R$' });
    });

    it("puts a September payment of an August invoice in September's received and August's billed", async () => {
      addContract({ id: 'sub-1' });
      const invoice = addInvoice({ amountMinor: 20000, issuedAt: '2026-08-01 09:00:00' });
      addPayment(invoice.id, 20000, '2026-09-03');

      const august = ok(await service.getMonthlyMovement('2026-08'));
      const september = ok(await service.getMonthlyMovement('2026-09'));

      expect(august).toMatchObject({
        invoicedMinor: 20000,
        billedMinor: 20000,
        receivedMinor: 0,
        outstandingMinor: 20000,
      });
      expect(september).toMatchObject({
        invoicedMinor: 0,
        billedMinor: 0,
        receivedMinor: 20000,
        outstandingMinor: 0,
      });
    });

    it('leaves a voided invoice out of every total, with its ledger rows', async () => {
      addContract({ id: 'sub-1' });
      const voided = addInvoice({
        amountMinor: 30000,
        status: InvoiceStatus.VOID,
        voidedAt: '2026-08-20 09:00:00',
        voidReason: 'Issued to the wrong student.',
      });
      addAdjustment(voided.id, -1000, '2026-08-21 09:00:00');
      addPayment(voided.id, 5000, '2026-08-22');

      const report = ok(await service.getMonthlyMovement('2026-08'));

      expect(report).toMatchObject({
        invoicedMinor: 0,
        adjustmentsMinor: 0,
        billedMinor: 0,
        receivedMinor: 0,
        outstandingMinor: 0,
        invoicesIssued: 0,
      });
    });

    it('ignores a drifted invoices.status cache and reports the rows', async () => {
      addContract({ id: 'sub-1' });
      // Cached as settled, but no payment ever landed.
      addInvoice({ id: 'inv-drift', amountMinor: 12000, status: InvoiceStatus.PAID });
      // Cached as open, but paid in full.
      const settled = addInvoice({ id: 'inv-settled', amountMinor: 8000, status: InvoiceStatus.OPEN });
      addPayment(settled.id, 8000, '2026-08-12');

      const report = ok(await service.getMonthlyMovement('2026-08'));

      expect(report.billedMinor).toBe(20000);
      expect(report.receivedMinor).toBe(8000);
      // 12000 from the row cached "paid"; nothing from the row cached "open".
      expect(report.outstandingMinor).toBe(12000);
    });

    it('counts an amended student once, grouping on contractGroupId', async () => {
      // One chain, three versions — one student.
      addContract({
        id: 'sub-v1',
        contractGroupId: 'group-a',
        status: ContractStatus.SUPERSEDED,
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      });
      addContract({
        id: 'sub-v2',
        contractGroupId: 'group-a',
        supersedesId: 'sub-v1',
        status: ContractStatus.SUPERSEDED,
        startDate: '2026-06-01',
        endDate: '2026-08-15',
      });
      addContract({
        id: 'sub-v3',
        contractGroupId: 'group-a',
        supersedesId: 'sub-v2',
        status: ContractStatus.ACTIVE,
        startDate: '2026-08-15',
      });
      // A second student, one contract.
      addContract({ id: 'sub-b', userId: 'student-2', startDate: '2026-02-01' });

      const report = ok(await service.getMonthlyMovement('2026-08'));

      expect(report.activeStudents).toBe(2);
      expect(repo.subscriptions.size).toBe(4);
    });

    it('400s a malformed month rather than returning an empty report', async () => {
      for (const month of ['2026-13', '2026-8', 'August', '']) {
        expect(await service.getMonthlyMovement(month)).toMatchObject({
          ok: false,
          status: 400,
          error: 'ValidationError',
        });
      }
    });

    it('states the tenant currency when the month holds no rows at all', async () => {
      const report = ok(await service.getMonthlyMovement('2026-08'));
      expect(report.currency.code).toBe('BRL');
      expect(report.billedMinor).toBe(0);
    });

    it('refuses to total across two currencies rather than converting', async () => {
      addContract({ id: 'sub-1' });
      addInvoice({ amountMinor: 15000, currency: 'BRL' });
      addInvoice({ amountMinor: 4000, currency: 'JPY' });

      const result = await service.getMonthlyMovement('2026-08');

      expect(result).toMatchObject({ ok: false, status: 409, error: 'Conflict' });
      if (!result.ok) {
        expect(String(result.meta?.message)).toContain('BRL');
        expect(String(result.meta?.message)).toContain('JPY');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Receivables aging
  // -------------------------------------------------------------------------

  describe('getReceivablesAging', () => {
    const AS_OF = '2026-09-30';

    it('places 30, 31, 60, 61, 90 and 91 days past due in the intended buckets', async () => {
      addContract({ id: 'sub-1' });
      const expected: Array<[number, string]> = [
        [30, '0-30'],
        [31, '31-60'],
        [60, '31-60'],
        [61, '61-90'],
        [90, '61-90'],
        [91, '90+'],
      ];
      for (const [days] of expected) {
        addInvoice({
          id: `inv-${days}`,
          amountMinor: 1000,
          dueDate: daysBefore(AS_OF, days),
          issuedAt: `${daysBefore(AS_OF, days + 10)} 09:00:00`,
        });
      }

      const report = ok(await service.getReceivablesAging(AS_OF));
      const totals = Object.fromEntries(report.buckets.map((b) => [b.bucket, b.totalMinor]));

      // Each boundary pair straddles a bucket edge: 30 vs 31, 60 vs 61, 90 vs 91.
      expect(totals).toEqual({ '0-30': 1000, '31-60': 2000, '61-90': 2000, '90+': 1000 });
      expect(report.totalMinor).toBe(6000);
      expect(report.invoiceCount).toBe(6);
      expect(report.studentCount).toBe(1);
      expect(report.asOf).toBe(AS_OF);
    });

    it('measures each invoice from its own due date, not from a shared one', async () => {
      addContract({ id: 'sub-1' });
      addInvoice({ id: 'inv-early', amountMinor: 1000, dueDate: daysBefore(AS_OF, 91) });
      addInvoice({ id: 'inv-late', amountMinor: 3000, dueDate: daysBefore(AS_OF, 1) });

      const report = ok(await service.getReceivablesAging(AS_OF));
      const bucket = (key: string) => report.buckets.find((b) => b.bucket === key)!;

      expect(bucket('90+').totalMinor).toBe(1000);
      expect(bucket('0-30').totalMinor).toBe(3000);
    });

    it('buckets an invoice that is not yet due with the freshest receivables', async () => {
      addContract({ id: 'sub-1' });
      addInvoice({ amountMinor: 2500, dueDate: '2026-10-15', issuedAt: '2026-09-20 09:00:00' });

      const report = ok(await service.getReceivablesAging(AS_OF));

      expect(report.buckets.find((b) => b.bucket === '0-30')!.totalMinor).toBe(2500);
      expect(report.totalMinor).toBe(2500);
    });

    it('excludes a voided invoice and one whose balance the rows have settled', async () => {
      addContract({ id: 'sub-1' });
      addInvoice({
        id: 'inv-void',
        amountMinor: 9000,
        dueDate: daysBefore(AS_OF, 45),
        status: InvoiceStatus.VOID,
        voidedAt: '2026-09-01 09:00:00',
        voidReason: 'Duplicated.',
      });
      // Cached as open; the rows say it is settled, and the rows win.
      const settled = addInvoice({
        id: 'inv-settled',
        amountMinor: 9000,
        dueDate: daysBefore(AS_OF, 45),
        status: InvoiceStatus.OPEN,
      });
      addAdjustment(settled.id, -4000, '2026-09-02 09:00:00', AdjustmentKind.WAIVER);
      addPayment(settled.id, 5000, '2026-09-03');
      // Cached as paid; the rows say 2000 is still owed, and the rows win.
      const drifted = addInvoice({
        id: 'inv-drift',
        amountMinor: 2000,
        dueDate: daysBefore(AS_OF, 45),
        status: InvoiceStatus.PAID,
      });

      const report = ok(await service.getReceivablesAging(AS_OF));

      expect(report.totalMinor).toBe(2000);
      expect(report.invoiceCount).toBe(1);
      expect(report.buckets.find((b) => b.bucket === '31-60')!.totalMinor).toBe(2000);
      expect(drifted.status).toBe(InvoiceStatus.PAID);
    });

    it('counts only the ledger rows that had landed by asOf', async () => {
      addContract({ id: 'sub-1' });
      const invoice = addInvoice({ amountMinor: 5000, dueDate: daysBefore(AS_OF, 40) });
      // Paid the day after the report's cut-off.
      addPayment(invoice.id, 5000, '2026-10-01');

      expect(ok(await service.getReceivablesAging(AS_OF)).totalMinor).toBe(5000);
      expect(ok(await service.getReceivablesAging('2026-10-02')).totalMinor).toBe(0);
    });

    it('400s a malformed asOf', async () => {
      expect(await service.getReceivablesAging('30-09-2026')).toMatchObject({
        ok: false,
        status: 400,
      });
    });

    it('refuses an aging that would span two currencies', async () => {
      addContract({ id: 'sub-1' });
      addInvoice({ amountMinor: 1000, currency: 'BRL', dueDate: daysBefore(AS_OF, 5) });
      addInvoice({ amountMinor: 1000, currency: 'USD', dueDate: daysBefore(AS_OF, 5) });

      expect(await service.getReceivablesAging(AS_OF)).toMatchObject({ ok: false, status: 409 });
    });
  });

  // -------------------------------------------------------------------------
  // Per-student statement
  // -------------------------------------------------------------------------

  describe('getStudentStatement', () => {
    it('404s an unknown student', async () => {
      expect(await service.getStudentStatement('ghost')).toMatchObject({
        ok: false,
        status: 404,
        error: 'NotFound',
      });
    });

    it('totals outstanding as the sum of the listed invoice balances', async () => {
      addContract({ id: 'sub-1' });
      const a = addInvoice({ id: 'inv-a', amountMinor: 15000 });
      addAdjustment(a.id, -5000, '2026-08-07 10:00:00');
      addPayment(a.id, 4000, '2026-08-09');
      const b = addInvoice({ id: 'inv-b', amountMinor: 8000, dueDate: '2026-09-10' });
      addPayment(b.id, 8000, '2026-09-09');
      // Void: listed for the history, summed into nothing.
      addInvoice({
        id: 'inv-void',
        amountMinor: 99000,
        status: InvoiceStatus.VOID,
        voidedAt: '2026-08-30 09:00:00',
        voidReason: 'Wrong student.',
      });

      const statement = ok(await service.getStudentStatement(STUDENT));
      const balances = Object.fromEntries(
        statement.invoices.map((invoice) => [invoice.id, invoice.balanceMinor]),
      );

      expect(balances).toEqual({ 'inv-a': 6000, 'inv-b': 0, 'inv-void': 0 });
      expect(statement.outstandingMinor).toBe(6000);
      expect(statement.outstandingMinor).toBe(
        statement.invoices.reduce((sum, i) => sum + Math.max(i.balanceMinor, 0), 0),
      );
      expect(statement.invoices.find((i) => i.id === 'inv-a')!.adjustments).toHaveLength(1);
      expect(statement.invoices.find((i) => i.id === 'inv-a')!.payments).toHaveLength(1);
      expect(statement.currency).toEqual({ code: 'BRL', exponent: 2, symbol: 'R$' });
    });

    it('reads both membership dates for a student who left and came back', async () => {
      // The first membership, cancelled.
      addContract({
        id: 'old-v1',
        contractGroupId: 'group-old',
        status: ContractStatus.CANCELLED,
        startDate: '2016-03-01',
        endDate: '2018-06-30',
      });
      // The second, a NEW group — a re-enrolment never supersedes (RFC 0013 #10).
      addContract({
        id: 'new-v1',
        contractGroupId: 'group-new',
        status: ContractStatus.SUPERSEDED,
        startDate: '2024-01-15',
        endDate: '2025-06-01',
      });
      addContract({
        id: 'new-v2',
        contractGroupId: 'group-new',
        supersedesId: 'new-v1',
        status: ContractStatus.ACTIVE,
        startDate: '2025-06-01',
      });

      const statement = ok(await service.getStudentStatement(STUDENT));

      // A student of ten years who took a break is still a student of ten years.
      expect(statement.studentSince).toBe('2016-03-01');
      // …but the current membership started when they came back, not when the
      // active *version* of its chain did.
      expect(statement.currentMembershipSince).toBe('2024-01-15');

      expect(statement.contractGroups.map((g) => g.contractGroupId)).toEqual([
        'group-old',
        'group-new',
      ]);
      const current = statement.contractGroups.find((g) => g.contractGroupId === 'group-new')!;
      expect(current.versions.map((v) => v.id)).toEqual(['new-v1', 'new-v2']);
      expect(current.status).toBe(ContractStatus.ACTIVE);
      expect(current.endDate).toBeNull();
    });

    it('reports no membership dates for a student who never signed', async () => {
      const statement = ok(await service.getStudentStatement(STUDENT));
      expect(statement.studentSince).toBeNull();
      expect(statement.currentMembershipSince).toBeNull();
      expect(statement.contractGroups).toEqual([]);
    });

    it('leaves currentMembershipSince null when no contract is active', async () => {
      addContract({
        id: 'sub-1',
        status: ContractStatus.CANCELLED,
        startDate: '2020-01-01',
        endDate: '2021-01-01',
      });

      const statement = ok(await service.getStudentStatement(STUDENT));
      expect(statement.studentSince).toBe('2020-01-01');
      expect(statement.currentMembershipSince).toBeNull();
    });

    it('refuses a statement whose invoices span two currencies', async () => {
      addContract({ id: 'sub-1' });
      addInvoice({ amountMinor: 15000, currency: 'BRL' });
      addInvoice({ amountMinor: 15000, currency: 'EUR' });

      expect(await service.getStudentStatement(STUDENT)).toMatchObject({ ok: false, status: 409 });
    });
  });

  // -------------------------------------------------------------------------
  // The read-only guarantee
  // -------------------------------------------------------------------------

  it('writes nothing: a full report sweep leaves every billing collection identical', async () => {
    addContract({ id: 'sub-1' });
    const invoice = addInvoice({ amountMinor: 15000 });
    addAdjustment(invoice.id, -2500, '2026-08-07 10:00:00');
    addPayment(invoice.id, 5000, '2026-08-09');
    // Deliberately drifted: a report that "repaired" the cache would show here.
    addInvoice({ id: 'inv-drift', amountMinor: 4000, status: InvoiceStatus.PAID });

    const snapshot = () =>
      JSON.stringify({
        currencies: [...repo.currencies.entries()],
        plans: [...repo.plans.entries()],
        subscriptions: [...repo.subscriptions.entries()],
        invoices: [...repo.invoices.entries()],
        adjustments: repo.adjustments,
        payments: repo.payments,
        holds: [...repo.holds.entries()],
      });

    const before = snapshot();

    ok(await service.getMonthlyMovement('2026-08'));
    ok(await service.getReceivablesAging('2026-09-30'));
    ok(await service.getStudentStatement(STUDENT));

    expect(snapshot()).toBe(before);
  });

  // -------------------------------------------------------------------------
  // Currencies come from the table
  // -------------------------------------------------------------------------

  it('resolves the exponent and symbol of a non-decimal currency from the table', async () => {
    addContract({ id: 'sub-1', currency: 'JPY' });
    addInvoice({ amountMinor: 12000, currency: 'JPY' });

    const report = ok(await service.getMonthlyMovement('2026-08'));

    // Minor units end to end: 12000 yen is 12000, not 120.00.
    expect(report.currency).toEqual({ code: 'JPY', exponent: 0, symbol: '¥' });
    expect(report.invoicedMinor).toBe(12000);
  });

  it('states a report in a currency added to the table after deploy', async () => {
    repo.currencies.set('GBP', {
      code: 'GBP',
      exponent: 2,
      symbol: '£',
      name: 'Pound sterling',
      active: false,
    });
    addContract({ id: 'sub-1', currency: 'GBP' });
    addInvoice({ amountMinor: 4200, currency: 'GBP' });

    const report = ok(await service.getMonthlyMovement('2026-08'));
    expect(report.currency).toEqual({ code: 'GBP', exponent: 2, symbol: '£' });
  });
});
