import type { HttpTransport } from './api-client';

// ---------------------------------------------------------------------------
// Wire types — string ids/dates mirroring `/v1/admin/billing/*` (RFC 0013 §5).
//
// The shared `Entities.Billing.*` shapes type timestamps as `Date`; over the
// wire they arrive as ISO strings, so string-typed records are declared here
// while staying structurally aligned with the shared catalog.
//
// Money is always an integer count of the currency's minor unit. Nothing in
// this file formats it: the exponent and the symbol travel on
// `BillingReportCurrency`, and rendering goes through `formatMoney`.
// ---------------------------------------------------------------------------

export type BillingCycle = 'monthly' | 'quarterly' | 'yearly';
export type TermsSource = 'standard' | 'negotiated';
export type ContractStatus = 'active' | 'paused' | 'cancelled' | 'superseded';
export type InvoiceStatus = 'open' | 'paid' | 'void';
export type AdjustmentKind = 'discount' | 'credit' | 'waiver' | 'surcharge';
export type PaymentMethod = 'cash' | 'pix' | 'bank_transfer' | 'card' | 'gateway' | 'other';
export type Standing = 'good' | 'due' | 'delinquent' | 'exempt';
export type AgingBucketKey = '0-30' | '31-60' | '61-90' | '90+';

/**
 * The two billing rails (RFC 0015 §2): contract invoices and event charges.
 * They are resolved, reported and aged apart — never merged into one figure.
 */
export type BillingRail = 'contract' | 'extras';

