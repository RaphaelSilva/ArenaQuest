import { z } from 'zod';
import { Entities } from '@arenaquest/shared/types/entities';
import type {
  BillingPlanRecord,
  BillingStandingHoldRecord,
  InvoiceAdjustmentRecord,
  InvoiceRecord,
  InvoiceWithBalanceRecord,
  PaymentRecord,
  SubscriptionRecord,
} from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';
import type { BillingService, RosterEntry } from '@api/core/billing/billing-service';
import type {
  AccountingService,
  AgingReport,
  MovementReport,
  StudentStatement,
} from '@api/core/billing/accounting-service';

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
});

const StudentParamSchema = z.object({ userId: z.string().min(1) });

/**
 * The roster query. `standing=exempt` **is** the held filter: a hold is the
 * only way a student reaches `exempt`, so a second `held` flag would be a
 * second spelling of the same predicate, free to disagree with the first.
 */
const RosterQuerySchema = z.object({
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
  ) {}

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

  async recordPayment(
    invoiceId: string,
    body: unknown,
    actorId: string,
  ): Promise<ControllerResult<PaymentRecord>> {
    const parsed = RecordPaymentSchema.safeParse(body);
    if (!parsed.success) return invalid(parsed.error);
    return this.service.recordPayment(invoiceId, parsed.data, actorId);
  }

  async reversePayment(
    paymentId: string,
    body: unknown,
    actorId: string,
  ): Promise<ControllerResult<PaymentRecord>> {
    const parsed = ReversePaymentSchema.safeParse(body ?? {});
    if (!parsed.success) return invalid(parsed.error);
    return this.service.reversePayment(paymentId, parsed.data, actorId);
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
    return this.accounting.getReceivablesAging(parsed.data.asOf);
  }

  async getStudentStatement(params: unknown): Promise<ControllerResult<StudentStatement>> {
    const parsed = StudentParamSchema.safeParse(params ?? {});
    if (!parsed.success) return invalid(parsed.error);
    return this.accounting.getStudentStatement(parsed.data.userId);
  }

  // Roster and holds — reported, never enforced ---------------------------

  /**
   * The everyday admin screen: every student with a contract and their
   * resolved standing. Nothing here gates anything — the roster is a listing,
   * and a `delinquent` row changes no permission.
   */
  async listStudentRoster(query: unknown): Promise<ControllerResult<RosterEntry[]>> {
    const parsed = RosterQuerySchema.safeParse(query ?? {});
    if (!parsed.success) return invalid(parsed.error);
    return this.service.listStudentRoster(parsed.data);
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
