import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { requireRole } from '@api/middleware/require-role';
import { ROLES } from '@arenaquest/shared/constants/roles';
import {
  AdminBillingController,
  AdminEventChargeController,
} from '@api/controllers/admin-billing.controller';
import { billingRunDeps } from '@api/core/billing/billing-service';
import { recordJobRun, billingOutcome } from '@api/jobs/record-job-run';
import { runReconcilePayments } from '@api/jobs/reconcile-payments';
import { Entities } from '@arenaquest/shared/types/entities';
import { respondWith, respondCreated, respondNoContent } from '@api/routes/_shared/envelope';
import {
  CheckoutSessionSchema,
  CreateCheckoutOnBehalfBodySchema,
  DismissedPaymentExceptionSchema,
  DismissPaymentExceptionBodySchema,
  ErrorBody,
  PaymentExceptionListSchema,
  ReconcilePaymentsRunSchema,
  PaymentConflictBody,
  PayOptionSchema,
  PendingCheckoutSchema,
  PendingCheckoutsSummarySchema,
  RefundConflictBody,
  RefundBusyBody,
  RefundUnrecordedBody,
  ValidationErrorBody,
} from '@api/openapi/components';
import { runMissionHook } from '@api/core/missions/hook';
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


/**
 * How a gateway payment was made (RFC 0026 §7; M30 Task 17) — **admin
 * responses only**: the admin statement and the charge detail set both keys on
 * every payment row (`null` when unknown); the student statement
 * (`GET /v1/me/billing`) and the record / reverse answers never carry them.
 */
const GATEWAY_METHOD_FIELDS = {
  gatewayMethod: z
    .enum(['pix', 'card', 'boleto', 'other'])
    .nullable()
    .optional()
    .openapi({
      description:
        'Admin statement and charge detail only. The normalised method of a payment a hosted checkout ' +
        'landed; `other` is anything the platform does not offer by name (e.g. the payer\'s provider ' +
        'balance). `null` for every other row — a non-gateway payment, a hand-matched gateway row, a refund.',
      example: 'other',
    }),
  gatewayMethodLabel: z
    .string()
    .max(64)
    .nullable()
    .optional()
    .openapi({
      description:
        'Admin statement and charge detail only. The provider\'s own name for the method — its ' +
        'identifiers, `[a-z0-9_/-]`, never free text: `account_money`, `credit_card/visa`, ' +
        '`ticket/bolbradesco`, `bank_transfer/pix`. `null` when unknown. Display only.',
      example: 'account_money',
    }),
};

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
    ...GATEWAY_METHOD_FIELDS,
  })
  .openapi('BillingPayment');

/**
 * `201` of the two record-payment routes: the row, plus the receivable's
 * hosted checkout still in progress so the form can warn (RFC 0026 §7).
 */
const RECORDED_PENDING_CHECKOUT = PendingCheckoutSchema.nullable().openapi({
  description:
    'The hosted checkout still in progress on this receivable, or `null`. The payment was recorded ' +
    'either way; a non-null value means the student holds a live link and may pay again online — the ' +
    'reconcile run expires it on its own.',
});

const RecordedPaymentSchema = PaymentSchema.extend({
  pendingCheckout: RECORDED_PENDING_CHECKOUT,
}).openapi('BillingRecordedPayment');

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
    /** The extras rail of the month, from event charges only. */
    extras: z
      .object({
        chargedMinor: MinorUnits,
        adjustmentsMinor: MinorUnits,
        receivedMinor: MinorUnits,
        chargesIssued: z.number().int(),
        receivableAtCloseMinor: MinorUnits,
      })
      .openapi('BillingMovementExtras'),
    /** Cash that entered the till in the month, both rails. Not a standing, not a receivable. */
    cashReceivedMinor: MinorUnits,
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

const RailSchema = z.enum(['contract', 'extras']).openapi({ example: 'contract' });

const AgingReportSchema = z
  .object({
    asOf: IsoDate,
    /** The one rail bucketed; on `extras` the counts count event charges. */
    rail: RailSchema,
    currency: ReportCurrencySchema,
    buckets: z.array(AgingBucketSchema),
    totalMinor: MinorUnits,
    invoiceCount: z.number().int(),
    studentCount: z.number().int(),
  })
  .openapi('BillingAgingReport');

/** The receivable's live hosted checkout (RFC 0026 §7); null when none is in progress. */
const PendingCheckoutField = PendingCheckoutSchema.nullable().openapi({
  description:
    'The live hosted checkout of this receivable — open, with a provider session and not yet ' +
    'expired — or `null`. A receivable has at most one.',
});

