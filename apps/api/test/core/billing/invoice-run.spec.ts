import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BillingService,
  statementPayLink,
  type BillingDirectory,
  type BillingRecipient,
  type BillingRunDeps,
  type BillingRunOptions,
  type BillingRunReport,
} from '@api/core/billing/billing-service';
import { AccountingService } from '@api/core/billing/accounting-service';
import { FakeBillingRepository } from '../../helpers/fake-billing-repository';
import { Entities } from '@arenaquest/shared/types/entities';
import type { IMailer, MailMessage } from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';
import { buildPaymentsWiring } from '@api/core/payments/gateway-registry';
import {
  StubGatewayAdapter,
  stubGatewayFactories,
  stubPaymentsEnv,
} from '../../adapters/payment/stub-gateway-adapter';

/**
 * The daily invoice run (RFC 0013 §6, Task 06).
 *
 * Everything asserted here is a property of the **routine**, not of the caller:
 * `POST /v1/admin/billing/invoices/run` and the `scheduled` handler both reach
 * this same method, so a rule proven here is proven for both.
 *
 * The run's whole contract is what it does *not* do. It writes one kind of row
 * — an `invoices` row for a period that had none — and every spec below is a
 * fence around that: no adjustment of any kind, no status repair, no duplicate
 * on a retry, no second mail, and no mail at all for a held student.
 */

const { BillingCycle, ContractStatus, ContractTermsSource, InvoiceStatus, BillingStanding } =
  Entities.Config;

const ADMIN = 'admin-1';
const STUDENT = 'student-1';

/** The contract anchor every case below shares: monthly, due on the 10th. */
const ANCHOR = '2026-01-01';
/** The March period: 2026-03-01 → 2026-04-01, due 2026-03-10. */
const MARCH_START = '2026-03-01';
const MARCH_DUE = '2026-03-10';
/** 5 grace days from the 10th: the last `due` day is the 15th. */
const GRACE_LAPSES = '2026-03-16';

/**
 * The two contract notices as they were sent before the pay link existed
 * (captured from the builders at 9e4c25f, before M30 Task 14). A label with
 * `PAYMENTS_PROVIDERS = none` must keep sending exactly these, character for
 * character — the stored half of "byte-for-byte what it is today".
 */
const TODAYS_NOTICES: MailMessage[] = [
  {
    to: 'student-1@dojo.test',
    subject: 'Your membership invoice is due today (2026-03-10)',
    text:
      'Hello Student student-1,\n' +
      '\n' +
      'Your membership invoice of R$150.00 is due today, 2026-03-10.\n' +
      'If you have already paid, please ignore this message.',
    html:
      '<p>Hello Student student-1,<br /><br />' +
      'Your membership invoice of R$150.00 is due today, 2026-03-10.<br />' +
      'If you have already paid, please ignore this message.</p>',
  },
  {
    to: 'student-1@dojo.test',
    subject: 'Your membership invoice is overdue (due 2026-03-10)',
    text:
      'Hello Student student-1,\n' +
      '\n' +
      'Your membership invoice of R$150.00, due on 2026-03-10, is now past its grace period.\n' +
      'Please get in touch so we can settle it together.',
    html:
      '<p>Hello Student student-1,<br /><br />' +
      'Your membership invoice of R$150.00, due on 2026-03-10, is now past its grace period.<br />' +
      'Please get in touch so we can settle it together.</p>',
  },
];

/** The label's web origin, with the trailing slash an operator may leave on it. */
const WEB_BASE_URL = 'https://dojo.example/';
const STATEMENT_URL = 'https://dojo.example/settings/billing';
const PAY_TEXT = `You can pay online from your statement: ${STATEMENT_URL}`;
const PAY_HTML = `You can pay online from <a href="${STATEMENT_URL}">your statement</a>.`;

