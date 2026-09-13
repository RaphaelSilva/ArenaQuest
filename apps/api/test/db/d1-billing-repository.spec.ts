import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { D1BillingRepository } from '@api/adapters/db/d1-billing-repository';
import { Entities } from '@arenaquest/shared/types/entities';
import { applyMigrations } from '../helpers/apply-migrations';

const { BillingCycle, ContractStatus, ContractTermsSource, InvoiceStatus, PaymentMethod, AdjustmentKind } =
  Entities.Config;

describe('D1BillingRepository', () => {
  let repo: D1BillingRepository;
  let studentId: string;
  let adminId: string;
  let planId: string;

  async function rawRow(table: string, id: string): Promise<Record<string, unknown> | null> {
    return env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
  }

  function createContract(overrides: Partial<{ amountMinor: number; userId: string }> = {}) {
    return repo.createSubscription({
      userId: overrides.userId ?? studentId,
      planId,
      amountMinor: overrides.amountMinor ?? 15000,
      currency: 'BRL',
      cycle: BillingCycle.MONTHLY,
      graceDays: 5,
      dueDay: 10,
      termsSource: ContractTermsSource.STANDARD,
      startDate: '2026-01-01',
      signedBy: adminId,
    });
  }

  beforeAll(async () => {
    await applyMigrations(env.DB);
    repo = new D1BillingRepository(env.DB);
  });

  beforeEach(async () => {
    studentId = crypto.randomUUID();
    adminId = crypto.randomUUID();

    await env.DB.batch([
      env.DB
        .prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
        .bind(studentId, 'Student', `s-${studentId}@example.com`, 'hash'),
      env.DB
        .prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
        .bind(adminId, 'Admin', `a-${adminId}@example.com`, 'hash'),
    ]);

    const plan = await repo.createPlan({
      name: 'Monthly membership',
      description: 'Standard',
      amountMinor: 15000,
      currency: 'BRL',
      cycle: BillingCycle.MONTHLY,
      graceDays: 5,
    });
    planId = plan.id;
  });

  // -------------------------------------------------------------------------
  // Plans
  // -------------------------------------------------------------------------

  describe('currencies', () => {
    it("reads migration 0026's seed rows with their own exponents", async () => {
      expect(await repo.getCurrency('BRL')).toEqual({
        code: 'BRL',
        exponent: 2,
        symbol: 'R$',
        name: 'Brazilian real',
        active: true,
      });
      // The non-decimal codes exist precisely so this path is exercised.
      expect((await repo.getCurrency('JPY'))?.exponent).toBe(0);
      expect((await repo.getCurrency('BTC'))?.exponent).toBe(8);
    });

    it('returns null for a code with no row', async () => {
      expect(await repo.getCurrency('XYZ')).toBeNull();
    });

    it('lists the active currency first, and sees one inserted at runtime', async () => {
      await env.DB
        .prepare('INSERT INTO currencies (code, exponent, symbol, name, active) VALUES (?, ?, ?, ?, 0)')
        .bind('GBP', 2, '\u00a3', 'Pound sterling')
        .run();

      const currencies = await repo.listCurrencies();

      expect(currencies[0]).toMatchObject({ code: 'BRL', active: true });
      expect(currencies.map((c) => c.code)).toContain('GBP');
      expect(currencies.filter((c) => c.active)).toHaveLength(1);
    });
  });

  describe('plans', () => {
    it('round trips a plan and defaults its optional columns', async () => {
      const plan = await repo.getPlan(planId);
      expect(plan).not.toBeNull();
      expect(plan!.amountMinor).toBe(15000);
      expect(plan!.currency).toBe('BRL');
      expect(plan!.cycle).toBe(BillingCycle.MONTHLY);
      expect(plan!.graceDays).toBe(5);
      expect(plan!.scopeTopicId).toBeNull();
      expect(plan!.archived).toBe(false);
    });

    it('creates a free plan, because zero is a first-class amount', async () => {
      const free = await repo.createPlan({
        name: 'Scholarship',
        amountMinor: 0,
        currency: 'BRL',
        cycle: BillingCycle.MONTHLY,
        graceDays: 0,
      });
      expect(free.amountMinor).toBe(0);
      expect(free.description).toBe('');
    });

    it('filters by archived and by cycle', async () => {
      const yearly = await repo.createPlan({
        name: 'Yearly',
        amountMinor: 150000,
        currency: 'BRL',
        cycle: BillingCycle.YEARLY,
        graceDays: 10,
      });
      await repo.updatePlan(yearly.id, { archived: true });

      const live = await repo.listPlans({ archived: false });
      expect(live.map((p) => p.id)).toContain(planId);
      expect(live.map((p) => p.id)).not.toContain(yearly.id);

      const archived = await repo.listPlans({ archived: true });
      expect(archived.map((p) => p.id)).toEqual([yearly.id]);

      const monthly = await repo.listPlans({ cycle: BillingCycle.MONTHLY });
      expect(monthly.every((p) => p.cycle === BillingCycle.MONTHLY)).toBe(true);
    });

    it('returns null when updating an unknown plan', async () => {
      expect(await repo.updatePlan(crypto.randomUUID(), { name: 'Nope' })).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  describe('subscriptions', () => {
    it('creates a contract that is its own group and is immediately active', async () => {
      const contract = await createContract();
      expect(contract.status).toBe(ContractStatus.ACTIVE);
      expect(contract.contractGroupId).toBe(contract.id);
      expect(contract.supersedesId).toBeNull();
      expect(contract.endDate).toBeNull();
      expect(contract.termsNote).toBe('');

      expect((await repo.getActiveSubscription(studentId))!.id).toBe(contract.id);
    });

    it('cancels a contract with an end date', async () => {
      const contract = await createContract();
      const cancelled = await repo.updateSubscriptionStatus(
        contract.id,
        ContractStatus.CANCELLED,
        '2026-06-01',
      );
      expect(cancelled!.status).toBe(ContractStatus.CANCELLED);
      expect(cancelled!.endDate).toBe('2026-06-01');
      expect(await repo.getActiveSubscription(studentId)).toBeNull();
    });

    it('leaves two amendments as a chain of three versions with exactly one active', async () => {
      const first = await createContract();

      const second = await repo.amendSubscription({
        subscriptionId: first.id,
        amountMinor: 18000,
        startDate: '2026-04-01',
        termsNote: 'Annual price review',
        signedBy: adminId,
      });
      const third = await repo.amendSubscription({
        subscriptionId: second.id,
        amountMinor: 12000,
        termsSource: ContractTermsSource.NEGOTIATED,
        startDate: '2026-07-01',
        termsNote: 'Sibling discount negotiated',
        signedBy: adminId,
      });

      const chain = await repo.listContractGroup(first.contractGroupId);
      expect(chain).toHaveLength(3);
      expect(chain.map((s) => s.id)).toEqual([first.id, second.id, third.id]);
      expect(new Set(chain.map((s) => s.contractGroupId))).toEqual(
        new Set([first.contractGroupId]),
      );
      expect(chain.filter((s) => s.status === ContractStatus.ACTIVE).map((s) => s.id)).toEqual([
        third.id,
      ]);

      // The superseded versions close on the successor's start date.
      expect(chain[0].endDate).toBe('2026-04-01');
      expect(chain[1].endDate).toBe('2026-07-01');
      expect(chain[2].endDate).toBeNull();

      expect(chain[1].supersedesId).toBe(first.id);
      expect(chain[2].supersedesId).toBe(second.id);

      // Unamended terms carry forward; currency is never re-denominated.
      expect(third.amountMinor).toBe(12000);
      expect(third.graceDays).toBe(first.graceDays);
      expect(third.dueDay).toBe(first.dueDay);
      expect(third.currency).toBe('BRL');
      expect(third.termsSource).toBe(ContractTermsSource.NEGOTIATED);
      expect(third.termsNote).toBe('Sibling discount negotiated');
    });

    it('refuses to amend an unknown contract', async () => {
      await expect(
        repo.amendSubscription({
          subscriptionId: crypto.randomUUID(),
          startDate: '2026-04-01',
          termsNote: 'nope',
          signedBy: adminId,
        }),
      ).rejects.toThrow();
    });

    it('filters subscriptions by user, plan, status and contract group', async () => {
      const contract = await createContract();
      expect((await repo.listSubscriptions({ userId: studentId })).map((s) => s.id)).toEqual([
        contract.id,
      ]);
      expect((await repo.listSubscriptions({ planId })).map((s) => s.id)).toEqual([contract.id]);
      expect(
        (await repo.listSubscriptions({ status: ContractStatus.ACTIVE, userId: studentId })).map(
          (s) => s.id,
        ),
      ).toEqual([contract.id]);
      expect(
        (await repo.listSubscriptions({ contractGroupId: contract.contractGroupId })).map(
          (s) => s.id,
        ),
      ).toEqual([contract.id]);
    });
  });

  // -------------------------------------------------------------------------
  // The snapshot rule
  // -------------------------------------------------------------------------

  it('leaves every contract and invoice row byte-identical when the plan is re-priced', async () => {
    const contract = await createContract();
    const invoice = await repo.createInvoice({
      subscriptionId: contract.id,
      userId: studentId,
      periodStart: '2026-01-01',
      periodEnd: '2026-02-01',
      dueDate: '2026-01-10',
      amountMinor: 15000,
      currency: 'BRL',
      graceDays: 5,
    });

    const before = {
      subscription: await rawRow('subscriptions', contract.id),
      invoice: await rawRow('invoices', invoice.id),
    };

    const repriced = await repo.updatePlan(planId, { amountMinor: 99000, graceDays: 30 });
    expect(repriced!.amountMinor).toBe(99000);
    expect(repriced!.graceDays).toBe(30);

    expect({
      subscription: await rawRow('subscriptions', contract.id),
      invoice: await rawRow('invoices', invoice.id),
    }).toEqual(before);
  });

  // -------------------------------------------------------------------------
  // Invoices and balance arithmetic
  // -------------------------------------------------------------------------

  describe('invoices', () => {
    let contractId: string;
    let invoiceId: string;

    beforeEach(async () => {
      const contract = await createContract();
      contractId = contract.id;
      const invoice = await repo.createInvoice({
        subscriptionId: contractId,
        userId: studentId,
        periodStart: '2026-01-01',
        periodEnd: '2026-02-01',
        dueDate: '2026-01-10',
        amountMinor: 15000,
        currency: 'BRL',
        graceDays: 5,
      });
      invoiceId = invoice.id;
    });

    it('opens at the full charge', async () => {
      const invoice = await repo.getInvoice(invoiceId);
      expect(invoice!.status).toBe(InvoiceStatus.OPEN);
      expect(invoice!.balanceMinor).toBe(15000);
    });

    it('settles a zero-amount invoice at issue, with no payment row', async () => {
      const freeStudent = crypto.randomUUID();
      await env.DB
        .prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
        .bind(freeStudent, 'Free', `f-${freeStudent}@example.com`, 'hash')
        .run();
      const freeContract = await createContract({ amountMinor: 0, userId: freeStudent });

      const free = await repo.createInvoice({
        subscriptionId: freeContract.id,
        userId: freeStudent,
        periodStart: '2026-01-01',
        periodEnd: '2026-02-01',
        dueDate: '2026-01-10',
        amountMinor: 0,
        currency: 'BRL',
        graceDays: 0,
      });

      expect(free.status).toBe(InvoiceStatus.PAID);
      expect((await repo.getInvoice(free.id))!.balanceMinor).toBe(0);
      expect(await repo.listLedger({ invoiceId: free.id })).toEqual([]);
    });

    it('computes the balance as charge plus signed adjustments minus payments', async () => {
      await repo.applyAdjustment({
        invoiceId,
        kind: AdjustmentKind.DISCOUNT,
        amountMinor: -5000,
        reason: 'Sibling discount',
        appliedBy: adminId,
      });

      let invoice = await repo.getInvoice(invoiceId);
      expect(invoice!.balanceMinor).toBe(10000);
      expect(invoice!.status).toBe(InvoiceStatus.OPEN);

      const payment = await repo.recordPayment({
        invoiceId,
        amountMinor: 10000,
        currency: 'BRL',
        method: PaymentMethod.PIX,
        paidAt: '2026-01-08',
        externalReference: 'E1234',
        note: 'Paid at the front desk',
        recordedBy: adminId,
      });

      invoice = await repo.getInvoice(invoiceId);
      expect(invoice!.balanceMinor).toBe(0);
      expect(invoice!.status).toBe(InvoiceStatus.PAID);

      // A reversal is a new negative row, never an edit of the original.
      await repo.recordPayment({
        invoiceId,
        amountMinor: -10000,
        currency: 'BRL',
        method: PaymentMethod.PIX,
        paidAt: '2026-01-20',
        note: 'Bounced',
        reversesId: payment.id,
        recordedBy: adminId,
      });

      invoice = await repo.getInvoice(invoiceId);
      expect(invoice!.balanceMinor).toBe(10000);
      expect(invoice!.status).toBe(InvoiceStatus.OPEN);

      // The original payment row is untouched by its own reversal.
      expect(await repo.getPayment(payment.id)).toEqual(payment);
    });

    it('never flips a voided invoice back out of void', async () => {
      const voided = await repo.voidInvoice(invoiceId, 'Issued in error', adminId);
      expect(voided!.status).toBe(InvoiceStatus.VOID);
      expect(voided!.voidReason).toBe('Issued in error');
      expect(voided!.voidedAt).not.toBeNull();

      await repo.recordPayment({
        invoiceId,
        amountMinor: 15000,
        currency: 'BRL',
        method: PaymentMethod.CASH,
        paidAt: '2026-01-09',
        recordedBy: adminId,
      });

      expect((await repo.getInvoice(invoiceId))!.status).toBe(InvoiceStatus.VOID);
    });

    it('returns open invoices with the balance resolveStanding consumes', async () => {
      await repo.applyAdjustment({
        invoiceId,
        kind: AdjustmentKind.WAIVER,
        amountMinor: -3000,
        reason: 'Goodwill',
        appliedBy: adminId,
      });

      const open = await repo.listOpenInvoices(studentId);
      expect(open).toHaveLength(1);
      expect(open[0].id).toBe(invoiceId);
      expect(open[0].balanceMinor).toBe(12000);
      expect(open[0].graceDays).toBe(5);
      expect(open[0].dueDate).toBe('2026-01-10');
      expect(open[0].currency).toBe('BRL');
    });

    it('filters invoices by status and due-date window', async () => {
      expect(
        (await repo.listInvoices({ userId: studentId, status: InvoiceStatus.OPEN })).map(
          (i) => i.id,
        ),
      ).toEqual([invoiceId]);
      expect(
        (await repo.listInvoices({ dueFrom: '2026-01-01', dueTo: '2026-01-31' })).map((i) => i.id),
      ).toEqual([invoiceId]);
      expect(await repo.listInvoices({ dueFrom: '2026-02-01' })).toEqual([]);
      expect(await repo.listInvoices({ subscriptionId: crypto.randomUUID() })).toEqual([]);
    });

    it('orders the ledger by when each entry occurred', async () => {
      await repo.recordPayment({
        invoiceId,
        amountMinor: 5000,
        currency: 'BRL',
        method: PaymentMethod.CASH,
        paidAt: '2026-01-15',
        recordedBy: adminId,
      });
      await repo.recordPayment({
        invoiceId,
        amountMinor: 2000,
        currency: 'BRL',
        method: PaymentMethod.BANK_TRANSFER,
        paidAt: '2026-01-05',
        recordedBy: adminId,
      });
      await repo.applyAdjustment({
        invoiceId,
        kind: AdjustmentKind.CREDIT,
        amountMinor: -1000,
        reason: 'Credit carried over',
        appliedBy: adminId,
      });

      const ledger = await repo.listLedger({ invoiceId });
      expect(ledger).toHaveLength(3);

      // Ordered by when the money moved, not by when it was typed in: the
      // second payment was recorded last and still sorts first.
      const occurred = ledger.map((e) => e.occurredAt);
      expect([...occurred].sort()).toEqual(occurred);
      expect(
        ledger.filter((e) => e.entry === 'payment').map((e) => e.occurredAt),
      ).toEqual(['2026-01-05', '2026-01-15']);
      expect(ledger.filter((e) => e.entry === 'adjustment')).toHaveLength(1);

      // The same rows are reachable by student, which is how a statement reads.
      expect(await repo.listLedger({ userId: studentId })).toHaveLength(3);
      expect(await repo.listLedger({ userId: crypto.randomUUID() })).toEqual([]);

      // Both bounds are inclusive and both are applied.
      const window = await repo.listLedger({ invoiceId, from: '2026-01-10', to: '2026-01-20' });
      expect(
        window.filter((e) => e.entry === 'payment').map((e) => e.occurredAt),
      ).toEqual(['2026-01-15']);
    });
  });

  // -------------------------------------------------------------------------
  // The invoice run
  // -------------------------------------------------------------------------

  describe('issueInvoices', () => {
    it('issues one invoice per active contract and is idempotent for a period', async () => {
      const contract = await createContract();

      const first = await repo.issueInvoices({ referenceDate: '2026-03-15' });
      const mine = first.filter((i) => i.subscriptionId === contract.id);
      expect(mine).toHaveLength(1);
      expect(mine[0].periodStart).toBe('2026-03-01');
      expect(mine[0].periodEnd).toBe('2026-04-01');
      expect(mine[0].dueDate).toBe('2026-03-10');
      expect(mine[0].amountMinor).toBe(15000);
      expect(mine[0].graceDays).toBe(5);

      const second = await repo.issueInvoices({ referenceDate: '2026-03-15' });
      expect(second.filter((i) => i.subscriptionId === contract.id)).toEqual([]);

      expect(await repo.listInvoices({ subscriptionId: contract.id })).toHaveLength(1);
    });

    it('skips a paused contract and issues nothing before its start date', async () => {
      const contract = await createContract();
      await repo.updateSubscriptionStatus(contract.id, ContractStatus.PAUSED);

      const issued = await repo.issueInvoices({ referenceDate: '2026-03-15' });
      expect(issued.filter((i) => i.subscriptionId === contract.id)).toEqual([]);

      await repo.updateSubscriptionStatus(contract.id, ContractStatus.ACTIVE);
      const early = await repo.issueInvoices({ referenceDate: '2025-12-01' });
      expect(early.filter((i) => i.subscriptionId === contract.id)).toEqual([]);
    });

    it('issues a free contract paid, with no payment row', async () => {
      const contract = await createContract({ amountMinor: 0 });

      const issued = await repo.issueInvoices({ referenceDate: '2026-03-15' });
      const mine = issued.filter((i) => i.subscriptionId === contract.id);
      expect(mine).toHaveLength(1);
      expect(mine[0].amountMinor).toBe(0);
      expect(mine[0].status).toBe(InvoiceStatus.PAID);
      expect(await repo.listLedger({ invoiceId: mine[0].id })).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Holds
  // -------------------------------------------------------------------------

  describe('holds', () => {
    it('round trips a hold and overwrites it on a second set', async () => {
      const hold = await repo.setHold({
        userId: studentId,
        reason: 'Payment under verification',
        expiresAt: '2026-02-01',
        setBy: adminId,
      });
      expect(hold.userId).toBe(studentId);
      expect(hold.expiresAt).toBe('2026-02-01');
      expect(hold.setBy).toBe(adminId);

      const updated = await repo.setHold({
        userId: studentId,
        reason: 'Dispute opened',
        setBy: adminId,
      });
      expect(updated.reason).toBe('Dispute opened');
      expect(updated.expiresAt).toBeNull();

      expect(await repo.listHolds()).toHaveLength(1);
    });

    it('returns an expired hold as stored, because expiry belongs to resolveStanding', async () => {
      await repo.setHold({
        userId: studentId,
        reason: 'Arrangement made in person',
        expiresAt: '2020-01-01',
        setBy: adminId,
      });

      const hold = await repo.getHold(studentId);
      expect(hold).not.toBeNull();
      expect(hold!.expiresAt).toBe('2020-01-01');
      expect(await repo.listHolds()).toHaveLength(1);
    });

    it('clears a hold and reads back null', async () => {
      await repo.setHold({ userId: studentId, reason: 'Temporary', setBy: adminId });
      await repo.clearHold(studentId);
      expect(await repo.getHold(studentId)).toBeNull();
      expect(await repo.listHolds()).toEqual([]);
    });
  });
});