const StatementInvoiceSchema = InvoiceWithBalanceSchema.extend({
  adjustments: z.array(AdjustmentSchema),
  payments: z.array(PaymentSchema),
  pendingCheckout: PendingCheckoutField,
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

// The extras rail's record schemas (RFC 0015 §3), declared before the statement
// because the statement's `extras` block lists charges with their ledger.
const ChargeStatusSchema = z.enum(['open', 'paid', 'void']);

const EventChargeSchema = z
  .object({
    id: z.string(),
    eventId: z.string(),
    userId: z.string(),
    description: z.string(),
    amountMinor: MinorUnits,
    currency: z.string(),
    termsSource: TermsSourceSchema,
    termsNote: z.string(),
    dueDate: IsoDate,
    graceDays: z.number().int(),
    status: ChargeStatusSchema,
    issuedBy: z.string(),
    issuedAt: z.string(),
    voidedAt: z.string().nullable(),
    voidReason: z.string().nullable(),
  })
  .openapi('BillingEventCharge');

const EventChargeWithBalanceSchema = EventChargeSchema.extend({
  balanceMinor: MinorUnits,
}).openapi('BillingEventChargeWithBalance');

const ChargeAdjustmentSchema = z
  .object({
    id: z.string(),
    chargeId: z.string(),
    kind: AdjustmentKindSchema,
    amountMinor: MinorUnits,
    reason: z.string(),
    appliedBy: z.string(),
    appliedAt: z.string(),
  })
  .openapi('BillingEventChargeAdjustment');

const ChargePaymentSchema = z
  .object({
    id: z.string(),
    chargeId: z.string(),
    amountMinor: MinorUnits,
    currency: z.string(),
    method: PaymentMethodSchema,
    paidAt: z.string(),
    externalReference: z.string().nullable(),
    note: z.string(),
    reversesId: z.string().nullable(),
    recordedBy: z.string(),
    recordedAt: z.string(),
    ...GATEWAY_METHOD_FIELDS,
  })
  .openapi('BillingEventChargePayment');

const RecordedChargePaymentSchema = ChargePaymentSchema.extend({
  pendingCheckout: RECORDED_PENDING_CHECKOUT,
}).openapi('BillingRecordedEventChargePayment');

/** One row of the admin charge list: the charge, its balance and its payment in progress. */
const EventChargeListItemSchema = EventChargeWithBalanceSchema.extend({
  pendingCheckout: PendingCheckoutSchema.nullable().openapi({
    description:
      'The live hosted checkout of this charge — open, with a provider session and not yet expired — ' +
      'or `null`. Always `null` for a charge that is not `open`.',
  }),
}).openapi('BillingEventChargeListItem');

const EventChargeDetailSchema = EventChargeWithBalanceSchema.extend({
  adjustments: z.array(ChargeAdjustmentSchema),
  payments: z.array(ChargePaymentSchema),
}).openapi('BillingEventChargeDetail');

/** One event charge on a statement: the charge, its event, and its whole ledger. */
const StatementChargeSchema = EventChargeDetailSchema.extend({
  eventTitle: z.string().openapi({ example: 'Seminário de Inverno' }),
  /** When the event starts; null when the event no longer exists. */
  eventStartsAt: z.string().nullable().openapi({ example: '2026-07-18T13:00:00.000Z' }),
  pendingCheckout: PendingCheckoutField,
}).openapi('BillingStatementCharge');

export const StandingSchema = z
  .enum(['good', 'due', 'delinquent', 'exempt'])
  .openapi({ example: 'delinquent' });

/**
 * The extras rail of a statement (RFC 0015 §7): its own standing and its own
 * outstanding, beside — never summed into — the contract `outstandingMinor`.
 */
const StatementExtrasSchema = z
  .object({
    standing: StandingSchema,
    oldestOverdueDate: IsoDate.nullable(),
    outstandingMinor: MinorUnits,
    charges: z.array(StatementChargeSchema),
  })
  .openapi('BillingStatementExtras');

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
    extras: StatementExtrasSchema,
    payOptions: z.array(PayOptionSchema).openapi({
      description:
        'The providers a receivable can be paid through and the methods each offers, in the ' +
        'label\'s list order. Empty when online payment is off or misconfigured — the statement ' +
        'never fails on payment configuration.',
    }),
  })
  .openapi('BillingStudentStatement');

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
 * The contract rail of one roster line: RFC 0013's standing, resolved on every
 * read from the contract's invoices, the hold and `asOf`.
 */
const RosterContractSchema = z
  .object({
    id: z.string(),
    groupId: z.string(),
    status: ContractStatusSchema,
    nextDueDate: IsoDate.nullable(),
    negotiatedTerms: z.boolean(),
    standing: StandingSchema,
    oldestOverdueDate: IsoDate.nullable(),
    outstandingMinor: MinorUnits,
  })
  .openapi('BillingRosterContract');

/**
 * The extras rail of one roster line: resolved from event charges only, never
 * held — a contract hold does not reach it.
 */
const RosterExtrasSchema = z
  .object({
    standing: StandingSchema,
    oldestOverdueDate: IsoDate.nullable(),
    outstandingMinor: MinorUnits,
    /** Live charges with a positive balance. */
    openCharges: z.number().int(),
    /** Of those, the ones whose due date has arrived. */
    overdueCharges: z.number().int(),
  })
  .openapi('BillingRosterExtras');

/**
 * One roster line (RFC 0015 §4). Two rails side by side and **no top-level
 * standing or total**, so nothing can read one number as both. `contract` is
 * null for a buyer with no contract; `extras` is null for someone never
 * charged for an extra. Nothing here gates anything: a `delinquent` rail
 * changes no permission.
 */
