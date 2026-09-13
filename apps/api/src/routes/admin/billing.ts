import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { requireRole } from '@api/middleware/require-role';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { AdminBillingController } from '@api/controllers/admin-billing.controller';
import { billingRunDeps } from '@api/core/billing/billing-service';
import { respondWith, respondCreated, respondNoContent } from '@api/routes/_shared/envelope';
import type { AppContainer } from '@api/container';

/**
 * `/v1/admin/billing` — the admin lifecycle surface (RFC 0013 §5).
 *
 * HTTP only: parse, guard, shape. Every rule lives in `BillingService` and
 * every branch arrives as a `ControllerResult`.
 *
 * **Money is an integer count of the currency's minor unit**, in every request
 * and every response. Nothing here formats: a response carries the amount and
 * the currency code, and the exponent and symbol come from `currencies`.
 */

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const IsoDate = z.string().openapi({ example: '2026-01-01' });
const MinorUnits = z.number().int().openapi({ example: 15000 });

const CycleSchema = z.enum(['monthly', 'quarterly', 'yearly']).openapi({ example: 'monthly' });
const TermsSourceSchema = z.enum(['standard', 'negotiated']).openapi({ example: 'standard' });
const ContractStatusSchema = z.enum(['active', 'paused', 'cancelled', 'superseded']);
const InvoiceStatusSchema = z.enum(['open', 'paid', 'void']);
const AdjustmentKindSchema = z.enum(['discount', 'credit', 'waiver', 'surcharge']);
const PaymentMethodSchema = z.enum(['cash', 'pix', 'bank_transfer', 'card', 'gateway', 'other']);

const PlanSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    amountMinor: MinorUnits,
    currency: z.string().openapi({ example: 'BRL' }),
    cycle: CycleSchema,
    graceDays: z.number().int(),
    scopeTopicId: z.string().nullable(),
    archived: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('BillingPlan');

const SubscriptionSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    planId: z.string(),
    contractGroupId: z.string(),
    supersedesId: z.string().nullable(),
    termsSource: TermsSourceSchema,
    amountMinor: MinorUnits,
    currency: z.string(),
    cycle: CycleSchema,
    graceDays: z.number().int(),
    dueDay: z.number().int(),
    status: ContractStatusSchema,
    startDate: IsoDate,
    endDate: IsoDate.nullable(),
    termsNote: z.string(),
    signedBy: z.string(),
    signedAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('BillingSubscription');

const InvoiceSchema = z
  .object({
    id: z.string(),
    subscriptionId: z.string(),
    userId: z.string(),
    periodStart: IsoDate,
    periodEnd: IsoDate,
    dueDate: IsoDate,
    amountMinor: MinorUnits,
    currency: z.string(),
    graceDays: z.number().int(),
    status: InvoiceStatusSchema,
    issuedAt: z.string(),
    voidedAt: z.string().nullable(),
    voidReason: z.string().nullable(),
  })
  .openapi('BillingInvoice');

const InvoiceWithBalanceSchema = InvoiceSchema.extend({
  balanceMinor: MinorUnits,
}).openapi('BillingInvoiceWithBalance');

const AdjustmentSchema = z
  .object({
    id: z.string(),
    invoiceId: z.string(),
    kind: AdjustmentKindSchema,
    amountMinor: MinorUnits,
    reason: z.string(),
    appliedBy: z.string(),
    appliedAt: z.string(),
  })
  .openapi('BillingInvoiceAdjustment');

const PaymentSchema = z
  .object({
    id: z.string(),
    invoiceId: z.string(),
    amountMinor: MinorUnits,
    currency: z.string(),
    method: PaymentMethodSchema,
    paidAt: z.string(),
    externalReference: z.string().nullable(),
    note: z.string(),
    reversesId: z.string().nullable(),
    recordedBy: z.string(),
    recordedAt: z.string(),
  })
  .openapi('BillingPayment');

const IdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'plan-id' }),
});

const UserIdParamSchema = z.object({
  userId: z.string().openapi({ param: { name: 'userId', in: 'path' }, example: 'user-id' }),
});

/**
 * The currency a report is stated in. It travels with every report because the
 * amounts are integers in the currency's minor unit and nothing on the server
 * formats them — the client needs the exponent and the symbol to do it.
 */
