import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BillingService,
  statementPayLink,
  type BillingDirectory,
  type BillingRecipient,
  type BillingRunDeps,
  type BillingRunOptions,
  type BillingRunReport,
  type ChargeReader,
} from '@api/core/billing/billing-service';
import { FakeBillingRepository } from '../../helpers/fake-billing-repository';
import { addDays } from '@arenaquest/shared/domain/billing/billing-cycle';
import { Entities } from '@arenaquest/shared/types/entities';
import type {
  EventChargeFilter,
  EventChargeWithBalanceRecord,
  IMailer,
  MailMessage,
} from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';
import { buildPaymentsWiring } from '@api/core/payments/gateway-registry';
import {
  StubGatewayAdapter,
  stubGatewayFactories,
  stubPaymentsEnv,
} from '../../adapters/payment/stub-gateway-adapter';

/**
 * The daily run on the extras rail (RFC 0015 §5, M22 Task 06).
 *
 * The run only *reads* charges: it sends the same two notices as for a
 * monthly fee, worded for the event, never suppressed by a contract hold, and
 * reports extras crossings in their own digest section. Contract behaviour is
 * fenced by `invoice-run.spec.ts`, which this task leaves untouched.
 */

const { BillingCycle, BillingStanding, ChargeStatus, ContractTermsSource } = Entities.Config;

const ADMIN = 'admin-1';
const STUDENT = 'student-1';
const BUYER = 'buyer-1';
const EVENT_TITLE = 'Seminário de Março';

/** The charge every case shares: due 2026-03-10, 3 grace days → late on the 14th. */
const CHARGE_DUE = '2026-03-10';
const CHARGE_GRACE = 3;
const CHARGE_LAPSES = '2026-03-14';

/**
 * The two extras notices as they were sent before the pay link existed
 * (captured from the builders at 9e4c25f, before M30 Task 14). A label with
 * `PAYMENTS_PROVIDERS = none` must keep sending exactly these, character for
 * character.
 */
