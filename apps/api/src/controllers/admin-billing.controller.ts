import { z } from 'zod';
import { Entities } from '@arenaquest/shared/types/entities';
import type {
  EventChargeAdjustmentRecord,
  EventChargePaymentRecord,
  EventChargeRecord,
  EventPriceRecord,
  BillingPlanRecord,
  BillingStandingHoldRecord,
  InvoiceAdjustmentRecord,
  InvoiceRecord,
  InvoiceWithBalanceRecord,
  PaymentRecord,
  SubscriptionRecord,
} from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';
import {
  silentBillingRunDeps,
  type BillingRunDeps,
  type BillingRunReport,
  type BillingService,
  type RosterEntry,
} from '@api/core/billing/billing-service';
import type {
  AccountingService,
  AgingReport,
  MovementReport,
  PendingCheckout,
  StudentStatement,
} from '@api/core/billing/accounting-service';
import {
  MAX_CHARGE_USERS,
  type AudienceCheckResult,
  type EventChargeDetail,
  type EventChargeListItem,
  type EventChargeService,
  type EventChargeSummary,
  type IssueEventChargesResult,
} from '@api/core/billing/event-charge-service';
import {
  NO_GATEWAY_PAID_METHOD,
  PAYMENTS_PROVIDER_NOT_ENABLED,
  type CheckoutSession,
  type DismissedException,
  type GatewayPaidMethod,
  type GatewayService,
  type PaymentExceptionView,
} from '@api/core/payments/gateway-service';
import { PAYMENTS_CONFIG_INVALID } from '@api/core/payments/config';
import type { ReconcilePaymentsReport, ReconcilePaymentsSummary } from '@api/jobs/reconcile-payments';
import type { ReceivableKind } from '@arenaquest/shared/domain/billing/receivable';

/**
 * AdminBillingController — the admin billing lifecycle as `ControllerResult<T>`.
 *
 * It owns two things and deliberately no third:
 *
 * 1. **Shape validation.** Each method parses its raw input with the Zod schema
 *    below and returns `400 ValidationError` with the issues on failure, so a
 *    malformed body never reaches a repository.
 * 2. **The error surface.** Every branch the lifecycle can take —
 *    unknown plan / subscription / invoice / payment (`404`), a second active
 *    contract, an amendment of a non-active version, a payment against a void
 *    invoice, a reversal of an already-reversed payment (`409`), a negotiated
 *    contract with no reason, a void with no reason (`400`) — arrives here as a
 *    `ControllerResult` and leaves unchanged.
 *
 * What it does **not** own is the rules themselves: those live in
 * `BillingService`, in one place, so the router, a future scheduled run and any
 * other caller cannot each enforce a slightly different version of them.
 * No provider-specific (D1 / R2) symbol appears in this file.
 */

const {
  BillingCycle,
  BillingStanding,
  ContractTermsSource,
  InvoiceStatus,
  AdjustmentKind,
  PaymentMethod,
} = Entities.Config;

// ---------------------------------------------------------------------------
// Schemas — money is always an integer count of the currency's minor unit
// ---------------------------------------------------------------------------

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a YYYY-MM-DD date');
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, 'expected a three-letter currency code');
const CycleSchema = z.nativeEnum(BillingCycle);
const TermsSourceSchema = z.nativeEnum(ContractTermsSource);

const CreatePlanSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  amountMinor: z.number().int().min(0),
  currency: CurrencySchema,
  cycle: CycleSchema,
  graceDays: z.number().int().min(0),
  scopeTopicId: z.string().nullable().optional(),
});

const UpdatePlanSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    amountMinor: z.number().int().min(0).optional(),
    cycle: CycleSchema.optional(),
    graceDays: z.number().int().min(0).optional(),
    scopeTopicId: z.string().nullable().optional(),
    archived: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'the patch is empty' });

const SignContractSchema = z.object({
  userId: z.string().min(1),
  planId: z.string().min(1),
  dueDay: z.number().int().min(1).max(28),
  startDate: IsoDateSchema,
  termsSource: TermsSourceSchema.default(ContractTermsSource.STANDARD),
  amountMinor: z.number().int().min(0).optional(),
  cycle: CycleSchema.optional(),
  graceDays: z.number().int().min(0).optional(),
  termsNote: z.string().optional(),
});