const ReportCurrencySchema = z
  .object({
    code: z.string().openapi({ example: 'BRL' }),
    exponent: z.number().int().openapi({ example: 2 }),
    symbol: z.string().openapi({ example: 'R$' }),
  })
  .openapi('BillingReportCurrency');

const MovementReportSchema = z
  .object({
    month: z.string().openapi({ example: '2026-08' }),
    periodStart: IsoDate,
    periodEnd: IsoDate,
    currency: ReportCurrencySchema,
    invoicedMinor: MinorUnits,
    adjustmentsMinor: MinorUnits,
    billedMinor: MinorUnits,
    receivedMinor: MinorUnits,
    outstandingMinor: MinorUnits,
    invoicesIssued: z.number().int(),
    activeStudents: z.number().int(),
  })
  .openapi('BillingMovementReport');

const AgingBucketSchema = z
  .object({
    bucket: z.enum(['0-30', '31-60', '61-90', '90+']),
    fromDaysPastDue: z.number().int().nullable(),
    toDaysPastDue: z.number().int().nullable(),
    invoiceCount: z.number().int(),
    studentCount: z.number().int(),
    totalMinor: MinorUnits,
  })
  .openapi('BillingAgingBucket');

const AgingReportSchema = z
  .object({
    asOf: IsoDate,
    currency: ReportCurrencySchema,
    buckets: z.array(AgingBucketSchema),
    totalMinor: MinorUnits,
    invoiceCount: z.number().int(),
    studentCount: z.number().int(),
  })
  .openapi('BillingAgingReport');

const StatementInvoiceSchema = InvoiceWithBalanceSchema.extend({
  adjustments: z.array(AdjustmentSchema),
  payments: z.array(PaymentSchema),
}).openapi('BillingStatementInvoice');

const StatementContractGroupSchema = z
  .object({
    contractGroupId: z.string(),
    startDate: IsoDate,
    endDate: IsoDate.nullable(),
    status: ContractStatusSchema,
    versions: z.array(SubscriptionSchema),
  })
  .openapi('BillingStatementContractGroup');

/**
 * Exported so `/v1/me/billing` returns the **same** shape rather than a second
 * declaration of it. Reusing the instance also keeps the OpenAPI registry
 * holding one `BillingStudentStatement` component instead of two rival ones.
 */
export const StudentStatementSchema = z
  .object({
    userId: z.string(),
    currency: ReportCurrencySchema,
    studentSince: IsoDate.nullable(),
    currentMembershipSince: IsoDate.nullable(),
    outstandingMinor: MinorUnits,
    contractGroups: z.array(StatementContractGroupSchema),
    invoices: z.array(StatementInvoiceSchema),
  })
  .openapi('BillingStudentStatement');

export const StandingSchema = z
  .enum(['good', 'due', 'delinquent', 'exempt'])
  .openapi({ example: 'delinquent' });

const HoldSchema = z
  .object({
    userId: z.string(),
    reason: z.string(),
    expiresAt: IsoDate.nullable(),
    setBy: z.string(),
    setAt: z.string(),
  })
  .openapi('BillingStandingHold');

/**
 * One roster line. `standing` is resolved on every read from the invoices, the
 * hold and `asOf` — there is no standing column behind it, and nothing here
 * gates anything: a `delinquent` row changes no permission.
 */
const RosterEntrySchema = z
  .object({
    userId: z.string(),
    asOf: IsoDate,
    standing: StandingSchema,
    oldestOverdueDate: IsoDate.nullable(),
    outstandingMinor: MinorUnits,
    contractId: z.string(),
    contractGroupId: z.string(),
    contractStatus: ContractStatusSchema,
    currency: z.string().openapi({ example: 'BRL' }),
    nextDueDate: IsoDate.nullable(),
    negotiatedTerms: z.boolean(),
    /** The stored row, expired or not; `standing === 'exempt'` says whether it bites. */
    hold: HoldSchema.nullable(),
  })
  .openapi('BillingRosterEntry');

/**
 * What one daily run did (RFC 0013 §6).
 *
 * Everything here is *reported*: the run persists an `invoices` row for a
 * period that had none and nothing else. `absorbed` is the retry's answer — a
 * second run for one period creates nothing and counts every existing invoice
 * here — and `divergences` is logged rather than repaired.
 */