/** How many times `needle` occurs in `text`. */
function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function ok<T>(result: ControllerResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.status} ${result.error}`);
  return result.data;
}

/** A capturing `IMailer` — the whole of "was a message sent?" in these specs. */
class CapturingMailer implements IMailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push({ ...message });
  }

  to(email: string): MailMessage[] {
    return this.sent.filter((message) => message.to === email);
  }
}

class FakeDirectory implements BillingDirectory {
  readonly students = new Map<string, BillingRecipient>();
  readonly admins: BillingRecipient[] = [];

  async findRecipient(userId: string): Promise<BillingRecipient | null> {
    return this.students.get(userId) ?? null;
  }

  async listAdmins(): Promise<BillingRecipient[]> {
    return [...this.admins];
  }
}

describe('BillingService.runBillingCycle — the daily run', () => {
  let repo: FakeBillingRepository;
  let service: BillingService;
  let accounting: AccountingService;
  let mailer: CapturingMailer;
  let directory: FakeDirectory;
  let deps: BillingRunDeps;
  let audit: ReturnType<typeof vi.spyOn>;

  function events(): Array<Record<string, unknown>> {
    return audit.mock.calls
      .map((call) => JSON.parse(call[0] as string) as Record<string, unknown>)
      .filter((event) => String(event.event).startsWith('billing.'));
  }

  async function run(options: BillingRunOptions = {}): Promise<BillingRunReport> {
    return ok(await service.runBillingCycle(deps, options, ADMIN));
  }

  async function seedPlan(amountMinor = 15000, graceDays = 5) {
    return ok(
      await service.createPlan(
        {
          name: `Plan ${amountMinor}`,
          amountMinor,
          currency: 'BRL',
          cycle: BillingCycle.MONTHLY,
          graceDays,
        },
        ADMIN,
      ),
    );
  }

  async function seedContract(planId: string, userId = STUDENT) {
    directory.students.set(userId, {
      userId,
      name: `Student ${userId}`,
      email: `${userId}@dojo.test`,
    });
    return ok(
      await service.signContract(
        {
          userId,
          planId,
          dueDay: 10,
          startDate: ANCHOR,
          termsSource: ContractTermsSource.STANDARD,
        },
        ADMIN,
      ),
    );
  }

  beforeEach(() => {
    repo = new FakeBillingRepository();
    service = new BillingService(repo);
    accounting = new AccountingService(repo, async () => true);
    mailer = new CapturingMailer();
    directory = new FakeDirectory();
    directory.admins.push({ userId: ADMIN, name: 'Sensei', email: 'sensei@dojo.test' });
    deps = { mailer, directory };
    audit = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Issuance — idempotent by construction
  // -------------------------------------------------------------------------

  describe('issuance', () => {
    it('issues one invoice per active contract for the period', async () => {
      const plan = await seedPlan();
      const contract = await seedContract(plan.id);

      const report = await run({ asOf: MARCH_START });

      expect(report.eligibleContracts).toBe(1);
      expect(report.issued).toHaveLength(1);
      expect(report.issued[0]).toMatchObject({
        subscriptionId: contract.id,
        userId: STUDENT,
        periodStart: MARCH_START,
        dueDate: MARCH_DUE,
        // The contract's snapshot, not the plan's current price.
        amountMinor: 15000,
        currency: 'BRL',
        status: InvoiceStatus.OPEN,
      });
      expect(report.absorbed).toBe(0);
    });

    it('issues each invoice exactly once when the run is repeated', async () => {
      const plan = await seedPlan();
      await seedContract(plan.id);

      const first = await run({ asOf: MARCH_START });
      const countAfterFirst = repo.invoices.size;

      // The retry. Idempotency is `UNIQUE (subscription_id, period_start)`,
      // not the job having run exactly once, so this is a no-op rather than a
      // duplicate or a failure.
      const second = await run({ asOf: MARCH_START });

      expect(first.issued).toHaveLength(1);
      expect(second.issued).toHaveLength(0);
      // The duplicate is reported as absorbed, not raised.
      expect(second.absorbed).toBe(1);
      expect(second.eligibleContracts).toBe(1);
      expect(repo.invoices.size).toBe(countAfterFirst);
    });

    it('issues nothing for a paused contract, and leaves its open invoices alone', async () => {
      const plan = await seedPlan();
      const contract = await seedContract(plan.id);

      // February's invoice exists and is open when the contract is paused.
      await run({ asOf: '2026-02-01' });
      const february = [...repo.invoices.values()][0];
      ok(await service.changeLifecycle(contract.id, { action: 'pause' }, ADMIN));

      const report = await run({ asOf: MARCH_START });

      // Skipped at issuance...
      expect(report.eligibleContracts).toBe(0);
      expect(report.issued).toHaveLength(0);
      expect(repo.invoices.size).toBe(1);

      // ...and nowhere else. The open invoice keeps its due date, still counts
      // toward the roster's outstanding total and still lands in the aging
      // report — a pause stops billing, it does not forgive a debt.
      expect(repo.invoices.get(february.id)).toEqual(february);

      const roster = ok(await service.listStudentRoster({ asOf: GRACE_LAPSES }));
      expect(roster).toHaveLength(1);
      expect(roster[0]).toMatchObject({
        userId: STUDENT,
        contract: {
          status: ContractStatus.PAUSED,
          outstandingMinor: 15000,
          standing: BillingStanding.DELINQUENT,
        },
      });

      const aging = ok(await accounting.getReceivablesAging(GRACE_LAPSES));
      expect(aging.totalMinor).toBe(15000);
      expect(aging.invoiceCount).toBe(1);
    });

    it('issues nothing for a cancelled contract or past an end date', async () => {
      const plan = await seedPlan();
      const cancelled = await seedContract(plan.id, 'student-cancelled');
      ok(
        await service.changeLifecycle(
          cancelled.id,
          { action: 'cancel', endDate: '2026-02-01' },
          ADMIN,
        ),
      );

      const ended = await seedContract(plan.id, 'student-ended');
      await repo.updateSubscriptionStatus(ended.id, ContractStatus.ACTIVE, '2026-02-15');

      const report = await run({ asOf: MARCH_START });

      expect(report.eligibleContracts).toBe(0);
      expect(report.issued).toHaveLength(0);
      expect(repo.invoices.size).toBe(0);
    });

    it("issues a free contract's invoice as paid, with no payment row and no mail", async () => {
      const free = await seedPlan(0, 5);
      await seedContract(free.id, 'scholarship-student');

      // The whole life of the invoice: issued on the 1st, due on the 10th,
      // grace lapsing on the 16th. A zero balance must produce no notice on
      // any of those days.
      const issue = await run({ asOf: MARCH_START });
      const onDue = await run({ asOf: MARCH_DUE, since: '2026-03-09' });
      const afterGrace = await run({ asOf: GRACE_LAPSES, since: '2026-03-15' });

      expect(issue.issued).toHaveLength(1);
      expect(issue.issued[0]).toMatchObject({ amountMinor: 0, status: InvoiceStatus.PAID });
      // Settled by its balance, not by a payment.
      expect(repo.payments).toHaveLength(0);
      expect(mailer.sent).toHaveLength(0);
      expect([...issue.reminders, ...onDue.reminders, ...afterGrace.reminders]).toHaveLength(0);
      expect([...issue.crossings, ...onDue.crossings, ...afterGrace.crossings]).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // The rule the whole task exists to keep: the job writes no money
  // -------------------------------------------------------------------------

  describe('no automatic money', () => {
    it('writes no invoice_adjustments row of any kind, surcharge included', async () => {
      const plan = await seedPlan();
      await seedContract(plan.id);

      const before = repo.adjustments.length;

      // A full month of firings, straight through the due date and past the
      // end of grace — every day on which a late fee would plausibly accrue.
      let since = '2026-02-28';
      for (const day of [
        MARCH_START,
        '2026-03-09',
        MARCH_DUE,
        '2026-03-15',
        GRACE_LAPSES,
        '2026-03-20',
        '2026-03-31',
      ]) {
        await run({ asOf: day, since });
        since = day;
      }

      expect(before).toBe(0);
      // Nothing accrued: no interest, no percentage, no cap, no daily
      // incidence. The table is counted rather than inspected so a row of any
      // `kind` fails this.
      expect(repo.adjustments).toHaveLength(0);
      expect(repo.adjustments.filter((a) => a.kind === Entities.Config.AdjustmentKind.SURCHARGE))
        .toHaveLength(0);

      // The invoice is still worth exactly what the contract said.
      const [invoice] = await repo.listInvoices({});
      expect(invoice.amountMinor).toBe(15000);
      expect(invoice.balanceMinor).toBe(15000);
    });
  });

  // -------------------------------------------------------------------------
  // The two student notices — no sequence, once per invoice
  // -------------------------------------------------------------------------

  describe('reminders', () => {
    it('sends the due-date notice on the due date and the grace notice when grace lapses', async () => {
      const plan = await seedPlan();
      await seedContract(plan.id);
      await run({ asOf: MARCH_START });

      const onDue = await run({ asOf: MARCH_DUE, since: '2026-03-09' });
      expect(onDue.reminders).toHaveLength(1);
      expect(onDue.reminders[0]).toMatchObject({ kind: 'due_date', sent: true });

      const lastGraceDay = await run({ asOf: '2026-03-15', since: MARCH_DUE });
      expect(lastGraceDay.reminders).toHaveLength(0);

      const lapsed = await run({ asOf: GRACE_LAPSES, since: '2026-03-15' });
      expect(lapsed.reminders).toHaveLength(1);
      expect(lapsed.reminders[0]).toMatchObject({ kind: 'grace_lapsed', sent: true });
    });

    it('fires each notice exactly once per invoice across a month of runs', async () => {
      const plan = await seedPlan();
      await seedContract(plan.id);

      // Every day of March, as the cron would walk it: disjoint one-day
      // windows, so a notice can land in exactly one of them. Nothing
      // remembers that it already sent — there is no `last_sent` column.
      let since = '2026-02-28';
      for (let day = 1; day <= 31; day += 1) {
        const asOf = `2026-03-${String(day).padStart(2, '0')}`;
        await run({ asOf, since });
        since = asOf;
      }

      const student = mailer.to(`${STUDENT}@dojo.test`);
      expect(student).toHaveLength(2);
      expect(student[0].subject).toContain('due today');
      expect(student[1].subject).toContain('overdue');
    });

    it('sends nothing a second time when a day is re-run', async () => {
      const plan = await seedPlan();
      await seedContract(plan.id);
      await run({ asOf: MARCH_START });
      await run({ asOf: MARCH_DUE, since: '2026-03-09' });

      const sentAfterFirst = mailer.sent.length;
      // The previous run was today: `(asOf, asOf]` is empty, so the day owes
      // nothing further.
      const rerun = await run({ asOf: MARCH_DUE, since: MARCH_DUE });

      expect(rerun.reminders).toHaveLength(0);
      expect(mailer.sent).toHaveLength(sentAfterFirst);
    });

    it('sends no reminder once the invoice is paid', async () => {
      const plan = await seedPlan();
      await seedContract(plan.id);
      await run({ asOf: MARCH_START });

      const [invoice] = await repo.listInvoices({});
      ok(
        await service.recordPayment(
          invoice.id,
          { amountMinor: 15000, method: Entities.Config.PaymentMethod.PIX },
          ADMIN,
        ),
      );

      const onDue = await run({ asOf: MARCH_DUE, since: '2026-03-09' });
      expect(onDue.reminders).toHaveLength(0);
      expect(mailer.sent).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // The pay link (RFC 0026 §7, M30 Task 14) — one line, only when payable online
  // -------------------------------------------------------------------------

  describe('the pay link', () => {
    /** Runs March up to the grace lapse and returns the student's two notices. */
    async function twoNotices(): Promise<MailMessage[]> {
      const plan = await seedPlan();
      await seedContract(plan.id);
      await run({ asOf: MARCH_START });
      await run({ asOf: MARCH_DUE, since: '2026-03-09' });
      await run({ asOf: GRACE_LAPSES, since: '2026-03-15' });
      return mailer.to(`${STUDENT}@dojo.test`);
    }

    it('sends both notices exactly as before when the label offers no online payment', async () => {
      expect(await twoNotices()).toEqual(TODAYS_NOTICES);
    });

    /**
     * Rebuilds the service the way the container does: the resolver over a
     * registry parsed from `env`, with a stub adapter behind every provider.
     */
    function offerPayments(env: Record<string, string>): StubGatewayAdapter {
      const stub = new StubGatewayAdapter('mercadopago');
      const { config, gateways } = buildPaymentsWiring(env, stubGatewayFactories(stub));
      configOk = config.ok;
      service = new BillingService(repo, undefined, undefined, statementPayLink(() => gateways.payOptions, WEB_BASE_URL));
      return stub;
    }
    let configOk = true;

    it('adds one line and one link to the statement page when a provider offers a method', async () => {
      const stub = offerPayments(stubPaymentsEnv('mercadopago:pix+card'));
      expect(configOk).toBe(true);

      const notices = await twoNotices();
      expect(notices).toHaveLength(2);

      notices.forEach((message, index) => {
        const before = TODAYS_NOTICES[index];
        expect(message.subject).toBe(before.subject);

        // The line sits just before the closing sentence; nothing else moved.
        const lines = message.text.split('\n');
        expect(lines.filter((line) => line !== PAY_TEXT).join('\n')).toBe(before.text);
        expect(lines[lines.length - 2]).toBe(PAY_TEXT);
        expect(message.html).toBe(before.html.replace(/(<br \/>)(?!.*<br \/>)/, `$1${PAY_HTML}$1`));

        // Exactly one link, to the statement itself: no query, no id, no provider.
        expect(occurrences(message.text, 'https://')).toBe(1);
        expect(occurrences(message.text, STATEMENT_URL)).toBe(1);
        expect(occurrences(message.html, 'href=')).toBe(1);
        expect(message.html).toContain(`href="${STATEMENT_URL}"`);
        for (const part of [message.text, message.html]) {
          expect(part).not.toContain('?');
          expect(part.toLowerCase()).not.toContain('mercadopago');
          expect(part).not.toContain('.invalid');
        }
      });

      // Building a reminder asks no provider anything and opens no checkout.
      expect(stub.calls).toEqual([]);
      expect(stub.factoryInputs).toEqual([]);
    });

    it('is byte-for-byte the old message with PAYMENTS_PROVIDERS = none', async () => {
      const stub = offerPayments(stubPaymentsEnv('none'));
      expect(configOk).toBe(true);

      expect(await twoNotices()).toEqual(TODAYS_NOTICES);
      expect(stub.calls).toEqual([]);
    });

    it('completes the run and sends the old message under an invalid provider list', async () => {
      // A listed provider without its secrets: `missing_secret`, an empty registry.
      const stub = offerPayments({ PAYMENTS_PROVIDERS: 'mercadopago:pix' });
      expect(configOk).toBe(false);

      expect(await twoNotices()).toEqual(TODAYS_NOTICES);
      expect(stub.calls).toEqual([]);
    });

    it('adds no line when the bound provider offers no method', async () => {
      // A retired entry: still bound for refunds, offers nothing to pay with.
      const stub = offerPayments(stubPaymentsEnv('mercadopago:'));
      expect(configOk).toBe(true);

      expect(await twoNotices()).toEqual(TODAYS_NOTICES);
      expect(stub.calls).toEqual([]);
    });

    it('drops the line, not the run, when the resolver throws', async () => {
      service = new BillingService(repo, undefined, undefined, () => {
        throw new Error('pay options unavailable');
      });

      expect(await twoNotices()).toEqual(TODAYS_NOTICES);
    });
  });

  // -------------------------------------------------------------------------
  // The admin digest — crossings, never a standing list
  // -------------------------------------------------------------------------

  describe('the admin digest', () => {
    it('names the students who crossed into due or delinquent since the previous run', async () => {
      const plan = await seedPlan();
      await seedContract(plan.id);
      await run({ asOf: MARCH_START });

      const intoDue = await run({ asOf: MARCH_DUE, since: '2026-03-09' });
      expect(intoDue.crossings).toEqual([
        {
          userId: STUDENT,
          from: BillingStanding.GOOD,
          to: BillingStanding.DUE,
          oldestOverdueDate: MARCH_DUE,
          outstandingMinor: 15000,
          currency: 'BRL',
        },
      ]);
      expect(intoDue.adminsNotified).toBe(1);
      expect(mailer.to('sensei@dojo.test')).toHaveLength(1);

      const intoDelinquent = await run({ asOf: GRACE_LAPSES, since: '2026-03-15' });
      expect(intoDelinquent.crossings).toHaveLength(1);
      expect(intoDelinquent.crossings[0]).toMatchObject({
        from: BillingStanding.DUE,
        to: BillingStanding.DELINQUENT,
      });
    });

    it('reports nobody on a second run the same day', async () => {
      const plan = await seedPlan();
      await seedContract(plan.id);
      await run({ asOf: MARCH_START });

      const first = await run({ asOf: MARCH_DUE, since: '2026-03-09' });
      expect(first.crossings).toHaveLength(1);

      // The same day, run again. The previous run is today, so the window is
      // empty and the student — still `due`, still owing 15000 — is not news.
      // This is the standing-list failure mode the digest exists to avoid.
      const second = await run({ asOf: MARCH_DUE, since: first.asOf });

      expect(second.crossings).toHaveLength(0);
      expect(second.adminsNotified).toBe(0);
      expect(mailer.to('sensei@dojo.test')).toHaveLength(1);
    });

    it('reports nobody on a day when nothing moved', async () => {
      const plan = await seedPlan();
      await seedContract(plan.id);
      await run({ asOf: MARCH_START });
      await run({ asOf: MARCH_DUE, since: '2026-03-09' });

      // Still `due`, one day later, and therefore not news.
      const quiet = await run({ asOf: '2026-03-11', since: MARCH_DUE });
      expect(quiet.crossings).toHaveLength(0);
      expect(quiet.mailsSent).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // A hold suppresses mail, never a total
  // -------------------------------------------------------------------------

  describe('holds', () => {
    it('sends a held student neither mail, lists them in no digest, and changes no total', async () => {
      const plan = await seedPlan();
      await seedContract(plan.id);
      await run({ asOf: MARCH_START });

      ok(await service.setHold(STUDENT, { reason: 'Injured; agreed to pause chasing.' }, ADMIN));

      const onDue = await run({ asOf: MARCH_DUE, since: '2026-03-09' });
      const lapsed = await run({ asOf: GRACE_LAPSES, since: '2026-03-15' });

      // The notices were owed and were suppressed, not skipped silently.
      expect(onDue.reminders).toHaveLength(1);
      expect(onDue.reminders[0]).toMatchObject({ sent: false, suppressedByHold: true });
      expect(lapsed.reminders[0]).toMatchObject({ sent: false, suppressedByHold: true });
      expect(mailer.sent).toHaveLength(0);

      // No digest entry on either day.
      expect(onDue.crossings).toHaveLength(0);
      expect(lapsed.crossings).toHaveLength(0);

      // ...and the balance is untouched everywhere it is reported.
      expect(lapsed.suppressedByHold).toEqual([{ userId: STUDENT, outstandingMinor: 15000 }]);

      const roster = ok(await service.listStudentRoster({ asOf: GRACE_LAPSES }));
      expect(roster[0].contract).toMatchObject({
        standing: BillingStanding.EXEMPT,
        outstandingMinor: 15000,
      });
      const aging = ok(await accounting.getReceivablesAging(GRACE_LAPSES));
      expect(aging.totalMinor).toBe(15000);
      const statement = ok(await accounting.getStudentStatement(STUDENT));
      expect(statement.outstandingMinor).toBe(15000);
    });

    it('resumes chasing the day after the hold expires, with nothing having run', async () => {
      const plan = await seedPlan();
      await seedContract(plan.id);
      await run({ asOf: MARCH_START });
      ok(
        await service.setHold(
          STUDENT,
          { reason: 'Disputed charge.', expiresAt: '2026-03-09' },
          ADMIN,
        ),
      );

      const onDue = await run({ asOf: MARCH_DUE, since: '2026-03-09' });

      expect(onDue.reminders[0]).toMatchObject({ sent: true, suppressedByHold: false });
      expect(onDue.crossings).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Assert, do not repair
  // -------------------------------------------------------------------------

  describe('the balance-versus-status assertion', () => {
    it('logs a drifted cached status and leaves the row byte-identical', async () => {
      const plan = await seedPlan();
      await seedContract(plan.id);
      await run({ asOf: MARCH_START });

      const [issued] = [...repo.invoices.values()];
      // A hand-edit of the kind a manual database fix produces: the cache says
      // `paid` while the ledger still says 15000 is owed.
      const drifted = { ...issued, status: InvoiceStatus.PAID };
      repo.invoices.set(issued.id, drifted);
      const snapshot = JSON.stringify(drifted);

      const report = await run({ asOf: MARCH_DUE, since: '2026-03-09' });

      expect(report.divergences).toEqual([
        {
          invoiceId: issued.id,
          userId: STUDENT,
          cachedStatus: InvoiceStatus.PAID,
          expectedStatus: InvoiceStatus.OPEN,
          balanceMinor: 15000,
        },
      ]);

      const divergence = events().find((event) => event.event === 'billing.status_divergence');
      expect(divergence).toMatchObject({ invoiceId: issued.id, repaired: false });

      // Nothing was repaired. A silent fix would erase the evidence of whatever
      // wrote the wrong status.
      expect(JSON.stringify(repo.invoices.get(issued.id))).toBe(snapshot);
      expect(repo.adjustments).toHaveLength(0);
      expect(repo.payments).toHaveLength(0);
    });

    it('reports no divergence when the cache agrees with the balance', async () => {
      const plan = await seedPlan();
      await seedContract(plan.id);
      const report = await run({ asOf: MARCH_START });
      expect(report.divergences).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // The window
  // -------------------------------------------------------------------------

  describe('the run window', () => {
    it('defaults `since` to the day before `asOf`', async () => {
      const plan = await seedPlan();
      await seedContract(plan.id);
      const report = await run({ asOf: MARCH_DUE });
      expect(report).toMatchObject({ asOf: MARCH_DUE, since: '2026-03-09' });
    });

    it('refuses a window that runs backwards', async () => {
      const result = await service.runBillingCycle(deps, {
        asOf: MARCH_START,
        since: MARCH_DUE,
      });
      expect(result).toMatchObject({ ok: false, status: 400, error: 'ValidationError' });
    });

    it('refuses a malformed date rather than billing an unknown day', async () => {
      const result = await service.runBillingCycle(deps, { asOf: '01/03/2026' });
      expect(result).toMatchObject({ ok: false, status: 400, error: 'ValidationError' });
    });
  });

  // -------------------------------------------------------------------------
  // The structured audit line
  // -------------------------------------------------------------------------

  it('emits one billing.invoice_run line carrying the counts and a zero adjustment count', async () => {
    const plan = await seedPlan();
    await seedContract(plan.id);

    await run({ asOf: MARCH_START });

    const line = events().filter((event) => event.event === 'billing.invoice_run');
    expect(line).toHaveLength(1);
    expect(line[0]).toMatchObject({
      actor: ADMIN,
      asOf: MARCH_START,
      eligibleContracts: 1,
      issuedCount: 1,
      absorbed: 0,
      adjustmentsWritten: 0,
    });
  });

  it('continues the run when the mailer throws', async () => {
    const plan = await seedPlan();
    await seedContract(plan.id);
    await run({ asOf: MARCH_START });

    const exploding: BillingRunDeps = {
      mailer: {
        async send(): Promise<void> {
          throw new Error('provider down');
        },
      },
      directory,
    };

    const report = ok(
      await service.runBillingCycle(exploding, { asOf: MARCH_DUE, since: '2026-03-09' }, ADMIN),
    );

    // The notice is reported as undelivered rather than aborting a run that has
    // already issued invoices and still owes an assertion pass.
    expect(report.reminders[0]).toMatchObject({ sent: false, suppressedByHold: false });
    expect(report.mailsSent).toBe(0);
    expect(report.divergences).toHaveLength(0);
  });
});