export type BillingPlan = {
  id: string;
  name: string;
  description: string;
  amountMinor: number;
  currency: string;
  cycle: BillingCycle;
  graceDays: number;
  scopeTopicId: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreatePlanInput = {
  name: string;
  description?: string;
  amountMinor: number;
  currency: string;
  cycle: BillingCycle;
  graceDays: number;
  scopeTopicId?: string | null;
};

export type UpdatePlanInput = {
  name?: string;
  description?: string;
  amountMinor?: number;
  cycle?: BillingCycle;
  graceDays?: number;
  scopeTopicId?: string | null;
  archived?: boolean;
};

export type BillingSubscription = {
  id: string;
  userId: string;
  planId: string;
  contractGroupId: string;
  supersedesId: string | null;
  termsSource: TermsSource;
  amountMinor: number;
  currency: string;
  cycle: BillingCycle;
  graceDays: number;
  dueDay: number;
  status: ContractStatus;
  startDate: string;
  endDate: string | null;
  termsNote: string;
  signedBy: string;
  signedAt: string;
  updatedAt: string;
};

export type SignContractInput = {
  userId: string;
  planId: string;
  dueDay: number;
  startDate: string;
  termsSource?: TermsSource;
  amountMinor?: number;
  cycle?: BillingCycle;
  graceDays?: number;
  termsNote?: string;
};

export type ChangeLifecycleInput = {
  action: 'pause' | 'resume' | 'cancel';
  endDate?: string;
};

export type AmendContractInput = {
  startDate: string;
  termsNote: string;
  amountMinor?: number;
  cycle?: BillingCycle;
  graceDays?: number;
  dueDay?: number;
  termsSource?: TermsSource;
};

export type BillingInvoice = {
  id: string;
  subscriptionId: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  amountMinor: number;
  currency: string;
  graceDays: number;
  status: InvoiceStatus;
  issuedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
};

export type BillingInvoiceWithBalance = BillingInvoice & { balanceMinor: number };

export type InvoiceQuery = {
  status?: InvoiceStatus;
  from?: string;
  to?: string;
  userId?: string;
  subscriptionId?: string;
};

export type IssueInvoiceInput = {
  subscriptionId: string;
  periodStart?: string;
  periodEnd?: string;
  dueDate?: string;
  amountMinor?: number;
  referenceDate?: string;
};

/**
 * The manual twin of the daily cron — `POST /invoices/run`. Both fields are
 * optional: `asOf` defaults to today and `since` to the day before it, and the
 * window the run covers is `(since, asOf]`.
 */
export type RunInvoiceCycleInput = {
  asOf?: string;
  since?: string;
};

/** One invoice the run created. A second run for the period creates none. */
export type BillingRunIssuedInvoice = {
  invoiceId: string;
  subscriptionId: string;
  userId: string;
  periodStart: string;
  dueDate: string;
  amountMinor: number;
  currency: string;
  status: InvoiceStatus;
};

export type BillingRunReminderKind = 'due_date' | 'grace_lapsed';

/**
 * One student notice the run considered. `suppressedByHold` is the hold
 * skipping the chasing — the balance it names is still owed.
 */
export type BillingRunReminder = {
  invoiceId: string;
  userId: string;
  kind: BillingRunReminderKind;
  dueDate: string;
  triggerOn: string;
  balanceMinor: number;
  currency: string;
  sent: boolean;
  suppressedByHold: boolean;
};

/**
 * A standing crossing the run observed. `from` and `to` are resolved by the
 * server; nothing in this client derives either of them.
 */
export type BillingRunCrossing = {
  userId: string;
  from: Standing;
  to: Standing;
  oldestOverdueDate: string | null;
  outstandingMinor: number;
  currency: string;
};

/** A held student whose chasing was skipped while the debt stayed. */
export type BillingRunHoldSuppression = {
  userId: string;
  outstandingMinor: number;
};

/**
 * A cached-invoice-status finding. The run "writes no adjustment of any kind
 * and repairs no status", so a divergence is reported and never fixed.
 */
export type BillingRunDivergence = {
  invoiceId: string;
  userId: string;
  cachedStatus: InvoiceStatus;
  expectedStatus: InvoiceStatus;
  balanceMinor: number;
};

/**
 * What the run actually did. `eligibleContracts` is what separates "nothing was
 * in scope" from "nothing was left to bill", and `absorbed` is the idempotency
 * count a repeated run reports instead of a refusal.
 */
export type BillingRunReport = {
  asOf: string;
  since: string;
  eligibleContracts: number;
  issued: BillingRunIssuedInvoice[];
  absorbed: number;
  reminders: BillingRunReminder[];
  crossings: BillingRunCrossing[];
  suppressedByHold: BillingRunHoldSuppression[];
  divergences: BillingRunDivergence[];
  mailsSent: number;
  adminsNotified: number;
};

export type BillingAdjustment = {
  id: string;
  invoiceId: string;
  kind: AdjustmentKind;
  amountMinor: number;
  reason: string;
  appliedBy: string;
  appliedAt: string;
};

export type ApplyAdjustmentInput = {
  kind: AdjustmentKind;
  amountMinor: number;
  reason: string;
};

export type BillingPayment = {
  id: string;
  invoiceId: string;
  amountMinor: number;
  currency: string;
  method: PaymentMethod;
  paidAt: string;
  externalReference: string | null;
  /** A reversal carries its mandatory reason here. */
  note: string;
  /** Non-null on a reversal: the id of the payment it mirrors. */
  reversesId: string | null;
  recordedBy: string;
  recordedAt: string;
};

export type RecordPaymentInput = {
  amountMinor: number;
  method: PaymentMethod;
  paidAt?: string;
  currency?: string;
  externalReference?: string | null;
  note?: string;
};

export type ReversePaymentInput = {
  /** Mandatory on the server; the UI refuses to submit without it. */
  reason: string;
  paidAt?: string;
};

/**
 * The currency a report is stated in. It travels with the report because the
 * amounts are integers in the minor unit and nothing on the server formats
 * them — the client needs the exponent and the symbol to do it.
 */
export type BillingReportCurrency = {
  code: string;
  exponent: number;
  symbol: string;
};

export type BillingMovementReport = {
  month: string;
  periodStart: string;
  periodEnd: string;
  currency: BillingReportCurrency;
  invoicedMinor: number;
  adjustmentsMinor: number;
  billedMinor: number;
  receivedMinor: number;
  outstandingMinor: number;
  invoicesIssued: number;
  activeStudents: number;
  /** The extras rail of the month, from event charges only. */
  extras: BillingMovementExtras;
  /**
   * Cash that entered the till in the month, both rails. The one cross-rail
   * figure the API states — not a receivable and not a standing.
   */
  cashReceivedMinor: number;
};

export type BillingMovementExtras = {
  chargedMinor: number;
  /** Signed: negative reduces what is owed. */
  adjustmentsMinor: number;
  receivedMinor: number;
  chargesIssued: number;
  receivableAtCloseMinor: number;
};

export type BillingAgingBucket = {
  bucket: AgingBucketKey;
  fromDaysPastDue: number | null;
  toDaysPastDue: number | null;
  invoiceCount: number;
  studentCount: number;
  totalMinor: number;
};

export type BillingAgingReport = {
  asOf: string;
  /** The one rail bucketed; on `extras` the invoice counts count event charges. */
  rail: BillingRail;
  currency: BillingReportCurrency;
  buckets: BillingAgingBucket[];
  totalMinor: number;
  invoiceCount: number;
  studentCount: number;
};

export type BillingStatementInvoice = BillingInvoiceWithBalance & {
  adjustments: BillingAdjustment[];
  payments: BillingPayment[];
};

export type BillingStatementContractGroup = {
  contractGroupId: string;
  startDate: string;
  endDate: string | null;
  status: ContractStatus;
  versions: BillingSubscription[];
};

export type BillingStudentStatement = {
  userId: string;
  currency: BillingReportCurrency;
  studentSince: string | null;
  currentMembershipSince: string | null;
  outstandingMinor: number;
  contractGroups: BillingStatementContractGroup[];
  invoices: BillingStatementInvoice[];
  /**
   * The extras rail, beside — never summed into — the contract
   * `outstandingMinor`. The API always sends it; a student never charged gets
   * an empty `charges` list and a `good` standing.
   */
  extras: BillingStatementExtras;
};

export type BillingHold = {
  userId: string;
  reason: string;
  expiresAt: string | null;
  setBy: string;
  setAt: string;
};

/** The contract rail of one roster line: RFC 0013's standing, from invoices only. */
export type BillingRosterContract = {
  id: string;
  groupId: string;
  status: ContractStatus;
  nextDueDate: string | null;
  negotiatedTerms: boolean;
  standing: Standing;
  oldestOverdueDate: string | null;
  outstandingMinor: number;
};

/** The extras rail of one roster line: from event charges only, never held. */
export type BillingRosterExtras = {
  standing: Standing;
  oldestOverdueDate: string | null;
  outstandingMinor: number;
  /** Live charges with a positive balance. */
  openCharges: number;
  /** Of those, the ones whose due date has arrived. */
  overdueCharges: number;
};

/**
 * One roster line (RFC 0015 §4): two rails side by side and no top-level
 * standing or total. `contract` is null for an extras-only buyer; `extras` is
 * null for someone never charged. Both standings are resolved by the API on
 * every read — never recomputed here — and nothing on this row gates access.
 */
export type BillingRosterEntry = {
  userId: string;
  asOf: string;
  currency: string;
  contract: BillingRosterContract | null;
  extras: BillingRosterExtras | null;
  hold: BillingHold | null;
};

/**
 * The two filters are independent. `contractStanding=exempt` is the held
 * filter — a hold applies to the contract rail only.
 */
export type RosterQuery = {
  contractStanding?: Standing;
  extrasStanding?: Standing;
  /** @deprecated The server's alias of `contractStanding`. */
  standing?: Standing;
  asOf?: string;
};

export type SetHoldInput = {
  reason: string;
  expiresAt?: string | null;
};

// ---------------------------------------------------------------------------
// Extras rail (RFC 0015) — one-off charges for a published event. Its own
// ledger, never merged with the contract invoices above.
// ---------------------------------------------------------------------------

export type ChargeStatus = 'open' | 'paid' | 'void';

export type BillingEventPrice = {
  eventId: string;
  amountMinor: number;
  currency: string;
  dueInDays: number;
  graceDays: number;
  updatedBy: string;
  updatedAt: string;
};

/** The currency is never sent: the server prices in the active one. */
export type SetEventPriceInput = {
  amountMinor: number;
  dueInDays?: number;
  graceDays?: number;
};

export type BillingEventCharge = {
  id: string;
  eventId: string;
  userId: string;
  /** Snapshot of the event title at issue. */
  description: string;
  amountMinor: number;
  currency: string;
  termsSource: TermsSource;
  termsNote: string;
  dueDate: string;
  graceDays: number;
  status: ChargeStatus;
  issuedBy: string;
  issuedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
};

export type BillingEventChargeWithBalance = BillingEventCharge & { balanceMinor: number };

export type BillingEventChargeAdjustment = {
  id: string;
  chargeId: string;
  kind: AdjustmentKind;
  amountMinor: number;
  reason: string;
  appliedBy: string;
  appliedAt: string;
};

export type BillingEventChargePayment = {
  id: string;
  chargeId: string;
  amountMinor: number;
  currency: string;
  method: PaymentMethod;
  paidAt: string;
  externalReference: string | null;
  note: string;
  reversesId: string | null;
  recordedBy: string;
  recordedAt: string;
};

export type BillingEventChargeDetail = BillingEventChargeWithBalance & {
  adjustments: BillingEventChargeAdjustment[];
  payments: BillingEventChargePayment[];
};

export type EventChargeQuery = {
  eventId?: string;
  userId?: string;
  status?: ChargeStatus;
};

/**
 * Without `amountMinor` the event price is snapshot as standard terms; any
 * other amount is negotiated and the server demands a `termsNote`.
 */
export type IssueEventChargesInput = {
  eventId: string;
  userIds: string[];
  amountMinor?: number;
  dueDate?: string;
  graceDays?: number;
  termsNote?: string;
};

/**
 * `absorbed` pairs already had a live charge (a retry creates nothing);
 * `outsideAudience` is a warning only — those users were still charged.
 */
export type IssueEventChargesResult = {
  created: BillingEventCharge[];
  absorbed: { eventId: string; userId: string }[];
  outsideAudience: string[];
};

export type BillingEventChargeSummary = {
  eventId: string;
  currency: string;
  chargedMinor: number;
  /** Signed: negative reduces what is owed. */
  adjustmentsMinor: number;
  receivedMinor: number;
  outstandingMinor: number;
  chargeCount: number;
  counts: Record<ChargeStatus, number>;
};

export type BillingEventAudienceCheck = {
  eventId: string;
  audience: 'public' | 'members' | 'restricted';
  outsideAudience: string[];
};

/** One event charge on a statement: the charge, its event, and its whole ledger. */
export type BillingStatementCharge = BillingEventChargeDetail & {
  eventTitle: string;
  /** When the event starts; null when the event no longer exists. */
  eventStartsAt: string | null;
};

/** The extras rail of a statement: its own standing and its own outstanding. */
export type BillingStatementExtras = {
  standing: Standing;
  oldestOverdueDate: string | null;
  outstandingMinor: number;
  charges: BillingStatementCharge[];
};

export class AdminBillingApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'AdminBillingApiError';
  }

  /** The server's human-readable explanation, when it sent one. */
  get detailMessage(): string | null {
    return typeof this.details.message === 'string' ? this.details.message : null;
  }
}

