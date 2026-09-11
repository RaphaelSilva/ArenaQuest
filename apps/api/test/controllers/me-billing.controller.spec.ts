import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MeBillingController } from '@api/controllers/me-billing.controller';
import { BillingService } from '@api/core/billing/billing-service';
import { AccountingService } from '@api/core/billing/accounting-service';
import { FakeBillingRepository } from '../helpers/fake-billing-repository';
import { Entities } from '@arenaquest/shared/types/entities';
import type { ControllerResult } from '@api/core/result';

/**
 * `GET /v1/me/billing`'s controller.
 *
 * The point of this file is the shape of the interface rather than the
 * arithmetic: the statement itself is Task 04's and is tested there. What is
 * asserted here is that there is no way to ask for somebody else's — the method
 * takes the caller id and nothing else — and that an ordinary member with no
 * contract is answered rather than 404'd.
 */

const { BillingCycle, BillingStanding } = Entities.Config;

const ADMIN = 'admin-1';
const STUDENT = 'student-1';
const OTHER = 'student-2';

function ok<T>(result: ControllerResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.status} ${result.error}`);
  return result.data;
}

describe('MeBillingController', () => {
  let repo: FakeBillingRepository;
  let billing: BillingService;
  let controller: MeBillingController;

  async function seedDebt(userId: string, amountMinor: number, dueDate: string) {
    const plan = ok(
      await billing.createPlan(
        {
          name: `Plan ${userId}`,
          amountMinor,
          currency: 'BRL',
          cycle: BillingCycle.MONTHLY,
          graceDays: 5,
        },
        ADMIN,
      ),
    );
    const contract = ok(
      await billing.signContract(
        { userId, planId: plan.id, dueDay: 10, startDate: '2026-01-01' },
        ADMIN,
      ),
    );
    return ok(
      await billing.issueAdHocInvoice(
        { subscriptionId: contract.id, dueDate, referenceDate: '2026-01-01' },
        ADMIN,
      ),
    );
  }

  beforeEach(() => {
    repo = new FakeBillingRepository();
    billing = new BillingService(repo);
    // Every caller reached here through a verified token, so identity knows them.
    const accounting = new AccountingService(repo, async () => true);
    controller = new MeBillingController(billing, accounting);
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('takes the caller id and nothing else — there is no second parameter', () => {
    // Arity is the contract: a `userId` argument is the bug this endpoint's
    // shape exists to make unwritable.
    expect(controller.getMyStatement.length).toBe(1);
  });

  it("returns the caller's own statement with their standing resolved", async () => {
    await seedDebt(STUDENT, 15000, '2026-01-10');
    await seedDebt(OTHER, 99000, '2026-01-10');

    const statement = ok(await controller.getMyStatement(STUDENT));

    expect(statement.userId).toBe(STUDENT);
    expect(statement.outstandingMinor).toBe(15000);
    expect(statement.invoices).toHaveLength(1);
    expect(statement.invoices.every((invoice) => invoice.userId === STUDENT)).toBe(true);
    expect(statement.contractGroups).toHaveLength(1);
    // The other student's 99000 appears nowhere in it.
    expect(JSON.stringify(statement)).not.toContain(OTHER);
  });

  it('answers a member with no contract with an empty statement, not a 404', async () => {
    const statement = ok(await controller.getMyStatement('brand-new-member'));

    expect(statement).toMatchObject({
      userId: 'brand-new-member',
      standing: BillingStanding.GOOD,
      outstandingMinor: 0,
      contractGroups: [],
      invoices: [],
      studentSince: null,
      currentMembershipSince: null,
    });
    // With no rows to infer from, the statement still states its currency.
    expect(statement.currency.code).toBe('BRL');
  });

  it('reports a hold as `exempt` without leaking the note behind it', async () => {
    await seedDebt(STUDENT, 15000, '2026-01-10');
    ok(
      await billing.setHold(
        STUDENT,
        { reason: 'Family bereavement — do not chase.' },
        ADMIN,
      ),
    );

    const statement = ok(await controller.getMyStatement(STUDENT));

    expect(statement.standing).toBe(BillingStanding.EXEMPT);
    // The student sees the effect of the hold, never the admins' note about
    // them: no reason, no expiry, no `hold` field at all.
    expect(JSON.stringify(statement)).not.toContain('do not chase');
    expect(statement).not.toHaveProperty('hold');
    // And the exemption did not forgive anything.
    expect(statement.outstandingMinor).toBe(15000);
  });

  it('reports the standing the roster reports for the same student', async () => {
    await seedDebt(STUDENT, 15000, '2026-01-10');

    const mine = ok(await controller.getMyStatement(STUDENT));
    const entry = ok(await billing.listStudentRoster({ asOf: mine.asOf }))[0];

    expect(mine.standing).toBe(entry.standing);
    expect(mine.oldestOverdueDate).toBe(entry.oldestOverdueDate);
    expect(mine.outstandingMinor).toBe(entry.outstandingMinor);
  });

  it('surfaces a failed statement unchanged rather than inventing one', async () => {
    const strict = new MeBillingController(
      billing,
      new AccountingService(repo, async () => false),
    );
    expect(await strict.getMyStatement('deleted-account')).toMatchObject({
      ok: false,
      status: 404,
    });
  });
});