const RosterEntrySchema = z
  .object({
    userId: z.string(),
    asOf: IsoDate,
    currency: z.string().openapi({ example: 'BRL' }),
    contract: RosterContractSchema.nullable(),
    extras: RosterExtrasSchema.nullable(),
    /** The stored row, expired or not; `contract.standing === 'exempt'` says whether it bites. */
    hold: HoldSchema.nullable(),
    /** "Pending online payment": the student's hosted checkouts in progress, both rails. */
    pendingCheckouts: PendingCheckoutsSummarySchema,
  })
  .openapi('BillingRosterEntry');

/** One student who moved into `due` or `delinquent` on one rail since the previous run. */
const RunCrossingSchema = z.object({
  userId: z.string(),
  from: StandingSchema,
  to: StandingSchema,
  oldestOverdueDate: IsoDate.nullable(),
  outstandingMinor: MinorUnits,
  currency: z.string(),
});

/** What happened to one rail's reminders on one run. */
const ReminderCountsSchema = z.object({
  sent: z.number().int(),
  suppressed: z.number().int(),
  undeliverable: z.number().int(),
});

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
    /** "Crossed on the monthly fee" — contract invoices only. */
    crossings: z.array(RunCrossingSchema),
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
    /**
     * Extras notices (RFC 0015 §5), kept apart from the contract `reminders`.
     * No `suppressedByHold`: a contract hold never reaches the extras rail.
     */
    extrasReminders: z.array(
      z.object({
        chargeId: z.string(),
        eventId: z.string(),
        /** The event title snapshot the message names. */
        description: z.string(),
        userId: z.string(),
        kind: z.enum(['extras_due_date', 'extras_grace_lapsed']),
        dueDate: IsoDate,
        triggerOn: IsoDate,
        balanceMinor: MinorUnits,
        currency: z.string(),
        sent: z.boolean(),
      }),
    ),
    /** "Crossed on extras" — resolved from charges alone, with no hold. */
    extrasCrossings: z.array(RunCrossingSchema),
    /** Per-rail reminder tallies, never summed across rails. */
    reminderCounts: z.object({
      contract: ReminderCountsSchema,
      /** `suppressed` is always 0: the extras rail has no hold. */
      extras: ReminderCountsSchema,
    }),
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

/**
 * The two payment routes: with `method: 'gateway'` the reference must read
 * `<provider>:<id>` (`400`) and may sit on the ledger once (`409
 * PAYMENT_REFERENCE_EXISTS`, RFC 0026 §5).
 */
const PAYMENT_RESPONSES = {
  ...ERROR_RESPONSES,
  400: {
    description:
      'Validation failed — including a `gateway` payment whose externalReference is not `<provider>:<id>`',
  },
  409: json(
    'Conflict — `PAYMENT_REFERENCE_EXISTS` when a gateway payment with this reference is already on the ledger (`paymentId` names it); otherwise a void receivable',
    PaymentConflictBody,
  ),
};

const PAYMENT_BODY_DESCRIPTION =
  'With `method: "gateway"` the `externalReference` is required, must read `<provider>:<id>` for a known provider, and is unique on the ledger. ' +
  'Recording a payment on a receivable with a hosted checkout in progress is allowed (the student may have paid at the door): the answer carries that checkout as `pendingCheckout` so the form can warn.';

/**
 * The two reverse routes. A row whose `method` is anything but `gateway` is
 * RFC 0013's reversal, unchanged (`201`, no provider call). A `gateway` row is
 * a refund (RFC 0026 §5) and answers `200`.
 */
const REVERSE_DESCRIPTION =
  'Appends the mirror-image row; the original is never updated or deleted. A reversal cannot be reversed, and a payment is reversed at most once. ' +
  '**A payment whose `method` is `gateway` is refunded at its provider first** (full amount only), in this order: the provider named by the reference prefix must still be bound (`409 PAYMENTS_PROVIDER_NOT_ENABLED`) → the payment is read from the provider → a full refund it already holds is recorded under that refund id, or the row already carrying it is returned (`200`, nothing refunded again) → otherwise the refund is requested under an idempotency key derived from the payment row → a refusal is `409 PAYMENTS_REFUND_REFUSED` and **nothing is written**; a provider that cannot take the request right now (rate limit, timeout — refunds fired back to back are rate-limited) is `503 PAYMENTS_PROVIDER_BUSY`, also with nothing written, and the same request repeated a few seconds later completes → accepted and written is `200` → accepted but not written is `503 PAYMENTS_REFUND_UNRECORDED`, and the same request repeated completes it. ' +
  'The reversal row carries `method: "gateway"`, `reversesId` and `externalReference: "<provider>:<refund id>"`. Repeating the request answers `200` with the same row. Every other method never calls a provider.';

const jsonError = (description: string) => json(description, ErrorBody);