const ChangeLifecycleSchema = z.object({
  action: z.enum(['pause', 'resume', 'cancel']),
  endDate: IsoDateSchema.optional(),
  // Accepted only so the refusal can point at `/amend`; the service rejects
  // any of them rather than silently dropping a price the admin typed.
  amountMinor: z.number().int().min(0).optional(),
  cycle: CycleSchema.optional(),
  graceDays: z.number().int().min(0).optional(),
  dueDay: z.number().int().min(1).max(28).optional(),
});

const AmendContractSchema = z.object({
  startDate: IsoDateSchema,
  termsNote: z.string().min(1),
  amountMinor: z.number().int().min(0).optional(),
  cycle: CycleSchema.optional(),
  graceDays: z.number().int().min(0).optional(),
  dueDay: z.number().int().min(1).max(28).optional(),
  termsSource: TermsSourceSchema.optional(),
});

const IssueInvoiceSchema = z.object({
  subscriptionId: z.string().min(1),
  periodStart: IsoDateSchema.optional(),
  periodEnd: IsoDateSchema.optional(),
  dueDate: IsoDateSchema.optional(),
  amountMinor: z.number().int().min(0).optional(),
  referenceDate: IsoDateSchema.optional(),
});

const VoidInvoiceSchema = z.object({
  reason: z.string(),
});

/**
 * The manual twin of the cron. Both dates are optional and both default in the
 * service: `asOf` to today, `since` to the day before it — the window a daily
 * firing covers. An operator re-running a day that already ran passes
 * `since = asOf`, which is an empty window and therefore no mail.
 */
const RunInvoiceCycleSchema = z.object({
  asOf: IsoDateSchema.optional(),
  since: IsoDateSchema.optional(),
});

const ApplyAdjustmentSchema = z.object({
  kind: z.nativeEnum(AdjustmentKind),
  amountMinor: z.number().int(),
  reason: z.string(),
});

const RecordPaymentSchema = z.object({
  amountMinor: z.number().int(),
  method: z.nativeEnum(PaymentMethod),
  paidAt: IsoDateSchema.optional(),
  currency: CurrencySchema.optional(),
  externalReference: z.string().nullable().optional(),
  note: z.string().optional(),
});

const ReversePaymentSchema = z.object({
  reason: z.string(),
  paidAt: IsoDateSchema.optional(),
});

const ListPlansQuerySchema = z.object({
  archived: z.boolean().optional(),
  cycle: CycleSchema.optional(),
});

const ListSubscriptionsQuerySchema = z.object({
  userId: z.string().optional(),
  planId: z.string().optional(),
  status: z.nativeEnum(Entities.Config.ContractStatus).optional(),
  contractGroupId: z.string().optional(),
});

const ListInvoicesQuerySchema = z.object({
  userId: z.string().optional(),
  subscriptionId: z.string().optional(),
  status: z.nativeEnum(InvoiceStatus).optional(),
  /** Inclusive bounds on `dueDate`. */
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
});

/**
 * Report queries. A malformed `month` is a `400` and never an empty report:
 * silently returning zeroes for `2026-13` would read as "nothing happened".
 */
const MovementQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'expected a month as YYYY-MM'),
});

const AgingQuerySchema = z.object({
  /** The day the aging is measured at; defaults to today in the service. */
  asOf: IsoDateSchema.optional(),
  /**
   * The one rail this aging covers (RFC 0015 §7). Absent means `contract`, so
   * the existing screen keeps meaning exactly what it meant.
   */
  rail: z.enum(['contract', 'extras']).optional(),
});

const StudentParamSchema = z.object({ userId: z.string().min(1) });

/**
 * The roster query: one filter per rail, independent of each other (RFC 0015
 * §4). `contractStanding=exempt` **is** the held filter: a hold is the only way
 * a student reaches `exempt`, so a second `held` flag would be a second
 * spelling of the same predicate, free to disagree with the first. `standing`
 * is RFC 0013's filter, kept as an alias of `contractStanding` so its meaning
 * does not silently change.
 */
const RosterQuerySchema = z.object({
  contractStanding: z.nativeEnum(BillingStanding).optional(),
  extrasStanding: z.nativeEnum(BillingStanding).optional(),
  standing: z.nativeEnum(BillingStanding).optional(),
  /** The day to resolve standing against; defaults to today in the service. */
  asOf: IsoDateSchema.optional(),
});

/**
 * `reason` carries no `.min(1)` on purpose: whitespace is refused by the
 * service alongside the empty string, in the one place that rule lives.
 */
const SetHoldSchema = z.object({
  reason: z.string(),
  expiresAt: IsoDateSchema.nullable().optional(),
});

/**
 * Body of the two on-behalf checkout routes. The receivable is in the path and
 * its student is read from it, so the body can only say *how* to pay — and is
 * `strict`: a `userId` here is a validation error, not an ignored field.
 */