async function rejectWith(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  throw new AdminBillingApiError(
    typeof body.error === 'string' ? body.error : fallback,
    res.status,
    body,
  );
}

/** Serialises only the parameters that were actually supplied. */
function queryString(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : '';
}

const BASE = '/admin/billing';

export function createAdminBillingApi(http: HttpTransport) {
  async function get<T>(path: string, fallback: string): Promise<T> {
    const res = await http('GET', path);
    if (!res.ok) await rejectWith(res, fallback);
    return (await res.json()) as T;
  }

  async function send<T>(
    method: string,
    path: string,
    fallback: string,
    input?: unknown,
  ): Promise<T> {
    const res = await http(method, path, input === undefined ? undefined : { body: JSON.stringify(input) });
    if (!res.ok) await rejectWith(res, fallback);
    return (await res.json()) as T;
  }

  return {
    plans: {
      list(query: { archived?: boolean; cycle?: BillingCycle } = {}): Promise<BillingPlan[]> {
        const qs = queryString({
          archived: query.archived === undefined ? undefined : String(query.archived),
          cycle: query.cycle,
        });
        return get<BillingPlan[]>(`${BASE}/plans${qs}`, 'BILLING_PLANS_LIST_FAILED');
      },

      create(input: CreatePlanInput): Promise<BillingPlan> {
        return send<BillingPlan>('POST', `${BASE}/plans`, 'BILLING_PLAN_CREATE_FAILED', input);
      },

      update(id: string, input: UpdatePlanInput): Promise<BillingPlan> {
        return send<BillingPlan>('PATCH', `${BASE}/plans/${id}`, 'BILLING_PLAN_UPDATE_FAILED', input);
      },
    },

    subscriptions: {
      list(
        query: {
          userId?: string;
          planId?: string;
          status?: ContractStatus;
          contractGroupId?: string;
        } = {},
      ): Promise<BillingSubscription[]> {
        return get<BillingSubscription[]>(
          `${BASE}/subscriptions${queryString(query)}`,
          'BILLING_SUBSCRIPTIONS_LIST_FAILED',
        );
      },

      create(input: SignContractInput): Promise<BillingSubscription> {
        return send<BillingSubscription>(
          'POST',
          `${BASE}/subscriptions`,
          'BILLING_CONTRACT_SIGN_FAILED',
          input,
        );
      },

      /** Pause, resume or cancel only — terms move through `amend`. */
      update(id: string, input: ChangeLifecycleInput): Promise<BillingSubscription> {
        return send<BillingSubscription>(
          'PATCH',
          `${BASE}/subscriptions/${id}`,
          'BILLING_CONTRACT_LIFECYCLE_FAILED',
          input,
        );
      },

      amend(id: string, input: AmendContractInput): Promise<BillingSubscription> {
        return send<BillingSubscription>(
          'POST',
          `${BASE}/subscriptions/${id}/amend`,
          'BILLING_CONTRACT_AMEND_FAILED',
          input,
        );
      },
    },

    invoices: {
      list(query: InvoiceQuery = {}): Promise<BillingInvoiceWithBalance[]> {
        return get<BillingInvoiceWithBalance[]>(
          `${BASE}/invoices${queryString(query)}`,
          'BILLING_INVOICES_LIST_FAILED',
        );
      },

      create(input: IssueInvoiceInput): Promise<BillingInvoice> {
        return send<BillingInvoice>('POST', `${BASE}/invoices`, 'BILLING_INVOICE_ISSUE_FAILED', input);
      },

      /**
       * Runs the billing cycle by hand. The body is optional on the server, so
       * an absent `input` posts no body at all and the run uses its own
       * defaults. Idempotent by construction: a second run for one period
       * creates nothing and reports it as `absorbed`.
       */
      run(input?: RunInvoiceCycleInput): Promise<BillingRunReport> {
        return send<BillingRunReport>(
          'POST',
          `${BASE}/invoices/run`,
          'BILLING_INVOICE_RUN_FAILED',
          input,
        );
      },

      void(id: string, reason: string): Promise<BillingInvoice> {
        return send<BillingInvoice>(
          'POST',
          `${BASE}/invoices/${id}/void`,
          'BILLING_INVOICE_VOID_FAILED',
          { reason },
        );
      },

      addAdjustment(id: string, input: ApplyAdjustmentInput): Promise<BillingAdjustment> {
        return send<BillingAdjustment>(
          'POST',
          `${BASE}/invoices/${id}/adjustments`,
          'BILLING_ADJUSTMENT_FAILED',
          input,
        );
      },

      addPayment(id: string, input: RecordPaymentInput): Promise<BillingPayment> {
        return send<BillingPayment>(
          'POST',
          `${BASE}/invoices/${id}/payments`,
          'BILLING_PAYMENT_FAILED',
          input,
        );
      },
    },

    payments: {
      /**
       * Appends the mirror-image row. The original is never updated or deleted,
       * which is why no delete method exists on this module.
       */
      reverse(id: string, input: ReversePaymentInput): Promise<BillingPayment> {
        return send<BillingPayment>(
          'POST',
          `${BASE}/payments/${id}/reverse`,
          'BILLING_PAYMENT_REVERSE_FAILED',
          input,
        );
      },
    },

    reports: {
      movement(month: string): Promise<BillingMovementReport> {
        return get<BillingMovementReport>(
          `${BASE}/reports/movement${queryString({ month })}`,
          'BILLING_MOVEMENT_REPORT_FAILED',
        );
      },

      /** Without `rail` the server ages the contract rail. */
      aging(asOf?: string, rail?: BillingRail): Promise<BillingAgingReport> {
        return get<BillingAgingReport>(
          `${BASE}/reports/aging${queryString({ asOf, rail })}`,
          'BILLING_AGING_REPORT_FAILED',
        );
      },
    },

    students: {
      /** Both standing filters are server parameters, never a local array filter. */
      roster(query: RosterQuery = {}): Promise<BillingRosterEntry[]> {
        return get<BillingRosterEntry[]>(
          `${BASE}/students${queryString(query)}`,
          'BILLING_ROSTER_FAILED',
        );
      },

      statement(userId: string): Promise<BillingStudentStatement> {
        return get<BillingStudentStatement>(
          `${BASE}/students/${userId}/statement`,
          'BILLING_STATEMENT_FAILED',
        );
      },
    },

    /**
     * The extras rail (RFC 0015 §7). A charge never grants or revokes access,
     * and nothing here writes an audience row.
     */
    extras: {
      /** `null` when the event is not for sale (the server answers `404`). */
      async getPrice(eventId: string): Promise<BillingEventPrice | null> {
        const res = await http('GET', `${BASE}/event-prices/${eventId}`);
        if (res.status === 404) return null;
        if (!res.ok) await rejectWith(res, 'BILLING_EVENT_PRICE_FAILED');
        return (await res.json()) as BillingEventPrice;
      },

      setPrice(eventId: string, input: SetEventPriceInput): Promise<BillingEventPrice> {
        return send<BillingEventPrice>(
          'PUT',
          `${BASE}/event-prices/${eventId}`,
          'BILLING_EVENT_PRICE_SET_FAILED',
          input,
        );
      },

      async clearPrice(eventId: string): Promise<void> {
        const res = await http('DELETE', `${BASE}/event-prices/${eventId}`);
        if (!res.ok) await rejectWith(res, 'BILLING_EVENT_PRICE_CLEAR_FAILED');
      },

      listCharges(query: EventChargeQuery = {}): Promise<BillingEventChargeWithBalance[]> {
        return get<BillingEventChargeWithBalance[]>(
          `${BASE}/charges${queryString(query)}`,
          'BILLING_CHARGES_LIST_FAILED',
        );
      },

      getCharge(id: string): Promise<BillingEventChargeDetail> {
        return get<BillingEventChargeDetail>(`${BASE}/charges/${id}`, 'BILLING_CHARGE_FAILED');
      },

      /** Idempotent: `201` when something was created, `200` when all was absorbed. */
      issueCharges(input: IssueEventChargesInput): Promise<IssueEventChargesResult> {
        return send<IssueEventChargesResult>(
          'POST',
          `${BASE}/charges`,
          'BILLING_CHARGES_ISSUE_FAILED',
          input,
        );
      },

      voidCharge(id: string, reason: string): Promise<BillingEventCharge> {
        return send<BillingEventCharge>(
          'POST',
          `${BASE}/charges/${id}/void`,
          'BILLING_CHARGE_VOID_FAILED',
          { reason },
        );
      },

      addAdjustment(
        id: string,
        input: ApplyAdjustmentInput,
      ): Promise<BillingEventChargeAdjustment> {
        return send<BillingEventChargeAdjustment>(
          'POST',
          `${BASE}/charges/${id}/adjustments`,
          'BILLING_CHARGE_ADJUSTMENT_FAILED',
          input,
        );
      },

      addPayment(id: string, input: RecordPaymentInput): Promise<BillingEventChargePayment> {
        return send<BillingEventChargePayment>(
          'POST',
          `${BASE}/charges/${id}/payments`,
          'BILLING_CHARGE_PAYMENT_FAILED',
          input,
        );
      },

      reversePayment(id: string, input: ReversePaymentInput): Promise<BillingEventChargePayment> {
        return send<BillingEventChargePayment>(
          'POST',
          `${BASE}/charge-payments/${id}/reverse`,
          'BILLING_CHARGE_PAYMENT_REVERSE_FAILED',
          input,
        );
      },

      summary(eventId: string): Promise<BillingEventChargeSummary> {
        return get<BillingEventChargeSummary>(
          `${BASE}/events/${eventId}/summary`,
          'BILLING_EVENT_SUMMARY_FAILED',
        );
      },

      /** Read-only: who among `userIds` a restricted event is not addressed to. */
      audienceCheck(eventId: string, userIds: string[]): Promise<BillingEventAudienceCheck> {
        return get<BillingEventAudienceCheck>(
          `${BASE}/events/${eventId}/audience-check${queryString({ userIds: userIds.join(',') })}`,
          'BILLING_AUDIENCE_CHECK_FAILED',
        );
      },
    },

    holds: {
      set(userId: string, input: SetHoldInput): Promise<BillingHold> {
        return send<BillingHold>('POST', `${BASE}/holds/${userId}`, 'BILLING_HOLD_SET_FAILED', input);
      },

      async clear(userId: string): Promise<void> {
        const res = await http('DELETE', `${BASE}/holds/${userId}`);
        if (!res.ok) await rejectWith(res, 'BILLING_HOLD_CLEAR_FAILED');
      },
    },
  };
}