const BillingRunReportSchema = z
  .object({
    asOf: IsoDate,
    /** The previous run's day; the window is `(since, asOf]`. */
    since: IsoDate,
    eligibleContracts: z.number().int(),
    issued: z.array(
      z.object({
        invoiceId: z.string(),
        subscriptionId: z.string(),
        userId: z.string(),
        periodStart: IsoDate,
        dueDate: IsoDate,
        amountMinor: MinorUnits,
        currency: z.string(),
        status: InvoiceStatusSchema,
      }),
    ),
    absorbed: z.number().int(),
    reminders: z.array(
      z.object({
        invoiceId: z.string(),
        userId: z.string(),
        kind: z.enum(['due_date', 'grace_lapsed']),
        dueDate: IsoDate,
        triggerOn: IsoDate,
        balanceMinor: MinorUnits,
        currency: z.string(),
        sent: z.boolean(),
        suppressedByHold: z.boolean(),
      }),
    ),
    crossings: z.array(
      z.object({
        userId: z.string(),
        from: StandingSchema,
        to: StandingSchema,
        oldestOverdueDate: IsoDate.nullable(),
        outstandingMinor: MinorUnits,
        currency: z.string(),
      }),
    ),
    suppressedByHold: z.array(
      z.object({ userId: z.string(), outstandingMinor: MinorUnits }),
    ),
    divergences: z.array(
      z.object({
        invoiceId: z.string(),
        userId: z.string(),
        cachedStatus: InvoiceStatusSchema,
        expectedStatus: InvoiceStatusSchema,
        balanceMinor: MinorUnits,
      }),
    ),
    mailsSent: z.number().int(),
    adminsNotified: z.number().int(),
  })
  .openapi('BillingRunReport');

const json = <S extends z.ZodTypeAny>(description: string, schema: S) => ({
  description,
  content: { 'application/json': { schema } },
});

const ERROR_RESPONSES = {
  400: { description: 'Validation failed' },
  403: { description: 'Forbidden — admin only' },
  404: { description: 'Not found' },
  409: { description: 'Conflict' },
};

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

const body = <S extends z.ZodTypeAny>(schema: S) => ({
  body: { content: { 'application/json': { schema } } },
});

const CreatePlanBodySchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    amountMinor: MinorUnits.min(0),
    currency: z.string().openapi({ example: 'BRL' }),
    cycle: CycleSchema,
    graceDays: z.number().int().min(0).openapi({ example: 5 }),
    scopeTopicId: z.string().nullable().optional(),
  })
  .openapi('CreateBillingPlanBody');

const UpdatePlanBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    amountMinor: MinorUnits.min(0).optional(),
    cycle: CycleSchema.optional(),
    graceDays: z.number().int().min(0).optional(),
    scopeTopicId: z.string().nullable().optional(),
    archived: z.boolean().optional(),
  })
  .openapi('UpdateBillingPlanBody');

const SignContractBodySchema = z
  .object({
    userId: z.string().min(1),
    planId: z.string().min(1),
    dueDay: z.number().int().min(1).max(28).openapi({ example: 10 }),
    startDate: IsoDate,
    termsSource: TermsSourceSchema.optional(),
    amountMinor: MinorUnits.min(0).optional(),
    cycle: CycleSchema.optional(),
    graceDays: z.number().int().min(0).optional(),
    termsNote: z.string().optional(),
  })
  .openapi('SignContractBody');

const ChangeLifecycleBodySchema = z
  .object({
    action: z.enum(['pause', 'resume', 'cancel']).openapi({ example: 'pause' }),
    endDate: IsoDate.optional(),
    // Declared so the refusal can name `/amend` rather than reading as an
    // unrecognised field; the service rejects every one of them.
    amountMinor: MinorUnits.optional(),
    cycle: CycleSchema.optional(),
    graceDays: z.number().int().optional(),
    dueDay: z.number().int().optional(),
  })
  .openapi('ChangeContractLifecycleBody');

const AmendContractBodySchema = z
  .object({
    startDate: IsoDate,
    termsNote: z.string().min(1).openapi({ example: 'Scholarship agreed for 2026.' }),
    amountMinor: MinorUnits.min(0).optional(),
    cycle: CycleSchema.optional(),
    graceDays: z.number().int().min(0).optional(),
    dueDay: z.number().int().min(1).max(28).optional(),
    termsSource: TermsSourceSchema.optional(),
  })
  .openapi('AmendContractBody');