const CreateCheckoutOnBehalfSchema = z.object({ provider: z.string().min(1).max(40).optional() }).strict();

/**
 * The slice of the gateway the admin billing surface reaches (RFC 0026 §3, §5,
 * §7): checkouts on a student's behalf, refunds, and the payments in progress.
 * Absent on a wiring without a gateway — the checkout routes then answer
 * `404`, a gateway row cannot be refunded, and nothing reads as pending.
 */
export type AdminPayments = Pick<
  GatewayService,
  | 'checkoutGate'
  | 'createCheckoutOnBehalf'
  | 'refundInvoicePayment'
  | 'refundChargePayment'
  | 'listLiveCheckouts'
  | 'findLiveCheckout'
  | 'paidMethodsOf'
  | 'listExceptions'
  | 'dismissException'
>;

/**
 * The reconcile run, as the manual route starts it: the same job the hourly
 * trigger runs, recorded with `trigger = 'manual'` and the admin as its actor.
 */
export type PaymentsReconcileRunner = (actorId: string) => Promise<ReconcilePaymentsReport>;

/** What the manual reconcile answers: the run's verdict and its counts. */
export interface PaymentsReconcileRun {
  status: 'ok' | 'failed';
  error: string | null;
  /** What `PAYMENTS_KEY_MODE` declares here — a reminder, verified against nothing. */
  keyMode: 'test' | 'live';
  summary: ReconcilePaymentsSummary;
}

/** Decision 20: `{ ref, note }`, the note 1–500 characters and not blank. */
const DismissExceptionSchema = z
  .object({
    ref: z.string().min(1).max(300),
    note: z.string().trim().min(1).max(500),
  })
  .strict();

/** A hosted session, and whether this call opened it (`201`) or it was already open (`200`). */
export interface OnBehalfCheckoutAnswer {
  checkout: CheckoutSession;
  created: boolean;
}

/**
 * A payment just recorded, plus the receivable's hosted checkout still in
 * progress — so the form can warn that the student holds a live link and may
 * pay a second time. The payment is recorded either way.
 */
export type RecordedPayment<P> = P & { pendingCheckout: PendingCheckout | null };

const NOT_FOUND: ControllerResult<never> = { ok: false, status: 404, error: 'NotFound' };

/** `null` when the routes exist; `404` with no gateway wired, else the gateway's own answer. */
function onBehalfGate(payments: AdminPayments | undefined): ControllerResult<never> | null {
  return payments ? payments.checkoutGate() : NOT_FOUND;
}

/**
 * A ledger row as the **admin** reads it: the row, plus how a gateway payment
 * was made (RFC 0026 §7; M30 Task 17). Both keys are always present and `null`
 * for a row no checkout landed — every non-gateway row, a hand-matched gateway
 * row, a refund. The student statement never carries them.
 */
export type AdminLedgerPayment<P> = P & GatewayPaidMethod;

/** The statement as an admin reads it: the student's own, with the method on every payment row. */
export type AdminStudentStatement = Omit<StudentStatement, 'invoices' | 'extras'> & {
  invoices: Array<
    Omit<StudentStatement['invoices'][number], 'payments'> & {
      payments: Array<AdminLedgerPayment<StudentStatement['invoices'][number]['payments'][number]>>;
    }
  >;
  extras: Omit<StudentStatement['extras'], 'charges'> & {
    charges: Array<
      Omit<StudentStatement['extras']['charges'][number], 'payments'> & {
        payments: Array<AdminLedgerPayment<StudentStatement['extras']['charges'][number]['payments'][number]>>;
      }
    >;
  };
};

/** A charge's detail as an admin reads it. */
export type AdminEventChargeDetail = Omit<EventChargeDetail, 'payments'> & {
  payments: Array<AdminLedgerPayment<EventChargeDetail['payments'][number]>>;
};

/**
 * Adds `gatewayMethod` / `gatewayMethodLabel` to the payment rows of one rail,
 * with **one** read for all of them. Display only: a failed read (or a wiring
 * without a gateway) leaves every row at `null` and never fails the ledger.
 */
