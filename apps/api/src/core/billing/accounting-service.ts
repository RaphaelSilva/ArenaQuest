import type {
  IBillingRepository,
  CurrencyRecord,
  InvoiceWithBalanceRecord,
  InvoiceAdjustmentRecord,
  LedgerEntryRecord,
  PaymentRecord,
  SubscriptionRecord,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import type { ControllerResult } from '@api/core/result';

/**
 * AccountingService — the three views the spreadsheet used to provide
 * (RFC 0013 §5): monthly movement, receivables aging, and a per-student
 * statement.
 *
 * **It is read-only.** Nothing in this file issues, adjusts, pays, voids or
 * repairs anything: it calls only the reading half of `IBillingRepository`, and
 * a drifted `invoices.status` cache is Task 06's to log, not this file's to fix.
 *
 * Five rules shape every computation below, and each of them is a way a report
 * can lie if it is broken:
 *
 * 1. **Recompute, never trust the cache.** Every total is summed from
 *    `payments` and `invoice_adjustments` rows. `invoices.status` is never
 *    summed, and never used as a filter that could hide a row from a total —
 *    `status = 'void'` is the one exception, because voiding is a decision
 *    rather than an arithmetic outcome, and a voided invoice contributes to no
 *    total and no bucket.
 * 2. **Billed and received are different columns on different tables.** Billed
 *    is keyed off `invoices.issued_at` and `invoice_adjustments.applied_at`;
 *    received is keyed off `payments.paid_at`. A payment recorded in September
 *    against an invoice issued in August is September's *received* and August's
 *    *billed*, and conflating the two is the single easiest way to produce a
 *    plausible, wrong report.
 * 3. **Group on `contract_group_id`.** A student who renegotiated twice has
 *    three `subscriptions` rows and is still one student. Counting rows
 *    double-counts every amended contract (RFC 0013 #7, #10).
 * 4. **One currency, asserted rather than converted.** A report states the
 *    currency its rows are denominated in; one that would span two is refused
 *    with a `409`. No rate is applied anywhere, ever.
 * 5. **Minor units end to end.** Every amount is an integer count of the
 *    currency's minor unit, and the currency's `exponent` and `symbol` travel
 *    with it so the client can format. No floating point, and no server-side
 *    formatting.
 */

const { ContractStatus, InvoiceStatus } = Entities.Config;

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Reported shapes
// ---------------------------------------------------------------------------

/** The currency a report is stated in, carrying what a client needs to format. */
export interface ReportCurrency {
  code: string;
  /** Minor units per whole = 10 ** exponent. */
  exponent: number;
  symbol: string;
}

export interface MovementReport {
  /** `YYYY-MM`, echoed back. */
  month: string;
  periodStart: string;
  /** Inclusive — the month's last day. */
  periodEnd: string;
  currency: ReportCurrency;
  /** `SUM(invoices.amount_minor)` for invoices *issued* in the month. */
  invoicedMinor: number;
  /** The signed adjustments *applied* in the month; negative reduces billing. */
  adjustmentsMinor: number;
  /** `invoicedMinor + adjustmentsMinor`. */
  billedMinor: number;
  /** Signed `payments.amount_minor` for payments *paid* in the month. */
  receivedMinor: number;
  /** Open balances as at `periodEnd`, recomputed from the rows. */
  outstandingMinor: number;
  invoicesIssued: number;
  /**
   * Distinct `contract_group_id`s in force at any point in the month — never a
   * count of `subscriptions` rows.
   */
  activeStudents: number;
}

export type AgingBucketKey = '0-30' | '31-60' | '61-90' | '90+';

/**
 * Boundaries are **exclusive**: 30 days past due and 31 days past due land in
 * different buckets. `fromDaysPastDue: null` on the first bucket means it also
 * absorbs an invoice that is not yet due.
 */
export interface AgingBucket {
  bucket: AgingBucketKey;
  fromDaysPastDue: number | null;
  toDaysPastDue: number | null;
  invoiceCount: number;
  studentCount: number;
  totalMinor: number;
}

export interface AgingReport {
  /** The day the aging is measured at; defaults to today. */
  asOf: string;
  currency: ReportCurrency;
  buckets: AgingBucket[];
  totalMinor: number;
  invoiceCount: number;
  studentCount: number;
}

export interface StatementInvoice extends InvoiceWithBalanceRecord {
  adjustments: InvoiceAdjustmentRecord[];
  payments: PaymentRecord[];
}

export interface StatementContractGroup {
  contractGroupId: string;
  /** The root version's start — what "membership since" reads. */
  startDate: string;
  /** The newest version's end; `null` while the chain is live. */
  endDate: string | null;
  /** The newest version's status. */
  status: Entities.Config.ContractStatus;
  /** Every version of the chain, oldest first. */
  versions: SubscriptionRecord[];
}

export interface StudentStatement {
  userId: string;
  currency: ReportCurrency;
  /**
   * The earliest `start_date` across *every* contract group — a student of ten
   * years who took a break is still a student of ten years (RFC 0013 #10).
   */
  studentSince: string | null;
  /** The root `start_date` of the group now active; `null` when none is. */
  currentMembershipSince: string | null;
  /** The sum of the listed invoice balances, each recomputed from its rows. */
  outstandingMinor: number;
  contractGroups: StatementContractGroup[];
  invoices: StatementInvoice[];
}

/**
 * "Does this user exist?", injected rather than imported.
 *
 * The statement 404s an unknown user, and that is the only thing billing needs
 * to know about identity. Passing a probe keeps `IUserRepository` out of this
 * file, in the shape `StreakEngine` already established in the container.
 */
export type UserExistsProbe = (userId: string) => Promise<boolean>;

// ---------------------------------------------------------------------------
// Dates — every comparison is on a `YYYY-MM-DD` string, in whole days
// ---------------------------------------------------------------------------

/** Normalises `YYYY-MM-DD` and `YYYY-MM-DD HH:MM:SS` to the same comparable day. */
function dayOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` precedes `from`. */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS,
  );
}

function lastDayOfMonth(month: string): string {
  const [year, monthIndex] = month.split('-').map(Number);
  // Day 0 of the *next* month is the last day of this one.
  const day = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
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

function toReportCurrency(currency: CurrencyRecord): ReportCurrency {
  return { code: currency.code, exponent: currency.exponent, symbol: currency.symbol };
}

/**
 * The ledger, indexed by invoice.
 *
 * Both sides stay separate because they are read through different date
 * columns and mean different things — folding them into one running total is
 * exactly how "billed" and "received" get conflated.
 */
class LedgerIndex {
  private readonly adjustments = new Map<string, InvoiceAdjustmentRecord[]>();
  private readonly payments = new Map<string, PaymentRecord[]>();

  constructor(entries: LedgerEntryRecord[]) {
    for (const entry of entries) {
      if (entry.entry === 'adjustment') {
        push(this.adjustments, entry.adjustment.invoiceId, entry.adjustment);
      } else {
        push(this.payments, entry.payment.invoiceId, entry.payment);
      }
    }
  }

  adjustmentsFor(invoiceId: string): InvoiceAdjustmentRecord[] {
    return this.adjustments.get(invoiceId) ?? [];
  }

  paymentsFor(invoiceId: string): PaymentRecord[] {
    return this.payments.get(invoiceId) ?? [];
  }

  /**
   * `amount + SUM(adjustments) - SUM(payments)`, counting only rows that had
   * occurred by `asOf`. Integer arithmetic throughout.
   */
  balanceAsOf(invoice: InvoiceWithBalanceRecord, asOf: string): number {
    let balance = invoice.amountMinor;
    for (const adjustment of this.adjustmentsFor(invoice.id)) {
      if (dayOf(adjustment.appliedAt) <= asOf) balance += adjustment.amountMinor;
    }
    for (const payment of this.paymentsFor(invoice.id)) {
      if (dayOf(payment.paidAt) <= asOf) balance -= payment.amountMinor;
    }
    return balance;
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

/** Bucket a balance by days past its own due date; boundaries are exclusive. */
function bucketFor(daysPastDue: number): AgingBucketKey {
  if (daysPastDue <= 30) return '0-30';
  if (daysPastDue <= 60) return '31-60';
  if (daysPastDue <= 90) return '61-90';
  return '90+';
}

const BUCKET_BOUNDS: Array<{
  bucket: AgingBucketKey;
  fromDaysPastDue: number | null;
  toDaysPastDue: number | null;
}> = [
  { bucket: '0-30', fromDaysPastDue: null, toDaysPastDue: 30 },
  { bucket: '31-60', fromDaysPastDue: 31, toDaysPastDue: 60 },
  { bucket: '61-90', fromDaysPastDue: 61, toDaysPastDue: 90 },
  { bucket: '90+', fromDaysPastDue: 91, toDaysPastDue: null },
];

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AccountingService {
  constructor(
    private readonly repo: IBillingRepository,
    private readonly userExists: UserExistsProbe,
  ) {}

  // -------------------------------------------------------------------------
  // Monthly movement
  // -------------------------------------------------------------------------

  async getMonthlyMovement(month: string): Promise<ControllerResult<MovementReport>> {
    if (!MONTH_PATTERN.test(month)) {
      return badRequest(`expected a month as YYYY-MM, received "${month}"`);
    }

    const periodStart = `${month}-01`;
    const periodEnd = lastDayOfMonth(month);

    const [invoices, monthEntries, entriesToEnd, subscriptions] = await Promise.all([
      this.repo.listInvoices({}),
      this.repo.listLedger({ from: periodStart, to: periodEnd }),
      this.repo.listLedger({ to: periodEnd }),
      this.repo.listSubscriptions({}),
    ]);

    // `status = 'void'` is the one status this file reads, and it is read as a
    // decision rather than as a cached balance: a voided invoice, and every
    // ledger row hanging off it, contributes to nothing.
    const live = new Map(
      invoices.filter((invoice) => invoice.status !== InvoiceStatus.VOID).map((i) => [i.id, i]),
    );

    const codes = new Set<string>();

    let invoicedMinor = 0;
    let invoicesIssued = 0;
    for (const invoice of live.values()) {
      const issuedOn = dayOf(invoice.issuedAt);
      if (issuedOn < periodStart || issuedOn > periodEnd) continue;
      invoicedMinor += invoice.amountMinor;
      invoicesIssued += 1;
      codes.add(invoice.currency);
    }

    // Billed takes the adjustments *applied* in the month; received takes the
    // payments *paid* in it. Two date columns, two totals — never one.
    let adjustmentsMinor = 0;
    let receivedMinor = 0;
    for (const entry of monthEntries) {
      if (entry.entry === 'adjustment') {
        const invoice = live.get(entry.adjustment.invoiceId);
        if (!invoice) continue;
        adjustmentsMinor += entry.adjustment.amountMinor;
        codes.add(invoice.currency);
      } else {
        const invoice = live.get(entry.payment.invoiceId);
        if (!invoice) continue;
        receivedMinor += entry.payment.amountMinor;
        codes.add(entry.payment.currency);
      }
    }

    // Outstanding is a stock, not a flow: what was still owed when the month
    // closed, recomputed invoice by invoice from the rows that had landed by
    // then. A credit balance is not a negative receivable, so only positive
    // balances are summed.
    const ledgerToEnd = new LedgerIndex(entriesToEnd);
    let outstandingMinor = 0;
    for (const invoice of live.values()) {
      if (dayOf(invoice.issuedAt) > periodEnd) continue;
      const balance = ledgerToEnd.balanceAsOf(invoice, periodEnd);
      if (balance <= 0) continue;
      outstandingMinor += balance;
      codes.add(invoice.currency);
    }

    const currency = await this.resolveCurrency(codes);
    if (!currency.ok) return currency;

    return {
      ok: true,
      data: {
        month,
        periodStart,
        periodEnd,
        currency: currency.data,
        invoicedMinor,
        adjustmentsMinor,
        billedMinor: invoicedMinor + adjustmentsMinor,
        receivedMinor,
        outstandingMinor,
        invoicesIssued,
        activeStudents: countActiveStudents(subscriptions, periodStart, periodEnd),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Receivables aging
  // -------------------------------------------------------------------------

  async getReceivablesAging(asOf?: string): Promise<ControllerResult<AgingReport>> {
    if (asOf !== undefined && !DAY_PATTERN.test(asOf)) {
      return badRequest(`expected asOf as YYYY-MM-DD, received "${asOf}"`);
    }
    const day = asOf ?? today();

    const [invoices, entries] = await Promise.all([
      this.repo.listInvoices({}),
      this.repo.listLedger({ to: day }),
    ]);
    const ledger = new LedgerIndex(entries);

    const codes = new Set<string>();
    const totals = new Map<AgingBucketKey, { total: number; invoices: number; users: Set<string> }>(
      BUCKET_BOUNDS.map(({ bucket }) => [bucket, { total: 0, invoices: 0, users: new Set() }]),
    );

    let totalMinor = 0;
    let invoiceCount = 0;
    const students = new Set<string>();

    for (const invoice of invoices) {
      if (invoice.status === InvoiceStatus.VOID) continue;
      if (dayOf(invoice.issuedAt) > day) continue;

      const balance = ledger.balanceAsOf(invoice, day);
      if (balance <= 0) continue;

      const slot = totals.get(bucketFor(daysBetween(invoice.dueDate, day)))!;
      slot.total += balance;
      slot.invoices += 1;
      slot.users.add(invoice.userId);

      totalMinor += balance;
      invoiceCount += 1;
      students.add(invoice.userId);
      codes.add(invoice.currency);
    }

    const currency = await this.resolveCurrency(codes);
    if (!currency.ok) return currency;

    return {
      ok: true,
      data: {
        asOf: day,
        currency: currency.data,
        buckets: BUCKET_BOUNDS.map((bounds) => {
          const slot = totals.get(bounds.bucket)!;
          return {
            ...bounds,
            invoiceCount: slot.invoices,
            studentCount: slot.users.size,
            totalMinor: slot.total,
          };
        }),
        totalMinor,
        invoiceCount,
        studentCount: students.size,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Per-student statement
  // -------------------------------------------------------------------------

  async getStudentStatement(userId: string): Promise<ControllerResult<StudentStatement>> {
    if (!(await this.userExists(userId))) return notFound('student not found');

    const [subscriptions, invoices, entries] = await Promise.all([
      this.repo.listSubscriptions({ userId }),
      this.repo.listInvoices({ userId }),
      this.repo.listLedger({ userId }),
    ]);
    const ledger = new LedgerIndex(entries);
    const asOf = today();

    const codes = new Set<string>();
    let outstandingMinor = 0;

    const statementInvoices: StatementInvoice[] = invoices
      .slice()
      .sort((a, b) => compare(a.dueDate, b.dueDate) || compare(a.periodStart, b.periodStart))
      .map((invoice) => {
        const voided = invoice.status === InvoiceStatus.VOID;
        // A void invoice is still listed — the history is the point — but its
        // balance is reported as zero and it is summed into nothing.
        const balanceMinor = voided ? 0 : ledger.balanceAsOf(invoice, asOf);

        if (!voided) {
          codes.add(invoice.currency);
          if (balanceMinor > 0) outstandingMinor += balanceMinor;
          for (const payment of ledger.paymentsFor(invoice.id)) codes.add(payment.currency);
        }

        return {
          ...invoice,
          balanceMinor,
          adjustments: ledger
            .adjustmentsFor(invoice.id)
            .slice()
            .sort((a, b) => compare(a.appliedAt, b.appliedAt)),
          payments: ledger
            .paymentsFor(invoice.id)
            .slice()
            .sort((a, b) => compare(a.paidAt, b.paidAt)),
        };
      });

    const currency = await this.resolveCurrency(codes);
    if (!currency.ok) return currency;

    const contractGroups = groupContracts(subscriptions);

    // "Student since" spans every group; "current membership since" is the root
    // of the group now active. They differ only for someone who left and came
    // back, and neither is a stored column (RFC 0013 §1, #10).
    const studentSince = subscriptions.reduce<string | null>(
      (earliest, contract) =>
        earliest === null || contract.startDate < earliest ? contract.startDate : earliest,
      null,
    );

    const activeGroupId = subscriptions.find(
      (contract) => contract.status === ContractStatus.ACTIVE,
    )?.contractGroupId;
    const currentMembershipSince =
      contractGroups.find((group) => group.contractGroupId === activeGroupId)?.startDate ?? null;

    return {
      ok: true,
      data: {
        userId,
        currency: currency.data,
        studentSince,
        currentMembershipSince,
        outstandingMinor,
        contractGroups,
        invoices: statementInvoices,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Resolves the one currency a report is stated in — once per request, not
   * once per money row (RFC 0013 §1).
   *
   * A set of two is refused with a `409`, never reconciled: ArenaQuest holds no
   * exchange rate and inventing one would silently corrupt a total. With no
   * rows to infer from, the tenant's active currency is used, so an empty month
   * still states what it is empty *in*.
   */
  private async resolveCurrency(codes: Set<string>): Promise<ControllerResult<ReportCurrency>> {
    if (codes.size > 1) {
      return conflict(
        `this report spans more than one currency (${[...codes].sort().join(', ')}); a total is stated in one currency and never converted between them`,
      );
    }

    if (codes.size === 0) {
      const active = (await this.repo.listCurrencies()).find((currency) => currency.active);
      if (!active) {
        return conflict(
          'no currency is marked active in the currencies table, and the report has no rows from which to infer one',
        );
      }
      return { ok: true, data: toReportCurrency(active) };
    }

    const [code] = [...codes];
    const currency = await this.repo.getCurrency(code);
    if (!currency) {
      return conflict(`the reported rows are denominated in "${code}", which has no currency row`);
    }
    return { ok: true, data: toReportCurrency(currency) };
  }
}

// ---------------------------------------------------------------------------
// Contract grouping — the rule that keeps an amended student counted once
// ---------------------------------------------------------------------------

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function groupContracts(subscriptions: SubscriptionRecord[]): StatementContractGroup[] {
  const groups = new Map<string, SubscriptionRecord[]>();
  for (const contract of subscriptions) push(groups, contract.contractGroupId, contract);

  return [...groups.entries()]
    .map(([contractGroupId, versions]) => {
      const ordered = versions
        .slice()
        .sort((a, b) => compare(a.startDate, b.startDate) || compare(a.signedAt, b.signedAt));
      const newest = ordered[ordered.length - 1];
      return {
        contractGroupId,
        startDate: ordered[0].startDate,
        endDate: newest.endDate,
        status: newest.status,
        versions: ordered,
      };
    })
    .sort((a, b) => compare(a.startDate, b.startDate));
}

/**
 * Students with a contract in force at any point in the window, counted by
 * distinct `contract_group_id`.
 *
 * The three versions of a renegotiated contract share one group id, so the
 * student behind them counts **once** — which is the whole reason this is not
 * `subscriptions.length`.
 */
function countActiveStudents(
  subscriptions: SubscriptionRecord[],
  periodStart: string,
  periodEnd: string,
): number {
  const groups = new Set<string>();
  for (const contract of subscriptions) {
    const started = contract.startDate <= periodEnd;
    const stillOpen = contract.endDate === null || contract.endDate >= periodStart;
    if (started && stillOpen) groups.add(contract.contractGroupId);
  }
  return groups.size;
}