const IssueInvoiceBodySchema = z
  .object({
    subscriptionId: z.string().min(1),
    periodStart: IsoDate.optional(),
    periodEnd: IsoDate.optional(),
    dueDate: IsoDate.optional(),
    amountMinor: MinorUnits.min(0).optional(),
    referenceDate: IsoDate.optional(),
  })
  .openapi('IssueInvoiceBody');

const VoidInvoiceBodySchema = z
  .object({ reason: z.string().openapi({ example: 'Issued to the wrong student.' }) })
  .openapi('VoidInvoiceBody');

const RunInvoiceCycleBodySchema = z
  .object({
    /** The day to bill and resolve against; defaults to today. */
    asOf: IsoDate.optional(),
    /** The previous run's day; defaults to the day before `asOf`. */
    since: IsoDate.optional(),
  })
  .openapi('RunInvoiceCycleBody');

const ApplyAdjustmentBodySchema = z
  .object({
    kind: AdjustmentKindSchema,
    /** Signed and never zero; negative reduces what is owed. */
    amountMinor: MinorUnits.openapi({ example: -5000 }),
    reason: z.string(),
  })
  .openapi('ApplyAdjustmentBody');

const RecordPaymentBodySchema = z
  .object({
    amountMinor: MinorUnits,
    method: PaymentMethodSchema,
    paidAt: IsoDate.optional(),
    currency: z.string().optional(),
    externalReference: z.string().nullable().optional(),
    note: z.string().optional(),
  })
  .openapi('RecordPaymentBody');

const ReversePaymentBodySchema = z
  .object({
    reason: z.string().openapi({ example: 'Cheque bounced.' }),
    paidAt: IsoDate.optional(),
  })
  .openapi('ReversePaymentBody');

const SetHoldBodySchema = z
  .object({
    reason: z.string().openapi({ example: 'Injured; agreed to pause chasing until March.' }),
    expiresAt: IsoDate.nullable().optional(),
  })
  .openapi('SetBillingHoldBody');

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const common = { tags: ['admin:billing'], security: [{ bearerAuth: [] }] };

export const listPlansRoute = createRoute({
  ...common,
  method: 'get',
  path: '/plans',
  summary: 'List Billing Plans',
  description: 'The price list. Freely editable — a signed contract snapshots its terms.',
  request: {
    query: z.object({
      archived: z.enum(['true', 'false']).optional(),
      cycle: CycleSchema.optional(),
    }),
  },
  responses: { 200: json('Plans', z.array(PlanSchema)), ...ERROR_RESPONSES },
});

export const createPlanRoute = createRoute({
  ...common,
  method: 'post',
  path: '/plans',
  summary: 'Create a Billing Plan',
  request: body(CreatePlanBodySchema),
  responses: { 201: json('Plan created', PlanSchema), ...ERROR_RESPONSES },
});

export const updatePlanRoute = createRoute({
  ...common,
  method: 'patch',
  path: '/plans/{id}',
  summary: 'Edit a Billing Plan',
  description:
    'Editing the shelf is safe: every signed contract and every issued invoice carries its own snapshot of the terms.',
  request: { params: IdParamSchema, ...body(UpdatePlanBodySchema) },
  responses: { 200: json('Plan updated', PlanSchema), ...ERROR_RESPONSES },
});

export const listSubscriptionsRoute = createRoute({
  ...common,
  method: 'get',
  path: '/subscriptions',
  summary: 'List Contracts',
  request: {
    query: z.object({
      userId: z.string().optional(),
      planId: z.string().optional(),
      status: ContractStatusSchema.optional(),
      contractGroupId: z.string().optional(),
    }),
  },
  responses: { 200: json('Contracts', z.array(SubscriptionSchema)), ...ERROR_RESPONSES },
});

export const signContractRoute = createRoute({
  ...common,
  method: 'post',
  path: '/subscriptions',
  summary: 'Sign a Contract',
  description:
    "Snapshots the plan's amount, currency, cycle and grace days onto the contract. Negotiated terms require termsSource 'negotiated' and a termsNote.",
  request: body(SignContractBodySchema),
  responses: { 201: json('Contract signed', SubscriptionSchema), ...ERROR_RESPONSES },
});

export const changeLifecycleRoute = createRoute({
  ...common,
  method: 'patch',
  path: '/subscriptions/{id}',
  summary: 'Change a Contract Lifecycle',
  description: 'Pause, resume or cancel only. Terms move through POST /subscriptions/{id}/amend.',
  request: { params: IdParamSchema, ...body(ChangeLifecycleBodySchema) },
  responses: { 200: json('Contract updated', SubscriptionSchema), ...ERROR_RESPONSES },
});