async function withPaidMethods<P extends { id: string; method: string }>(
  payments: AdminPayments | undefined,
  kind: ReceivableKind,
  groups: ReadonlyArray<ReadonlyArray<P>>,
): Promise<Array<Array<AdminLedgerPayment<P>>>> {
  const gatewayIds = groups.flatMap((rows) =>
    rows.filter((row) => row.method === PaymentMethod.GATEWAY).map((row) => row.id),
  );
  let methods = new Map<string, GatewayPaidMethod>();
  if (payments && gatewayIds.length > 0) {
    try {
      methods = await payments.paidMethodsOf(kind, gatewayIds);
    } catch {
      console.error('[billing] paid-method lookup failed; the ledger is shown without method labels');
    }
  }
  return groups.map((rows) => rows.map((row) => ({ ...row, ...(methods.get(row.id) ?? NO_GATEWAY_PAID_METHOD) })));
}

async function openOnBehalf(
  payments: AdminPayments | undefined,
  kind: ReceivableKind,
  id: string,
  body: unknown,
  adminId: string,
  apiOrigin: string | null,
): Promise<ControllerResult<OnBehalfCheckoutAnswer>> {
  const closed = onBehalfGate(payments);
  if (closed || !payments) return closed ?? NOT_FOUND;
  const parsed = CreateCheckoutOnBehalfSchema.safeParse(body ?? {});
  if (!parsed.success) return invalid(parsed.error);
  // The origin is the request's own, read by the router — never a body field.
  const result = await payments.createCheckoutOnBehalf(
    { kind, id, provider: parsed.data.provider, apiOrigin },
    adminId,
  );
  if (!result.ok) return result;
  return { ok: true, data: { checkout: result.data.checkout, created: !result.data.reused } };
}

/**
 * The payment is on the ledger by the time this runs, so a failed read here
 * must never turn its `201` into an error the admin would answer by recording
 * it again: no answer is `null`.
 */
async function withPendingCheckout<P extends object>(
  payments: AdminPayments | undefined,
  kind: ReceivableKind,
  receivableId: string,
  payment: P,
): Promise<RecordedPayment<P>> {
  let pendingCheckout: PendingCheckout | null = null;
  try {
    pendingCheckout = payments ? await payments.findLiveCheckout(kind, receivableId) : null;
  } catch {
    console.error(JSON.stringify({ event: 'payments.pending_checkout_read_failed', kind, receivableId }));
  }
  return { ...payment, pendingCheckout };
}

/** A gateway row with no gateway wired: its provider cannot be asked, so nothing is written. */
const PROVIDER_NOT_ENABLED: ControllerResult<never> = {
  ok: false,
  status: 409,
  error: PAYMENTS_PROVIDER_NOT_ENABLED,
};

