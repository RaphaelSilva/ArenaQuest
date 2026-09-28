import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BillingService, type ChargeReader } from '@api/core/billing/billing-service';
import { EventChargeService } from '@api/core/billing/event-charge-service';
import type { EventChargeFilter, EventChargeWithBalanceRecord, IEventChargeRepository } from '@arenaquest/shared/ports';
import { resolveStanding } from '@arenaquest/shared/domain/billing/standing-resolver';
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

const {
  BillingCycle,
  BillingStanding,
  ChargeStatus,
  ContractStatus,
  ContractTermsSource,
  InvoiceStatus,
  PaymentMethod,
} = Entities.Config;

const ADMIN = 'admin-1';

/**
 * The extras ledger as the roster sees it: one read, filtered in memory. Each
 * charge is written with its balance already computed — the adapter's job,
 * and not what these tests are about.
 */
class FakeChargeReader implements ChargeReader {
  readonly charges: EventChargeWithBalanceRecord[] = [];

  async listCharges(filter: EventChargeFilter): Promise<EventChargeWithBalanceRecord[]> {
    return this.charges.filter(
      (charge) =>
        (filter.userId === undefined || charge.userId === filter.userId) &&
        (filter.eventId === undefined || charge.eventId === filter.eventId) &&
        (filter.status === undefined || charge.status === filter.status),
    );
  }

  add(
    userId: string,
    options: {
      dueDate: string;
      balanceMinor?: number;
      amountMinor?: number;
      graceDays?: number;
      status?: Entities.Config.ChargeStatus;
      currency?: string;
      issuedAt?: string;
    },
  ): EventChargeWithBalanceRecord {
    const amountMinor = options.amountMinor ?? 8000;
    const balanceMinor = options.balanceMinor ?? amountMinor;
    const charge: EventChargeWithBalanceRecord = {
      id: `charge-${this.charges.length + 1}`,
      eventId: `event-${this.charges.length + 1}`,
      userId,
      description: 'Seminar',
      amountMinor,
      currency: options.currency ?? 'BRL',
      termsSource: ContractTermsSource.STANDARD,
      termsNote: '',
      dueDate: options.dueDate,
      graceDays: options.graceDays ?? 5,
      status: options.status ?? (balanceMinor > 0 ? ChargeStatus.OPEN : ChargeStatus.PAID),
      issuedBy: ADMIN,
      issuedAt: options.issuedAt ?? '2026-01-01T00:00:00.000Z',
      voidedAt: null,
      voidReason: null,
      balanceMinor,
    };
    this.charges.push(charge);
    return charge;
  }
}