const TODAYS_NOTICES: MailMessage[] = [
  {
    to: 'buyer-1@dojo.test',
    subject: 'Your charge for Seminário de Março is due today (2026-03-10)',
    text:
      'Hello Student buyer-1,\n' +
      '\n' +
      'Your charge of R$150.00 for Seminário de Março is due today, 2026-03-10.\n' +
      'If you have already paid, please ignore this message.',
    html:
      '<p>Hello Student buyer-1,<br /><br />' +
      'Your charge of R$150.00 for Seminário de Março is due today, 2026-03-10.<br />' +
      'If you have already paid, please ignore this message.</p>',
  },
  {
    to: 'buyer-1@dojo.test',
    subject: 'Your charge for Seminário de Março is overdue (due 2026-03-10)',
    text:
      'Hello Student buyer-1,\n' +
      '\n' +
      'Your charge of R$150.00 for Seminário de Março, due on 2026-03-10, is now past its grace period.\n' +
      'Please get in touch so we can settle it together.',
    html:
      '<p>Hello Student buyer-1,<br /><br />' +
      'Your charge of R$150.00 for Seminário de Março, due on 2026-03-10, is now past its grace period.<br />' +
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

/**
 * A read-only extras ledger. It exposes exactly what `ChargeReader` allows —
 * `listCharges` — so the run could not write a charge here even if it tried.
 */
class FakeChargeReader implements ChargeReader {
  readonly charges: EventChargeWithBalanceRecord[] = [];
  reads = 0;

  async listCharges(filter: EventChargeFilter): Promise<EventChargeWithBalanceRecord[]> {
    this.reads += 1;
    return this.charges.filter(
      (charge) => filter.userId === undefined || charge.userId === filter.userId,
    );
  }

  add(
    userId: string,
    options: { balanceMinor?: number; status?: Entities.Config.ChargeStatus } = {},
  ): EventChargeWithBalanceRecord {
    const balanceMinor = options.balanceMinor ?? 15000;
    const charge: EventChargeWithBalanceRecord = {
      id: `charge-${this.charges.length + 1}`,
      eventId: 'event-1',
      userId,
      description: EVENT_TITLE,
      amountMinor: 15000,
      currency: 'BRL',
      termsSource: ContractTermsSource.STANDARD,
      termsNote: '',
      dueDate: CHARGE_DUE,
      graceDays: CHARGE_GRACE,
      status: options.status ?? (balanceMinor > 0 ? ChargeStatus.OPEN : ChargeStatus.PAID),
      issuedBy: ADMIN,
      issuedAt: '2026-03-01T12:00:00.000Z',
      voidedAt: null,
      voidReason: null,
      balanceMinor,
    };
    this.charges.push(charge);
    return charge;
  }
}

describe('BillingService.runBillingCycle — the extras rail', () => {
  let repo: FakeBillingRepository;
  let charges: FakeChargeReader;
  let service: BillingService;
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

  function enlist(userId: string): void {
    directory.students.set(userId, {
      userId,
      name: `Student ${userId}`,
      email: `${userId}@dojo.test`,
    });
  }

  /** A monthly contract due on the 10th, 5 grace days, starting in January. */
  async function seedContract(userId = STUDENT) {
    enlist(userId);
    const plan = ok(
      await service.createPlan(
        { name: 'Monthly', amountMinor: 20000, currency: 'BRL', cycle: BillingCycle.MONTHLY, graceDays: 5 },
        ADMIN,
      ),
    );
    return ok(
      await service.signContract(
        { userId, planId: plan.id, dueDay: 10, startDate: '2026-01-01', termsSource: ContractTermsSource.STANDARD },
        ADMIN,
      ),
    );
  }

  /** One run per day over `[from, to]`, each with `since` = the previous day. */
  async function runDaily(from: string, to: string): Promise<BillingRunReport[]> {
    const reports: BillingRunReport[] = [];
    for (let day = from; day <= to; day = addDays(day, 1)) {
      reports.push(await run({ asOf: day }));
    }
    return reports;
  }

  beforeEach(() => {
    repo = new FakeBillingRepository();
    charges = new FakeChargeReader();
    service = new BillingService(repo, async () => true, charges);
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
  // Reminders
  // -------------------------------------------------------------------------

  describe('extras reminders', () => {
    it('sends exactly one extras_due_date and one extras_grace_lapsed over the span, each naming the event', async () => {
      enlist(BUYER);
      charges.add(BUYER);

      const reports = await runDaily('2026-03-01', '2026-03-31');
      const lines = reports.flatMap((report) => report.extrasReminders);

      expect(lines.map((line) => [line.kind, line.triggerOn])).toEqual([
        ['extras_due_date', CHARGE_DUE],
        ['extras_grace_lapsed', CHARGE_LAPSES],
      ]);
      expect(lines.every((line) => line.sent && line.description === EVENT_TITLE)).toBe(true);

      const student = mailer.to(`${BUYER}@dojo.test`);
      expect(student).toHaveLength(2);
      for (const message of student) {
        expect(message.subject).toContain(EVENT_TITLE);
        expect(message.text).toContain(EVENT_TITLE);
        expect(message.text).toContain('R$150.00');
        expect(`${message.subject} ${message.text}`.toLowerCase()).not.toContain('membership');
      }
      expect(student[0].text).toContain('is due today, 2026-03-10');
      expect(student[1].text).toContain('past its grace period');

      // Contract lines never carry an extras notice.
      expect(reports.flatMap((report) => report.reminders)).toHaveLength(0);

      const kinds = events()
        .filter((event) => event.event === 'billing.extras_reminder')
        .map((event) => event.kind);
      expect(kinds).toEqual(['extras_due_date', 'extras_grace_lapsed']);
    });

    it('still reminds a student whose contract is on hold', async () => {
      await seedContract(STUDENT);
      charges.add(STUDENT);
      await run({ asOf: '2026-03-01' });

      ok(await service.setHold(STUDENT, { reason: 'Agreed to pause the monthly fee.' }, ADMIN));

      const onDue = await run({ asOf: CHARGE_DUE, since: '2026-03-09' });

      // The contract notice for the same day is suppressed...
      expect(onDue.reminders).toHaveLength(1);
      expect(onDue.reminders[0]).toMatchObject({ kind: 'due_date', sent: false, suppressedByHold: true });
      // ...and the extras one is not.
      expect(onDue.extrasReminders).toHaveLength(1);
      expect(onDue.extrasReminders[0]).toMatchObject({ kind: 'extras_due_date', sent: true });
      expect(onDue.reminderCounts).toEqual({
        contract: { sent: 0, suppressed: 1, undeliverable: 0 },
        extras: { sent: 1, suppressed: 0, undeliverable: 0 },
      });

      const lapsed = await run({ asOf: CHARGE_LAPSES, since: '2026-03-13' });
      expect(lapsed.extrasReminders[0]).toMatchObject({ kind: 'extras_grace_lapsed', sent: true });

      const mail = mailer.to(`${STUDENT}@dojo.test`);
      expect(mail).toHaveLength(2);
      expect(mail.every((message) => message.subject.includes(EVENT_TITLE))).toBe(true);
    });

    it('sends nothing new when the same day is re-run', async () => {
      enlist(BUYER);
      charges.add(BUYER);

      const first = await run({ asOf: CHARGE_DUE });
      expect(first.extrasReminders).toHaveLength(1);

      const again = await run({ asOf: CHARGE_DUE, since: first.asOf });
      expect(again.extrasReminders).toHaveLength(0);
      expect(again.extrasCrossings).toHaveLength(0);
      expect(again.mailsSent).toBe(0);
      expect(mailer.to(`${BUYER}@dojo.test`)).toHaveLength(1);
    });

    it('skips a paid or voided charge', async () => {
      enlist(BUYER);
      charges.add(BUYER, { balanceMinor: 0 });
      charges.add(BUYER, { status: ChargeStatus.VOID });

      const report = await run({ asOf: CHARGE_DUE });
      expect(report.extrasReminders).toHaveLength(0);
      expect(report.extrasCrossings).toHaveLength(0);
      expect(mailer.sent).toHaveLength(0);
    });

    it('reports an extras notice with no address as undeliverable', async () => {
      charges.add(BUYER);

      const report = await run({ asOf: CHARGE_DUE });
      expect(report.extrasReminders[0]).toMatchObject({ sent: false });
      expect(report.reminderCounts.extras).toEqual({ sent: 0, suppressed: 0, undeliverable: 1 });
      expect(events().some((event) => event.event === 'billing.extras_reminder_undeliverable')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // The pay link (RFC 0026 §7, M30 Task 14) — one line, only when payable online
  // -------------------------------------------------------------------------

  describe('the pay link', () => {
    /** Walks March and returns the buyer's two extras notices. */
    async function twoNotices(currency = 'BRL'): Promise<MailMessage[]> {
      enlist(BUYER);
      charges.add(BUYER).currency = currency;
      await runDaily('2026-03-01', '2026-03-31');
      return mailer.to(`${BUYER}@dojo.test`);
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
      service = new BillingService(repo, async () => true, charges, statementPayLink(() => gateways.payOptions, WEB_BASE_URL));
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

    it('adds no line when no offered method settles the charge currency', async () => {
      offerPayments(stubPaymentsEnv('mercadopago:pix+card'));

      // Mercado Pago settles BRL only; the fake ledger has no USD symbol, hence "150.00".
      const notices = await twoNotices('USD');
      expect(notices).toHaveLength(2);
      for (const message of notices) {
        expect(message.text).not.toContain('settings/billing');
        expect(message.html).not.toContain('href=');
      }
    });

    it('drops the line, not the run, when the resolver throws', async () => {
      service = new BillingService(repo, async () => true, charges, () => {
        throw new Error('pay options unavailable');
      });

      expect(await twoNotices()).toEqual(TODAYS_NOTICES);
    });
  });

  // -------------------------------------------------------------------------
  // Crossings and the digest
  // -------------------------------------------------------------------------

  describe('per-rail crossings and the two-section digest', () => {
    it('lists an extras-only buyer under extras and never under the monthly fee', async () => {
      enlist(BUYER);
      charges.add(BUYER);

      const onDue = await run({ asOf: CHARGE_DUE });
      expect(onDue.crossings).toHaveLength(0);
      expect(onDue.extrasCrossings).toEqual([
        {
          userId: BUYER,
          from: BillingStanding.GOOD,
          to: BillingStanding.DUE,
          oldestOverdueDate: CHARGE_DUE,
          outstandingMinor: 15000,
          currency: 'BRL',
        },
      ]);

      const [digest] = mailer.to('sensei@dojo.test');
      const [contractSection, extrasSection] = digest.text.split('Crossed on extras:');
      expect(contractSection).toContain('Crossed on the monthly fee:');
      expect(contractSection).not.toContain(BUYER);
      expect(contractSection).toContain('(none)');
      expect(extrasSection).toContain(`${BUYER}: good -> due`);
      expect(digest.subject).toBe('1 student changed billing standing');

      const lapsed = await run({ asOf: CHARGE_LAPSES });
      expect(lapsed.extrasCrossings[0]).toMatchObject({
        from: BillingStanding.DUE,
        to: BillingStanding.DELINQUENT,
      });
    });

    it('lists a student in both sections when both rails cross, and a hold does not spare the extras one', async () => {
      await seedContract(STUDENT);
      charges.add(STUDENT);
      await run({ asOf: '2026-03-01' });

      const both = await run({ asOf: CHARGE_DUE, since: '2026-03-09' });
      expect(both.crossings.map((c) => c.userId)).toEqual([STUDENT]);
      expect(both.extrasCrossings.map((c) => c.userId)).toEqual([STUDENT]);
      expect(mailer.to('sensei@dojo.test')[0].subject).toBe('1 student changed billing standing');

      // Held: the student resolves `exempt` on the contract rail, yet the
      // charge still crosses into delinquent on the extras rail.
      ok(await service.setHold(STUDENT, { reason: 'Agreed.' }, ADMIN));
      const lapsed = await run({ asOf: CHARGE_LAPSES, since: '2026-03-13' });
      expect(lapsed.crossings).toHaveLength(0);
      expect(lapsed.extrasCrossings).toHaveLength(1);
      expect(lapsed.extrasCrossings[0].to).toBe(BillingStanding.DELINQUENT);
    });
  });

  // -------------------------------------------------------------------------
  // Writes no money — on either ledger
  // -------------------------------------------------------------------------

  it('reads the extras ledger once per run and logs zero charge rows written', async () => {
    enlist(BUYER);
    const charge = charges.add(BUYER);
    const snapshot = JSON.stringify(charges.charges);

    await run({ asOf: CHARGE_DUE });

    expect(charges.reads).toBe(1);
    expect(JSON.stringify(charges.charges)).toBe(snapshot);
    expect(charge.balanceMinor).toBe(15000);

    const [summary] = events().filter((event) => event.event === 'billing.invoice_run');
    expect(summary).toMatchObject({
      extrasRemindersSent: 1,
      extrasCrossings: 1,
      chargeRowsWritten: 0,
      adjustmentsWritten: 0,
    });
  });
});