function invalid(error: z.ZodError): ControllerResult<never> {
  return {
    ok: false,
    status: 400,
    error: 'ValidationError',
    meta: { message: 'Invalid billing payload.', issues: error.issues },
  };
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class AdminBillingController {
  constructor(
    private readonly service: BillingService,
    /** Read-only; the three report handlers are the only callers. */
    private readonly accounting: AccountingService,
    /**
     * Mail and the address book for the run. Defaulted to a silent pair so a
     * spec constructing the controller with a service alone still works; the
     * router passes the container's real `IMailer` and user repository, and the
     * cron passes the same two through `runScheduledBilling`.
     */
    private readonly runDeps: BillingRunDeps = silentBillingRunDeps(),
    /** The payment gateway; absent on a wiring without one. */
    private readonly payments?: AdminPayments,
    /** The payment reconcile run; absent on a wiring without a gateway. */
    private readonly reconcile?: PaymentsReconcileRunner,
  ) {}

  // Payment reconcile and exceptions (RFC 0026 §6, §7) --------------------

  /**
   * The manual twin of the hourly payment reconcile: the same job, the same
   * caps. A label with no provider bound has nothing to reconcile (`404`, and
   * no run is recorded); an invalid provider list or key-mode value is `500
   * PAYMENTS_CONFIG_INVALID` (the failed run **is** recorded). A run that ran
   * is `200` even when it failed — the verdict is in the body.
   */
  async reconcilePayments(actorId: string): Promise<ControllerResult<PaymentsReconcileRun>> {
    if (!this.reconcile) return NOT_FOUND;
    const report = await this.reconcile(actorId);
    if (!report.ran) return NOT_FOUND;
    if (report.configInvalid || report.keyMode === null) {
      return { ok: false, status: 500, error: PAYMENTS_CONFIG_INVALID };
    }
    return {
      ok: true,
      data: { status: report.status, error: report.error, keyMode: report.keyMode, summary: report.summary },
    };
  }

  /**
   * The exceptions list, oldest first. Database only — it never calls a
   * provider, so it answers under `none` and under an invalid configuration
   * too: rows left by a provider that was since unbound still need an admin.
   */
  async listPaymentExceptions(): Promise<ControllerResult<{ exceptions: PaymentExceptionView[] }>> {
    return { ok: true, data: { exceptions: this.payments ? await this.payments.listExceptions() : [] } };
  }

  /** Dismisses one listed exception with a note (decision 20). Changes no status, no outcome, no ledger row. */
  async dismissPaymentException(body: unknown, actorId: string): Promise<ControllerResult<DismissedException>> {
    const parsed = DismissExceptionSchema.safeParse(body ?? {});
    if (!parsed.success) return invalid(parsed.error);
    if (!this.payments) return NOT_FOUND;
    return this.payments.dismissException(parsed.data.ref, parsed.data.note, actorId);
  }

  // Plans ---------------------------------------------------------------

  async listPlans(query: unknown): Promise<ControllerResult<BillingPlanRecord[]>> {
    const parsed = ListPlansQuerySchema.safeParse(query ?? {});
    if (!parsed.success) return invalid(parsed.error);
    return this.service.listPlans(parsed.data);
  }

  async createPlan(body: unknown, actorId: string): Promise<ControllerResult<BillingPlanRecord>> {
    const parsed = CreatePlanSchema.safeParse(body);
    if (!parsed.success) return invalid(parsed.error);
    return this.service.createPlan(parsed.data, actorId);
  }

  async updatePlan(
    id: string,
    body: unknown,
    actorId: string,
  ): Promise<ControllerResult<BillingPlanRecord>> {
    const parsed = UpdatePlanSchema.safeParse(body);
    if (!parsed.success) return invalid(parsed.error);
    return this.service.updatePlan(id, parsed.data, actorId);
  }

  // Contracts -----------------------------------------------------------

  async listSubscriptions(query: unknown): Promise<ControllerResult<SubscriptionRecord[]>> {
    const parsed = ListSubscriptionsQuerySchema.safeParse(query ?? {});
    if (!parsed.success) return invalid(parsed.error);
    return this.service.listSubscriptions(parsed.data);
  }

  async signContract(body: unknown, actorId: string): Promise<ControllerResult<SubscriptionRecord>> {
    const parsed = SignContractSchema.safeParse(body);
    if (!parsed.success) return invalid(parsed.error);
    return this.service.signContract(parsed.data, actorId);
  }

  async changeLifecycle(
    id: string,
    body: unknown,
    actorId: string,
  ): Promise<ControllerResult<SubscriptionRecord>> {
    const parsed = ChangeLifecycleSchema.safeParse(body);
    if (!parsed.success) return invalid(parsed.error);
    return this.service.changeLifecycle(id, parsed.data, actorId);
  }

  async amendContract(
    id: string,
    body: unknown,
    actorId: string,
  ): Promise<ControllerResult<SubscriptionRecord>> {
    const parsed = AmendContractSchema.safeParse(body);
    if (!parsed.success) return invalid(parsed.error);
    return this.service.amendContract(id, parsed.data, actorId);
  }

  // Invoices ------------------------------------------------------------

  async listInvoices(query: unknown): Promise<ControllerResult<InvoiceWithBalanceRecord[]>> {
    const parsed = ListInvoicesQuerySchema.safeParse(query ?? {});
    if (!parsed.success) return invalid(parsed.error);

    const { from, to, ...rest } = parsed.data;
    return this.service.listInvoices({ ...rest, dueFrom: from, dueTo: to });
  }

  async issueInvoice(body: unknown, actorId: string): Promise<ControllerResult<InvoiceRecord>> {
    const parsed = IssueInvoiceSchema.safeParse(body);
    if (!parsed.success) return invalid(parsed.error);
    return this.service.issueAdHocInvoice(parsed.data, actorId);
  }

  /**
   * The manual twin of the daily cron.
   *
   * It calls `BillingService.runBillingCycle` — the *identical* routine
   * `scheduled` calls — so a missed firing is recoverable by hand and the whole
   * job is testable without a cron. It writes no adjustment of any kind and
   * repairs no drifted status; both are properties of the routine, not of this
   * caller.
   */
  async runInvoiceCycle(
    body: unknown,
    actorId: string,
  ): Promise<ControllerResult<BillingRunReport>> {
    const parsed = RunInvoiceCycleSchema.safeParse(body ?? {});
    if (!parsed.success) return invalid(parsed.error);
    return this.service.runBillingCycle(this.runDeps, parsed.data, actorId);
  }

  async voidInvoice(
    id: string,
    body: unknown,
    actorId: string,
  ): Promise<ControllerResult<InvoiceRecord>> {
    const parsed = VoidInvoiceSchema.safeParse(body ?? {});
    if (!parsed.success) return invalid(parsed.error);
    return this.service.voidInvoice(id, parsed.data.reason, actorId);
  }

  // Ledger --------------------------------------------------------------

  async applyAdjustment(
    invoiceId: string,
    body: unknown,
    actorId: string,
  ): Promise<ControllerResult<InvoiceAdjustmentRecord>> {
    const parsed = ApplyAdjustmentSchema.safeParse(body);
    if (!parsed.success) return invalid(parsed.error);
    return this.service.applyAdjustment(invoiceId, parsed.data, actorId);
  }

  /**
   * Recording money on an invoice with a hosted checkout in progress stays
   * allowed — the student may well have paid at the door (RFC 0026 §7). The
   * answer names that checkout so the form can say so.
   */
  async recordPayment(
    invoiceId: string,
    body: unknown,
    actorId: string,
  ): Promise<ControllerResult<RecordedPayment<PaymentRecord>>> {
    const parsed = RecordPaymentSchema.safeParse(body);
    if (!parsed.success) return invalid(parsed.error);
    const recorded = await this.service.recordPayment(invoiceId, parsed.data, actorId);
    if (!recorded.ok) return recorded;
    return { ok: true, data: await withPendingCheckout(this.payments, 'invoice', invoiceId, recorded.data) };
  }

  /**
   * Two paths behind one route, chosen by the row's own `method`:
   *
   * - anything but `gateway` is RFC 0013's reversal, exactly as before — the
   *   mirror row, and **no provider is called**;
   * - a `gateway` row is a refund (RFC 0026 §5): the provider returns the
   *   money first, and the reversal is written only when it accepted.
   *
   * The reversal of a gateway row is itself a `gateway` row, which is how the
   * router tells the two apart (`200` for a refund, `201` for a mirror row).
   */
  async reversePayment(
    paymentId: string,
    body: unknown,
    actorId: string,
  ): Promise<ControllerResult<PaymentRecord>> {
    const parsed = ReversePaymentSchema.safeParse(body ?? {});
    if (!parsed.success) return invalid(parsed.error);

    const original = await this.service.getPayment(paymentId);
    if (original.ok && original.data.method === PaymentMethod.GATEWAY) {
      if (!this.payments) return PROVIDER_NOT_ENABLED;
      const refunded = await this.payments.refundInvoicePayment(paymentId, parsed.data, actorId);
      return refunded.ok ? { ok: true, data: refunded.data.payment } : refunded;
    }
    return this.service.reversePayment(paymentId, parsed.data, actorId);
  }

  // Checkouts on a student's behalf (RFC 0026 §3) -------------------------

  /** Whether the on-behalf checkout routes exist on this label; asked before a body is read. */
  checkoutGate(): ControllerResult<never> | null {
    return onBehalfGate(this.payments);
  }

  /**
   * Opens — or hands back — the hosted checkout of a student's invoice. The
   * student is the invoice's own; the admin is recorded as its creator and
   * gets the URL to hand over. `apiOrigin` is the origin of this very request:
   * the provider is told to notify the API that created the checkout.
   */
  async createCheckout(
    invoiceId: string,
    body: unknown,
    actorId: string,
    apiOrigin: string | null = null,
  ): Promise<ControllerResult<OnBehalfCheckoutAnswer>> {
    return openOnBehalf(this.payments, 'invoice', invoiceId, body, actorId, apiOrigin);
  }

  // Reports — read-only ---------------------------------------------------

  async getMonthlyMovement(query: unknown): Promise<ControllerResult<MovementReport>> {
    const parsed = MovementQuerySchema.safeParse(query ?? {});
    if (!parsed.success) return invalid(parsed.error);
    return this.accounting.getMonthlyMovement(parsed.data.month);
  }

  async getReceivablesAging(query: unknown): Promise<ControllerResult<AgingReport>> {
    const parsed = AgingQuerySchema.safeParse(query ?? {});
    if (!parsed.success) return invalid(parsed.error);
    return this.accounting.getReceivablesAging(parsed.data.asOf, parsed.data.rail ?? 'contract');
  }

  /**
   * The student's statement, with one admin-only addition: every payment row
   * says how a gateway payment was made (`gatewayMethod`, `gatewayMethodLabel`;
   * both `null` when unknown). The student's own route returns the statement
   * without them.
   */
  async getStudentStatement(params: unknown): Promise<ControllerResult<AdminStudentStatement>> {
    const parsed = StudentParamSchema.safeParse(params ?? {});
    if (!parsed.success) return invalid(parsed.error);
    const statement = await this.accounting.getStudentStatement(parsed.data.userId);
    if (!statement.ok) return statement;

    const { invoices, extras } = statement.data;
    const [invoicePayments, chargePayments] = await Promise.all([
      withPaidMethods(this.payments, 'invoice', invoices.map((invoice) => invoice.payments)),
      withPaidMethods(this.payments, 'event_charge', extras.charges.map((charge) => charge.payments)),
    ]);
    return {
      ok: true,
      data: {
        ...statement.data,
        invoices: invoices.map((invoice, i) => ({ ...invoice, payments: invoicePayments[i] })),
        extras: {
          ...extras,
          charges: extras.charges.map((charge, i) => ({ ...charge, payments: chargePayments[i] })),
        },
      },
    };
  }

  // Roster and holds — reported, never enforced ---------------------------

  /**
   * The everyday admin screen: every user with a contract or an event
   * charge, with the two rails resolved side by side and never merged. Nothing here gates anything — the roster is a listing,
   * and a `delinquent` row changes no permission.
   */
  async listStudentRoster(query: unknown): Promise<ControllerResult<RosterEntry[]>> {
    const parsed = RosterQuerySchema.safeParse(query ?? {});
    if (!parsed.success) return invalid(parsed.error);
    const payments = this.payments;
    return this.service.listStudentRoster(
      parsed.data,
      payments ? () => payments.listLiveCheckouts() : undefined,
    );
  }

  async setHold(
    userId: string,
    body: unknown,
    actorId: string,
  ): Promise<ControllerResult<BillingStandingHoldRecord>> {
    const parsed = SetHoldSchema.safeParse(body ?? {});
    if (!parsed.success) return invalid(parsed.error);
    return this.service.setHold(userId, parsed.data, actorId);
  }

  async clearHold(userId: string, actorId: string): Promise<ControllerResult<null>> {
    return this.service.clearHold(userId, actorId);
  }
}

// ---------------------------------------------------------------------------
// Extras rail (RFC 0015 §7) — schemas and controller
// ---------------------------------------------------------------------------

const UserIdsSchema = z
  .array(z.string().min(1))
  .min(1)
  .max(MAX_CHARGE_USERS)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'userIds must be distinct' });