export const amendContractRoute = createRoute({
  ...common,
  method: 'post',
  path: '/subscriptions/{id}/amend',
  summary: 'Amend a Contract',
  description:
    'Closes the live version to superseded and opens a new active one in the same contract group.',
  request: { params: IdParamSchema, ...body(AmendContractBodySchema) },
  responses: { 201: json('Contract amended', SubscriptionSchema), ...ERROR_RESPONSES },
});

export const listInvoicesRoute = createRoute({
  ...common,
  method: 'get',
  path: '/invoices',
  summary: 'Search Invoices',
  request: {
    query: z.object({
      status: InvoiceStatusSchema.optional(),
      from: IsoDate.optional(),
      to: IsoDate.optional(),
      userId: z.string().optional(),
      subscriptionId: z.string().optional(),
    }),
  },
  responses: {
    200: json('Invoices with their balances', z.array(InvoiceWithBalanceSchema)),
    ...ERROR_RESPONSES,
  },
});

export const issueInvoiceRoute = createRoute({
  ...common,
  method: 'post',
  path: '/invoices',
  summary: 'Issue an Ad-hoc Invoice',
  description: "Snapshots the contract's terms — never the plan's. A zero amount settles at issue.",
  request: body(IssueInvoiceBodySchema),
  responses: { 201: json('Invoice issued', InvoiceSchema), ...ERROR_RESPONSES },
});

/**
 * The manual twin of the daily cron (RFC 0013 §6).
 *
 * It runs the **identical** routine `scheduled` runs, so a missed firing is
 * recoverable by hand and the job is testable without a cron. Idempotent by
 * construction: `UNIQUE (subscription_id, period_start)` absorbs a second run
 * for one period, which is reported as `absorbed` rather than refused.
 */
export const runInvoiceCycleRoute = createRoute({
  ...common,
  method: 'post',
  path: '/invoices/run',
  summary: 'Run the Billing Cycle',
  description:
    'Issues the period\'s invoices, sends the two student notices, digests the admins on standing crossings and asserts each open invoice\'s cached status. It writes no adjustment of any kind and repairs no status.',
  request: {
    body: {
      required: false,
      content: { 'application/json': { schema: RunInvoiceCycleBodySchema } },
    },
  },
  responses: { 200: json('The run report', BillingRunReportSchema), ...ERROR_RESPONSES },
});

export const voidInvoiceRoute = createRoute({
  ...common,
  method: 'post',
  path: '/invoices/{id}/void',
  summary: 'Void an Invoice',
  description: 'The reason is mandatory. The acting admin is recorded in the audit event.',
  request: { params: IdParamSchema, ...body(VoidInvoiceBodySchema) },
  responses: { 200: json('Invoice voided', InvoiceSchema), ...ERROR_RESPONSES },
});

export const applyAdjustmentRoute = createRoute({
  ...common,
  method: 'post',
  path: '/invoices/{id}/adjustments',
  summary: 'Apply an Invoice Adjustment',
  description: 'Append-only. Negative reduces what is owed; nothing accrues a fee on its own.',
  request: { params: IdParamSchema, ...body(ApplyAdjustmentBodySchema) },
  responses: { 201: json('Adjustment applied', AdjustmentSchema), ...ERROR_RESPONSES },
});

export const recordPaymentRoute = createRoute({
  ...common,
  method: 'post',
  path: '/invoices/{id}/payments',
  summary: 'Record a Payment',
  request: { params: IdParamSchema, ...body(RecordPaymentBodySchema) },
  responses: { 201: json('Payment recorded', PaymentSchema), ...ERROR_RESPONSES },
});

export const reversePaymentRoute = createRoute({
  ...common,
  method: 'post',
  path: '/payments/{id}/reverse',
  summary: 'Reverse a Payment',
  description: 'Appends the mirror-image row; the original is never updated or deleted.',
  request: { params: IdParamSchema, ...body(ReversePaymentBodySchema) },
  responses: { 201: json('Reversal recorded', PaymentSchema), ...ERROR_RESPONSES },
});

// ---------------------------------------------------------------------------
// Reports — read-only (RFC 0013 §5)
// ---------------------------------------------------------------------------

