import type {
  IBillingRepository,
  BillingPlanRecord,
  BillingPlanFilter,
  UpdateBillingPlanInput,
  SubscriptionRecord,
  SubscriptionFilter,
  InvoiceRecord,
  InvoiceWithBalanceRecord,
  InvoiceFilter,
  InvoiceAdjustmentRecord,
  PaymentRecord,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { computePeriod } from '@arenaquest/shared/domain/billing/billing-cycle';
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

const { ContractStatus, ContractTermsSource, InvoiceStatus, AdjustmentKind } = Entities.Config;

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

export class BillingService {
  constructor(private readonly repo: IBillingRepository) {}

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