const SetEventPriceSchema = z.object({
  amountMinor: z.number().int().min(0),
  currency: CurrencySchema.optional(),
  dueInDays: z.number().int().min(0).optional(),
  graceDays: z.number().int().min(0).optional(),
});

const IssueEventChargesSchema = z.object({
  eventId: z.string().min(1),
  userIds: UserIdsSchema,
  amountMinor: z.number().int().min(0).optional(),
  currency: CurrencySchema.optional(),
  dueDate: IsoDateSchema.optional(),
  graceDays: z.number().int().min(0).optional(),
  termsNote: z.string().optional(),
});

const ListEventChargesQuerySchema = z.object({
  eventId: z.string().optional(),
  userId: z.string().optional(),
  status: z.nativeEnum(Entities.Config.ChargeStatus).optional(),
});

/** `userIds` travels as one comma-separated query value. */
const AudienceCheckQuerySchema = z.object({
  userIds: z
    .string()
    .transform((raw) => raw.split(',').map((id) => id.trim()).filter((id) => id.length > 0))
    .pipe(z.array(z.string()).min(1).max(MAX_CHARGE_USERS)),
});

/**
 * AdminEventChargeController — the extras rail's admin surface.
 *
 * Same split as `AdminBillingController`: this class owns shape validation and
 * hands every rule to `EventChargeService`, whose `ControllerResult` it returns
 * unchanged. Nothing here reads or writes an event, an audience grant or an
 * enrollment directly.
 */
