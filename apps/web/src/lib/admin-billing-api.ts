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
};

export type BillingHold = {
  userId: string;
  reason: string;
  expiresAt: string | null;
  setBy: string;
  setAt: string;
};

/**
 * One roster line. `standing` is resolved by the API on every read — it is
 * never recomputed here. Nothing on this row gates access: a `delinquent` line
 * changes no permission.
 */
export type BillingRosterEntry = {
  userId: string;
  asOf: string;
  standing: Standing;
  oldestOverdueDate: string | null;
  outstandingMinor: number;
  contractId: string;
  contractGroupId: string;
  contractStatus: ContractStatus;
  currency: string;
  nextDueDate: string | null;
  negotiatedTerms: boolean;
  hold: BillingHold | null;
};

/** `standing=exempt` is the held filter — a hold is the only way to reach it. */
export type RosterQuery = {
  standing?: Standing;
  asOf?: string;
};

export type SetHoldInput = {
  reason: string;
  expiresAt?: string | null;
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

      aging(asOf?: string): Promise<BillingAgingReport> {
        return get<BillingAgingReport>(
          `${BASE}/reports/aging${queryString({ asOf })}`,
          'BILLING_AGING_REPORT_FAILED',
        );
      },
    },

    students: {
      /** The standing filter is a server parameter, never a local array filter. */
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
