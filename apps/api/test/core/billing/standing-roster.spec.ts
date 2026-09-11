import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BillingService } from '@api/core/billing/billing-service';
import { AccountingService } from '@api/core/billing/accounting-service';
import { FakeBillingRepository } from '../../helpers/fake-billing-repository';
import { Entities } from '@arenaquest/shared/types/entities';
import type { ControllerResult } from '@api/core/result';

/**
 * The roster, standing and holds — the rules, at the cheapest layer that can
 * state them (node pool, fake repository, no `cloudflare:test`).
 *
 * Four of these tests exist to protect a property rather than a feature:
 *
 * - **Standing is resolved, never stored.** No test here reads a standing
 *   column, because there is none; every assertion drives standing by moving
 *   `asOf` or a ledger row.
 * - **The roster costs a fixed number of queries.** The query-count test fails
 *   the moment someone calls `getStanding` in a loop.
 * - **A hold suppresses an alert, never a total.** The aging and movement
 *   reports are compared byte for byte across setting one.
 * - **An expired hold stops biting with nothing having run.** Two reads of the
 *   same unchanged rows, a day apart, give two different standings.
 */

const { BillingCycle, BillingStanding, ContractStatus, ContractTermsSource, PaymentMethod } =
  Entities.Config;

const ADMIN = 'admin-1';