export class AdminEventChargeController {
  constructor(
    private readonly service: EventChargeService,
    /** The payment gateway; absent on a wiring without one. */
    private readonly payments?: AdminPayments,
  ) {}

  // Price ---------------------------------------------------------------

  async getPrice(eventId: string): Promise<ControllerResult<EventPriceRecord>> {
    return this.service.getPrice(eventId);
  }

  async setPrice(
    eventId: string,
    body: unknown,
    actorId: string,
  ): Promise<ControllerResult<EventPriceRecord>> {
    const parsed = SetEventPriceSchema.safeParse(body);
    if (!parsed.success) return invalid(parsed.error);
    return this.service.setPrice(eventId, parsed.data, actorId);
  }

  async clearPrice(eventId: string, actorId: string): Promise<ControllerResult<null>> {
    return this.service.clearPrice(eventId, actorId);
  }

  // Charges -------------------------------------------------------------

  async listCharges(query: unknown): Promise<ControllerResult<EventChargeListItem[]>> {
    const parsed = ListEventChargesQuerySchema.safeParse(query ?? {});
    if (!parsed.success) return invalid(parsed.error);
    const payments = this.payments;
    return this.service.listCharges(
      parsed.data,
      payments ? () => payments.listLiveCheckouts() : undefined,
    );
  }