const REVERSE_RESPONSES = {
  ...ERROR_RESPONSES,
  409: json(
    'Conflict. For a gateway payment: `PAYMENTS_PROVIDER_NOT_ENABLED` or `PAYMENTS_REFUND_REFUSED` — nothing was written',
    RefundConflictBody,
  ),
  500: jsonError('`PAYMENTS_CONFIG_INVALID`: the provider list or its secrets are invalid (gateway payments only)'),
  502: jsonError(
    '`PAYMENTS_PROVIDER_ERROR`: the provider could not be asked about the payment; no refund was requested and nothing was written',
  ),
  503: json(
    'Repeat the same request — it cannot refund twice. `PAYMENTS_REFUND_UNRECORDED` (with `refundId`): the provider returned the money and the reversal was not written. `PAYMENTS_PROVIDER_BUSY`: the provider could not take the request right now (rate limit, timeout); nothing was refunded by this call and nothing was written',
    z.union([RefundUnrecordedBody, RefundBusyBody]),
  ),
};

/**
 * The two on-behalf checkout routes (RFC 0026 §3; milestone 30 decision 22 for
 * the charge path).
 */
const ON_BEHALF_DESCRIPTION =
  'Opens the hosted checkout for the **full open balance** of a student\'s receivable, or hands back the one already open, and answers the URL the admin hands over. ' +
  'Same rules as `POST /v1/me/billing/checkouts`: one live checkout per receivable (`200` with the same session while more than five minutes remain, replaced otherwise; another provider cancels the first). ' +
  'The student is the receivable\'s own — the request names none — and the admin is recorded as `createdBy`. Nothing is charged to anyone until the student pays, and the student\'s hourly limit is not consumed. ' +
  'Refusals, in order: `403` → `500 PAYMENTS_CONFIG_INVALID` / `404` (no provider on this label) → `400` → `404` → `409 RECEIVABLE_NOT_PAYABLE` → `409 PAYMENTS_UNSUPPORTED_CURRENCY` → `502 PAYMENTS_PROVIDER_ERROR`. ' +
  'The provider is told to notify the API origin this request was made on (`<origin>/v1/webhooks/payments/<provider>`). Sent with `Cache-Control: private, no-store`.';

const ON_BEHALF_RESPONSES = {
  200: json('The receivable already had an open checkout; this is it', CheckoutSessionSchema),
  201: json('A new hosted checkout was opened', CheckoutSessionSchema),
  400: json(
    'Invalid body, or `PAYMENT_PROVIDER_REQUIRED`: several providers offer a method and none was named, or the one named offers no method on this label',
    z.union([ErrorBody, ValidationErrorBody]),
  ),
  403: { description: 'Forbidden — admin only' },
  404: jsonError(
    'The receivable does not exist. Also the answer of a label with no payment provider (`PAYMENTS_PROVIDERS = none`): the route does not exist there',
  ),
  409: jsonError(
    '`RECEIVABLE_NOT_PAYABLE`: void, settled or with no balance. `PAYMENTS_UNSUPPORTED_CURRENCY`: the provider cannot settle the receivable\'s currency. `CHECKOUT_IN_PROGRESS`: a concurrent request is opening this receivable\'s checkout — ask again',
  ),
  500: jsonError('`PAYMENTS_CONFIG_INVALID`: the provider list or its secrets are invalid'),
  502: jsonError('`PAYMENTS_PROVIDER_ERROR`: the provider did not open the session; nothing is left open'),
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

/** The `method` of a ledger row a provider collected — and of its reversal. */
const GATEWAY_METHOD = Entities.Config.PaymentMethod.GATEWAY;

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
  description: PAYMENT_BODY_DESCRIPTION,
  request: { params: IdParamSchema, ...body(RecordPaymentBodySchema) },
  responses: { 201: json('Payment recorded', RecordedPaymentSchema), ...PAYMENT_RESPONSES },
});

export const reversePaymentRoute = createRoute({
  ...common,
  method: 'post',
  path: '/payments/{id}/reverse',
  summary: 'Reverse a Payment',
  description: REVERSE_DESCRIPTION,
  request: { params: IdParamSchema, ...body(ReversePaymentBodySchema) },
  responses: {
    200: json('Gateway payment refunded at its provider; the reversal is on the ledger', PaymentSchema),
    201: json('Reversal recorded (any method but `gateway`)', PaymentSchema),
    ...REVERSE_RESPONSES,
  },
});

