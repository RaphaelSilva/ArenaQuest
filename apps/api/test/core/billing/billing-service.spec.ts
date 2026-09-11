import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BillingService } from '@api/core/billing/billing-service';
import { FakeBillingRepository } from '../../helpers/fake-billing-repository';
import { Entities } from '@arenaquest/shared/types/entities';
import type { ControllerResult } from '@api/core/result';

const { BillingCycle, ContractStatus, ContractTermsSource, InvoiceStatus, AdjustmentKind, PaymentMethod } =
  Entities.Config;

const ADMIN = 'admin-1';
const STUDENT = 'student-1';

/** Narrows an `ok` result, failing the test with its status when it is not. */
function ok<T>(result: ControllerResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.status} ${result.error}`);
  return result.data;
}

describe('BillingService', () => {
  let repo: FakeBillingRepository;
  let service: BillingService;
  let audit: ReturnType<typeof vi.spyOn>;

  /** Every `billing.*` line emitted so far, parsed back from JSON. */
  function events(): Array<Record<string, unknown>> {
    return audit.mock.calls
      .map((call) => JSON.parse(call[0] as string) as Record<string, unknown>)
      .filter((event) => String(event.event).startsWith('billing.'));
  }

  async function seedPlan(overrides: Partial<{ amountMinor: number; graceDays: number }> = {}) {
    return ok(
      await service.createPlan(
        {
          name: 'Monthly membership',
          amountMinor: overrides.amountMinor ?? 15000,
          currency: 'BRL',
          cycle: BillingCycle.MONTHLY,
          graceDays: overrides.graceDays ?? 5,
        },
        ADMIN,
      ),
    );
  }

  async function seedContract(planId: string, userId = STUDENT) {
    return ok(
      await service.signContract(
        {
          userId,
          planId,
          dueDay: 10,
          startDate: '2026-01-01',
          termsSource: ContractTermsSource.STANDARD,
        },
        ADMIN,
      ),
    );
  }

  beforeEach(() => {
    repo = new FakeBillingRepository();
    service = new BillingService(repo);
    audit = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Plans
  // -------------------------------------------------------------------------

  describe('plans', () => {
    it('refuses a currency the schema does not know', async () => {
      const result = await service.createPlan(
        {
          name: 'Bad',
          amountMinor: 100,
          currency: 'XYZ',
          cycle: BillingCycle.MONTHLY,
          graceDays: 0,
        },
        ADMIN,
      );
      expect(result).toMatchObject({ ok: false, status: 400, error: 'ValidationError' });
    });

    it('404s an edit of an unknown plan', async () => {
      const result = await service.updatePlan('nope', { amountMinor: 1 }, ADMIN);
      expect(result).toMatchObject({ ok: false, status: 404, error: 'NotFound' });
    });
  });

  // -------------------------------------------------------------------------
  // Signature — the snapshot rule
  // -------------------------------------------------------------------------

  describe('signContract', () => {
    it("copies the plan's terms onto the contract", async () => {
      const plan = await seedPlan();
      const contract = await seedContract(plan.id);

      expect(contract).toMatchObject({
        amountMinor: 15000,
        currency: 'BRL',
        cycle: BillingCycle.MONTHLY,
        graceDays: 5,
        termsSource: ContractTermsSource.STANDARD,
        signedBy: ADMIN,
        status: ContractStatus.ACTIVE,
      });
      // The first version of a chain is its own group.
      expect(contract.contractGroupId).toBe(contract.id);
      expect(contract.supersedesId).toBeNull();
    });

    it('leaves the contract and its invoices untouched when the plan is later edited', async () => {
      const plan = await seedPlan();
      const contract = await seedContract(plan.id);
      const invoice = ok(
        await service.issueAdHocInvoice(
          { subscriptionId: contract.id, referenceDate: '2026-01-15' },
          ADMIN,
        ),
      );

      ok(await service.updatePlan(plan.id, { amountMinor: 99900, graceDays: 30 }, ADMIN));

      const rereadContract = ok(await service.getSubscription(contract.id));
      const rereadInvoice = ok(await service.getInvoice(invoice.id));

      expect(rereadContract.amountMinor).toBe(15000);
      expect(rereadContract.graceDays).toBe(5);
      expect(rereadInvoice.amountMinor).toBe(15000);
      expect(rereadInvoice.graceDays).toBe(5);
    });

    it('rejects a negotiated contract that carries no reason', async () => {
      const plan = await seedPlan();
      const result = await service.signContract(
        {
          userId: STUDENT,
          planId: plan.id,
          dueDay: 10,
          startDate: '2026-01-01',
          termsSource: ContractTermsSource.NEGOTIATED,
          amountMinor: 9000,
        },
        ADMIN,
      );
      expect(result).toMatchObject({ ok: false, status: 400, error: 'ValidationError' });
    });

    it('stores the negotiated terms, the source and the reason', async () => {
      const plan = await seedPlan();
      const contract = ok(
        await service.signContract(
          {
            userId: STUDENT,
            planId: plan.id,
            dueDay: 5,
            startDate: '2026-01-01',
            termsSource: ContractTermsSource.NEGOTIATED,
            amountMinor: 9000,
            graceDays: 15,
            termsNote: 'Sibling discount agreed with the family.',
          },
          ADMIN,
        ),
      );

      expect(contract.termsSource).toBe(ContractTermsSource.NEGOTIATED);
      expect(contract.amountMinor).toBe(9000);
      expect(contract.graceDays).toBe(15);
      expect(contract.termsNote).toBe('Sibling discount agreed with the family.');
      // Currency is never overridable — re-denominating is a different contract.
      expect(contract.currency).toBe('BRL');
    });

    it('refuses a standard contract that silently overrides the plan', async () => {
      const plan = await seedPlan();
      const result = await service.signContract(
        {
          userId: STUDENT,
          planId: plan.id,
          dueDay: 10,
          startDate: '2026-01-01',
          termsSource: ContractTermsSource.STANDARD,
          amountMinor: 1,
        },
        ADMIN,
      );
      expect(result).toMatchObject({ ok: false, status: 400 });
    });

    it('refuses a second active contract for the same student', async () => {
      const plan = await seedPlan();
      await seedContract(plan.id);
      const second = await service.signContract(
        {
          userId: STUDENT,
          planId: plan.id,
          dueDay: 10,
          startDate: '2026-02-01',
          termsSource: ContractTermsSource.STANDARD,
        },
        ADMIN,
      );
      expect(second).toMatchObject({ ok: false, status: 409, error: 'Conflict' });
    });

    it('404s an unknown plan', async () => {
      const result = await service.signContract(
        {
          userId: STUDENT,
          planId: 'nope',
          dueDay: 10,
          startDate: '2026-01-01',
          termsSource: ContractTermsSource.STANDARD,
        },
        ADMIN,
      );
      expect(result).toMatchObject({ ok: false, status: 404, error: 'NotFound' });
    });
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  describe('changeLifecycle', () => {
    it('pauses, resumes and cancels, and cancelling closes the contract', async () => {
      const plan = await seedPlan();
      const contract = await seedContract(plan.id);

      const paused = ok(await service.changeLifecycle(contract.id, { action: 'pause' }, ADMIN));
      expect(paused.status).toBe(ContractStatus.PAUSED);
      expect(paused.endDate).toBeNull();

      const resumed = ok(await service.changeLifecycle(contract.id, { action: 'resume' }, ADMIN));
      expect(resumed.status).toBe(ContractStatus.ACTIVE);

      const cancelled = ok(
        await service.changeLifecycle(
          contract.id,
          { action: 'cancel', endDate: '2026-06-30' },
          ADMIN,
        ),
      );
      expect(cancelled.status).toBe(ContractStatus.CANCELLED);
      expect(cancelled.endDate).toBe('2026-06-30');
    });

    it('refuses a terms change and points at /amend', async () => {
      const plan = await seedPlan();
      const contract = await seedContract(plan.id);

      const result = await service.changeLifecycle(
        contract.id,
        { action: 'pause', amountMinor: 1 },
        ADMIN,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(String(result.meta?.message)).toContain('/amend');
    });

    it('refuses resuming a contract that was never paused', async () => {
      const plan = await seedPlan();
      const contract = await seedContract(plan.id);
      const result = await service.changeLifecycle(contract.id, { action: 'resume' }, ADMIN);
      expect(result).toMatchObject({ ok: false, status: 409 });
    });

    it('404s an unknown contract', async () => {
      const result = await service.changeLifecycle('nope', { action: 'pause' }, ADMIN);
      expect(result).toMatchObject({ ok: false, status: 404 });
    });
  });

  // -------------------------------------------------------------------------
  // Amendment
  // -------------------------------------------------------------------------

  describe('amendContract', () => {
    it('supersedes the live version and opens a new one in the same group', async () => {
      const plan = await seedPlan();
      const original = await seedContract(plan.id);

      const amended = ok(
        await service.amendContract(
          original.id,
          { startDate: '2026-07-01', termsNote: 'Annual readjustment.', amountMinor: 17000 },
          ADMIN,
        ),
      );

      expect(amended.status).toBe(ContractStatus.ACTIVE);
      expect(amended.supersedesId).toBe(original.id);
      expect(amended.contractGroupId).toBe(original.contractGroupId);
      expect(amended.amountMinor).toBe(17000);

      const closed = ok(await service.getSubscription(original.id));
      expect(closed.status).toBe(ContractStatus.SUPERSEDED);
      expect(closed.endDate).toBe('2026-07-01');
    });

    it('refuses a second amendment of the superseded version with a conflict', async () => {
      const plan = await seedPlan();
      const original = await seedContract(plan.id);
      ok(
        await service.amendContract(
          original.id,
          { startDate: '2026-07-01', termsNote: 'First.' },
          ADMIN,
        ),
      );

      const again = await service.amendContract(
        original.id,
        { startDate: '2026-08-01', termsNote: 'Second.' },
        ADMIN,
      );
      expect(again).toMatchObject({ ok: false, status: 409, error: 'Conflict' });
    });

    it('requires a reason', async () => {
      const plan = await seedPlan();
      const original = await seedContract(plan.id);
      const result = await service.amendContract(
        original.id,
        { startDate: '2026-07-01', termsNote: '   ' },
        ADMIN,
      );
      expect(result).toMatchObject({ ok: false, status: 400 });
    });
  });

  // -------------------------------------------------------------------------
  // Invoices
  // -------------------------------------------------------------------------

  describe('issueAdHocInvoice', () => {
    it("snapshots the contract's terms, not the plan's", async () => {
      const plan = await seedPlan();
      const contract = ok(
        await service.signContract(
          {
            userId: STUDENT,
            planId: plan.id,
            dueDay: 10,
            startDate: '2026-01-01',
            termsSource: ContractTermsSource.NEGOTIATED,
            amountMinor: 9000,
            graceDays: 20,
            termsNote: 'Scholarship.',
          },
          ADMIN,
        ),
      );

      const invoice = ok(
        await service.issueAdHocInvoice(
          { subscriptionId: contract.id, referenceDate: '2026-03-05' },
          ADMIN,
        ),
      );

      expect(invoice.amountMinor).toBe(9000);
      expect(invoice.graceDays).toBe(20);
      expect(invoice.currency).toBe('BRL');
      expect(invoice.periodStart).toBe('2026-03-01');
      expect(invoice.dueDate).toBe('2026-03-10');
    });

    it('issues a zero-amount invoice and settles it on arrival', async () => {
      const plan = await seedPlan({ amountMinor: 0 });
      const contract = await seedContract(plan.id);
      const invoice = ok(
        await service.issueAdHocInvoice(
          { subscriptionId: contract.id, referenceDate: '2026-01-15' },
          ADMIN,
        ),
      );
      expect(invoice.amountMinor).toBe(0);
      expect(invoice.status).toBe(InvoiceStatus.PAID);
    });

    it('refuses a duplicate period rather than surfacing the unique index', async () => {
      const plan = await seedPlan();
      const contract = await seedContract(plan.id);
      ok(
        await service.issueAdHocInvoice(
          { subscriptionId: contract.id, referenceDate: '2026-01-15' },
          ADMIN,
        ),
      );
      const duplicate = await service.issueAdHocInvoice(
        { subscriptionId: contract.id, referenceDate: '2026-01-20' },
        ADMIN,
      );
      expect(duplicate).toMatchObject({ ok: false, status: 409, error: 'Conflict' });
    });

    it('refuses to bill a cancelled contract', async () => {
      const plan = await seedPlan();
      const contract = await seedContract(plan.id);
      ok(await service.changeLifecycle(contract.id, { action: 'cancel' }, ADMIN));
      const result = await service.issueAdHocInvoice(
        { subscriptionId: contract.id, referenceDate: '2026-01-15' },
        ADMIN,
      );
      expect(result).toMatchObject({ ok: false, status: 409 });
    });
  });

  describe('voidInvoice', () => {
    it('requires a reason', async () => {
      const plan = await seedPlan();
      const contract = await seedContract(plan.id);
      const invoice = ok(
        await service.issueAdHocInvoice({ subscriptionId: contract.id }, ADMIN),
      );
      const result = await service.voidInvoice(invoice.id, '  ', ADMIN);
      expect(result).toMatchObject({ ok: false, status: 400, error: 'ValidationError' });
    });

    it('voids with the reason and refuses a second void', async () => {
      const plan = await seedPlan();
      const contract = await seedContract(plan.id);
      const invoice = ok(
        await service.issueAdHocInvoice({ subscriptionId: contract.id }, ADMIN),
      );

      const voided = ok(await service.voidInvoice(invoice.id, 'Issued twice.', ADMIN));
      expect(voided.status).toBe(InvoiceStatus.VOID);
      expect(voided.voidReason).toBe('Issued twice.');

      const again = await service.voidInvoice(invoice.id, 'Again.', ADMIN);
      expect(again).toMatchObject({ ok: false, status: 409 });
    });
  });

  // -------------------------------------------------------------------------
  // Ledger
  // -------------------------------------------------------------------------

  describe('ledger', () => {
    async function openInvoice() {
      const plan = await seedPlan();
      const contract = await seedContract(plan.id);
      return ok(await service.issueAdHocInvoice({ subscriptionId: contract.id }, ADMIN));
    }

    it('appends a negative adjustment and moves the balance', async () => {
      const invoice = await openInvoice();
      ok(
        await service.applyAdjustment(
          invoice.id,
          { kind: AdjustmentKind.DISCOUNT, amountMinor: -5000, reason: 'Holiday discount.' },
          ADMIN,
        ),
      );
      const reread = ok(await service.getInvoice(invoice.id));
      expect(reread.balanceMinor).toBe(10000);
      expect(repo.adjustments).toHaveLength(1);
    });

    it('refuses a zero adjustment and a reasonless one', async () => {
      const invoice = await openInvoice();
      expect(
        await service.applyAdjustment(
          invoice.id,
          { kind: AdjustmentKind.DISCOUNT, amountMinor: 0, reason: 'x' },
          ADMIN,
        ),
      ).toMatchObject({ ok: false, status: 400 });
      expect(
        await service.applyAdjustment(
          invoice.id,
          { kind: AdjustmentKind.DISCOUNT, amountMinor: -1, reason: '' },
          ADMIN,
        ),
      ).toMatchObject({ ok: false, status: 400 });
    });

    it('records a payment, settling the invoice', async () => {
      const invoice = await openInvoice();
      const payment = ok(
        await service.recordPayment(
          invoice.id,
          { amountMinor: 15000, method: PaymentMethod.PIX, paidAt: '2026-01-09' },
          ADMIN,
        ),
      );
      expect(payment.recordedBy).toBe(ADMIN);
      expect(payment.reversesId).toBeNull();

      const reread = ok(await service.getInvoice(invoice.id));
      expect(reread.balanceMinor).toBe(0);
      expect(reread.status).toBe(InvoiceStatus.PAID);
    });

    it('refuses a payment against a voided invoice', async () => {
      const invoice = await openInvoice();
      ok(await service.voidInvoice(invoice.id, 'Wrong student.', ADMIN));

      const result = await service.recordPayment(
        invoice.id,
        { amountMinor: 15000, method: PaymentMethod.CASH },
        ADMIN,
      );
      expect(result).toMatchObject({ ok: false, status: 409, error: 'Conflict' });
    });

    it('refuses a non-positive payment, directing the caller to a reversal', async () => {
      const invoice = await openInvoice();
      const result = await service.recordPayment(
        invoice.id,
        { amountMinor: -1, method: PaymentMethod.CASH },
        ADMIN,
      );
      expect(result).toMatchObject({ ok: false, status: 400 });
    });

    it('reverses by appending a mirror row, leaving the original in place', async () => {
      const invoice = await openInvoice();
      const payment = ok(
        await service.recordPayment(
          invoice.id,
          { amountMinor: 15000, method: PaymentMethod.PIX },
          ADMIN,
        ),
      );

      const reversal = ok(
        await service.reversePayment(payment.id, { reason: 'Cheque bounced.' }, ADMIN),
      );

      expect(reversal.amountMinor).toBe(-15000);
      expect(reversal.reversesId).toBe(payment.id);
      // The original is still there, untouched: two rows, not one edited row.
      expect(repo.payments).toHaveLength(2);
      expect(repo.payments[0]).toMatchObject({ id: payment.id, amountMinor: 15000 });

      const reread = ok(await service.getInvoice(invoice.id));
      expect(reread.balanceMinor).toBe(15000);
      expect(reread.status).toBe(InvoiceStatus.OPEN);
    });

    it('refuses reversing an already-reversed payment, and reversing a reversal', async () => {
      const invoice = await openInvoice();
      const payment = ok(
        await service.recordPayment(
          invoice.id,
          { amountMinor: 15000, method: PaymentMethod.PIX },
          ADMIN,
        ),
      );
      const reversal = ok(await service.reversePayment(payment.id, { reason: 'Bounced.' }, ADMIN));

      expect(await service.reversePayment(payment.id, { reason: 'Again.' }, ADMIN)).toMatchObject({
        ok: false,
        status: 409,
      });
      expect(await service.reversePayment(reversal.id, { reason: 'Nope.' }, ADMIN)).toMatchObject({
        ok: false,
        status: 409,
      });
    });

    it('requires a reason on a reversal and 404s an unknown payment', async () => {
      const invoice = await openInvoice();
      const payment = ok(
        await service.recordPayment(
          invoice.id,
          { amountMinor: 100, method: PaymentMethod.CASH },
          ADMIN,
        ),
      );
      expect(await service.reversePayment(payment.id, { reason: ' ' }, ADMIN)).toMatchObject({
        ok: false,
        status: 400,
      });
      expect(await service.reversePayment('nope', { reason: 'x' }, ADMIN)).toMatchObject({
        ok: false,
        status: 404,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Audit — one structured event per mutation, always carrying the actor
  // -------------------------------------------------------------------------

  describe('audit events', () => {
    it('emits one billing.* event per mutation, each naming the acting admin', async () => {
      const plan = await seedPlan();
      const contract = await seedContract(plan.id);
      ok(await service.updatePlan(plan.id, { amountMinor: 16000 }, ADMIN));
      ok(await service.changeLifecycle(contract.id, { action: 'pause' }, ADMIN));
      ok(await service.changeLifecycle(contract.id, { action: 'resume' }, ADMIN));
      const amended = ok(
        await service.amendContract(
          contract.id,
          { startDate: '2026-07-01', termsNote: 'Readjustment.' },
          ADMIN,
        ),
      );
      const invoice = ok(await service.issueAdHocInvoice({ subscriptionId: amended.id }, ADMIN));
      ok(
        await service.applyAdjustment(
          invoice.id,
          { kind: AdjustmentKind.DISCOUNT, amountMinor: -1000, reason: 'Goodwill.' },
          ADMIN,
        ),
      );
      const payment = ok(
        await service.recordPayment(
          invoice.id,
          { amountMinor: 1000, method: PaymentMethod.CASH },
          ADMIN,
        ),
      );
      ok(await service.reversePayment(payment.id, { reason: 'Miscounted.' }, ADMIN));
      ok(await service.voidInvoice(invoice.id, 'Reissued.', ADMIN));

      const names = events().map((e) => e.event);
      expect(names).toEqual([
        'billing.create_plan',
        'billing.sign_contract',
        'billing.update_plan',
        'billing.change_lifecycle',
        'billing.change_lifecycle',
        'billing.amend_contract',
        'billing.issue_invoice',
        'billing.apply_adjustment',
        'billing.record_payment',
        'billing.reverse_payment',
        'billing.void_invoice',
      ]);

      for (const event of events()) {
        expect(event.actor).toBe(ADMIN);
        expect(typeof event.at).toBe('string');
      }
    });

    it('carries the acting admin for a void, which has no column to hold it', async () => {
      const plan = await seedPlan();
      const contract = await seedContract(plan.id);
      const invoice = ok(await service.issueAdHocInvoice({ subscriptionId: contract.id }, ADMIN));
      ok(await service.voidInvoice(invoice.id, 'Duplicate.', 'admin-who-voided'));

      const voidEvent = events().find((e) => e.event === 'billing.void_invoice');
      expect(voidEvent).toMatchObject({
        actor: 'admin-who-voided',
        invoiceId: invoice.id,
        reason: 'Duplicate.',
      });
      // The schema has `voided_at` and `void_reason` and no `voided_by`: the
      // event is the only record of who did it.
      expect(repo.invoices.get(invoice.id)).not.toHaveProperty('voidedBy');
    });

    it('emits no event when a mutation is refused', async () => {
      const plan = await seedPlan();
      await service.signContract(
        {
          userId: STUDENT,
          planId: plan.id,
          dueDay: 10,
          startDate: '2026-01-01',
          termsSource: ContractTermsSource.NEGOTIATED,
        },
        ADMIN,
      );
      expect(events().map((e) => e.event)).toEqual(['billing.create_plan']);
    });
  });
});