  /** The charge with its ledger; each payment row says how a gateway payment was made (`null` when unknown). */
  async getCharge(id: string): Promise<ControllerResult<AdminEventChargeDetail>> {
    const detail = await this.service.getChargeDetail(id);
    if (!detail.ok) return detail;
    const [payments] = await withPaidMethods(this.payments, 'event_charge', [detail.data.payments]);
    return { ok: true, data: { ...detail.data, payments } };
  }

  async issueCharges(
    body: unknown,
    actorId: string,
  ): Promise<ControllerResult<IssueEventChargesResult>> {
    const parsed = IssueEventChargesSchema.safeParse(body);
    if (!parsed.success) return invalid(parsed.error);
    return this.service.issueCharges(parsed.data, actorId);
  }

  async voidCharge(
    id: string,
    body: unknown,
    actorId: string,
  ): Promise<ControllerResult<EventChargeRecord>> {
    const parsed = VoidInvoiceSchema.safeParse(body ?? {});
    if (!parsed.success) return invalid(parsed.error);
    return this.service.voidCharge(id, parsed.data.reason, actorId);
  }

  // Ledger --------------------------------------------------------------

  async applyAdjustment(
    chargeId: string,
    body: unknown,
    actorId: string,
  ): Promise<ControllerResult<EventChargeAdjustmentRecord>> {
    const parsed = ApplyAdjustmentSchema.safeParse(body);
    if (!parsed.success) return invalid(parsed.error);
    return this.service.applyAdjustment(chargeId, parsed.data, actorId);
  }

  /** As on the contract rail: allowed with a checkout in progress, and the answer names it. */
  async recordPayment(
    chargeId: string,
    body: unknown,
    actorId: string,
  ): Promise<ControllerResult<RecordedPayment<EventChargePaymentRecord>>> {
    const parsed = RecordPaymentSchema.safeParse(body);
    if (!parsed.success) return invalid(parsed.error);
    const recorded = await this.service.recordPayment(chargeId, parsed.data, actorId);
    if (!recorded.ok) return recorded;
    return { ok: true, data: await withPendingCheckout(this.payments, 'event_charge', chargeId, recorded.data) };
  }

  /** The extras twin of `AdminBillingController.reversePayment`: a `gateway` row is refunded at its provider. */
  async reversePayment(
    paymentId: string,
    body: unknown,
    actorId: string,
  ): Promise<ControllerResult<EventChargePaymentRecord>> {
    const parsed = ReversePaymentSchema.safeParse(body ?? {});
    if (!parsed.success) return invalid(parsed.error);

    const original = await this.service.getPayment(paymentId);
    if (original.ok && original.data.method === PaymentMethod.GATEWAY) {
      if (!this.payments) return PROVIDER_NOT_ENABLED;
      const refunded = await this.payments.refundChargePayment(paymentId, parsed.data, actorId);
      return refunded.ok ? { ok: true, data: refunded.data.payment } : refunded;
    }
    return this.service.reversePayment(paymentId, parsed.data, actorId);
  }

  /** The extras twin of `AdminBillingController.createCheckout`. */
  async createCheckout(
    chargeId: string,
    body: unknown,
    actorId: string,
    apiOrigin: string | null = null,
  ): Promise<ControllerResult<OnBehalfCheckoutAnswer>> {
    return openOnBehalf(this.payments, 'event_charge', chargeId, body, actorId, apiOrigin);
  }

  // Reads ---------------------------------------------------------------

  async getEventSummary(eventId: string): Promise<ControllerResult<EventChargeSummary>> {
    return this.service.getEventSummary(eventId);
  }

  async checkAudience(
    eventId: string,
    query: unknown,
  ): Promise<ControllerResult<AudienceCheckResult>> {
    const parsed = AudienceCheckQuerySchema.safeParse(query ?? {});
    if (!parsed.success) return invalid(parsed.error);
    return this.service.checkAudience(eventId, parsed.data.userIds);
  }
}