function ok<T>(result: ControllerResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.status} ${result.error}`);
  return result.data;
}

describe('BillingService — standing, the roster and holds', () => {
  let repo: FakeBillingRepository;
  let service: BillingService;
  let accounting: AccountingService;
  let audit: ReturnType<typeof vi.spyOn>;

  function events(): Array<Record<string, unknown>> {
    return audit.mock.calls
      .map((call) => JSON.parse(call[0] as string) as Record<string, unknown>)
      .filter((event) => String(event.event).startsWith('billing.'));
  }

  /**
   * One student with one contract and one invoice falling due on `dueDate`.
   * Everything standing depends on is an argument, so a test states the
   * situation it is about and nothing else.
   */
  async function seedStudent(
    userId: string,
    options: {
      dueDate: string;
      amountMinor?: number;
      graceDays?: number;
      startDate?: string;
      negotiated?: boolean;
    },
  ) {
    const amountMinor = options.amountMinor ?? 15000;
    const graceDays = options.graceDays ?? 5;
    const startDate = options.startDate ?? '2026-01-01';

    const plan = ok(
      await service.createPlan(
        {
          name: `Plan for ${userId}`,
          amountMinor,
          currency: 'BRL',
          cycle: BillingCycle.MONTHLY,
          graceDays,
        },
        ADMIN,
      ),
    );

    const contract = ok(
      await service.signContract(
        {
          userId,
          planId: plan.id,
          dueDay: 10,
          startDate,
          termsSource: options.negotiated
            ? ContractTermsSource.NEGOTIATED
            : ContractTermsSource.STANDARD,
          ...(options.negotiated
            ? { amountMinor: amountMinor - 5000, termsNote: 'Scholarship agreed.' }
            : {}),
        },
        ADMIN,
      ),
    );

    const invoice = ok(
      await service.issueAdHocInvoice(
        { subscriptionId: contract.id, dueDate: options.dueDate, referenceDate: startDate },
        ADMIN,
      ),
    );

    return { plan, contract, invoice };
  }

  beforeEach(() => {
    repo = new FakeBillingRepository();
    service = new BillingService(repo);
    accounting = new AccountingService(repo, async () => true);
    audit = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // The roster
  // -------------------------------------------------------------------------

  describe('the roster', () => {
    it('resolves each standing from the invoices and the day, with nothing stored', async () => {
      // Grace is five days, so 2026-02-25 is still inside it on 2026-03-01 and
      // 2026-01-10 is long past it.
      await seedStudent('future', { dueDate: '2026-04-10' });
      await seedStudent('within-grace', { dueDate: '2026-02-25' });
      await seedStudent('past-grace', { dueDate: '2026-01-10' });

      const roster = ok(await service.listStudentRoster({ asOf: '2026-03-01' }));
      const by = new Map(roster.map((entry) => [entry.userId, entry]));

      expect(roster).toHaveLength(3);
      expect(by.get('future')).toMatchObject({
        standing: BillingStanding.GOOD,
        oldestOverdueDate: null,
        outstandingMinor: 15000,
      });
      expect(by.get('within-grace')).toMatchObject({
        standing: BillingStanding.DUE,
        oldestOverdueDate: '2026-02-25',
      });
      expect(by.get('past-grace')).toMatchObject({
        standing: BillingStanding.DELINQUENT,
        oldestOverdueDate: '2026-01-10',
      });

      // The same rows, read a day earlier, answer differently — which is only
      // possible because nothing was written down.
      const earlier = ok(await service.listStudentRoster({ asOf: '2026-02-24' }));
      expect(earlier.find((entry) => entry.userId === 'within-grace')!.standing).toBe(
        BillingStanding.GOOD,
      );
    });

    it('agrees with the statement on what the student owes', async () => {
      await seedStudent('debtor', { dueDate: '2026-01-10', amountMinor: 22000 });

      const entry = ok(await service.listStudentRoster({ asOf: '2026-03-01' }))[0];
      const statement = ok(await accounting.getStudentStatement('debtor'));

      expect(entry.outstandingMinor).toBe(statement.outstandingMinor);
      expect(entry.oldestOverdueDate).toBe('2026-01-10');
    });

    it('derives the next due date from the cycle and flags negotiated terms', async () => {
      await seedStudent('standard', { dueDate: '2026-01-10' });
      await seedStudent('negotiated', { dueDate: '2026-01-10', negotiated: true });

      const before = new Map(
        ok(await service.listStudentRoster({ asOf: '2026-03-01' })).map((e) => [e.userId, e]),
      );
      // The 10th of March has not passed on the 1st, so it is the next one.
      expect(before.get('standard')).toMatchObject({
        nextDueDate: '2026-03-10',
        negotiatedTerms: false,
      });
      expect(before.get('negotiated')!.negotiatedTerms).toBe(true);

      // Past it, the series steps to the following period.
      const after = ok(await service.listStudentRoster({ asOf: '2026-03-15' }));
      expect(after.find((e) => e.userId === 'standard')!.nextDueDate).toBe('2026-04-10');
    });

    it('stops offering a next due date once the contract is not active', async () => {
      const { contract } = await seedStudent('cancelled', { dueDate: '2026-01-10' });
      ok(await service.changeLifecycle(contract.id, { action: 'cancel' }, ADMIN));

      const entry = ok(await service.listStudentRoster({ asOf: '2026-03-01' }))[0];
      // Still on the roster — a cancelled contract does not cancel the debt —
      // but with no date, because nothing will be invoiced.
      expect(entry).toMatchObject({
        contractStatus: ContractStatus.CANCELLED,
        nextDueDate: null,
        outstandingMinor: 15000,
      });
    });

    it('filters by standing, and `exempt` is the held filter', async () => {
      await seedStudent('late-a', { dueDate: '2026-01-10' });
      await seedStudent('late-b', { dueDate: '2026-01-11' });
      await seedStudent('paid-up', { dueDate: '2026-06-10' });

      ok(await service.setHold('late-b', { reason: 'Injured; agreed to pause.' }, ADMIN));

      const delinquent = ok(
        await service.listStudentRoster({
          asOf: '2026-03-01',
          standing: BillingStanding.DELINQUENT,
        }),
      );
      expect(delinquent.map((entry) => entry.userId)).toEqual(['late-a']);

      const held = ok(
        await service.listStudentRoster({ asOf: '2026-03-01', standing: BillingStanding.EXEMPT }),
      );
      expect(held.map((entry) => entry.userId)).toEqual(['late-b']);
      expect(held[0].hold).toMatchObject({ reason: 'Injured; agreed to pause.', setBy: ADMIN });
    });

    it('leaves a student with no contract off the roster entirely', async () => {
      await seedStudent('member', { dueDate: '2026-01-10' });
      const roster = ok(await service.listStudentRoster({ asOf: '2026-03-01' }));
      expect(roster.map((entry) => entry.userId)).toEqual(['member']);
    });

    it('ignores a voided invoice', async () => {
      const { invoice } = await seedStudent('voided', { dueDate: '2026-01-10' });
      ok(await service.voidInvoice(invoice.id, 'Issued to the wrong student.', ADMIN));

      expect(ok(await service.listStudentRoster({ asOf: '2026-03-01' }))[0]).toMatchObject({
        standing: BillingStanding.GOOD,
        outstandingMinor: 0,
      });
    });

    it('orders by what is owed, largest first, and breaks ties by id', async () => {
      await seedStudent('small', { dueDate: '2026-01-10', amountMinor: 1000 });
      await seedStudent('large', { dueDate: '2026-01-10', amountMinor: 90000 });
      await seedStudent('medium', { dueDate: '2026-01-10', amountMinor: 5000 });

      expect(
        ok(await service.listStudentRoster({ asOf: '2026-03-01' })).map((e) => e.userId),
      ).toEqual(['large', 'medium', 'small']);
    });
  });

  // -------------------------------------------------------------------------
  // The query budget — the N+1 guard
  // -------------------------------------------------------------------------

  describe('the roster query budget', () => {
    /**
     * Counts what the roster actually asks the repository for.
     *
     * The three aggregate readers must each be called **once**, and the two
     * per-student readers must not be called at all: `getStanding` in a loop
     * would light up `listOpenInvoices`/`getHold` and is the regression this
     * test exists to fail on.
     */
    function countReads() {
      return {
        listSubscriptions: vi.spyOn(repo, 'listSubscriptions'),
        listInvoices: vi.spyOn(repo, 'listInvoices'),
        listHolds: vi.spyOn(repo, 'listHolds'),
        listOpenInvoices: vi.spyOn(repo, 'listOpenInvoices'),
        getHold: vi.spyOn(repo, 'getHold'),
      };
    }

    it('costs the same number of queries for fifty students as for one', async () => {
      await seedStudent('only-student', { dueDate: '2026-01-10' });

      let spies = countReads();
      ok(await service.listStudentRoster({ asOf: '2026-03-01' }));

      expect(spies.listSubscriptions).toHaveBeenCalledTimes(1);
      expect(spies.listInvoices).toHaveBeenCalledTimes(1);
      expect(spies.listHolds).toHaveBeenCalledTimes(1);
      expect(spies.listOpenInvoices).not.toHaveBeenCalled();
      expect(spies.getHold).not.toHaveBeenCalled();

      vi.restoreAllMocks();
      audit = vi.spyOn(console, 'info').mockImplementation(() => {});

      for (let index = 0; index < 50; index += 1) {
        await seedStudent(`student-${index}`, { dueDate: '2026-01-10' });
      }

      spies = countReads();
      const roster = ok(await service.listStudentRoster({ asOf: '2026-03-01' }));

      expect(roster).toHaveLength(51);
      expect(spies.listSubscriptions).toHaveBeenCalledTimes(1);
      expect(spies.listInvoices).toHaveBeenCalledTimes(1);
      expect(spies.listHolds).toHaveBeenCalledTimes(1);
      expect(spies.listOpenInvoices).not.toHaveBeenCalled();
      expect(spies.getHold).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Holds
  // -------------------------------------------------------------------------

  describe('holds', () => {
    it('refuses a hold with no reason, and one made of whitespace', async () => {
      expect(await service.setHold('someone', { reason: '' }, ADMIN)).toMatchObject({
        ok: false,
        status: 400,
      });
      expect(await service.setHold('someone', { reason: '   ' }, ADMIN)).toMatchObject({
        ok: false,
        status: 400,
      });
      expect(repo.holds.size).toBe(0);
    });

    it('records the reason, the expiry and the admin who set it, and audits both ends', async () => {
      await seedStudent('held', { dueDate: '2026-01-10' });

      const hold = ok(
        await service.setHold(
          'held',
          { reason: 'Injured until March.', expiresAt: '2026-03-31' },
          ADMIN,
        ),
      );
      expect(hold).toMatchObject({
        userId: 'held',
        reason: 'Injured until March.',
        expiresAt: '2026-03-31',
        setBy: ADMIN,
      });

      ok(await service.clearHold('held', ADMIN));

      expect(events()).toEqual([
        expect.objectContaining({ event: 'billing.create_plan' }),
        expect.objectContaining({ event: 'billing.sign_contract' }),
        expect.objectContaining({ event: 'billing.issue_invoice' }),
        expect.objectContaining({
          event: 'billing.set_hold',
          actor: ADMIN,
          userId: 'held',
          reason: 'Injured until March.',
          expiresAt: '2026-03-31',
        }),
        expect.objectContaining({ event: 'billing.clear_hold', actor: ADMIN, userId: 'held' }),
      ]);
    });

    it('refuses to clear a hold that is not set, and audits nothing for it', async () => {
      expect(await service.clearHold('nobody', ADMIN)).toMatchObject({ ok: false, status: 404 });
      expect(events().some((event) => event.event === 'billing.clear_hold')).toBe(false);
    });

    it('refuses a hold on a student identity does not know', async () => {
      const guarded = new BillingService(repo, async (userId) => userId !== 'ghost');
      expect(await guarded.setHold('ghost', { reason: 'Whoever this is.' }, ADMIN)).toMatchObject({
        ok: false,
        status: 404,
      });
    });

    it('suppresses the label and nothing else — not the balance, not a total', async () => {
      await seedStudent('held', { dueDate: '2026-01-10', amountMinor: 42000 });

      const agingBefore = ok(await accounting.getReceivablesAging('2026-03-01'));
      const movementBefore = ok(await accounting.getMonthlyMovement('2026-01'));
      const statementBefore = ok(await accounting.getStudentStatement('held'));

      ok(await service.setHold('held', { reason: 'Stop chasing this one.' }, ADMIN));

      const entry = ok(await service.listStudentRoster({ asOf: '2026-03-01' }))[0];
      expect(entry.standing).toBe(BillingStanding.EXEMPT);
      // The debt is reported in full beside the exemption, and the overdue date
      // is still stated — the hold says "do not chase", not "does not owe".
      expect(entry.outstandingMinor).toBe(42000);
      expect(entry.oldestOverdueDate).toBe('2026-01-10');

      // Byte-identical: a hold that moved a total would be a hold that lost money.
      expect(ok(await accounting.getReceivablesAging('2026-03-01'))).toEqual(agingBefore);
      expect(ok(await accounting.getMonthlyMovement('2026-01'))).toEqual(movementBefore);
      expect(ok(await accounting.getStudentStatement('held'))).toEqual(statementBefore);
      expect(agingBefore.totalMinor).toBe(42000);
    });

    it('drops out of the delinquency listing while held, and returns to it when cleared', async () => {
      await seedStudent('held', { dueDate: '2026-01-10' });

      const delinquentIds = async () =>
        ok(
          await service.listStudentRoster({
            asOf: '2026-03-01',
            standing: BillingStanding.DELINQUENT,
          }),
        ).map((entry) => entry.userId);

      expect(await delinquentIds()).toEqual(['held']);
      ok(await service.setHold('held', { reason: 'Agreed to wait.' }, ADMIN));
      expect(await delinquentIds()).toEqual([]);
      ok(await service.clearHold('held', ADMIN));
      expect(await delinquentIds()).toEqual(['held']);
    });

    it('stops taking effect the day after it expires, with nothing having run', async () => {
      await seedStudent('temporary', { dueDate: '2026-01-10' });
      ok(
        await service.setHold(
          'temporary',
          { reason: 'Paused for February.', expiresAt: '2026-03-01' },
          ADMIN,
        ),
      );

      // No write of any kind happens between the two reads below.
      const setHold = vi.spyOn(repo, 'setHold');
      const clearHold = vi.spyOn(repo, 'clearHold');

      const lastDay = ok(await service.listStudentRoster({ asOf: '2026-03-01' }))[0];
      const dayAfter = ok(await service.listStudentRoster({ asOf: '2026-03-02' }))[0];

      expect(lastDay.standing).toBe(BillingStanding.EXEMPT);
      expect(dayAfter.standing).toBe(BillingStanding.DELINQUENT);

      expect(setHold).not.toHaveBeenCalled();
      expect(clearHold).not.toHaveBeenCalled();
      // The row is still there, untouched: expiry is a comparison, not a job.
      expect(repo.holds.get('temporary')).toMatchObject({ expiresAt: '2026-03-01' });
    });
  });

  // -------------------------------------------------------------------------
  // One student's standing
  // -------------------------------------------------------------------------

  describe('getStanding', () => {
    it('reports `good` with no contract and no invoice at all', async () => {
      const standing = ok(await service.getStanding('stranger', '2026-03-01'));
      expect(standing).toEqual({
        userId: 'stranger',
        asOf: '2026-03-01',
        standing: BillingStanding.GOOD,
        oldestOverdueDate: null,
        outstandingMinor: 0,
      });
    });

    it('follows the money: a payment moves the standing with no other input', async () => {
      const { invoice } = await seedStudent('payer', { dueDate: '2026-01-10' });

      expect(ok(await service.getStanding('payer', '2026-03-01')).standing).toBe(
        BillingStanding.DELINQUENT,
      );

      ok(
        await service.recordPayment(
          invoice.id,
          { amountMinor: 15000, method: PaymentMethod.PIX, paidAt: '2026-03-01' },
          ADMIN,
        ),
      );

      expect(ok(await service.getStanding('payer', '2026-03-01'))).toMatchObject({
        standing: BillingStanding.GOOD,
        outstandingMinor: 0,
      });
    });
  });
});
