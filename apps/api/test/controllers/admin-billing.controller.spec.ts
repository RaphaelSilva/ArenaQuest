import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AdminBillingController } from '@api/controllers/admin-billing.controller';
import { BillingService } from '@api/core/billing/billing-service';
import { FakeBillingRepository } from '../helpers/fake-billing-repository';
import { Entities } from '@arenaquest/shared/types/entities';
import type { ControllerResult } from '@api/core/result';

/**
 * The controller's error surface — one test per branch of the task's table.
 *
 * Node pool, fake repository: nothing here imports `cloudflare:test`, and no
 * provider-specific symbol appears in the controller under test.
 */

const { BillingCycle, ContractTermsSource, AdjustmentKind, PaymentMethod } = Entities.Config;

const ADMIN = 'admin-1';
const STUDENT = 'student-1';

function ok<T>(result: ControllerResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.status} ${result.error}`);
  return result.data;
}

describe('AdminBillingController', () => {
  let repo: FakeBillingRepository;
  let controller: AdminBillingController;

  async function seedPlan() {
    return ok(
      await controller.createPlan(
        {
          name: 'Monthly membership',
          amountMinor: 15000,
          currency: 'BRL',
          cycle: BillingCycle.MONTHLY,
          graceDays: 5,
        },
        ADMIN,
      ),
    );
  }

  async function seedContract(planId: string, userId = STUDENT) {
    return ok(
      await controller.signContract(
        { userId, planId, dueDay: 10, startDate: '2026-01-01' },
        ADMIN,
      ),
    );
  }

  async function seedInvoice() {
    const plan = await seedPlan();
    const contract = await seedContract(plan.id);
    return ok(await controller.issueInvoice({ subscriptionId: contract.id }, ADMIN));
  }

  beforeEach(() => {
    repo = new FakeBillingRepository();
    controller = new AdminBillingController(new BillingService(repo));
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 400 — validation
  // -------------------------------------------------------------------------

  it('400s a plan referencing an unknown currency', async () => {
    const result = await controller.createPlan(
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

  it('400s a malformed body before it reaches the repository', async () => {
    const result = await controller.createPlan({ name: '', amountMinor: 'free' }, ADMIN);
    expect(result).toMatchObject({ ok: false, status: 400, error: 'ValidationError' });
    expect(repo.plans.size).toBe(0);
  });

  it('400s a negotiated contract with no reason', async () => {
    const plan = await seedPlan();
    const result = await controller.signContract(
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

  it('400s a terms change attempted through the lifecycle endpoint', async () => {
    const plan = await seedPlan();
    const contract = await seedContract(plan.id);
    const result = await controller.changeLifecycle(
      contract.id,
      { action: 'pause', graceDays: 30 },
      ADMIN,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(String(result.meta?.message)).toContain('/amend');
  });

  it('400s a lifecycle action that is not pause, resume or cancel', async () => {
    const plan = await seedPlan();
    const contract = await seedContract(plan.id);
    const result = await controller.changeLifecycle(contract.id, { action: 'terminate' }, ADMIN);
    expect(result).toMatchObject({ ok: false, status: 400, error: 'ValidationError' });
  });

  it('400s a void with no reason', async () => {
    const invoice = await seedInvoice();
    const result = await controller.voidInvoice(invoice.id, { reason: '' }, ADMIN);
    expect(result).toMatchObject({ ok: false, status: 400, error: 'ValidationError' });
  });

  // -------------------------------------------------------------------------
  // 404 — unknown plan / subscription / invoice / payment
  // -------------------------------------------------------------------------

  it('404s an unknown plan, subscription, invoice and payment', async () => {
    expect(await controller.updatePlan('nope', { archived: true }, ADMIN)).toMatchObject({
      ok: false,
      status: 404,
      error: 'NotFound',
    });
    expect(
      await controller.signContract(
        { userId: STUDENT, planId: 'nope', dueDay: 10, startDate: '2026-01-01' },
        ADMIN,
      ),
    ).toMatchObject({ ok: false, status: 404 });
    expect(await controller.changeLifecycle('nope', { action: 'pause' }, ADMIN)).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(
      await controller.amendContract(
        'nope',
        { startDate: '2026-07-01', termsNote: 'x' },
        ADMIN,
      ),
    ).toMatchObject({ ok: false, status: 404 });
    expect(await controller.issueInvoice({ subscriptionId: 'nope' }, ADMIN)).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(await controller.voidInvoice('nope', { reason: 'x' }, ADMIN)).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(
      await controller.applyAdjustment(
        'nope',
        { kind: AdjustmentKind.CREDIT, amountMinor: -1, reason: 'x' },
        ADMIN,
      ),
    ).toMatchObject({ ok: false, status: 404 });
    expect(
      await controller.recordPayment('nope', { amountMinor: 1, method: PaymentMethod.CASH }, ADMIN),
    ).toMatchObject({ ok: false, status: 404 });
    expect(await controller.reversePayment('nope', { reason: 'x' }, ADMIN)).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  // -------------------------------------------------------------------------
  // 409 — conflicts
  // -------------------------------------------------------------------------

  it('409s a second active contract for one student', async () => {
    const plan = await seedPlan();
    await seedContract(plan.id);
    const second = await controller.signContract(
      { userId: STUDENT, planId: plan.id, dueDay: 10, startDate: '2026-02-01' },
      ADMIN,
    );
    expect(second).toMatchObject({ ok: false, status: 409, error: 'Conflict' });
  });

  it('409s an amendment of a non-active version', async () => {
    const plan = await seedPlan();
    const contract = await seedContract(plan.id);
    ok(
      await controller.amendContract(
        contract.id,
        { startDate: '2026-07-01', termsNote: 'First.' },
        ADMIN,
      ),
    );
    const again = await controller.amendContract(
      contract.id,
      { startDate: '2026-08-01', termsNote: 'Second.' },
      ADMIN,
    );
    expect(again).toMatchObject({ ok: false, status: 409, error: 'Conflict' });
  });

  it('409s a payment against a void invoice', async () => {
    const invoice = await seedInvoice();
    ok(await controller.voidInvoice(invoice.id, { reason: 'Wrong student.' }, ADMIN));
    const result = await controller.recordPayment(
      invoice.id,
      { amountMinor: 15000, method: PaymentMethod.PIX },
      ADMIN,
    );
    expect(result).toMatchObject({ ok: false, status: 409, error: 'Conflict' });
  });

  it('409s a reversal of an already-reversed payment', async () => {
    const invoice = await seedInvoice();
    const payment = ok(
      await controller.recordPayment(
        invoice.id,
        { amountMinor: 15000, method: PaymentMethod.PIX },
        ADMIN,
      ),
    );
    ok(await controller.reversePayment(payment.id, { reason: 'Bounced.' }, ADMIN));
    const again = await controller.reversePayment(payment.id, { reason: 'Again.' }, ADMIN);
    expect(again).toMatchObject({ ok: false, status: 409, error: 'Conflict' });
  });

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  it('maps the invoice search filters onto the repository filter', async () => {
    const invoice = await seedInvoice();
    const listed = ok(
      await controller.listInvoices({
        userId: STUDENT,
        from: invoice.dueDate,
        to: invoice.dueDate,
      }),
    );
    expect(listed.map((i) => i.id)).toEqual([invoice.id]);

    const outsideWindow = ok(
      await controller.listInvoices({ userId: STUDENT, from: '1999-01-01', to: '1999-12-31' }),
    );
    expect(outsideWindow).toEqual([]);
  });

  it('carries the computed balance on every listed invoice', async () => {
    const invoice = await seedInvoice();
    ok(
      await controller.applyAdjustment(
        invoice.id,
        { kind: AdjustmentKind.DISCOUNT, amountMinor: -5000, reason: 'Goodwill.' },
        ADMIN,
      ),
    );
    const [listed] = ok(await controller.listInvoices({ userId: STUDENT }));
    expect(listed.balanceMinor).toBe(10000);
  });

  it('lists plans and contracts through their filters', async () => {
    const plan = await seedPlan();
    await seedContract(plan.id);

    expect(ok(await controller.listPlans({ archived: false }))).toHaveLength(1);
    expect(ok(await controller.listPlans({ archived: true }))).toHaveLength(0);
    expect(ok(await controller.listSubscriptions({ userId: STUDENT }))).toHaveLength(1);
    expect(ok(await controller.listSubscriptions({ userId: 'someone-else' }))).toHaveLength(0);
  });
});
