import type {
  IBillingRepository,
  BillingPlanRecord,
  BillingPlanFilter,
  UpdateBillingPlanInput,
  BillingStandingHoldRecord,
  CurrencyRecord,
  SubscriptionRecord,
  SubscriptionFilter,
  InvoiceRecord,
  InvoiceWithBalanceRecord,
  InvoiceFilter,
  InvoiceAdjustmentRecord,
  PaymentRecord,
  IMailer,
  MailMessage,
  IUserRepository,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { addDays, computePeriod, nextPeriod } from '@arenaquest/shared/domain/billing/billing-cycle';
import {
  resolveStanding,
  type StandingInvoice,
} from '@arenaquest/shared/domain/billing/standing-resolver';
import type { ControllerResult } from '@api/core/result';

/**
 * BillingService — the rules the schema cannot state (RFC 0013 §4).
 *
 * Pure orchestration over `IBillingRepository`: no D1 symbol, no Hono type, no
 * worker `env`. Four rules shape everything below.
 *
 * 1. **Snapshot, never join.** Signing copies the plan's `amountMinor`,
 *    `currency`, `cycle` and `graceDays` onto the subscription, and issuing an
 *    invoice copies the *subscription's* copy onto the invoice. The plan is a
 *    catalogue: editing it afterwards must leave every signed contract and
 *    every issued invoice byte-identical.
 * 2. **Append-only corrections.** Nothing here updates or deletes a `payments`
 *    or an `invoice_adjustments` row. Changing what a student owes is an
 *    adjustment; undoing a payment is a reversing row with a negative amount.
 * 3. **No automatic money.** The service accrues nothing — no interest, no
 *    percentage late fee, no daily incidence. `surcharge` is only ever written
 *    from an explicit admin request (RFC 0013 #8).
 * 4. **No access effect and no gateway.** Nothing here reads or writes an
 *    enrollment grant, and `method: 'gateway'` is an accepted input value and
 *    nothing more (RFC 0013 #9).
 *
 * Every mutation records the acting admin on the row (`signedBy`,
 * `recordedBy`, `appliedBy`) and emits one structured `billing.*` event, in the
 * shape `EnrollmentService` already established. Voiding is the exception that
 * proves the rule: `invoices` has no `voided_by` column by design, so the
 * acting admin for a void is carried by the audit event alone.
 */

const {
  ContractStatus,
  ContractTermsSource,
  InvoiceStatus,
  AdjustmentKind,
  BillingStanding,
  UserStatus,
} = Entities.Config;

/** The only date shape that crosses this module's boundary. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The only lifecycle transitions `PATCH /subscriptions/{id}` may request. */
export type LifecycleAction = 'pause' | 'resume' | 'cancel';

export interface CreatePlanCommand {
  name: string;
  description?: string;
  amountMinor: number;
  currency: string;
  cycle: Entities.Config.BillingCycle;
  graceDays: number;
  scopeTopicId?: string | null;
}

export interface SignContractCommand {
  userId: string;
  planId: string;
  dueDay: number;
  startDate: string;
  termsSource: Entities.Config.ContractTermsSource;
  /** Negotiated terms; for a standard contract they must match the plan. */
  amountMinor?: number;
  cycle?: Entities.Config.BillingCycle;
  graceDays?: number;
  /** Mandatory when `termsSource` is `negotiated`. */
  termsNote?: string;
}

export interface ChangeLifecycleCommand {
  action: LifecycleAction;
  /** Cancellation date; defaults to today. Ignored by pause and resume. */
  endDate?: string;
  /**
   * Terms are not changeable through the lifecycle endpoint. They are accepted
   * by the schema only so the refusal can name `/amend` instead of reading as a
   * generic "unrecognised field".
   */
  amountMinor?: number;
  cycle?: Entities.Config.BillingCycle;
  graceDays?: number;
  dueDay?: number;
}

export interface AmendContractCommand {
  startDate: string;
  termsNote: string;
  amountMinor?: number;
  cycle?: Entities.Config.BillingCycle;
  graceDays?: number;
  dueDay?: number;
  termsSource?: Entities.Config.ContractTermsSource;
}

export interface IssueInvoiceCommand {
  subscriptionId: string;
  /** Defaults to the contract's own period containing `referenceDate`. */
  periodStart?: string;
  periodEnd?: string;
  dueDate?: string;
  /** Defaults to the contract's snapshot amount. Zero is a legal invoice. */
  amountMinor?: number;
  /** Which period to bill when the dates are omitted; defaults to today. */
  referenceDate?: string;
}

export interface ApplyAdjustmentCommand {
  kind: Entities.Config.AdjustmentKind;
  /** Signed and never zero; negative reduces what is owed. */
  amountMinor: number;
  reason: string;
}

export interface RecordPaymentCommand {
  /** Strictly positive — a negative amount is a reversal, not a payment. */
  amountMinor: number;
  method: Entities.Config.PaymentMethod;
  paidAt?: string;
  currency?: string;
  externalReference?: string | null;
  note?: string;
}

export interface ReversePaymentCommand {
  reason: string;
  paidAt?: string;
}

/**
 * A student's standing, resolved rather than read (RFC 0013 §2).
 *
 * `asOf` travels with the answer because the answer is only true for that day:
 * a hold that expires tonight reports `exempt` today and the underlying
 * standing tomorrow, with nothing having run in between.
 */
export interface StandingSummary {
  userId: string;
  standing: Entities.Config.BillingStanding;
  /** Due date of the oldest unpaid invoice already past due; null if none is. */
  oldestOverdueDate: string | null;
  /** What is still owed. A hold never changes this. */
  outstandingMinor: number;
  /** The day the standing was resolved against — `YYYY-MM-DD`. */
  asOf: string;
}

/**
 * One line of the admin roster: a student with a contract, their standing and
 * what the front desk needs to act on it.
 *
 * `hold` is the stored row, expired or not; whether it is still in force is
 * `standing === 'exempt'` and nothing else — there is no second copy of that
 * decision here.
 */
export interface RosterEntry extends StandingSummary {
  /** The contract the other fields describe: the active one, else the newest. */
  contractId: string;
  contractGroupId: string;
  contractStatus: Entities.Config.ContractStatus;
  currency: string;
  /** The next due date of an active contract; null once it is not active. */
  nextDueDate: string | null;
  /** True when the contract's terms were negotiated rather than taken from the plan. */
  negotiatedTerms: boolean;
  hold: BillingStandingHoldRecord | null;
}

export interface RosterFilter {
  /** `exempt` is the held filter: a hold is the only way to reach it. */
  standing?: Entities.Config.BillingStanding;
  /** The day to resolve against; defaults to today. */
  asOf?: string;
}

export interface SetHoldCommand {
  /** Mandatory: a hold with no reason quietly becomes permanent. */
  reason: string;
  /** YYYY-MM-DD; omitted or null never expires. */
  expiresAt?: string | null;
}

/**
 * "Does this user exist?", injected rather than imported, in the shape
 * `AccountingService` already established. Setting a hold on an unknown id is
 * the only place billing needs to ask identity anything.
 */
export type StudentExistsProbe = (userId: string) => Promise<boolean>;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function isBlank(value: string | undefined | null): boolean {
  return value === undefined || value === null || value.trim() === '';
}

function badRequest(message: string): ControllerResult<never> {
  return { ok: false, status: 400, error: 'ValidationError', meta: { message } };
}

function notFound(message: string): ControllerResult<never> {
  return { ok: false, status: 404, error: 'NotFound', meta: { message } };
}

function conflict(message: string): ControllerResult<never> {
  return { ok: false, status: 409, error: 'Conflict', meta: { message } };
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

/**
 * Every invoice that still counts.
 *
 * A voided invoice is excluded — voiding is a decision rather than an
 * arithmetic outcome — and a settled one is left in, because `resolveStanding`
 * drops a non-positive balance itself. Filtering on `invoices.status = 'open'`
 * instead would make standing depend on a *cache* of the balance rather than on
 * the balance, which is the one thing this bounded context never does.
 */
function unvoided(invoices: InvoiceWithBalanceRecord[]): InvoiceWithBalanceRecord[] {
  return invoices.filter((invoice) => invoice.status !== InvoiceStatus.VOID);
}

/** The invoice reduced to the three columns standing depends on. */
function toStandingInvoice(invoice: InvoiceWithBalanceRecord): StandingInvoice {
  return {
    dueDate: invoice.dueDate,
    // The invoice's own snapshot — never the contract's or the plan's.
    graceDays: invoice.graceDays,
    balanceMinor: invoice.balanceMinor,
  };
}

/**
 * The version of a student's contract the roster describes: the active one, or
 * the newest version when the chain is paused, cancelled or superseded. A
 * student who cancelled last month still owes what they owe, so they stay on
 * the roster with their last contract's currency beside the balance.
 */
function currentContract(contracts: SubscriptionRecord[]): SubscriptionRecord {
  const active = contracts.find((contract) => contract.status === ContractStatus.ACTIVE);
  if (active) return active;

  return contracts.reduce((newest, contract) =>
    contract.startDate > newest.startDate ||
    (contract.startDate === newest.startDate && contract.signedAt > newest.signedAt)
      ? contract
      : newest,
  );
}

/**
 * The next date this contract falls due, derived from the cycle rather than
 * from a stored column.
 *
 * Only an active contract has one: a paused or cancelled contract bills
 * nothing, and answering with a date would put a demand on the roster for money
 * that will never be invoiced.
 *
 * A contract row carrying a date or a `dueDay` the calendar cannot honour makes
 * `computePeriod` throw. That is one bad row, and it must not take the whole
 * roster down with it — the entry is reported with no next due date instead.
 */
function nextDueDateOf(contract: SubscriptionRecord, asOf: string): string | null {
  if (contract.status !== ContractStatus.ACTIVE) return null;

  try {
    const period = computePeriod(contract.cycle, contract.startDate, contract.dueDay, asOf);
    if (period.dueDate >= asOf) return period.dueDate;
    return nextPeriod(contract.cycle, contract.startDate, contract.dueDay, period).dueDate;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The daily run (RFC 0013 §6)
//
// One routine, two callers: the `scheduled` handler in `src/index.ts` and
// `POST /v1/admin/billing/invoices/run`. Never two implementations — a manual
// twin that drifts from the cron path is the failure this shape exists to make
// impossible.
//
// Four rules the run is written to keep, each of which is a way it could lie:
//
// 1. **It writes no money.** The run issues invoices and sends mail. It writes
//    no `invoice_adjustments` row of any kind, `surcharge` included: nothing
//    accrues interest, a percentage, a cap or a daily incidence (RFC 0013 #8).
//    `applyAdjustment` is not reachable from anything below.
// 2. **Idempotent by construction.** Issuance leans on
//    `UNIQUE (subscription_id, period_start)` rather than on the job having run
//    exactly once, so a retry is a no-op that reports its duplicates as
//    *absorbed* instead of failing.
// 3. **Crossings, not a standing list, and no `last_alerted` column.** What is
//    news is derived by resolving each student's standing twice — once at the
//    previous run's day, once at this one's — and reporting only the movement
//    between them. There is no per-student column to keep in sync, nothing to
//    backfill, and a run told the previous run was today reports nobody.
// 4. **Assert, do not repair.** The balance-versus-cached-status check logs and
//    returns. Rewriting a drifted `invoices.status` would hide the bug that
//    caused the drift.
// ---------------------------------------------------------------------------

/** Who a reminder or a digest is addressed to. */
export interface BillingRecipient {
  userId: string;
  name: string;
  email: string;
}

/**
 * The one thing the run asks identity: an address to mail.
 *
 * Injected rather than imported, in the shape `StudentExistsProbe` already
 * established, so `BillingService` still holds no `IUserRepository` and a
 * node-pool spec can hand it two arrays.
 */
export interface BillingDirectory {
  /** The student's contact details, or `null` when the account is gone. */
  findRecipient(userId: string): Promise<BillingRecipient | null>;
  /** Everyone who should receive the admin digest. */
  listAdmins(): Promise<BillingRecipient[]>;
}

/** Everything the run needs that is not persistence. */
export interface BillingRunDeps {
  mailer: IMailer;
  directory: BillingDirectory;
}

/**
 * The window a run covers, as two `YYYY-MM-DD` days.
 *
 * `since` is **the previous run's day**, and the window is half-open —
 * `(since, asOf]`. That is the whole of "since the previous run": a daily cron
 * walks disjoint one-day windows, so every reminder and every crossing falls
 * inside exactly one of them and fires exactly once, with no `last_sent` and no
 * `last_alerted` column to drift. A caller that re-runs a day it has already
 * run passes `since = asOf` and the window is empty.
 */
export interface BillingRunOptions {
  /** The day to bill and resolve against; defaults to today. */
  asOf?: string;
  /** The previous run's day; defaults to the day before `asOf`. */
  since?: string;
}

/** The two student notices. There is no sequence and no third (RFC Non-Goal). */
export type BillingReminderKind = 'due_date' | 'grace_lapsed';

export interface IssuedInvoiceLine {
  invoiceId: string;
  subscriptionId: string;
  userId: string;
  periodStart: string;
  dueDate: string;
  amountMinor: number;
  currency: string;
  /** `paid` already for a free contract's zero-amount invoice. */
  status: Entities.Config.InvoiceStatus;
}

export interface ReminderLine {
  invoiceId: string;
  userId: string;
  kind: BillingReminderKind;
  dueDate: string;
  /** The day the notice is owed — inside `(since, asOf]` or it is not here. */
  triggerOn: string;
  balanceMinor: number;
  currency: string;
  /** False when a hold suppressed it, or when no address could be resolved. */
  sent: boolean;
  /** True when a hold is what kept it quiet. */
  suppressedByHold: boolean;
}

/** One student who moved into `due` or `delinquent` since the previous run. */
export interface StandingCrossingLine {
  userId: string;
  from: Entities.Config.BillingStanding;
  to: Entities.Config.BillingStanding;
  oldestOverdueDate: string | null;
  /** Unchanged by a hold, here as everywhere else. */
  outstandingMinor: number;
  currency: string;
}

/** A cached `invoices.status` that disagrees with the recomputed balance. */
export interface StatusDivergenceLine {
  invoiceId: string;
  userId: string;
  cachedStatus: Entities.Config.InvoiceStatus;
  expectedStatus: Entities.Config.InvoiceStatus;
  balanceMinor: number;
}

/**
 * What one run did — the body of `POST /invoices/run` and the shape the cron
 * logs. Every number here is reported; none of it is persisted.
 */
export interface BillingRunReport {
  asOf: string;
  since: string;
  /** Contracts the run considered: `active`, started, not past their end date. */
  eligibleContracts: number;
  issued: IssuedInvoiceLine[];
  /**
   * Eligible contracts whose period already had an invoice. A second run for
   * one period reports every invoice here and creates none — the retry is a
   * no-op rather than a failure.
   */
  absorbed: number;
  reminders: ReminderLine[];
  crossings: StandingCrossingLine[];
  /** Students a hold kept out of the mail and out of the digest. */
  suppressedByHold: Array<{ userId: string; outstandingMinor: number }>;
  divergences: StatusDivergenceLine[];
  /** Messages actually handed to `IMailer`, students and admins together. */
  mailsSent: number;
  adminsNotified: number;
}

/** The actor recorded on an audit line the cron emitted rather than a person. */
export const SCHEDULED_BILLING_ACTOR = 'system:scheduled';

/**
 * A hold is in force on `day` when it exists and has not expired. The same
 * comparison `resolveStanding` makes, applied where mail is suppressed rather
 * than where a label is chosen.
 */
function holdInForce(hold: BillingStandingHoldRecord | undefined, day: string): boolean {
  return hold !== undefined && (hold.expiresAt === null || hold.expiresAt >= day);
}

/**
 * Renders a minor-unit amount for an **email**.
 *
 * The reports never format — they ship integers and the currency's exponent so
 * the client can. A message to a human is the exception: "R$150.00" is the only
 * thing that can be written in a sentence.
 */
function formatAmount(amountMinor: number, currency: CurrencyRecord | null): string {
  const exponent = currency?.exponent ?? 2;
  const symbol = currency?.symbol ?? '';
  const sign = amountMinor < 0 ? '-' : '';
  return `${sign}${symbol}${(Math.abs(amountMinor) / 10 ** exponent).toFixed(exponent)}`;
}

/** The plain-text half of a message, mirrored into minimal HTML. */
function asHtml(lines: string[]): string {
  const escape = (line: string): string =>
    line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  return `<p>${lines.map(escape).join('<br />')}</p>`;
}

export class BillingService {
  constructor(
    private readonly repo: IBillingRepository,
    /**
     * Only `setHold` asks. It defaults to "yes" so every existing caller and
     * every spec that constructs the service with a repository alone keeps
     * working; the container passes the real probe.
     */
    private readonly studentExists: StudentExistsProbe = async () => true,
  ) {}

  // -------------------------------------------------------------------------
  // Plans — the catalogue
  // -------------------------------------------------------------------------

  async listPlans(filter: BillingPlanFilter = {}): Promise<ControllerResult<BillingPlanRecord[]>> {
    return { ok: true, data: await this.repo.listPlans(filter) };
  }

  async getPlan(id: string): Promise<ControllerResult<BillingPlanRecord>> {
    const plan = await this.repo.getPlan(id);
    if (!plan) return notFound('plan not found');
    return { ok: true, data: plan };
  }

  async createPlan(
    input: CreatePlanCommand,
    actorId: string,
  ): Promise<ControllerResult<BillingPlanRecord>> {
    // The `currencies` table is the source of truth, not a constant in this
    // file: RFC 0013 §1 has an unknown code "rejected by the database rather
    // than by convention", and decision #13 makes adding a currency a
    // `wrangler d1 execute` rather than a deploy. Reading the row keeps both
    // true — a code inserted by SQL is accepted here the moment it lands —
    // while still turning an unknown one into a clean `400` rather than a
    // raised foreign-key error.
    if (!(await this.repo.getCurrency(input.currency))) {
      return badRequest(`unknown currency "${input.currency}"`);
    }

    const plan = await this.repo.createPlan(input);
    this.audit('billing.create_plan', actorId, { planId: plan.id, currency: plan.currency });
    return { ok: true, data: plan };
  }

  /**
   * The shelf is freely editable precisely because nothing reads it once a
   * contract has copied it — which is why `currency` is absent from
   * `UpdateBillingPlanInput` and cannot be patched here either.
   */
  async updatePlan(
    id: string,
    patch: UpdateBillingPlanInput,
    actorId: string,
  ): Promise<ControllerResult<BillingPlanRecord>> {
    const updated = await this.repo.updatePlan(id, patch);
    if (!updated) return notFound('plan not found');

    this.audit('billing.update_plan', actorId, { planId: updated.id });
    return { ok: true, data: updated };
  }

  // -------------------------------------------------------------------------
  // Contracts
  // -------------------------------------------------------------------------

  async listSubscriptions(
    filter: SubscriptionFilter = {},
  ): Promise<ControllerResult<SubscriptionRecord[]>> {
    return { ok: true, data: await this.repo.listSubscriptions(filter) };
  }

  async getSubscription(id: string): Promise<ControllerResult<SubscriptionRecord>> {
    const subscription = await this.repo.getSubscription(id);
    if (!subscription) return notFound('subscription not found');
    return { ok: true, data: subscription };
  }

  /**
   * Signs a contract, snapshotting the plan's terms onto it.
   *
   * A negotiated contract is the same call with overridden terms, a
   * `termsSource` of `negotiated` and a mandatory reason. A *standard* contract
   * may not carry an override: silently dropping one would leave the admin
   * believing a price they typed had been agreed.
   */
  async signContract(
    input: SignContractCommand,
    actorId: string,
  ): Promise<ControllerResult<SubscriptionRecord>> {
    const plan = await this.repo.getPlan(input.planId);
    if (!plan) return notFound('plan not found');

    const negotiated = input.termsSource === ContractTermsSource.NEGOTIATED;

    if (negotiated && isBlank(input.termsNote)) {
      return badRequest('a negotiated contract requires termsNote explaining why the terms differ');
    }

    if (!negotiated) {
      const overridden =
        (input.amountMinor !== undefined && input.amountMinor !== plan.amountMinor) ||
        (input.cycle !== undefined && input.cycle !== plan.cycle) ||
        (input.graceDays !== undefined && input.graceDays !== plan.graceDays);
      if (overridden) {
        return badRequest(
          "terms differing from the plan require termsSource 'negotiated' and a termsNote",
        );
      }
    }

    // The partial unique index is the second line of defence, not the first:
    // a clean conflict beats a surfaced constraint error.
    const active = await this.repo.getActiveSubscription(input.userId);
    if (active) return conflict('the student already has an active contract');

    const subscription = await this.repo.createSubscription({
      userId: input.userId,
      planId: plan.id,
      // The snapshot. Currency is never overridable — re-denominating is not a
      // negotiation, it is a different contract.
      amountMinor: negotiated ? (input.amountMinor ?? plan.amountMinor) : plan.amountMinor,
      currency: plan.currency,
      cycle: negotiated ? (input.cycle ?? plan.cycle) : plan.cycle,
      graceDays: negotiated ? (input.graceDays ?? plan.graceDays) : plan.graceDays,
      dueDay: input.dueDay,
      termsSource: input.termsSource,
      startDate: input.startDate,
      termsNote: input.termsNote ?? '',
      signedBy: actorId,
    });

    this.audit('billing.sign_contract', actorId, {
      userId: subscription.userId,
      subscriptionId: subscription.id,
      contractGroupId: subscription.contractGroupId,
      termsSource: subscription.termsSource,
    });

    return { ok: true, data: subscription };
  }

  /**
   * Pause, resume or cancel — and nothing else. Terms move only through
   * `amendContract`, which supersedes rather than edits.
   */
  async changeLifecycle(
    id: string,
    command: ChangeLifecycleCommand,
    actorId: string,
  ): Promise<ControllerResult<SubscriptionRecord>> {
    const attemptedTerms =
      command.amountMinor !== undefined ||
      command.cycle !== undefined ||
      command.graceDays !== undefined ||
      command.dueDay !== undefined;
    if (attemptedTerms) {
      return badRequest(
        'this endpoint changes the lifecycle only; amend the contract at POST /subscriptions/{id}/amend to change its terms',
      );
    }

    const subscription = await this.repo.getSubscription(id);
    if (!subscription) return notFound('subscription not found');

    const { action } = command;

    if (action === 'pause' && subscription.status !== ContractStatus.ACTIVE) {
      return conflict('only an active contract can be paused');
    }
    if (action === 'resume' && subscription.status !== ContractStatus.PAUSED) {
      return conflict('only a paused contract can be resumed');
    }
    if (
      action === 'cancel' &&
      subscription.status !== ContractStatus.ACTIVE &&
      subscription.status !== ContractStatus.PAUSED
    ) {
      return conflict('only a live contract can be cancelled');
    }

    const nextStatus =
      action === 'pause'
        ? ContractStatus.PAUSED
        : action === 'resume'
          ? ContractStatus.ACTIVE
          : ContractStatus.CANCELLED;

    // Cancelling closes the contract; resuming reopens one that was never
    // closed, so `endDate` is left exactly as it was for pause and resume.
    const endDate = action === 'cancel' ? (command.endDate ?? today()) : undefined;

    const updated = await this.repo.updateSubscriptionStatus(id, nextStatus, endDate);
    if (!updated) return notFound('subscription not found');

    this.audit('billing.change_lifecycle', actorId, {
      userId: updated.userId,
      subscriptionId: updated.id,
      action,
      status: updated.status,
      endDate: updated.endDate,
    });

    return { ok: true, data: updated };
  }

  /**
   * Renegotiation: the live version closes to `superseded` with its `endDate`
   * set and one new `active` row opens carrying `supersedesId` and the same
   * `contractGroupId`. Amending anything but the live version is refused here
   * rather than at `idx_subscriptions_one_successor`.
   */
  async amendContract(
    id: string,
    command: AmendContractCommand,
    actorId: string,
  ): Promise<ControllerResult<SubscriptionRecord>> {
    if (isBlank(command.termsNote)) {
      return badRequest('an amendment requires termsNote explaining the renegotiation');
    }

    const current = await this.repo.getSubscription(id);
    if (!current) return notFound('subscription not found');
    if (current.status !== ContractStatus.ACTIVE) {
      return conflict(
        `only the active version of a contract can be amended; this one is "${current.status}"`,
      );
    }

    const amended = await this.repo.amendSubscription({
      subscriptionId: id,
      amountMinor: command.amountMinor,
      cycle: command.cycle,
      graceDays: command.graceDays,
      dueDay: command.dueDay,
      termsSource: command.termsSource,
      startDate: command.startDate,
      termsNote: command.termsNote,
      signedBy: actorId,
    });

    this.audit('billing.amend_contract', actorId, {
      userId: amended.userId,
      subscriptionId: amended.id,
      supersedesId: amended.supersedesId,
      contractGroupId: amended.contractGroupId,
    });

    return { ok: true, data: amended };
  }

  // -------------------------------------------------------------------------
  // Invoices
  // -------------------------------------------------------------------------

  async listInvoices(filter: InvoiceFilter): Promise<ControllerResult<InvoiceWithBalanceRecord[]>> {
    return { ok: true, data: await this.repo.listInvoices(filter) };
  }

  async getInvoice(id: string): Promise<ControllerResult<InvoiceWithBalanceRecord>> {
    const invoice = await this.repo.getInvoice(id);
    if (!invoice) return notFound('invoice not found');
    return { ok: true, data: invoice };
  }

  /**
   * Issues one invoice by hand, snapshotting the **contract's** terms — never
   * the plan's, which may have moved since the signature.
   */
  async issueAdHocInvoice(
    command: IssueInvoiceCommand,
    actorId: string,
  ): Promise<ControllerResult<InvoiceRecord>> {
    const subscription = await this.repo.getSubscription(command.subscriptionId);
    if (!subscription) return notFound('subscription not found');

    if (
      subscription.status === ContractStatus.CANCELLED ||
      subscription.status === ContractStatus.SUPERSEDED
    ) {
      return conflict(`a "${subscription.status}" contract cannot be billed`);
    }

    const period = computePeriod(
      subscription.cycle,
      subscription.startDate,
      subscription.dueDay,
      command.referenceDate ?? today(),
    );

    const periodStart = command.periodStart ?? period.periodStart;
    const periodEnd = command.periodEnd ?? period.periodEnd;
    const dueDate = command.dueDate ?? period.dueDate;

    if (periodEnd <= periodStart) {
      return badRequest('periodEnd must be after periodStart');
    }

    const amountMinor = command.amountMinor ?? subscription.amountMinor;
    if (amountMinor < 0) return badRequest('amountMinor must be zero or positive');

    // `UNIQUE (subscription_id, period_start)` is what makes the monthly run
    // idempotent; hitting it from here would surface as a constraint error.
    const existing = await this.repo.listInvoices({ subscriptionId: subscription.id });
    if (existing.some((invoice) => invoice.periodStart === periodStart)) {
      return conflict(`the contract already has an invoice for the period starting ${periodStart}`);
    }

    const invoice = await this.repo.createInvoice({
      subscriptionId: subscription.id,
      userId: subscription.userId,
      periodStart,
      periodEnd,
      dueDate,
      amountMinor,
      // The contract's snapshot, copied forward. `resolveStanding` reads the
      // invoice's own `graceDays`, so it must be the one in force at issue.
      currency: subscription.currency,
      graceDays: subscription.graceDays,
    });

    this.audit('billing.issue_invoice', actorId, {
      userId: invoice.userId,
      subscriptionId: invoice.subscriptionId,
      invoiceId: invoice.id,
      amountMinor: invoice.amountMinor,
      currency: invoice.currency,
    });

    return { ok: true, data: invoice };
  }

  /**
   * Voiding demands a reason. The acting admin is not persisted: `invoices` has
   * `voided_at` and `void_reason` and no `voided_by` column by design, so the
   * actor lives in the audit event below and nowhere else.
   */
  async voidInvoice(
    id: string,
    reason: string,
    actorId: string,
  ): Promise<ControllerResult<InvoiceRecord>> {
    if (isBlank(reason)) return badRequest('voiding an invoice requires a reason');

    const invoice = await this.repo.getInvoice(id);
    if (!invoice) return notFound('invoice not found');
    if (invoice.status === InvoiceStatus.VOID) return conflict('the invoice is already void');

    const voided = await this.repo.voidInvoice(id, reason.trim(), actorId);
    if (!voided) return notFound('invoice not found');

    this.audit('billing.void_invoice', actorId, {
      userId: voided.userId,
      invoiceId: voided.id,
      reason: voided.voidReason,
    });

    return { ok: true, data: voided };
  }

  // -------------------------------------------------------------------------
  // Ledger — append-only on both tables
  // -------------------------------------------------------------------------

  /**
   * Appends a signed override. Negative reduces what is owed; `surcharge` is
   * written here and only here, from an explicit admin request — nothing in
   * this service accrues one.
   */
  async applyAdjustment(
    invoiceId: string,
    command: ApplyAdjustmentCommand,
    actorId: string,
  ): Promise<ControllerResult<InvoiceAdjustmentRecord>> {
    if (command.amountMinor === 0) {
      return badRequest('an adjustment amount must not be zero');
    }
    if (isBlank(command.reason)) {
      return badRequest('an adjustment requires a reason');
    }

    const invoice = await this.repo.getInvoice(invoiceId);
    if (!invoice) return notFound('invoice not found');
    if (invoice.status === InvoiceStatus.VOID) {
      return conflict('a void invoice cannot be adjusted');
    }

    const adjustment = await this.repo.applyAdjustment({
      invoiceId,
      kind: command.kind,
      amountMinor: command.amountMinor,
      reason: command.reason.trim(),
      appliedBy: actorId,
    });

    this.audit('billing.apply_adjustment', actorId, {
      userId: invoice.userId,
      invoiceId,
      adjustmentId: adjustment.id,
      kind: adjustment.kind,
      amountMinor: adjustment.amountMinor,
      // Every kind is applied by hand; this flag exists so an audit reader can
      // answer "did anything ever accrue a fee?" with a grep.
      manual: true,
      surcharge: adjustment.kind === AdjustmentKind.SURCHARGE,
    });

    return { ok: true, data: adjustment };
  }

  /** Records money received. A payment against a voided invoice is refused. */
  async recordPayment(
    invoiceId: string,
    command: RecordPaymentCommand,
    actorId: string,
  ): Promise<ControllerResult<PaymentRecord>> {
    if (command.amountMinor <= 0) {
      return badRequest('a payment amount must be positive; undo a payment with a reversal');
    }

    const invoice = await this.repo.getInvoice(invoiceId);
    if (!invoice) return notFound('invoice not found');
    if (invoice.status === InvoiceStatus.VOID) {
      return conflict('a void invoice cannot receive a payment');
    }

    if (command.currency !== undefined && command.currency !== invoice.currency) {
      return badRequest(
        `the payment currency "${command.currency}" differs from the invoice currency "${invoice.currency}"`,
      );
    }

    const payment = await this.repo.recordPayment({
      invoiceId,
      amountMinor: command.amountMinor,
      currency: invoice.currency,
      method: command.method,
      paidAt: command.paidAt ?? today(),
      externalReference: command.externalReference ?? null,
      note: command.note ?? '',
      reversesId: null,
      recordedBy: actorId,
    });

    this.audit('billing.record_payment', actorId, {
      userId: invoice.userId,
      invoiceId,
      paymentId: payment.id,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      method: payment.method,
    });

    return { ok: true, data: payment };
  }

  /**
   * Undoes a payment by **appending** its mirror image: a row with the negated
   * amount and `reversesId` set. The original is never updated and never
   * deleted, so the invoice's history still shows the money arriving and
   * leaving. `idx_payments_one_reversal` backs the conflict below up.
   */
  async reversePayment(
    paymentId: string,
    command: ReversePaymentCommand,
    actorId: string,
  ): Promise<ControllerResult<PaymentRecord>> {
    if (isBlank(command.reason)) {
      return badRequest('a reversal requires a reason');
    }

    const original = await this.repo.getPayment(paymentId);
    if (!original) return notFound('payment not found');
    if (original.reversesId !== null) {
      return conflict('a reversal cannot itself be reversed');
    }

    const ledger = await this.repo.listLedger({ invoiceId: original.invoiceId });
    const alreadyReversed = ledger.some(
      (entry) => entry.entry === 'payment' && entry.payment.reversesId === paymentId,
    );
    if (alreadyReversed) return conflict('the payment has already been reversed');

    const reversal = await this.repo.recordPayment({
      invoiceId: original.invoiceId,
      amountMinor: -original.amountMinor,
      currency: original.currency,
      method: original.method,
      paidAt: command.paidAt ?? today(),
      externalReference: original.externalReference,
      note: command.reason.trim(),
      reversesId: original.id,
      recordedBy: actorId,
    });

    this.audit('billing.reverse_payment', actorId, {
      invoiceId: original.invoiceId,
      paymentId: reversal.id,
      reversesId: original.id,
      amountMinor: reversal.amountMinor,
      reason: reversal.note,
    });

    return { ok: true, data: reversal };
  }

  // -------------------------------------------------------------------------
  // Standing, the roster and holds (RFC 0013 §2)
  //
  // Standing is **resolved, never stored**: there is no standing column, no
  // cached value and no job that writes one. It is also **reported, never
  // enforced** — nothing below reads or writes an enrollment grant, and no
  // caller of these methods is a guard. A student sitting `delinquent` keeps
  // exactly the access they had the day before.
  // -------------------------------------------------------------------------

  /** One student's standing, resolved from their rows and a calendar date. */
  async getStanding(userId: string, asOf?: string): Promise<ControllerResult<StandingSummary>> {
    const day = asOf ?? today();

    const [invoices, hold] = await Promise.all([
      this.repo.listInvoices({ userId }),
      this.repo.getHold(userId),
    ]);

    return {
      ok: true,
      data: {
        userId,
        asOf: day,
        ...resolveStanding({
          openInvoices: unvoided(invoices).map(toStandingInvoice),
          hold: hold ? { expiresAt: hold.expiresAt } : null,
          today: day,
        }),
      },
    };
  }

  /**
   * Every student with a contract, with their standing resolved.
   *
   * **Three aggregate reads, not three per student.** This is the everyday
   * admin screen and it lists the whole dojo, so the invoices, the contracts
   * and the holds are each fetched **once** and joined in memory. Calling
   * `getStanding` in a loop here would issue two queries per student and is
   * exactly the regression the roster's query-count test exists to catch.
   */
  async listStudentRoster(filter: RosterFilter = {}): Promise<ControllerResult<RosterEntry[]>> {
    const asOf = filter.asOf ?? today();

    const [subscriptions, invoices, holds] = await Promise.all([
      this.repo.listSubscriptions({}),
      this.repo.listInvoices({}),
      this.repo.listHolds(),
    ]);

    const invoicesByUser = new Map<string, InvoiceWithBalanceRecord[]>();
    for (const invoice of unvoided(invoices)) push(invoicesByUser, invoice.userId, invoice);

    const contractsByUser = new Map<string, SubscriptionRecord[]>();
    for (const contract of subscriptions) push(contractsByUser, contract.userId, contract);

    const holdByUser = new Map(holds.map((hold) => [hold.userId, hold]));

    const entries: RosterEntry[] = [];
    for (const [userId, contracts] of contractsByUser) {
      const contract = currentContract(contracts);
      const hold = holdByUser.get(userId) ?? null;

      // The same pure function the statement and the reminder run call. An
      // expired hold is dropped here by comparing it against `asOf` — no
      // cleanup job ever deletes the row, and none needs to.
      const resolved = resolveStanding({
        openInvoices: (invoicesByUser.get(userId) ?? []).map(toStandingInvoice),
        hold: hold ? { expiresAt: hold.expiresAt } : null,
        today: asOf,
      });

      entries.push({
        userId,
        asOf,
        ...resolved,
        contractId: contract.id,
        contractGroupId: contract.contractGroupId,
        contractStatus: contract.status,
        currency: contract.currency,
        nextDueDate: nextDueDateOf(contract, asOf),
        negotiatedTerms: contract.termsSource === ContractTermsSource.NEGOTIATED,
        hold,
      });
    }

    const filtered =
      filter.standing === undefined
        ? entries
        : entries.filter((entry) => entry.standing === filter.standing);

    // Largest debt first — the order the screen is read in — and by id inside a
    // tie so the listing is stable between two identical requests.
    filtered.sort(
      (a, b) =>
        b.outstandingMinor - a.outstandingMinor || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
    );

    return { ok: true, data: filtered };
  }

  /**
   * "Stop chasing this one."
   *
   * A hold suppresses an alert, never a permission and never a total: it moves
   * the *reported* standing to `exempt` and takes the student out of the
   * delinquency listing and the reminder mail. Their balance is untouched, and
   * still appears in the movement report, the aging report and their statement.
   *
   * The reason and the acting admin are mandatory so a hold meant for a month
   * cannot quietly become permanent, and `expiresAt` needs nothing to run: the
   * day after it passes, `resolveStanding` reports the underlying standing
   * again from the same unchanged row.
   */
  async setHold(
    userId: string,
    command: SetHoldCommand,
    actorId: string,
  ): Promise<ControllerResult<BillingStandingHoldRecord>> {
    if (isBlank(command.reason)) {
      return badRequest('a standing hold requires a reason');
    }
    if (!(await this.studentExists(userId))) return notFound('student not found');

    const hold = await this.repo.setHold({
      userId,
      reason: command.reason.trim(),
      expiresAt: command.expiresAt ?? null,
      setBy: actorId,
    });

    this.audit('billing.set_hold', actorId, {
      userId: hold.userId,
      reason: hold.reason,
      expiresAt: hold.expiresAt,
    });

    return { ok: true, data: hold };
  }

  /** Removes the hold. The debt it was hiding from the listing was never touched. */
  async clearHold(userId: string, actorId: string): Promise<ControllerResult<null>> {
    const existing = await this.repo.getHold(userId);
    if (!existing) return notFound('no standing hold is set for this student');

    await this.repo.clearHold(userId);

    this.audit('billing.clear_hold', actorId, {
      userId,
      reason: existing.reason,
      expiresAt: existing.expiresAt,
    });

    return { ok: true, data: null };
  }

  // -------------------------------------------------------------------------
  // The daily run (RFC 0013 §6)
  //
  // The cron calls this; `POST /v1/admin/billing/invoices/run` calls this. One
  // routine, two callers.
  // -------------------------------------------------------------------------

  /**
   * Issues, reminds, digests and asserts — in that order, for one day.
   *
   * It writes exactly one kind of row: an `invoices` row for a period that had
   * none. No payment, no adjustment, no status repair and no hold.
   */
  async runBillingCycle(
    deps: BillingRunDeps,
    options: BillingRunOptions = {},
    actorId: string = SCHEDULED_BILLING_ACTOR,
  ): Promise<ControllerResult<BillingRunReport>> {
    const asOf = options.asOf ?? today();
    if (!ISO_DAY.test(asOf)) return badRequest('asOf must be a YYYY-MM-DD date');

    const since = options.since ?? addDays(asOf, -1);
    if (!ISO_DAY.test(since)) return badRequest('since must be a YYYY-MM-DD date');
    if (since > asOf) return badRequest('since must not be after asOf');

    // --- 1. Issue ----------------------------------------------------------
    //
    // The status filter is the whole of "a `paused` contract is skipped here
    // and nowhere else": it never reaches issuance, and every step below reads
    // invoices rather than contracts, so its already-open invoices keep their
    // due dates and still count in the roster, the totals and the aging report.
    const eligible = (await this.repo.listSubscriptions({ status: ContractStatus.ACTIVE })).filter(
      (contract) =>
        contract.startDate <= asOf && (contract.endDate === null || contract.endDate > asOf),
    );

    // Idempotency is the database's, not this function's:
    // `UNIQUE (subscription_id, period_start)` decides, and the adapter returns
    // only the rows it actually created. Whatever it did not create was already
    // there — absorbed, not failed.
    const created = await this.repo.issueInvoices({ referenceDate: asOf });
    const issued: IssuedInvoiceLine[] = created.map((invoice) => ({
      invoiceId: invoice.id,
      subscriptionId: invoice.subscriptionId,
      userId: invoice.userId,
      periodStart: invoice.periodStart,
      dueDate: invoice.dueDate,
      amountMinor: invoice.amountMinor,
      currency: invoice.currency,
      // A free contract's zero-amount invoice arrives `paid` already, settled
      // by the balance rather than by a payment row this run did not write.
      status: invoice.status,
    }));
    const absorbed = Math.max(0, eligible.length - created.length);

    // --- State, read once --------------------------------------------------
    const [allInvoices, holds, currencies] = await Promise.all([
      this.repo.listInvoices({}),
      this.repo.listHolds(),
      this.repo.listCurrencies(),
    ]);

    const currencyOf = new Map(currencies.map((currency) => [currency.code, currency]));
    const holdByUser = new Map(holds.map((hold) => [hold.userId, hold]));

    // --- 2. Assert the balance cache — log, never repair --------------------
    const divergences: StatusDivergenceLine[] = [];
    for (const invoice of allInvoices) {
      // Voiding is a decision rather than an arithmetic outcome, so a void
      // invoice's status is not a cache of anything and cannot diverge.
      if (invoice.status === InvoiceStatus.VOID) continue;

      const expectedStatus =
        invoice.balanceMinor <= 0 ? InvoiceStatus.PAID : InvoiceStatus.OPEN;
      if (invoice.status === expectedStatus) continue;

      const divergence: StatusDivergenceLine = {
        invoiceId: invoice.id,
        userId: invoice.userId,
        cachedStatus: invoice.status,
        expectedStatus,
        balanceMinor: invoice.balanceMinor,
      };
      divergences.push(divergence);

      // Reported and left alone. A silent repair here would erase the evidence
      // of whatever wrote the wrong status in the first place.
      this.audit('billing.status_divergence', actorId, { ...divergence, asOf, repaired: false });
    }

    // --- 3. Remind the student ---------------------------------------------
    const recipients = new Map<string, BillingRecipient | null>();
    const recipientOf = async (userId: string): Promise<BillingRecipient | null> => {
      if (!recipients.has(userId)) {
        recipients.set(userId, await deps.directory.findRecipient(userId));
      }
      return recipients.get(userId) ?? null;
    };

    const reminders: ReminderLine[] = [];
    let mailsSent = 0;

    for (const invoice of unvoided(allInvoices).filter((i) => i.balanceMinor > 0)) {
      const triggers: Array<[BillingReminderKind, string]> = [
        ['due_date', invoice.dueDate],
        // The first day the invoice is late: `resolveStanding` counts the last
        // day of grace as still `due`, so grace lapses the day after it.
        ['grace_lapsed', addDays(invoice.dueDate, invoice.graceDays + 1)],
      ];

      for (const [kind, triggerOn] of triggers) {
        // Derived from the invoice's own dates against the window, so the
        // notice fires on exactly one run of a daily chain and needs no
        // `last_sent` column to remember that it did.
        if (triggerOn <= since || triggerOn > asOf) continue;

        const held = holdInForce(holdByUser.get(invoice.userId), asOf);
        const line: ReminderLine = {
          invoiceId: invoice.id,
          userId: invoice.userId,
          kind,
          dueDate: invoice.dueDate,
          triggerOn,
          balanceMinor: invoice.balanceMinor,
          currency: invoice.currency,
          sent: false,
          suppressedByHold: held,
        };
        reminders.push(line);

        if (held) {
          this.audit('billing.reminder_suppressed', actorId, {
            userId: line.userId,
            invoiceId: line.invoiceId,
            kind,
            reason: 'hold',
          });
          continue;
        }

        const recipient = await recipientOf(invoice.userId);
        if (recipient === null) {
          this.audit('billing.reminder_undeliverable', actorId, {
            userId: line.userId,
            invoiceId: line.invoiceId,
            kind,
            reason: 'no address',
          });
          continue;
        }

        line.sent = await this.send(
          deps,
          this.reminderMessage(kind, recipient, invoice, currencyOf.get(invoice.currency) ?? null),
          actorId,
        );
        if (line.sent) mailsSent += 1;

        this.audit('billing.reminder', actorId, {
          userId: line.userId,
          invoiceId: line.invoiceId,
          kind,
          triggerOn,
          balanceMinor: line.balanceMinor,
          currency: line.currency,
          sent: line.sent,
        });
      }
    }

    // --- 4. Digest the admins — crossings, never a standing list -------------
    const invoicesByUser = new Map<string, InvoiceWithBalanceRecord[]>();
    for (const invoice of unvoided(allInvoices)) push(invoicesByUser, invoice.userId, invoice);

    const crossings: StandingCrossingLine[] = [];
    const suppressedByHold: Array<{ userId: string; outstandingMinor: number }> = [];

    for (const [userId, invoices] of invoicesByUser) {
      const hold = holdByUser.get(userId);
      const holdInput = hold ? { expiresAt: hold.expiresAt } : null;
      const openInvoices = invoices.map(toStandingInvoice);

      // The same pure function the roster, the statement and the banner run.
      // Twice, against two days — the movement between them is the news.
      const before = resolveStanding({ openInvoices, hold: holdInput, today: since });
      const now = resolveStanding({ openInvoices, hold: holdInput, today: asOf });

      if (holdInForce(hold, asOf)) {
        // `hold: null` is what makes the balance beside a suppressed name the
        // real one: a hold stops the chasing, never the total.
        const unheld = resolveStanding({ openInvoices, hold: null, today: asOf });
        if (unheld.standing !== BillingStanding.GOOD) {
          suppressedByHold.push({ userId, outstandingMinor: unheld.outstandingMinor });
        }
      }

      // Only a move *into* one of the two chased states is news. A held student
      // resolves to `exempt` and is therefore never here.
      const chased =
        now.standing === BillingStanding.DUE || now.standing === BillingStanding.DELINQUENT;
      if (!chased || now.standing === before.standing) continue;

      crossings.push({
        userId,
        from: before.standing,
        to: now.standing,
        oldestOverdueDate: now.oldestOverdueDate,
        outstandingMinor: now.outstandingMinor,
        currency: invoices[0].currency,
      });
    }

    // Largest debt first, then by id so two identical runs read identically.
    crossings.sort(
      (a, b) =>
        b.outstandingMinor - a.outstandingMinor ||
        (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
    );

    let adminsNotified = 0;
    if (crossings.length > 0) {
      const digest = this.digestMessage(crossings, since, asOf, currencyOf);
      for (const admin of await deps.directory.listAdmins()) {
        if (await this.send(deps, { ...digest, to: admin.email }, actorId)) {
          mailsSent += 1;
          adminsNotified += 1;
        }
      }
      this.audit('billing.delinquency_digest', actorId, {
        asOf,
        since,
        crossings: crossings.length,
        adminsNotified,
      });
    }

    const report: BillingRunReport = {
      asOf,
      since,
      eligibleContracts: eligible.length,
      issued,
      absorbed,
      reminders,
      crossings,
      suppressedByHold,
      divergences,
      mailsSent,
      adminsNotified,
    };

    this.audit('billing.invoice_run', actorId, {
      asOf,
      since,
      eligibleContracts: report.eligibleContracts,
      issuedCount: issued.length,
      absorbed,
      remindersSent: reminders.filter((reminder) => reminder.sent).length,
      remindersSuppressed: reminders.filter((reminder) => reminder.suppressedByHold).length,
      crossings: crossings.length,
      divergences: divergences.length,
      mailsSent,
      // The grep that answers "did the job ever price anything?" with a `false`.
      adjustmentsWritten: 0,
    });

    return { ok: true, data: report };
  }

  /**
   * Hands one message to `IMailer`, and answers whether it left.
   *
   * A provider outage must not abort a run that has already issued invoices and
   * still has an assertion pass to make, so the failure is logged and the run
   * continues.
   */
  private async send(
    deps: BillingRunDeps,
    message: MailMessage,
    actorId: string,
  ): Promise<boolean> {
    try {
      await deps.mailer.send(message);
      return true;
    } catch (error) {
      this.audit('billing.mail_failed', actorId, {
        to: message.to,
        subject: message.subject,
        reason: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /** The student's notice. Two of them exist and there is no third. */
  private reminderMessage(
    kind: BillingReminderKind,
    recipient: BillingRecipient,
    invoice: InvoiceWithBalanceRecord,
    currency: CurrencyRecord | null,
  ): MailMessage {
    const amount = formatAmount(invoice.balanceMinor, currency);
    const lines =
      kind === 'due_date'
        ? [
            `Hello ${recipient.name},`,
            '',
            `Your membership invoice of ${amount} is due today, ${invoice.dueDate}.`,
            'If you have already paid, please ignore this message.',
          ]
        : [
            `Hello ${recipient.name},`,
            '',
            `Your membership invoice of ${amount}, due on ${invoice.dueDate}, is now past its grace period.`,
            'Please get in touch so we can settle it together.',
          ];

    return {
      to: recipient.email,
      subject:
        kind === 'due_date'
          ? `Your membership invoice is due today (${invoice.dueDate})`
          : `Your membership invoice is overdue (due ${invoice.dueDate})`,
      text: lines.join('\n'),
      html: asHtml(lines),
    };
  }

  /**
   * The admin digest. It names the movement and nothing else — a standing list
   * is the thing people learn to stop opening (RFC 0013 §3).
   */
  private digestMessage(
    crossings: StandingCrossingLine[],
    since: string,
    asOf: string,
    currencyOf: Map<string, CurrencyRecord>,
  ): MailMessage {
    const lines = [
      `Billing standing changes since ${since} (as of ${asOf}):`,
      '',
      ...crossings.map(
        (crossing) =>
          `- ${crossing.userId}: ${crossing.from} -> ${crossing.to}, ` +
          `${formatAmount(crossing.outstandingMinor, currencyOf.get(crossing.currency) ?? null)} outstanding` +
          (crossing.oldestOverdueDate ? ` (oldest due ${crossing.oldestOverdueDate})` : ''),
      ),
      '',
      'Nobody has lost access: standing is reported, never enforced.',
    ];

    return {
      // Replaced per admin by the caller.
      to: '',
      subject: `${crossings.length} student${crossings.length === 1 ? '' : 's'} changed billing standing`,
      text: lines.join('\n'),
      html: asHtml(lines),
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * One structured line per mutation, always carrying the acting admin, in the
   * shape `EnrollmentService` established. This is the only record of who
   * voided an invoice.
   */
  private audit(event: string, actorId: string, payload: Record<string, unknown>): void {
    console.info(
      JSON.stringify({
        event,
        actor: actorId,
        ...payload,
        at: new Date().toISOString(),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Wiring the run to the container — the two callers, and nothing between them
// ---------------------------------------------------------------------------

/** One page of `users.list`, and the ceiling on how many pages are walked. */
const ADMIN_PAGE_SIZE = 100;
const ADMIN_PAGE_LIMIT = 5;

/**
 * Builds the run's dependencies out of the two ports it needs.
 *
 * Typed by the ports rather than by `AppContainer`, so `billing-service.ts`
 * still imports no worker symbol, no D1 handle and no Hono type — and so the
 * container does not have to import back into a module it already imports.
 */
export function billingRunDeps(mailer: IMailer, users: IUserRepository): BillingRunDeps {
  const toRecipient = (user: Entities.Identity.User): BillingRecipient => ({
    userId: user.id,
    name: user.name,
    email: user.email,
  });

  return {
    mailer,
    directory: {
      async findRecipient(userId: string): Promise<BillingRecipient | null> {
        const user = await users.findById(userId);
        return user ? toRecipient(user) : null;
      },

      async listAdmins(): Promise<BillingRecipient[]> {
        const admins: BillingRecipient[] = [];
        // `IUserRepository` has no role-filtered listing and billing is not the
        // module that should add one, so the pages are walked and bounded: a
        // dojo is not a mailing list, and an unbounded walk inside a cron is a
        // subrequest budget waiting to be exhausted.
        for (let page = 0; page < ADMIN_PAGE_LIMIT; page += 1) {
          const batch = await users.list({
            limit: ADMIN_PAGE_SIZE,
            offset: page * ADMIN_PAGE_SIZE,
          });
          for (const user of batch) {
            if (user.status !== UserStatus.ACTIVE) continue;
            if (!user.roles.some((role) => role.name === ROLES.ADMIN)) continue;
            admins.push(toRecipient(user));
          }
          if (batch.length < ADMIN_PAGE_SIZE) break;
        }
        return admins;
      },
    },
  };
}

/**
 * Deps that resolve nobody and send nothing.
 *
 * The default for a caller constructed without a directory — a node-pool spec
 * that only wants the report. The run still issues, asserts and computes its
 * crossings; it simply has no address to mail them to.
 */
export function silentBillingRunDeps(): BillingRunDeps {
  return {
    mailer: { async send(): Promise<void> {} },
    directory: {
      async findRecipient(): Promise<BillingRecipient | null> {
        return null;
      },
      async listAdmins(): Promise<BillingRecipient[]> {
        return [];
      },
    },
  };
}

/**
 * The structural slice of `AppContainer` the scheduled run needs.
 *
 * Declared structurally rather than imported so there is no import cycle
 * between the container and the service it constructs; `AppContainer` satisfies
 * it without naming it.
 */
export interface ScheduledBillingHost {
  billing: { billingService: BillingService };
  identity: { users: IUserRepository };
  infra: { mailer: IMailer };
}

/**
 * What `scheduled` in `src/index.ts` delegates to.
 *
 * The container is built per invocation by the caller — Workers share no memory
 * between invocations, so nothing here or there may be hoisted to module scope
 * — and this function adds no rule of its own: it assembles the deps and calls
 * the same `runBillingCycle` the admin route calls.
 */
export async function runScheduledBilling(
  host: ScheduledBillingHost,
  options?: BillingRunOptions,
): Promise<ControllerResult<BillingRunReport>> {
  const result = await host.billing.billingService.runBillingCycle(
    billingRunDeps(host.infra.mailer, host.identity.users),
    options,
    SCHEDULED_BILLING_ACTOR,
  );

  if (!result.ok) {
    // A cron has nobody to return a status to, so the refusal is the log line.
    console.error(
      JSON.stringify({
        event: 'billing.invoice_run_failed',
        actor: SCHEDULED_BILLING_ACTOR,
        status: result.status,
        error: result.error,
        ...result.meta,
        at: new Date().toISOString(),
      }),
    );
  }

  return result;
}