/**
 * `409` on every report is the two-currency refusal: a total that would span
 * two currencies is refused rather than rate-converted, because ArenaQuest
 * holds no exchange rate and an invented one corrupts the total silently.
 */
const REPORT_RESPONSES = {
  400: { description: 'Validation failed — a malformed month or asOf' },
  403: { description: 'Forbidden — admin only' },
  409: { description: 'The report would span two currencies; totals are never converted' },
};

export const movementReportRoute = createRoute({
  ...common,
  method: 'get',
  path: '/reports/movement',
  summary: 'Monthly Movement',
  description:
    "Billed, received and outstanding for one month, recomputed from the ledger rows. Billed is keyed off the invoice's issue date and the adjustment's applied date; received is keyed off the payment's paid date — a payment in September against an August invoice is September's received and August's billed.",
  request: {
    query: z.object({
      month: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .openapi({ param: { name: 'month', in: 'query' }, example: '2026-08' }),
    }),
  },
  responses: { 200: json('Monthly movement', MovementReportSchema), ...REPORT_RESPONSES },
});

export const agingReportRoute = createRoute({
  ...common,
  method: 'get',
  path: '/reports/aging',
  summary: 'Receivables Aging',
  description:
    "Open balances bucketed 0-30 / 31-60 / 61-90 / 90+ by days past each invoice's own due date. Boundaries are exclusive: 30 days past due and 31 days past due land in different buckets.",
  request: {
    query: z.object({
      asOf: IsoDate.optional().openapi({ param: { name: 'asOf', in: 'query' } }),
    }),
  },
  responses: { 200: json('Receivables aging', AgingReportSchema), ...REPORT_RESPONSES },
});

export const studentStatementRoute = createRoute({
  ...common,
  method: 'get',
  path: '/students/{userId}/statement',
  summary: "A Student's Statement",
  description:
    'The student\'s contracts with their chains, invoices with their adjustments and payments, the outstanding total, and the two derived membership dates: "student since" spans every contract group, "current membership since" is the root of the group now active.',
  request: { params: UserIdParamSchema },
  responses: {
    200: json('Student statement', StudentStatementSchema),
    404: { description: 'Student not found' },
    ...REPORT_RESPONSES,
  },
});

// ---------------------------------------------------------------------------
// Roster and holds (RFC 0013 §2)
//
// Standing is reported here and enforced nowhere. No route below adds a guard,
// returns a `402` or touches an enrollment grant — a student sitting
// `delinquent` keeps exactly the access they had the day before.
// ---------------------------------------------------------------------------

export const studentRosterRoute = createRoute({
  ...common,
  method: 'get',
  path: '/students',
  summary: 'The Student Billing Roster',
  description:
    "Every student with a contract, with their standing resolved from their invoices rather than read from a column: outstanding balance, oldest overdue date, next due date and whether the terms were negotiated. `standing=exempt` is the held filter — a hold is the only way to reach it. Reporting only: nothing here gates a student's access.",
  request: {
    query: z.object({
      standing: StandingSchema.optional().openapi({ param: { name: 'standing', in: 'query' } }),
      asOf: IsoDate.optional().openapi({ param: { name: 'asOf', in: 'query' } }),
    }),
  },
  responses: { 200: json('The roster', z.array(RosterEntrySchema)), ...ERROR_RESPONSES },
});

export const setHoldRoute = createRoute({
  ...common,
  method: 'post',
  path: '/holds/{userId}',
  summary: 'Hold a Student Standing',
  description:
    'Suppresses an alert, never a permission and never a total: the reported standing becomes `exempt` and the student leaves the delinquency listing and the reminder mail, while their balance stays in the movement report, the aging report and their statement. The reason is mandatory and the acting admin is recorded, so a temporary hold cannot quietly become permanent. An `expiresAt` needs nothing to run — the day after it passes the underlying standing is reported again.',
  request: { params: UserIdParamSchema, ...body(SetHoldBodySchema) },
  responses: { 201: json('Hold set', HoldSchema), ...ERROR_RESPONSES },
});