function ok<T>(result: ControllerResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.status} ${result.error}`);
  return result.data;
}

describe('BillingService — standing, the roster and holds', () => {
  let repo: FakeBillingRepository;
  let charges: FakeChargeReader;
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
    charges = new FakeChargeReader();
    service = new BillingService(repo, async () => true, charges);
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
      expect(by.get('future')!.contract).toMatchObject({
        standing: BillingStanding.GOOD,
        oldestOverdueDate: null,
        outstandingMinor: 15000,
      });
      expect(by.get('within-grace')!.contract).toMatchObject({
        standing: BillingStanding.DUE,
        oldestOverdueDate: '2026-02-25',
      });
      expect(by.get('past-grace')!.contract).toMatchObject({
        standing: BillingStanding.DELINQUENT,
        oldestOverdueDate: '2026-01-10',
      });
      // Never charged for an extra: no extras rail at all.
      expect(by.get('future')!.extras).toBeNull();

      // The same rows, read a day earlier, answer differently — which is only
      // possible because nothing was written down.
      const earlier = ok(await service.listStudentRoster({ asOf: '2026-02-24' }));
      expect(earlier.find((entry) => entry.userId === 'within-grace')!.contract!.standing).toBe(
        BillingStanding.GOOD,
      );
    });

    it('agrees with the statement on what the student owes', async () => {
      await seedStudent('debtor', { dueDate: '2026-01-10', amountMinor: 22000 });

      const entry = ok(await service.listStudentRoster({ asOf: '2026-03-01' }))[0];
      const statement = ok(await accounting.getStudentStatement('debtor'));

      expect(entry.contract!.outstandingMinor).toBe(statement.outstandingMinor);
      expect(entry.contract!.oldestOverdueDate).toBe('2026-01-10');
    });

    it('derives the next due date from the cycle and flags negotiated terms', async () => {
      await seedStudent('standard', { dueDate: '2026-01-10' });
      await seedStudent('negotiated', { dueDate: '2026-01-10', negotiated: true });

      const before = new Map(
        ok(await service.listStudentRoster({ asOf: '2026-03-01' })).map((e) => [e.userId, e]),
      );
      // The 10th of March has not passed on the 1st, so it is the next one.
      expect(before.get('standard')!.contract).toMatchObject({
        nextDueDate: '2026-03-10',
        negotiatedTerms: false,
      });
      expect(before.get('negotiated')!.contract!.negotiatedTerms).toBe(true);

      // Past it, the series steps to the following period.
      const after = ok(await service.listStudentRoster({ asOf: '2026-03-15' }));
      expect(after.find((e) => e.userId === 'standard')!.contract!.nextDueDate).toBe('2026-04-10');
    });

    it('stops offering a next due date once the contract is not active', async () => {
      const { contract } = await seedStudent('cancelled', { dueDate: '2026-01-10' });
      ok(await service.changeLifecycle(contract.id, { action: 'cancel' }, ADMIN));

      const entry = ok(await service.listStudentRoster({ asOf: '2026-03-01' }))[0];
      // Still on the roster — a cancelled contract does not cancel the debt —
      // but with no date, because nothing will be invoiced.
      expect(entry.contract).toMatchObject({
        status: ContractStatus.CANCELLED,
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

    it('leaves a user with no contract and no charge off the roster entirely', async () => {
      await seedStudent('member', { dueDate: '2026-01-10' });
      const roster = ok(await service.listStudentRoster({ asOf: '2026-03-01' }));
      expect(roster.map((entry) => entry.userId)).toEqual(['member']);
    });

    it('ignores a voided invoice', async () => {
      const { invoice } = await seedStudent('voided', { dueDate: '2026-01-10' });
      ok(await service.voidInvoice(invoice.id, 'Issued to the wrong student.', ADMIN));

      expect(ok(await service.listStudentRoster({ asOf: '2026-03-01' }))[0].contract).toMatchObject({
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
     * Counts what the roster actually asks for.
     *
     * The four aggregate readers — contracts, invoices, charges, holds — must
     * each be called **once**, and the per-student readers must not be called
     * at all: `getStanding` in a loop would light up `listOpenInvoices` /
     * `getHold` and is the regression this test exists to fail on.
     */
    function countReads() {
      return {
        aggregate: [
          vi.spyOn(repo, 'listSubscriptions'),
          vi.spyOn(repo, 'listInvoices'),
          vi.spyOn(charges, 'listCharges'),
          vi.spyOn(repo, 'listHolds'),
        ],
        perStudent: [vi.spyOn(repo, 'listOpenInvoices'), vi.spyOn(repo, 'getHold')],
      };
    }

    function expectFourQueries(spies: ReturnType<typeof countReads>) {
      for (const spy of spies.aggregate) expect(spy).toHaveBeenCalledTimes(1);
      const total = spies.aggregate.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
      expect(total).toBe(4);
      for (const spy of spies.perStudent) expect(spy).not.toHaveBeenCalled();
    }

    it('costs exactly four queries for one student and for a hundred', async () => {
      await seedStudent('only-student', { dueDate: '2026-01-10' });
      charges.add('only-student', { dueDate: '2026-01-20' });

      let spies = countReads();
      ok(await service.listStudentRoster({ asOf: '2026-03-01' }));
      expectFourQueries(spies);

      vi.restoreAllMocks();
      audit = vi.spyOn(console, 'info').mockImplementation(() => {});

      // Fifty with a contract (and an extra each), fifty buyers of extras only.
      for (let index = 0; index < 50; index += 1) {
        await seedStudent(`student-${index}`, { dueDate: '2026-01-10' });
        charges.add(`student-${index}`, { dueDate: '2026-01-20' });
        charges.add(`buyer-${index}`, { dueDate: '2026-01-20' });
      }

      spies = countReads();
      const roster = ok(await service.listStudentRoster({ asOf: '2026-03-01' }));

      expect(roster).toHaveLength(101);
      expectFourQueries(spies);
    });
  });

  // -------------------------------------------------------------------------
  // Two rails, never merged (RFC 0015 §4)
  // -------------------------------------------------------------------------

  describe('two rails on the roster', () => {
    it('a late extra never moves the monthly fee', async () => {
      const { invoice } = await seedStudent('paid-up', { dueDate: '2026-01-10' });
      ok(
        await service.recordPayment(
          invoice.id,
          { amountMinor: 15000, method: PaymentMethod.PIX, paidAt: '2026-01-05' },
          ADMIN,
        ),
      );
      charges.add('paid-up', { dueDate: '2026-02-01', amountMinor: 8000 });

      const entry = ok(await service.listStudentRoster({ asOf: '2026-03-01' }))[0];
      expect(entry.contract).toMatchObject({
        standing: BillingStanding.GOOD,
        outstandingMinor: 0,
        oldestOverdueDate: null,
      });
      expect(entry.extras).toEqual({
        standing: BillingStanding.DELINQUENT,
        oldestOverdueDate: '2026-02-01',
        outstandingMinor: 8000,
        openCharges: 1,
        overdueCharges: 1,
      });
    });

    it('paid extras never clear a late monthly fee', async () => {
      await seedStudent('late', { dueDate: '2026-01-10' });
      charges.add('late', { dueDate: '2026-01-10', balanceMinor: 0 });
      charges.add('late', { dueDate: '2026-02-10', balanceMinor: -500 });

      const entry = ok(await service.listStudentRoster({ asOf: '2026-03-01' }))[0];
      expect(entry.contract).toMatchObject({
        standing: BillingStanding.DELINQUENT,
        outstandingMinor: 15000,
      });
      expect(entry.extras).toEqual({
        standing: BillingStanding.GOOD,
        oldestOverdueDate: null,
        outstandingMinor: 0,
        openCharges: 0,
        overdueCharges: 0,
      });
    });

    it('lists a buyer of extras with no contract, in the charge currency', async () => {
      charges.add('buyer', { dueDate: '2026-01-20', currency: 'BRL' });

      const roster = ok(await service.listStudentRoster({ asOf: '2026-03-01' }));
      expect(roster).toHaveLength(1);
      expect(roster[0]).toMatchObject({
        userId: 'buyer',
        currency: 'BRL',
        contract: null,
        extras: { standing: BillingStanding.DELINQUENT, outstandingMinor: 8000 },
        hold: null,
      });
    });

    it('keeps a buyer whose charges are all paid or void, as `good`', async () => {
      charges.add('settled', { dueDate: '2026-01-20', balanceMinor: 0 });
      charges.add('settled', { dueDate: '2026-01-20', status: ChargeStatus.VOID });

      const [entry] = ok(await service.listStudentRoster({ asOf: '2026-03-01' }));
      expect(entry).toMatchObject({
        userId: 'settled',
        contract: null,
        extras: { standing: BillingStanding.GOOD, outstandingMinor: 0, openCharges: 0 },
      });
    });

    it('ignores a voided charge on the extras rail', async () => {
      charges.add('voided', { dueDate: '2026-01-20', status: ChargeStatus.VOID });
      const [entry] = ok(await service.listStudentRoster({ asOf: '2026-03-01' }));
      expect(entry.extras).toMatchObject({ standing: BillingStanding.GOOD, outstandingMinor: 0 });
    });

    it('counts open and overdue charges apart, overdue from the due date', async () => {
      charges.add('buyer', { dueDate: '2026-03-01' }); // due today: overdue, within grace
      charges.add('buyer', { dueDate: '2026-04-01' }); // not yet due
      charges.add('buyer', { dueDate: '2026-01-01', balanceMinor: 0 }); // paid

      const [entry] = ok(await service.listStudentRoster({ asOf: '2026-03-01' }));
      expect(entry.extras).toEqual({
        standing: BillingStanding.DUE,
        oldestOverdueDate: '2026-03-01',
        outstandingMinor: 16000,
        openCharges: 2,
        overdueCharges: 1,
      });
    });

    it('has no top-level standing or total on any entry', async () => {
      await seedStudent('member', { dueDate: '2026-01-10' });
      charges.add('member', { dueDate: '2026-01-10' });
      charges.add('buyer', { dueDate: '2026-01-10' });

      for (const entry of ok(await service.listStudentRoster({ asOf: '2026-03-01' }))) {
        expect(entry).not.toHaveProperty('standing');
        expect(entry).not.toHaveProperty('outstandingMinor');
        expect(Object.keys(entry).sort()).toEqual(
          ['asOf', 'contract', 'currency', 'extras', 'hold', 'userId'],
        );
      }
    });

    it('a hold turns the contract exempt and leaves extras untouched', async () => {
      await seedStudent('held', { dueDate: '2026-01-10' });
      charges.add('held', { dueDate: '2026-01-20' });

      const before = ok(await service.listStudentRoster({ asOf: '2026-03-01' }))[0];
      ok(await service.setHold('held', { reason: 'Injured; agreed to pause.' }, ADMIN));
      const after = ok(await service.listStudentRoster({ asOf: '2026-03-01' }))[0];

      expect(before.contract!.standing).toBe(BillingStanding.DELINQUENT);
      expect(after.contract!.standing).toBe(BillingStanding.EXEMPT);
      expect(after.extras).toEqual(before.extras);
      expect(after.extras!.standing).toBe(BillingStanding.DELINQUENT);
    });

    it('a hold on an extras-only buyer never makes them exempt', async () => {
      charges.add('buyer', { dueDate: '2026-01-20' });
      ok(await service.setHold('buyer', { reason: 'Talk to them first.' }, ADMIN));

      const [entry] = ok(await service.listStudentRoster({ asOf: '2026-03-01' }));
      expect(entry.contract).toBeNull();
      expect(entry.extras!.standing).toBe(BillingStanding.DELINQUENT);
      expect(entry.hold).toMatchObject({ reason: 'Talk to them first.' });
      expect(
        ok(await service.listStudentRoster({ asOf: '2026-03-01', extrasStanding: BillingStanding.EXEMPT })),
      ).toEqual([]);
    });

    it('`contractStanding` and the legacy `standing` return the same users with or without charges', async () => {
      await seedStudent('late-a', { dueDate: '2026-01-10' });
      await seedStudent('late-b', { dueDate: '2026-01-11' });
      const { invoice } = await seedStudent('paid-up', { dueDate: '2026-01-10' });
      ok(
        await service.recordPayment(
          invoice.id,
          { amountMinor: 15000, method: PaymentMethod.CASH, paidAt: '2026-01-05' },
          ADMIN,
        ),
      );
      ok(await service.setHold('late-b', { reason: 'Paused.' }, ADMIN));

      const ids = async (filter: Parameters<BillingService['listStudentRoster']>[0]) =>
        ok(await service.listStudentRoster({ asOf: '2026-03-01', ...filter })).map((e) => e.userId);

      const filters = [
        { contractStanding: BillingStanding.DELINQUENT },
        { standing: BillingStanding.DELINQUENT },
        { contractStanding: BillingStanding.GOOD },
        { standing: BillingStanding.EXEMPT },
      ];
      const empty = await Promise.all(filters.map(ids));

      // Every kind of charge: overdue on a paid-up student, paid on a late one,
      // overdue on a held one, and a buyer with no contract at all.
      charges.add('paid-up', { dueDate: '2026-01-10' });
      charges.add('late-a', { dueDate: '2026-01-10', balanceMinor: 0 });
      charges.add('late-b', { dueDate: '2026-01-10' });
      charges.add('buyer', { dueDate: '2026-01-10' });

      expect(await Promise.all(filters.map(ids))).toEqual(empty);
      expect(empty[0]).toEqual(['late-a']);
      expect(empty[1]).toEqual(['late-a']);
      expect(empty[2]).toEqual(['paid-up']);
      expect(empty[3]).toEqual(['late-b']);
    });

    it('filters each rail independently, and both together', async () => {
      await seedStudent('late-contract', { dueDate: '2026-01-10' });
      const { invoice } = await seedStudent('late-extra', { dueDate: '2026-01-10' });
      ok(
        await service.recordPayment(
          invoice.id,
          { amountMinor: 15000, method: PaymentMethod.CASH, paidAt: '2026-01-05' },
          ADMIN,
        ),
      );
      await seedStudent('late-both', { dueDate: '2026-01-10' });
      charges.add('late-extra', { dueDate: '2026-01-10' });
      charges.add('late-both', { dueDate: '2026-01-10' });
      charges.add('buyer', { dueDate: '2026-01-10' });

      const ids = async (filter: Parameters<BillingService['listStudentRoster']>[0]) =>
        ok(await service.listStudentRoster({ asOf: '2026-03-01', ...filter }))
          .map((e) => e.userId)
          .sort();

      expect(await ids({ extrasStanding: BillingStanding.DELINQUENT })).toEqual([
        'buyer',
        'late-both',
        'late-extra',
      ]);
      expect(await ids({ contractStanding: BillingStanding.DELINQUENT })).toEqual([
        'late-both',
        'late-contract',
      ]);
      expect(
        await ids({
          contractStanding: BillingStanding.DELINQUENT,
          extrasStanding: BillingStanding.DELINQUENT,
        }),
      ).toEqual(['late-both']);
    });

    it('refuses a legacy `standing` that contradicts `contractStanding`', async () => {
      expect(
        await service.listStudentRoster({
          standing: BillingStanding.GOOD,
          contractStanding: BillingStanding.DELINQUENT,
        }),
      ).toMatchObject({ ok: false, status: 400 });
      expect(
        await service.listStudentRoster({
          standing: BillingStanding.DELINQUENT,
          contractStanding: BillingStanding.DELINQUENT,
        }),
      ).toMatchObject({ ok: true });
    });

    it('sorts by contract outstanding, then extras outstanding, then id', async () => {
      await seedStudent('contract-big', { dueDate: '2026-01-10', amountMinor: 90000 });
      await seedStudent('contract-small-a', { dueDate: '2026-01-10', amountMinor: 1000 });
      await seedStudent('contract-small-b', { dueDate: '2026-01-10', amountMinor: 1000 });
      charges.add('contract-small-b', { dueDate: '2026-01-10', amountMinor: 500 });
      charges.add('buyer-big', { dueDate: '2026-01-10', amountMinor: 70000 });
      charges.add('buyer-small', { dueDate: '2026-01-10', amountMinor: 100 });

      expect(
        ok(await service.listStudentRoster({ asOf: '2026-03-01' })).map((e) => e.userId),
      ).toEqual([
        'contract-big',
        'contract-small-b',
        'contract-small-a',
        'buyer-big',
        'buyer-small',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // The extras standing of one student
  // -------------------------------------------------------------------------

  describe('EventChargeService.getExtrasStanding', () => {
    function extrasService(): { extras: EventChargeService; listCharges: ReturnType<typeof vi.spyOn> } {
      const listCharges = vi.spyOn(charges, 'listCharges');
      const extras = new EventChargeService(
        charges as unknown as IEventChargeRepository,
        { findById: async () => null, getAudienceGrants: async () => ({ userIds: [], groupIds: [] }) } as never,
        { listMembers: async () => [] } as never,
        { listCurrencies: async () => [] } as never,
      );
      return { extras, listCharges };
    }

    it('resolves from the student\'s charges alone, in one read, and ignores a hold', async () => {
      await seedStudent('held', { dueDate: '2026-01-10' });
      ok(await service.setHold('held', { reason: 'Paused.' }, ADMIN));
      charges.add('held', { dueDate: '2026-01-20' });
      charges.add('someone-else', { dueDate: '2026-01-01', amountMinor: 99999 });

      const { extras, listCharges } = extrasService();
      const standing = ok(await extras.getExtrasStanding('held', '2026-03-01'));

      expect(listCharges).toHaveBeenCalledTimes(1);
      expect(listCharges).toHaveBeenCalledWith({ userId: 'held' });
      expect(standing).toEqual({
        userId: 'held',
        asOf: '2026-03-01',
        standing: BillingStanding.DELINQUENT,
        oldestOverdueDate: '2026-01-20',
        outstandingMinor: 8000,
        openCharges: 1,
        overdueCharges: 1,
      });
      // The contract rail, from the same student, is the held one.
      expect(ok(await service.getStanding('held', '2026-03-01')).standing).toBe(
        BillingStanding.EXEMPT,
      );
    });

    it('reports `good` for someone never charged', async () => {
      const { extras } = extrasService();
      expect(ok(await extras.getExtrasStanding('stranger', '2026-03-01'))).toMatchObject({
        standing: BillingStanding.GOOD,
        outstandingMinor: 0,
        openCharges: 0,
        overdueCharges: 0,
      });
    });

    it('agrees with the roster', async () => {
      charges.add('buyer', { dueDate: '2026-02-20' });
      charges.add('buyer', { dueDate: '2026-01-20', balanceMinor: 3000 });
      const { extras } = extrasService();
      const { userId: _userId, asOf: _asOf, ...alone } = ok(
        await extras.getExtrasStanding('buyer', '2026-03-01'),
      );
      const [entry] = ok(await service.listStudentRoster({ asOf: '2026-03-01' }));
      expect(entry.extras).toEqual(alone);
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
      expect(entry.contract!.standing).toBe(BillingStanding.EXEMPT);
      // The debt is reported in full beside the exemption, and the overdue date
      // is still stated — the hold says "do not chase", not "does not owe".
      expect(entry.contract!.outstandingMinor).toBe(42000);
      expect(entry.contract!.oldestOverdueDate).toBe('2026-01-10');

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

      expect(lastDay.contract!.standing).toBe(BillingStanding.EXEMPT);
      expect(dayAfter.contract!.standing).toBe(BillingStanding.DELINQUENT);

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
    it('answers exactly what `resolveStanding` answers over the unvoided invoices', async () => {
      // A spread of ledgers: settled, part-paid, voided, within grace, held,
      // expired hold. The contract rail must be byte-identical to RFC 0013.
      const { invoice: paid } = await seedStudent('paid', { dueDate: '2026-01-10' });
      ok(await service.recordPayment(paid.id, { amountMinor: 15000, method: PaymentMethod.PIX, paidAt: '2026-01-05' }, ADMIN));
      const { invoice: part } = await seedStudent('part', { dueDate: '2026-01-10' });
      ok(await service.recordPayment(part.id, { amountMinor: 4000, method: PaymentMethod.PIX, paidAt: '2026-01-05' }, ADMIN));
      const { invoice: voided } = await seedStudent('voided', { dueDate: '2026-01-10' });
      ok(await service.voidInvoice(voided.id, 'Wrong student.', ADMIN));
      await seedStudent('grace', { dueDate: '2026-02-27' });
      await seedStudent('held', { dueDate: '2026-01-10' });
      ok(await service.setHold('held', { reason: 'Paused.' }, ADMIN));
      await seedStudent('expired', { dueDate: '2026-01-10' });
      ok(await service.setHold('expired', { reason: 'Paused.', expiresAt: '2026-02-01' }, ADMIN));
      // A charge on every one of them must change nothing.
      for (const userId of ['paid', 'part', 'voided', 'grace', 'held', 'expired', 'stranger']) {
        charges.add(userId, { dueDate: '2026-01-01' });
      }

      for (const userId of ['paid', 'part', 'voided', 'grace', 'held', 'expired', 'stranger']) {
        const invoices = (await repo.listInvoices({ userId })).filter(
          (invoice) => invoice.status !== InvoiceStatus.VOID,
        );
        const hold = await repo.getHold(userId);
        const expected = resolveStanding({
          openInvoices: invoices.map((invoice) => ({
            dueDate: invoice.dueDate,
            graceDays: invoice.graceDays,
            balanceMinor: invoice.balanceMinor,
          })),
          hold: hold ? { expiresAt: hold.expiresAt } : null,
          today: '2026-03-01',
        });
        expect(ok(await service.getStanding(userId, '2026-03-01'))).toEqual({
          userId,
          asOf: '2026-03-01',
          ...expected,
        });
      }
    });

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