export const createInvoiceCheckoutRoute = createRoute({
  ...common,
  method: 'post',
  path: '/invoices/{id}/checkouts',
  summary: 'Open a Checkout for a Student\'s Invoice',
  description: ON_BEHALF_DESCRIPTION,
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: CreateCheckoutOnBehalfBodySchema } }, required: true },
  },
  responses: ON_BEHALF_RESPONSES,
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
    "Billed, received and outstanding for one month, recomputed from the ledger rows. Billed is keyed off the invoice's issue date and the adjustment's applied date; received is keyed off the payment's paid date — a payment in September against an August invoice is September's received and August's billed. Every top-level field is the contract rail only; `extras` reports event charges on the same date rules, and `cashReceivedMinor` is the one cross-rail figure — money that entered the till.",
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
    "Open balances bucketed 0-30 / 31-60 / 61-90 / 90+ by days past each item's own due date. Boundaries are exclusive: 30 days past due and 31 days past due land in different buckets. `rail` picks the one rail aged — `contract` (invoices, the default, unchanged) or `extras` (event charges); the two are never bucketed together.",
  request: {
    query: z.object({
      asOf: IsoDate.optional().openapi({ param: { name: 'asOf', in: 'query' } }),
      rail: RailSchema.optional().openapi({ param: { name: 'rail', in: 'query' } }),
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
    'The student\'s contracts with their chains, invoices with their adjustments and payments, the outstanding total, and the two derived membership dates: "student since" spans every contract group, "current membership since" is the root of the group now active. `outstandingMinor` is the contract rail only; the sibling `extras` object carries the extras rail — its own standing, outstanding and each event charge with its event title, date and ledger.',
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
    "Every user with a contract or any event charge, with two standings resolved side by side and never merged: `contract` (from contract invoices only — outstanding balance, oldest overdue date, next due date, negotiated terms; null when there is no contract) and `extras` (from event charges only — outstanding balance, oldest overdue date, open and overdue charge counts; null when never charged). There is no top-level standing or total. `pendingCheckouts` is the line's \"pending online payment\": how many of the student's open receivables, on both rails, have a hosted checkout in progress, and when the first expires. `contractStanding` and `extrasStanding` filter independently; `standing` is kept as an alias of `contractStanding`. `contractStanding=exempt` is the held filter — a hold applies to the contract rail only. Reporting only: nothing here gates a student's access.",
  request: {
    query: z.object({
      contractStanding: StandingSchema.optional().openapi({
        param: { name: 'contractStanding', in: 'query' },
      }),
      extrasStanding: StandingSchema.optional().openapi({
        param: { name: 'extrasStanding', in: 'query' },
      }),
      standing: StandingSchema.optional().openapi({
        param: { name: 'standing', in: 'query' },
        description: 'Deprecated alias of `contractStanding`.',
      }),
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
// Extras rail (RFC 0015 §7)
//
// One-off charges for an event, on a ledger of their own. Every route below
// sits behind this router's `requireRole(ROLES.ADMIN)`, and none of them reads
// or writes an enrollment or an audience grant: a charge grants nothing, and
// `outsideAudience` is a warning, never a write. Money stays out of
// `routes/admin/events.ts`.
// ---------------------------------------------------------------------------

const EventIdParamSchema = z.object({
  eventId: z.string().openapi({ param: { name: 'eventId', in: 'path' }, example: 'event-id' }),
});

const EventPriceSchema = z
  .object({
    eventId: z.string(),
    amountMinor: MinorUnits,
    currency: z.string().openapi({ example: 'BRL' }),
    dueInDays: z.number().int(),
    graceDays: z.number().int(),
    updatedBy: z.string(),
    updatedAt: z.string(),
  })
  .openapi('BillingEventPrice');

const IssueChargesResultSchema = z
  .object({
    created: z.array(EventChargeSchema),
    /** Pairs that already had a live charge; a retry creates nothing. */
    absorbed: z.array(z.object({ eventId: z.string(), userId: z.string() })),
    /** Charged users who cannot see a restricted event. A warning only. */
    outsideAudience: z.array(z.string()),
  })
  .openapi('BillingIssueEventChargesResult');

const EventChargeSummarySchema = z
  .object({
    eventId: z.string(),
    currency: z.string(),
    chargedMinor: MinorUnits,
    adjustmentsMinor: MinorUnits,
    receivedMinor: MinorUnits,
    outstandingMinor: MinorUnits,
    chargeCount: z.number().int(),
    counts: z.object({
      open: z.number().int(),
      paid: z.number().int(),
      void: z.number().int(),
    }),
  })
  .openapi('BillingEventChargeSummary');

const AudienceCheckSchema = z
  .object({
    eventId: z.string(),
    audience: z.enum(['public', 'members', 'restricted']),
    outsideAudience: z.array(z.string()),
  })
  .openapi('BillingEventAudienceCheck');

const SetEventPriceBodySchema = z
  .object({
    amountMinor: MinorUnits.min(0),
    /** Optional; must be the tenant's active currency. */
    currency: z.string().optional().openapi({ example: 'BRL' }),
    dueInDays: z.number().int().min(0).optional().openapi({ example: 7 }),
    graceDays: z.number().int().min(0).optional().openapi({ example: 5 }),
  })
  .openapi('SetEventPriceBody');

const IssueEventChargesBodySchema = z
  .object({
    eventId: z.string().min(1),
    userIds: z.array(z.string().min(1)).min(1).max(200),
    amountMinor: MinorUnits.min(0).optional(),
    currency: z.string().optional(),
    dueDate: IsoDate.optional(),
    graceDays: z.number().int().min(0).optional(),
    termsNote: z.string().optional(),
  })
  .openapi('IssueEventChargesBody');

const VoidChargeBodySchema = z
  .object({ reason: z.string().openapi({ example: 'Seminar cancelled for this student.' }) })
  .openapi('VoidEventChargeBody');

export const getEventPriceRoute = createRoute({
  ...common,
  method: 'get',
  path: '/event-prices/{eventId}',
  summary: "An Event's Price",
  description: 'The list price of an event, or `404` when the event is not for sale.',
  request: { params: EventIdParamSchema },
  responses: { 200: json('Event price', EventPriceSchema), ...ERROR_RESPONSES },
});

export const setEventPriceRoute = createRoute({
  ...common,
  method: 'put',
  path: '/event-prices/{eventId}',
  summary: "Set an Event's Price",
  description:
    "Creates or replaces the event's price in the tenant's active currency. Charges already issued keep their own snapshot.",
  request: { params: EventIdParamSchema, ...body(SetEventPriceBodySchema) },
  responses: { 200: json('Event price set', EventPriceSchema), ...ERROR_RESPONSES },
});

export const clearEventPriceRoute = createRoute({
  ...common,
  method: 'delete',
  path: '/event-prices/{eventId}',
  summary: "Clear an Event's Price",
  description: 'Stops offering the event. Existing charges are untouched.',
  request: { params: EventIdParamSchema },
  responses: { 204: { description: 'Price cleared' }, ...ERROR_RESPONSES },
});

export const listEventChargesRoute = createRoute({
  ...common,
  method: 'get',
  path: '/charges',
  summary: 'List Event Charges',
  request: {
    query: z.object({
      eventId: z.string().optional(),
      userId: z.string().optional(),
      status: ChargeStatusSchema.optional(),
    }),
  },
  responses: {
    200: json(
      'Charges with their balances and their payment in progress',
      z.array(EventChargeListItemSchema),
    ),
    ...ERROR_RESPONSES,
  },
});

export const issueEventChargesRoute = createRoute({
  ...common,
  method: 'post',
  path: '/charges',
  summary: 'Charge Users for an Event',
  description:
    'Issues one charge per user (1–200) for one published event (`409` for draft or archived). Idempotent: a pair with a live charge is reported under `absorbed`. Without `amountMinor` the price is snapshot as standard; any other amount is negotiated and needs a `termsNote`. For a restricted event, `outsideAudience` lists the users who cannot see it — the charge is still issued and no audience row is written.',
  request: body(IssueEventChargesBodySchema),
  responses: {
    201: json('At least one charge created', IssueChargesResultSchema),
    200: json('Nothing created; every pair was absorbed', IssueChargesResultSchema),
    ...ERROR_RESPONSES,
  },
});

export const getEventChargeRoute = createRoute({
  ...common,
  method: 'get',
  path: '/charges/{id}',
  summary: 'An Event Charge with its Ledger',
  request: { params: IdParamSchema },
  responses: { 200: json('Charge with its ledger', EventChargeDetailSchema), ...ERROR_RESPONSES },
});

export const voidEventChargeRoute = createRoute({
  ...common,
  method: 'post',
  path: '/charges/{id}/void',
  summary: 'Void an Event Charge',
  description:
    'The reason is mandatory. Refused with `409` while the charge has net payments — reverse them first.',
  request: { params: IdParamSchema, ...body(VoidChargeBodySchema) },
  responses: { 200: json('Charge voided', EventChargeSchema), ...ERROR_RESPONSES },
});

export const applyChargeAdjustmentRoute = createRoute({
  ...common,
  method: 'post',
  path: '/charges/{id}/adjustments',
  summary: 'Apply an Event Charge Adjustment',
  description: 'Append-only, signed, non-zero and reasoned. Negative reduces what is owed.',
  request: { params: IdParamSchema, ...body(ApplyAdjustmentBodySchema) },
  responses: { 201: json('Adjustment applied', ChargeAdjustmentSchema), ...ERROR_RESPONSES },
});

export const recordChargePaymentRoute = createRoute({
  ...common,
  method: 'post',
  path: '/charges/{id}/payments',
  summary: 'Record an Event Charge Payment',
  description: PAYMENT_BODY_DESCRIPTION,
  request: { params: IdParamSchema, ...body(RecordPaymentBodySchema) },
  responses: { 201: json('Payment recorded', RecordedChargePaymentSchema), ...PAYMENT_RESPONSES },
});

export const createChargeCheckoutRoute = createRoute({
  ...common,
  method: 'post',
  path: '/charges/{id}/checkouts',
  summary: 'Open a Checkout for a Student\'s Event Charge',
  description: ON_BEHALF_DESCRIPTION,
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: CreateCheckoutOnBehalfBodySchema } }, required: true },
  },
  responses: ON_BEHALF_RESPONSES,
});

export const reverseChargePaymentRoute = createRoute({
  ...common,
  method: 'post',
  path: '/charge-payments/{id}/reverse',
  summary: 'Reverse an Event Charge Payment',
  description: REVERSE_DESCRIPTION,
  request: { params: IdParamSchema, ...body(ReversePaymentBodySchema) },
  responses: {
    200: json('Gateway payment refunded at its provider; the reversal is on the ledger', ChargePaymentSchema),
    201: json('Reversal recorded (any method but `gateway`)', ChargePaymentSchema),
    ...REVERSE_RESPONSES,
  },
});

export const eventChargeSummaryRoute = createRoute({
  ...common,
  method: 'get',
  path: '/events/{eventId}/summary',
  summary: "An Event's Charge Summary",
  description:
    'Charged, signed adjustments, received and outstanding over the non-void charges (`chargedMinor + adjustmentsMinor - receivedMinor = outstandingMinor`), plus counts by status.',
  request: { params: EventIdParamSchema },
  responses: { 200: json('Event charge summary', EventChargeSummarySchema), ...ERROR_RESPONSES },
});

export const eventAudienceCheckRoute = createRoute({
  ...common,
  method: 'get',
  path: '/events/{eventId}/audience-check',
  summary: 'Check Buyers Against an Event Audience',
  description:
    'Read-only: lists the given users a restricted event is not addressed to. Always empty for public and members events.',
  request: {
    params: EventIdParamSchema,
    query: z.object({
      userIds: z
        .string()
        .openapi({ param: { name: 'userIds', in: 'query' }, example: 'user-a,user-b' }),
    }),
  },
  responses: { 200: json('Audience check', AudienceCheckSchema), ...ERROR_RESPONSES },
});

// ---------------------------------------------------------------------------
// Payment reconcile and exceptions (RFC 0026 §6, §7)
// ---------------------------------------------------------------------------

export const reconcilePaymentsRoute = createRoute({
  ...common,
  method: 'post',
  path: '/payments/reconcile',
  summary: 'Run the Payment Reconcile',
  description:
    'Runs the hourly reconcile job on demand, with the same caps: at most 25 checkouts are asked about at their provider and 10 unsettled events retried; the rest is counted as deferred and taken first by the next run. ' +
    'A payment the provider holds whose notification never arrived lands exactly as a webhook would land it. The run is recorded as a `reconcile_payments` job run with `trigger: manual`. ' +
    '`200` even when the run failed — read `status`. `404` on a label with no payment provider (nothing is recorded).',
  responses: {
    200: json('The run and its counts', ReconcilePaymentsRunSchema),
    403: { description: 'Forbidden — admin only' },
    404: jsonError('No payment provider is bound on this label'),
    500: jsonError('`PAYMENTS_CONFIG_INVALID`: the provider list, a secret or the `PAYMENTS_KEY_MODE` value is invalid; the failed run is recorded'),
  },
});

export const listPaymentExceptionsRoute = createRoute({
  ...common,
  method: 'get',
  path: '/payments/exceptions',
  summary: 'List Payment Exceptions',
  description:
    'What the gateway could not settle on its own, oldest first: `orphan`, `mismatch` and `failed` events, events left `received` for over an hour, checkouts in `mismatch` and checkouts under dispute. Dismissed rows are excluded. ' +
    'Reads the database only — no provider is called — so it also answers on a label whose provider was unbound.',
  responses: {
    200: json('The exceptions', PaymentExceptionListSchema),
    403: { description: 'Forbidden — admin only' },
  },
});

export const dismissPaymentExceptionRoute = createRoute({
  ...common,
  method: 'post',
  path: '/payments/exceptions/dismiss',
  summary: 'Dismiss a Payment Exception',
  description:
    'Records who dismissed the row, when and why, and removes it from the list and from the reconcile run\'s stale count. It changes no status, no outcome and writes no ledger row. ' +
    '`404` when the `ref` names nothing currently on the list (unknown, or already dismissed).',
  request: body(DismissPaymentExceptionBodySchema),
  responses: {
    200: json('Dismissed', DismissedPaymentExceptionSchema),
    400: { description: 'Validation failed — a malformed `ref`, or a note that is blank or longer than 500 characters' },
    403: { description: 'Forbidden — admin only' },
    404: jsonError('The `ref` names nothing on the exceptions list'),
  },
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
    container.payments.gatewayService,
    // The job the hourly trigger runs (`src/index.ts`), recorded as a manual
    // run with the admin as its actor — never a second implementation.
    (actorId) =>
      runReconcilePayments(
        {
          config: container.payments.config,
          gateways: container.payments.gateways,
          gatewayRepo: container.payments.gatewayRepo,
          gatewayService: container.payments.gatewayService,
          jobRuns: container.infra.jobRuns,
        },
        { trigger: Entities.Config.JobTrigger.MANUAL, actorId },
      ),
  );
  const extras = new AdminEventChargeController(
    container.billing.eventChargeService,
    container.payments.gatewayService,
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

  // The on-behalf checkout routes exist only where a provider is bound. Asked
  // after the role guard and before the body is validated, so a label under
  // `none` answers `404` to any body and an invalid provider list is a loud
  // `500` — the student routes' own order (RFC 0026 §3).
  const privateNoStore: MiddlewareHandler = async (c, next) => {
    await next();
    c.header('Cache-Control', 'private, no-store');
  };
  const checkoutGate: MiddlewareHandler = async (c, next) => {
    const closed = controller.checkoutGate();
    if (closed && !closed.ok) return c.json({ error: closed.error }, closed.status as 404 | 500);
    return next();
  };
  for (const path of ['/invoices/:id/checkouts', '/charges/:id/checkouts']) {
    router.use(path, privateNoStore);
    router.use(path, checkoutGate);
  }
  router.use('/payments/reconcile', privateNoStore);
  router.use('/payments/exceptions', privateNoStore);
  router.use('/payments/exceptions/*', privateNoStore);

  router.openapi(reconcilePaymentsRoute, async (c) => {
    const result = await controller.reconcilePayments(c.get('user').sub);
    if (!result.ok) return c.json({ error: result.error }, result.status as 404 | 500);
    return c.json(result.data, 200);
  });

  router.openapi(listPaymentExceptionsRoute, async (c) => {
    const result = await controller.listPaymentExceptions();
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(dismissPaymentExceptionRoute, async (c) => {
    const result = await controller.dismissPaymentException(c.req.valid('json'), c.get('user').sub);
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

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
  //
  // The run is recorded as a `job_runs` row with `trigger = 'manual'` and the
  // admin as its actor (RFC 0025 §3.1) - here rather than in the controller,
  // because who triggered it is an HTTP concern. The response is unchanged.
  router.openapi(runInvoiceCycleRoute, async (c) => {
    const actorId = c.get('user').sub;
    const result = await recordJobRun(
      container.infra.jobRuns,
      { job: Entities.Config.JobName.BILLING, trigger: Entities.Config.JobTrigger.MANUAL, actorId },
      () => controller.runInvoiceCycle(c.req.valid('json'), actorId),
      billingOutcome,
    );
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
    // A refund answers `200` however often it is asked; a mirror row is `201`.
    if (result.ok && result.data.method === GATEWAY_METHOD) return c.json(result.data, 200);
    return respondCreated(c, result);
  });

  router.openapi(createInvoiceCheckoutRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await controller.createCheckout(id, c.req.valid('json'), c.get('user').sub, new URL(c.req.url).origin);
    if (result.ok) return c.json(result.data.checkout, result.data.created ? 201 : 200);
    return respondWith(c, result);
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

  // Roster and holds. Read-and-label: the roster issues four aggregate reads
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

  // Extras rail (RFC 0015 §7). Same guard as everything above; none of these
  // handlers touches an enrollment or an audience grant.

  router.openapi(getEventPriceRoute, async (c) => {
    const { eventId } = c.req.valid('param');
    const result = await extras.getPrice(eventId);
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(setEventPriceRoute, async (c) => {
    const { eventId } = c.req.valid('param');
    const result = await extras.setPrice(eventId, c.req.valid('json'), c.get('user').sub);
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(clearEventPriceRoute, async (c) => {
    const { eventId } = c.req.valid('param');
    const result = await extras.clearPrice(eventId, c.get('user').sub);
    return respondNoContent(c, result);
  });

  router.openapi(listEventChargesRoute, async (c) => {
    const result = await extras.listCharges(c.req.valid('query'));
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(issueEventChargesRoute, async (c) => {
    const result = await extras.issueCharges(c.req.valid('json'), c.get('user').sub);
    if (!result.ok) return respondWith(c, result);
    // A retry that created nothing is a success, not a creation.
    return result.data.created.length > 0 ? c.json(result.data, 201) : c.json(result.data, 200);
  });

  router.openapi(getEventChargeRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await extras.getCharge(id);
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(voidEventChargeRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await extras.voidCharge(id, c.req.valid('json'), c.get('user').sub);
    if (!result.ok) return respondWith(c, result);
    await runMissionHook(container, { kind: 'event_charge', userId: result.data.userId, eventId: result.data.eventId });
    return c.json(result.data, 200);
  });

  router.openapi(applyChargeAdjustmentRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await extras.applyAdjustment(id, c.req.valid('json'), c.get('user').sub);
    if (result.ok) await runMissionHook(container, { kind: 'event_charge_by_id', chargeId: result.data.chargeId });
    return respondCreated(c, result);
  });

  router.openapi(recordChargePaymentRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await extras.recordPayment(id, c.req.valid('json'), c.get('user').sub);
    if (result.ok) await runMissionHook(container, { kind: 'event_charge_by_id', chargeId: result.data.chargeId });
    return respondCreated(c, result);
  });

  router.openapi(reverseChargePaymentRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await extras.reversePayment(id, c.req.valid('json'), c.get('user').sub);
    if (result.ok) await runMissionHook(container, { kind: 'event_charge_by_id', chargeId: result.data.chargeId });
    if (result.ok && result.data.method === GATEWAY_METHOD) return c.json(result.data, 200);
    return respondCreated(c, result);
  });

  router.openapi(createChargeCheckoutRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await extras.createCheckout(id, c.req.valid('json'), c.get('user').sub, new URL(c.req.url).origin);
    if (result.ok) return c.json(result.data.checkout, result.data.created ? 201 : 200);
    return respondWith(c, result);
  });

  router.openapi(eventChargeSummaryRoute, async (c) => {
    const { eventId } = c.req.valid('param');
    const result = await extras.getEventSummary(eventId);
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(eventAudienceCheckRoute, async (c) => {
    const { eventId } = c.req.valid('param');
    const result = await extras.checkAudience(eventId, c.req.valid('query'));
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  return router;
}