export const clearHoldRoute = createRoute({
  ...common,
  method: 'delete',
  path: '/holds/{userId}',
  summary: 'Clear a Standing Hold',
  description: 'Removes the hold. The debt it kept out of the listing was never touched.',
  request: { params: UserIdParamSchema },
  responses: { 204: { description: 'Hold cleared' }, ...ERROR_RESPONSES },
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function buildAdminBillingRouter(container: AppContainer) {
  const controller = new AdminBillingController(
    container.billing.billingService,
    container.billing.accountingService,
    // The same two ports `runScheduledBilling` hands the cron, assembled the
    // same way, so the manual twin and the cron mail through one code path.
    billingRunDeps(container.infra.mailer, container.identity.users),
  );

  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: 'ValidationError' as const, issues: result.error.issues }, 400);
      }
    },
  });

  // The dojo's finances are ADMIN-only, stricter than the admin umbrella
  // (`/v1/admin/*` admits ADMIN and CONTENT_CREATOR). Mounting billing without
  // this guard would hand every content creator the money. A tutor is
  // deliberately given nothing here (RFC 0013 §5).
  router.use('*', requireRole(ROLES.ADMIN));

  router.openapi(listPlansRoute, async (c) => {
    const q = c.req.valid('query');
    const result = await controller.listPlans({
      archived: q.archived === undefined ? undefined : q.archived === 'true',
      cycle: q.cycle,
    });
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(createPlanRoute, async (c) => {
    const result = await controller.createPlan(c.req.valid('json'), c.get('user').sub);
    return respondCreated(c, result);
  });

  router.openapi(updatePlanRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await controller.updatePlan(id, c.req.valid('json'), c.get('user').sub);
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(listSubscriptionsRoute, async (c) => {
    const result = await controller.listSubscriptions(c.req.valid('query'));
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(signContractRoute, async (c) => {
    const result = await controller.signContract(c.req.valid('json'), c.get('user').sub);
    return respondCreated(c, result);
  });

  router.openapi(changeLifecycleRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await controller.changeLifecycle(id, c.req.valid('json'), c.get('user').sub);
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(amendContractRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await controller.amendContract(id, c.req.valid('json'), c.get('user').sub);
    return respondCreated(c, result);
  });

  router.openapi(listInvoicesRoute, async (c) => {
    const result = await controller.listInvoices(c.req.valid('query'));
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(issueInvoiceRoute, async (c) => {
    const result = await controller.issueInvoice(c.req.valid('json'), c.get('user').sub);
    return respondCreated(c, result);
  });

  // The manual twin. `runBillingCycle` is the one routine; the cron in
  // `src/index.ts` reaches it through `runScheduledBilling` and this route
  // reaches it through the controller — never a second implementation.
  router.openapi(runInvoiceCycleRoute, async (c) => {
    const result = await controller.runInvoiceCycle(c.req.valid('json'), c.get('user').sub);
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(voidInvoiceRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await controller.voidInvoice(id, c.req.valid('json'), c.get('user').sub);
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(applyAdjustmentRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await controller.applyAdjustment(id, c.req.valid('json'), c.get('user').sub);
    return respondCreated(c, result);
  });

  router.openapi(recordPaymentRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await controller.recordPayment(id, c.req.valid('json'), c.get('user').sub);
    return respondCreated(c, result);
  });

  router.openapi(reversePaymentRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await controller.reversePayment(id, c.req.valid('json'), c.get('user').sub);
    return respondCreated(c, result);
  });

  // Reports. Read-only: none of the three writes a row, and none repairs a
  // drifted `invoices.status` cache — that divergence is reported elsewhere.

  router.openapi(movementReportRoute, async (c) => {
    const result = await controller.getMonthlyMovement(c.req.valid('query'));
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(agingReportRoute, async (c) => {
    const result = await controller.getReceivablesAging(c.req.valid('query'));
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(studentStatementRoute, async (c) => {
    const result = await controller.getStudentStatement(c.req.valid('param'));
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  // Roster and holds. Read-and-label: the roster issues three aggregate reads
  // and resolves in memory, and a hold writes one row that no guard ever reads.

  router.openapi(studentRosterRoute, async (c) => {
    const result = await controller.listStudentRoster(c.req.valid('query'));
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(setHoldRoute, async (c) => {
    const { userId } = c.req.valid('param');
    const result = await controller.setHold(userId, c.req.valid('json'), c.get('user').sub);
    return respondCreated(c, result);
  });

  router.openapi(clearHoldRoute, async (c) => {
    const { userId } = c.req.valid('param');
    const result = await controller.clearHold(userId, c.get('user').sub);
    return respondNoContent(c, result);
  });

  return router;
}
