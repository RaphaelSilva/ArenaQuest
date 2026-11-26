import type {
  IBillingRepository,
  IEventChargeRepository,
  IEventRepository,
  IUserGroupRepository,
  EventPriceRecord,
  EventChargeRecord,
  EventChargeWithBalanceRecord,
  EventChargeAdjustmentRecord,
  EventChargePaymentRecord,
  EventChargeFilter,
  EventChargePair,
  IssueChargeItem,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { addDays } from '@arenaquest/shared/domain/billing/billing-cycle';
import { fromCharge, resolveRailStanding } from '@arenaquest/shared/domain/billing/receivable';
import { splitGatewayReference } from '@arenaquest/shared/domain/billing/gateway-money';
import { SYSTEM_PAYMENT_ACTOR_ID } from '@api/adapters/db/d1-gateway-repository';
import type { ControllerResult } from '@api/core/result';
import type { PendingCheckout } from '@api/core/billing/accounting-service';
import type { LiveCheckout } from '@api/core/payments/gateway-service';

/**
 * EventChargeService — the write rules of the extras rail (RFC 0015 §3).
 *
 * It mirrors `BillingService` method for method, over a **sibling** ledger:
 * snapshot at issue, append-only corrections, reversal by mirror row, voiding
 * as a recorded decision, one active currency. Two rules are its own:
 *
 * 1. **Only a `published` event is chargeable** (Resolved #6). `draft` and
 *    `archived` are refused with `409` before anything is written; a charge
 *    already issued is untouched if the event is archived later.
 * 2. **An audience gap is a warning, never a write** (Resolved #7). For a
 *    `restricted` event the service lists the charged users who can not see it
 *    — `outsideAudience` — and still issues. It never writes an
 *    `event_audience_*` row, never touches an `enrollments_*` row and never
 *    reads effective topic access: a charge grants nothing.
 *
 * Every mutation emits one structured `billing.charge.*` line carrying the
 * acting admin, in the shape `BillingService` established. No provider symbol
 * appears here; events and groups are read through their ports, narrowed to
 * the read-only methods this service needs.
 *
 * **Gateway entry points (RFC 0026 §5).** `recordGatewayPayment`,
 * `reverseGatewayPayment` and `recordGatewayRefund` are the only way a
 * provider-confirmed movement reaches this ledger. They fix `method =
 * 'gateway'` and the `<provider>:<id>` reference, write through the same
 * repository statement an admin payment uses, and are idempotent on the
 * reference: a collision returns the row that already exists. They call no
 * provider, and — like everything else here — touch no enrollment and no hold.
 */

const { ChargeStatus, ContractTermsSource, EventStatus, EventAudience, PaymentMethod } =
  Entities.Config;

/** Grace applied when the event has no price row — the column's own default. */
const DEFAULT_GRACE_DAYS = 5;

/** The bulk bound on one issue or one audience check (RFC 0015 §7). */
export const MAX_CHARGE_USERS = 200;

// ---------------------------------------------------------------------------
// Commands and results
// ---------------------------------------------------------------------------

export interface SetEventPriceCommand {
  amountMinor: number;
  /** Optional; must equal the tenant's active currency when given. */
  currency?: string;
  dueInDays?: number;
  graceDays?: number;
}

export interface IssueEventChargesCommand {
  eventId: string;
  userIds: string[];
  /** Omitted: the event price is snapshot as `standard`. */
  amountMinor?: number;
  /** Optional; must equal the tenant's active currency when given. */
  currency?: string;
  /** YYYY-MM-DD; defaults to today + the price's due-in days. */
  dueDate?: string;
  /** Defaults to the price's grace. */
  graceDays?: number;
  /** Mandatory when the terms are negotiated. */
  termsNote?: string;
}

export interface IssueEventChargesResult {
  created: EventChargeRecord[];
  absorbed: EventChargePair[];
  /** Charged users who cannot see a `restricted` event. A warning only. */
  outsideAudience: string[];
}

export interface ApplyChargeAdjustmentCommand {
  kind: Entities.Config.AdjustmentKind;
  amountMinor: number;
  reason: string;
}

export interface RecordChargePaymentCommand {
  amountMinor: number;
  method: Entities.Config.PaymentMethod;
  paidAt?: string;
  currency?: string;
  externalReference?: string | null;
  note?: string;
}

export interface ReverseChargePaymentCommand {
  reason: string;
  paidAt?: string;
}

/** The error code of a `409` whose gateway reference is already on the ledger. */
export const PAYMENT_REFERENCE_EXISTS = 'PAYMENT_REFERENCE_EXISTS';

/** What a provider-side negative row stands for; it only words the note. */
export type GatewayRefundKind = 'refund' | 'dispute';

/** A provider-confirmed payment, as the provider captured it (RFC 0026 §5). */
export interface RecordGatewayChargePaymentCommand {
  /** Strictly positive: what the provider captured, not what the checkout asked for. */
  amountMinor: number;
  /** Must equal the charge's currency; anything else lands nothing. */
  currency: string;
  /** `YYYY-MM-DD` or an ISO timestamp; stored as its UTC day, like an admin payment. */
  paidAt: string;
  /** `<provider>:<provider payment id>`. */
  externalReference: string;
}

/** The refund of a gateway row this ledger knows — the full amount, linked by `reversesId`. */
export interface ReverseGatewayChargePaymentCommand {
  /** `<provider>:<refund id>` — the refund's own id, never the original's reference. */
  externalReference: string;
  /** `YYYY-MM-DD` or an ISO timestamp. */
  paidAt: string;
  /** Defaults to `provider refund <refund id>`. */
  note?: string;
  /** Defaults to the system actor; the admin refund route names the admin. */
  recordedBy?: string;
}

/** Money that left at the provider with no local original to link (dashboard refund, lost dispute). */
export interface RecordGatewayChargeRefundCommand {
  /** Strictly positive magnitude; the row is written negative. */
  amountMinor: number;
  currency: string;
  /** `YYYY-MM-DD` or an ISO timestamp. */
  paidAt: string;
  /** `<provider>:<refund or dispute id>`. */
  externalReference: string;
  /** Defaults to `refund`. */
  kind?: GatewayRefundKind;
}

/** The landed row, and whether this call wrote it or found it already there. */
export interface GatewayChargePaymentResult {
  payment: EventChargePaymentRecord;
  created: boolean;
}

/**
 * One row of the admin charge list: the charge, its balance, and its payment
 * in progress (RFC 0026 §7) — the same view the statement gives, `null` when
 * no hosted checkout is live or the charge is no longer `open`.
 */
export interface EventChargeListItem extends EventChargeWithBalanceRecord {
  pendingCheckout: PendingCheckout | null;
}

/** Every payment in progress, in one read (`GatewayService.listLiveCheckouts`); injected per call. */
export type ChargeLiveCheckoutReader = () => Promise<ReadonlyArray<LiveCheckout>>;

export interface EventChargeDetail extends EventChargeWithBalanceRecord {
  adjustments: EventChargeAdjustmentRecord[];
  payments: EventChargePaymentRecord[];
}

/**
 * One event's money at a glance. Sums run over the **non-void** charges, and
 * adjustments are signed (negative reduces what is owed), so
 * `chargedMinor + adjustmentsMinor - receivedMinor === outstandingMinor`,
 * which is the sum of those charges' balances.
 */
export interface EventChargeSummary {
  eventId: string;
  currency: string;
  chargedMinor: number;
  adjustmentsMinor: number;
  receivedMinor: number;
  outstandingMinor: number;
  chargeCount: number;
  counts: Record<Entities.Config.ChargeStatus, number>;
}

export interface AudienceCheckResult {
  eventId: string;
  audience: Entities.Config.EventAudience;
  outsideAudience: string[];
}

/**
 * One student's extras rail, resolved from their event charges only (RFC 0015
 * §4). The labels are `resolveStanding`'s, but `exempt` is unreachable here:
 * the extras rail has no hold (Resolved #9).
 */
export interface ExtrasRailSummary {
  standing: Entities.Config.BillingStanding;
  /** Due date of the oldest unpaid live charge already past due; null if none is. */
  oldestOverdueDate: string | null;
  /** What is still owed on extras. Never summed with the contract rail. */
  outstandingMinor: number;
  /** Live (non-void) charges with a positive balance. */
  openCharges: number;
  /** Of `openCharges`, those whose due date has arrived — the same "overdue" as `oldestOverdueDate`. */
  overdueCharges: number;
}

export interface ExtrasStandingSummary extends ExtrasRailSummary {
  userId: string;
  /** The day the standing was resolved against — `YYYY-MM-DD`. */
  asOf: string;
}

export type EventReader = Pick<IEventRepository, 'findById' | 'getAudienceGrants'>;
export type GroupMemberReader = Pick<IUserGroupRepository, 'listMembers'>;
export type CurrencyReader = Pick<IBillingRepository, 'listCurrencies'>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** `409 PAYMENT_REFERENCE_EXISTS`, naming the row that already carries the reference. */
export function paymentReferenceExists(paymentId: string): ControllerResult<never> {
  return {
    ok: false,
    status: 409,
    error: PAYMENT_REFERENCE_EXISTS,
    meta: { message: 'a gateway payment with this reference is already on the ledger', paymentId },
  };
}

/**
 * A unique-index failure on a ledger insert. Which index fired is settled by
 * re-reading the reference, never by parsing the message further.
 */
export function isUniqueFailure(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

const GATEWAY_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The day a provider movement is booked on: a `YYYY-MM-DD` verbatim, an ISO
 * timestamp as its UTC day — the shape an admin payment stores, so the
 * reports read both alike. `null` when the value is neither.
 */
export function gatewayPaidDay(paidAt: string): string | null {
  if (typeof paidAt !== 'string') return null;
  if (GATEWAY_DAY.test(paidAt)) return Number.isNaN(Date.parse(paidAt)) ? null : paidAt;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(paidAt)) return null;
  const time = Date.parse(paidAt);
  return Number.isNaN(time) ? null : new Date(time).toISOString().slice(0, 10);
}

/**
 * A foreign-key failure on the issue batch means a `userId` names no user.
 * The batch is atomic, so nothing was written; the caller gets a `404`.
 */
function isForeignKeyFailure(error: unknown): boolean {
  return error instanceof Error && /FOREIGN KEY/i.test(error.message);
}

/**
 * The extras rail of one student, from their charges alone.
 *
 * Pure. The hold is **always** `null`: `billing_standing_holds` means "stop
 * chasing the monthly fee" and never reaches this rail (Resolved #9). Every
 * item goes through `fromCharge`, so `resolveRailStanding` would throw on an
 * invoice slipped into the list — the backstop against a merged standing.
 */
export function resolveExtrasRail(
  charges: EventChargeWithBalanceRecord[],
  asOf: string,
): ExtrasRailSummary {
  const resolved = resolveRailStanding('extras', charges.map((charge) => fromCharge(charge)), null, asOf);

  const open = charges.filter(
    (charge) => charge.status !== ChargeStatus.VOID && charge.balanceMinor > 0,
  );
  return {
    ...resolved,
    openCharges: open.length,
    overdueCharges: open.filter((charge) => asOf >= charge.dueDate).length,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class EventChargeService {
  constructor(
    private readonly repo: IEventChargeRepository,
    private readonly events: EventReader,
    private readonly groups: GroupMemberReader,
    private readonly currencies: CurrencyReader,
  ) {}

  // -------------------------------------------------------------------------
  // Price — optional per event
  // -------------------------------------------------------------------------

  async getPrice(eventId: string): Promise<ControllerResult<EventPriceRecord>> {
    if (!(await this.events.findById(eventId))) return notFound('event not found');
    const price = await this.repo.getPrice(eventId);
    if (!price) return notFound('the event has no price');
    return { ok: true, data: price };
  }

  /**
   * Pricing is allowed on any event status: a price is a catalogue entry, not
   * a sale. Only issuing a charge demands a `published` event.
   */
  async setPrice(
    eventId: string,
    command: SetEventPriceCommand,
    actorId: string,
  ): Promise<ControllerResult<EventPriceRecord>> {
    if (!(await this.events.findById(eventId))) return notFound('event not found');

    const active = await this.activeCurrency();
    if (!active.ok) return active;
    if (command.currency !== undefined && command.currency !== active.data) {
      return badRequest(
        `a price must be in the active currency "${active.data}", not "${command.currency}"`,
      );
    }

    const price = await this.repo.setPrice({
      eventId,
      amountMinor: command.amountMinor,
      currency: active.data,
      dueInDays: command.dueInDays,
      graceDays: command.graceDays,
      updatedBy: actorId,
    });

    this.audit('billing.charge.set_price', actorId, {
      eventId,
      amountMinor: price.amountMinor,
      currency: price.currency,
      dueInDays: price.dueInDays,
      graceDays: price.graceDays,
    });

    return { ok: true, data: price };
  }

  /** Stops offering the event. Charges already issued are untouched. */
  async clearPrice(eventId: string, actorId: string): Promise<ControllerResult<null>> {
    if (!(await this.events.findById(eventId))) return notFound('event not found');
    const existing = await this.repo.getPrice(eventId);
    if (!existing) return notFound('the event has no price');

    await this.repo.clearPrice(eventId);

    this.audit('billing.charge.clear_price', actorId, {
      eventId,
      amountMinor: existing.amountMinor,
      currency: existing.currency,
    });

    return { ok: true, data: null };
  }

  // -------------------------------------------------------------------------
  // Charges
  // -------------------------------------------------------------------------

  /**
   * The admin list. `liveCheckouts` is **one** set-based read joined in memory
   * — never one lookup per charge; omitted (no gateway), every row reads
   * `pendingCheckout: null`.
   */
  async listCharges(
    filter: EventChargeFilter,
    liveCheckouts?: ChargeLiveCheckoutReader,
  ): Promise<ControllerResult<EventChargeListItem[]>> {
    const [charges, live] = await Promise.all([
      this.repo.listCharges(filter),
      liveCheckouts ? liveCheckouts() : [],
    ]);
    const pendingByCharge = new Map<string, PendingCheckout>();
    for (const checkout of live) {
      if (checkout.receivableKind === 'event_charge') pendingByCharge.set(checkout.receivableId, checkout.pending);
    }
    return {
      ok: true,
      data: charges.map((charge) => ({
        ...charge,
        pendingCheckout:
          charge.status === ChargeStatus.OPEN ? (pendingByCharge.get(charge.id) ?? null) : null,
      })),
    };
  }

  /** One ledger row, whatever its sign — what the admin's reversal branches on. */
  async getPayment(id: string): Promise<ControllerResult<EventChargePaymentRecord>> {
    const payment = await this.repo.getPayment(id);
    if (!payment) return notFound('payment not found');
    return { ok: true, data: payment };
  }

  /**
   * One charge with its balance and nothing else — what a checkout is opened
   * against (RFC 0026 §3). `getChargeDetail` also reads the whole ledger.
   */
  async getCharge(id: string): Promise<ControllerResult<EventChargeWithBalanceRecord>> {
    const charge = await this.repo.getCharge(id);
    if (!charge) return notFound('charge not found');
    return { ok: true, data: charge };
  }

  async getChargeDetail(id: string): Promise<ControllerResult<EventChargeDetail>> {
    const charge = await this.repo.getCharge(id);
    if (!charge) return notFound('charge not found');

    const ledger = await this.repo.listLedger({ chargeId: id });
    const adjustments: EventChargeAdjustmentRecord[] = [];
    const payments: EventChargePaymentRecord[] = [];
    for (const entry of ledger) {
      if (entry.entry === 'payment') payments.push(entry.payment);
      else adjustments.push(entry.adjustment);
    }

    return { ok: true, data: { ...charge, adjustments, payments } };
  }

  /**
   * Issues one charge per user for one event, idempotently: a pair that
   * already has a live charge is reported under `absorbed`, never refused.
   */
  async issueCharges(
    command: IssueEventChargesCommand,
    actorId: string,
  ): Promise<ControllerResult<IssueEventChargesResult>> {
    const { userIds } = command;
    if (userIds.length === 0 || userIds.length > MAX_CHARGE_USERS) {
      return badRequest(`userIds must hold between 1 and ${MAX_CHARGE_USERS} ids`);
    }
    if (new Set(userIds).size !== userIds.length) {
      return badRequest('userIds must be distinct');
    }

    const event = await this.events.findById(command.eventId);
    if (!event) return notFound('event not found');
    if (event.status !== EventStatus.PUBLISHED) {
      return conflict(`only a published event can be charged; this event is "${event.status}"`);
    }

    const active = await this.activeCurrency();
    if (!active.ok) return active;
    if (command.currency !== undefined && command.currency !== active.data) {
      return badRequest(
        `a charge must be in the active currency "${active.data}", not "${command.currency}"`,
      );
    }

    const price = await this.repo.getPrice(command.eventId);
    if (price && price.currency !== active.data) {
      return conflict(
        `the event price is in "${price.currency}", which is no longer the active currency "${active.data}"; set the price again`,
      );
    }

    // Terms: the price snapshot is `standard`; anything else is negotiated.
    let amountMinor: number;
    let termsSource: Entities.Config.ContractTermsSource;
    if (command.amountMinor === undefined) {
      if (!price) {
        return badRequest('the event has no price; give amountMinor and a termsNote');
      }
      amountMinor = price.amountMinor;
      termsSource = ContractTermsSource.STANDARD;
    } else {
      amountMinor = command.amountMinor;
      termsSource =
        price && price.amountMinor === command.amountMinor
          ? ContractTermsSource.STANDARD
          : ContractTermsSource.NEGOTIATED;
    }
    if (termsSource === ContractTermsSource.NEGOTIATED && isBlank(command.termsNote)) {
      return badRequest('an amount that differs from the event price requires a termsNote');
    }

    const dueDate = command.dueDate ?? addDays(today(), price?.dueInDays ?? 0);
    const graceDays = command.graceDays ?? price?.graceDays ?? DEFAULT_GRACE_DAYS;
    const termsNote = command.termsNote?.trim() ?? '';

    const outside = await this.outsideAudience(event, userIds);

    const items: IssueChargeItem[] = userIds.map((userId) => ({
      userId,
      amountMinor,
      currency: active.data,
      termsSource,
      termsNote,
      dueDate,
      graceDays,
    }));

    let result;
    try {
      result = await this.repo.issueCharges({
        eventId: event.id,
        description: event.title,
        issuedBy: actorId,
        items,
      });
    } catch (error) {
      if (isForeignKeyFailure(error)) {
        return notFound('one or more userIds do not name a user; nothing was charged');
      }
      throw error;
    }

    for (const charge of result.created) {
      this.audit('billing.charge.issue', actorId, {
        userId: charge.userId,
        eventId: charge.eventId,
        chargeId: charge.id,
        amountMinor: charge.amountMinor,
        currency: charge.currency,
        termsSource: charge.termsSource,
        dueDate: charge.dueDate,
      });
    }
    this.audit('billing.charge.issue_batch', actorId, {
      eventId: event.id,
      requested: userIds.length,
      created: result.created.length,
      absorbed: result.absorbed.length,
      outsideAudience: outside,
    });

    return {
      ok: true,
      data: { created: result.created, absorbed: result.absorbed, outsideAudience: outside },
    };
  }

  /**
   * Voiding needs a reason and is refused while the charge holds money:
   * reverse the payments first, so the refund is visible in the ledger.
   */
  async voidCharge(
    id: string,
    reason: string,
    actorId: string,
  ): Promise<ControllerResult<EventChargeRecord>> {
    if (isBlank(reason)) return badRequest('voiding a charge requires a reason');

    const charge = await this.repo.getCharge(id);
    if (!charge) return notFound('charge not found');
    if (charge.status === ChargeStatus.VOID) return conflict('the charge is already void');

    const ledger = await this.repo.listLedger({ chargeId: id });
    const netPaymentsMinor = ledger.reduce(
      (sum, entry) => (entry.entry === 'payment' ? sum + entry.payment.amountMinor : sum),
      0,
    );
    if (netPaymentsMinor > 0) {
      return conflict('a charge with net payments cannot be voided; reverse the payments first');
    }

    const voided = await this.repo.voidCharge(id, reason.trim(), actorId);
    if (!voided) return notFound('charge not found');

    this.audit('billing.charge.void', actorId, {
      userId: voided.userId,
      eventId: voided.eventId,
      chargeId: voided.id,
      reason: voided.voidReason,
    });

    return { ok: true, data: voided };
  }

  // -------------------------------------------------------------------------
  // Ledger — append-only
  // -------------------------------------------------------------------------

  async applyAdjustment(
    chargeId: string,
    command: ApplyChargeAdjustmentCommand,
    actorId: string,
  ): Promise<ControllerResult<EventChargeAdjustmentRecord>> {
    if (command.amountMinor === 0) return badRequest('an adjustment amount must not be zero');
    if (isBlank(command.reason)) return badRequest('an adjustment requires a reason');

    const charge = await this.repo.getCharge(chargeId);
    if (!charge) return notFound('charge not found');
    if (charge.status === ChargeStatus.VOID) return conflict('a void charge cannot be adjusted');

    const adjustment = await this.repo.applyAdjustment({
      chargeId,
      kind: command.kind,
      amountMinor: command.amountMinor,
      reason: command.reason.trim(),
      appliedBy: actorId,
    });

    this.audit('billing.charge.adjust', actorId, {
      userId: charge.userId,
      eventId: charge.eventId,
      chargeId,
      adjustmentId: adjustment.id,
      kind: adjustment.kind,
      amountMinor: adjustment.amountMinor,
      manual: true,
    });

    return { ok: true, data: adjustment };
  }

  async recordPayment(
    chargeId: string,
    command: RecordChargePaymentCommand,
    actorId: string,
  ): Promise<ControllerResult<EventChargePaymentRecord>> {
    return this.writePayment(chargeId, command, actorId);
  }

  /**
   * The one place a positive payment row is written on this rail — the admin
   * form and `recordGatewayPayment` (`landed`) both end here, so the guards
   * and the balance refresh cannot drift apart.
   *
   * A `gateway` row is keyed on its reference: it must read `<known
   * provider>:<id>` (`400`), and one already on the ledger is `409
   * PAYMENT_REFERENCE_EXISTS` — checked before the insert and again when the
   * partial unique index refuses a concurrent twin.
   */
  private async writePayment(
    chargeId: string,
    command: RecordChargePaymentCommand,
    actorId: string,
    landed = false,
  ): Promise<ControllerResult<EventChargePaymentRecord>> {
    if (command.amountMinor <= 0) {
      return badRequest('a payment amount must be positive; undo a payment with a reversal');
    }
    const viaGateway = command.method === PaymentMethod.GATEWAY;
    const reference = command.externalReference ?? null;
    if (viaGateway && !splitGatewayReference(reference)) {
      return badRequest('a gateway payment needs an externalReference of the form "<provider>:<id>"');
    }

    const charge = await this.repo.getCharge(chargeId);
    if (!charge) return notFound('charge not found');
    if (charge.status === ChargeStatus.VOID) {
      return conflict('a void charge cannot receive a payment');
    }
    if (command.currency !== undefined && command.currency !== charge.currency) {
      return badRequest(
        `the payment currency "${command.currency}" differs from the charge currency "${charge.currency}"`,
      );
    }

    if (viaGateway && reference !== null) {
      const existing = await this.repo.findGatewayPayment(reference);
      if (existing) return paymentReferenceExists(existing.id);
    }

    let payment: EventChargePaymentRecord;
    try {
      payment = await this.repo.recordPayment({
        chargeId,
        amountMinor: command.amountMinor,
        currency: charge.currency,
        method: command.method,
        paidAt: command.paidAt ?? today(),
        externalReference: reference,
        note: command.note ?? '',
        reversesId: null,
        recordedBy: actorId,
      });
    } catch (error) {
      if (viaGateway && reference !== null && isUniqueFailure(error)) {
        const winner = await this.repo.findGatewayPayment(reference);
        if (winner) return paymentReferenceExists(winner.id);
      }
      throw error;
    }

    if (landed) {
      // A landed gateway payment is audited by ids only (RFC 0026 §5).
      this.audit('payments.gateway_landed', actorId, {
        rail: 'extras',
        userId: charge.userId,
        chargeId,
        paymentId: payment.id,
      });
    } else {
      this.audit('billing.charge.payment', actorId, {
        userId: charge.userId,
        eventId: charge.eventId,
        chargeId,
        paymentId: payment.id,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        method: payment.method,
      });
    }

    return { ok: true, data: payment };
  }

  // -------------------------------------------------------------------------
  // Gateway entry points (RFC 0026 §5) — idempotent on the reference
  // -------------------------------------------------------------------------

  /**
   * Lands a provider-confirmed payment: an ordinary payment row with `method =
   * 'gateway'`, recorded by the system actor. A reference already on the
   * ledger returns that row with `created: false` and writes nothing —
   * whatever the charge's state has become since. An overpayment is a credit,
   * exactly as it is for an admin payment.
   */
  async recordGatewayPayment(
    chargeId: string,
    command: RecordGatewayChargePaymentCommand,
  ): Promise<ControllerResult<GatewayChargePaymentResult>> {
    if (!splitGatewayReference(command.externalReference)) {
      return badRequest('a gateway payment needs an externalReference of the form "<provider>:<id>"');
    }
    const paidAt = gatewayPaidDay(command.paidAt);
    if (!paidAt) return badRequest('paidAt must be a YYYY-MM-DD date or an ISO timestamp');

    const existing = await this.repo.findGatewayPayment(command.externalReference);
    if (existing) return { ok: true, data: { payment: existing, created: false } };

    const written = await this.writePayment(
      chargeId,
      {
        amountMinor: command.amountMinor,
        currency: command.currency,
        method: PaymentMethod.GATEWAY,
        paidAt,
        externalReference: command.externalReference,
      },
      SYSTEM_PAYMENT_ACTOR_ID,
      true,
    );
    if (written.ok) return { ok: true, data: { payment: written.data, created: true } };
    if (written.error !== PAYMENT_REFERENCE_EXISTS) return written;

    // A concurrent call won the insert: its row is the answer.
    const winner = await this.repo.findGatewayPayment(command.externalReference);
    if (!winner) return written;
    return { ok: true, data: { payment: winner, created: false } };
  }

  /**
   * Reverses a gateway row this ledger knows, in full: the mirror amount,
   * `reversesId` set, and the provider's **refund id** as the row's own
   * reference — never the original's, which the partial unique index would
   * refuse. A refund id already on the ledger (this call's twin, or the
   * provider's notification landing it first with no link) is returned with
   * `created: false`.
   */
  async reverseGatewayPayment(
    paymentId: string,
    command: ReverseGatewayChargePaymentCommand,
  ): Promise<ControllerResult<GatewayChargePaymentResult>> {
    const refund = splitGatewayReference(command.externalReference);
    if (!refund) {
      return badRequest('a gateway reversal needs an externalReference of the form "<provider>:<refund id>"');
    }
    const paidAt = gatewayPaidDay(command.paidAt);
    if (!paidAt) return badRequest('paidAt must be a YYYY-MM-DD date or an ISO timestamp');

    const original = await this.repo.getPayment(paymentId);
    if (!original) return notFound('payment not found');
    if (original.method !== PaymentMethod.GATEWAY) {
      return conflict('only a gateway payment is reversed through the gateway');
    }
    if (original.reversesId !== null || original.amountMinor <= 0) {
      return conflict('a reversal cannot itself be reversed');
    }
    if (original.externalReference === command.externalReference) {
      return badRequest("a reversal carries the refund id, never the original payment's reference");
    }
    if (splitGatewayReference(original.externalReference)?.provider !== refund.provider) {
      return badRequest('the refund belongs to another provider than the payment it reverses');
    }

    const existing = await this.repo.findGatewayPayment(command.externalReference);
    if (existing) return { ok: true, data: { payment: existing, created: false } };

    const ledger = await this.repo.listLedger({ chargeId: original.chargeId });
    const alreadyReversed = ledger.some(
      (entry) => entry.entry === 'payment' && entry.payment.reversesId === paymentId,
    );
    if (alreadyReversed) return conflict('the payment has already been reversed');

    const recordedBy = command.recordedBy ?? SYSTEM_PAYMENT_ACTOR_ID;
    let reversal: EventChargePaymentRecord;
    try {
      reversal = await this.repo.recordPayment({
        chargeId: original.chargeId,
        amountMinor: -original.amountMinor,
        currency: original.currency,
        method: PaymentMethod.GATEWAY,
        paidAt,
        externalReference: command.externalReference,
        note: isBlank(command.note) ? `provider refund ${refund.id}` : command.note!.trim(),
        reversesId: original.id,
        recordedBy,
      });
    } catch (error) {
      if (!isUniqueFailure(error)) throw error;
      const winner = await this.repo.findGatewayPayment(command.externalReference);
      if (winner) return { ok: true, data: { payment: winner, created: false } };
      // Not the reference: `idx_event_charge_payments_one_reversal` fired.
      return conflict('the payment has already been reversed');
    }

    this.audit('payments.gateway_reversed', recordedBy, {
      rail: 'extras',
      chargeId: original.chargeId,
      paymentId: reversal.id,
      reversesId: original.id,
    });

    return { ok: true, data: { payment: reversal, created: true } };
  }

  /**
   * Books money that left at the provider with no local original to link — a
   * refund made in the provider's dashboard (full or partial) or a lost
   * dispute: a **negative** gateway row, `reversesId` null, keyed on the
   * provider's refund or dispute id and named in the note. Like an admin
   * reversal, it does not ask whether the charge is void.
   */
  async recordGatewayRefund(
    chargeId: string,
    command: RecordGatewayChargeRefundCommand,
  ): Promise<ControllerResult<GatewayChargePaymentResult>> {
    const reference = splitGatewayReference(command.externalReference);
    if (!reference) {
      return badRequest('a gateway refund needs an externalReference of the form "<provider>:<id>"');
    }
    if (!Number.isInteger(command.amountMinor) || command.amountMinor <= 0) {
      return badRequest('a refund amount is a positive count of minor units; it is written negative');
    }
    const paidAt = gatewayPaidDay(command.paidAt);
    if (!paidAt) return badRequest('paidAt must be a YYYY-MM-DD date or an ISO timestamp');

    const existing = await this.repo.findGatewayPayment(command.externalReference);
    if (existing) return { ok: true, data: { payment: existing, created: false } };

    const charge = await this.repo.getCharge(chargeId);
    if (!charge) return notFound('charge not found');
    if (command.currency !== charge.currency) {
      return badRequest(
        `the refund currency "${command.currency}" differs from the charge currency "${charge.currency}"`,
      );
    }

    const kind: GatewayRefundKind = command.kind ?? 'refund';
    let refund: EventChargePaymentRecord;
    try {
      refund = await this.repo.recordPayment({
        chargeId,
        amountMinor: -command.amountMinor,
        currency: charge.currency,
        method: PaymentMethod.GATEWAY,
        paidAt,
        externalReference: command.externalReference,
        note: `provider ${kind} ${reference.id}`,
        reversesId: null,
        recordedBy: SYSTEM_PAYMENT_ACTOR_ID,
      });
    } catch (error) {
      if (!isUniqueFailure(error)) throw error;
      const winner = await this.repo.findGatewayPayment(command.externalReference);
      if (!winner) throw error;
      return { ok: true, data: { payment: winner, created: false } };
    }

    this.audit('payments.gateway_refund_landed', SYSTEM_PAYMENT_ACTOR_ID, {
      rail: 'extras',
      kind,
      userId: charge.userId,
      chargeId,
      paymentId: refund.id,
    });

    return { ok: true, data: { payment: refund, created: true } };
  }

  /**
   * Appends the payment's mirror image; the original row is never touched.
   * `idx_event_charge_payments_one_reversal` backs up the "at most once" rule.
   */
  async reversePayment(
    paymentId: string,
    command: ReverseChargePaymentCommand,
    actorId: string,
  ): Promise<ControllerResult<EventChargePaymentRecord>> {
    if (isBlank(command.reason)) return badRequest('a reversal requires a reason');

    const original = await this.repo.getPayment(paymentId);
    if (!original) return notFound('payment not found');
    if (original.method === PaymentMethod.GATEWAY) {
      // See `BillingService.reversePayment`: the provider returns the money first.
      return conflict('a gateway payment is reversed by refunding it at its provider');
    }
    if (original.reversesId !== null) return conflict('a reversal cannot itself be reversed');

    const ledger = await this.repo.listLedger({ chargeId: original.chargeId });
    const alreadyReversed = ledger.some(
      (entry) => entry.entry === 'payment' && entry.payment.reversesId === paymentId,
    );
    if (alreadyReversed) return conflict('the payment has already been reversed');

    const reversal = await this.repo.recordPayment({
      chargeId: original.chargeId,
      amountMinor: -original.amountMinor,
      currency: original.currency,
      method: original.method,
      paidAt: command.paidAt ?? today(),
      externalReference: original.externalReference,
      note: command.reason.trim(),
      reversesId: original.id,
      recordedBy: actorId,
    });

    this.audit('billing.charge.reverse_payment', actorId, {
      chargeId: original.chargeId,
      paymentId: reversal.id,
      reversesId: original.id,
      amountMinor: reversal.amountMinor,
      reason: reversal.note,
    });

    return { ok: true, data: reversal };
  }

  // -------------------------------------------------------------------------
  // Extras standing (RFC 0015 §4)
  // -------------------------------------------------------------------------

  /**
   * One student's extras standing, from `listCharges({ userId })` alone. It
   * never reads an invoice or a hold, so no contract fact can move it and it
   * can move no contract fact.
   */
  async getExtrasStanding(
    userId: string,
    asOf?: string,
  ): Promise<ControllerResult<ExtrasStandingSummary>> {
    const day = asOf ?? today();
    const charges = await this.repo.listCharges({ userId });
    return { ok: true, data: { userId, asOf: day, ...resolveExtrasRail(charges, day) } };
  }

  // -------------------------------------------------------------------------
  // Reads — per-event summary and the audience check
  // -------------------------------------------------------------------------

  async getEventSummary(eventId: string): Promise<ControllerResult<EventChargeSummary>> {
    if (!(await this.events.findById(eventId))) return notFound('event not found');

    const [charges, ledger] = await Promise.all([
      this.repo.listCharges({ eventId }),
      this.repo.listLedger({ eventId }),
    ]);

    const counts: Record<Entities.Config.ChargeStatus, number> = {
      [ChargeStatus.OPEN]: 0,
      [ChargeStatus.PAID]: 0,
      [ChargeStatus.VOID]: 0,
    };
    const live = new Set<string>();
    const codes = new Set<string>();
    let chargedMinor = 0;
    let outstandingMinor = 0;
    for (const charge of charges) {
      counts[charge.status] += 1;
      if (charge.status === ChargeStatus.VOID) continue;
      live.add(charge.id);
      codes.add(charge.currency);
      chargedMinor += charge.amountMinor;
      outstandingMinor += charge.balanceMinor;
    }

    let adjustmentsMinor = 0;
    let receivedMinor = 0;
    for (const entry of ledger) {
      if (entry.entry === 'payment') {
        if (live.has(entry.payment.chargeId)) receivedMinor += entry.payment.amountMinor;
      } else if (live.has(entry.adjustment.chargeId)) {
        adjustmentsMinor += entry.adjustment.amountMinor;
      }
    }

    if (codes.size > 1) {
      return conflict(
        `this event's charges span more than one currency (${[...codes].sort().join(', ')}); a total is never converted`,
      );
    }
    let currency: string;
    if (codes.size === 1) {
      [currency] = [...codes];
    } else {
      const active = await this.activeCurrency();
      if (!active.ok) return active;
      currency = active.data;
    }

    return {
      ok: true,
      data: {
        eventId,
        currency,
        chargedMinor,
        adjustmentsMinor,
        receivedMinor,
        outstandingMinor,
        chargeCount: charges.length,
        counts,
      },
    };
  }

  /** The dry-run form of `outsideAudience`: reads, never writes. */
  async checkAudience(
    eventId: string,
    userIds: string[],
  ): Promise<ControllerResult<AudienceCheckResult>> {
    if (userIds.length === 0 || userIds.length > MAX_CHARGE_USERS) {
      return badRequest(`userIds must hold between 1 and ${MAX_CHARGE_USERS} ids`);
    }
    const event = await this.events.findById(eventId);
    if (!event) return notFound('event not found');

    const distinct = [...new Set(userIds)];
    return {
      ok: true,
      data: {
        eventId,
        audience: event.audience,
        outsideAudience: await this.outsideAudience(event, distinct),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * The requested users a `restricted` event is not addressed to — neither
   * granted directly nor through a group. Always empty for `public` and
   * `members`. Reads the grants through the event port; writes nothing.
   */
  private async outsideAudience(
    event: Entities.Events.Event,
    userIds: string[],
  ): Promise<string[]> {
    if (event.audience !== EventAudience.RESTRICTED) return [];

    const grants = await this.events.getAudienceGrants(event.id);
    const granted = new Set(grants.userIds);
    const memberLists = await Promise.all(
      grants.groupIds.map((groupId) => this.groups.listMembers(groupId)),
    );
    for (const members of memberLists) {
      for (const member of members) granted.add(member.userId);
    }

    return userIds.filter((userId) => !granted.has(userId));
  }

  /** The tenant's one live currency; `409` when none is marked active. */
  private async activeCurrency(): Promise<ControllerResult<string>> {
    const active = (await this.currencies.listCurrencies()).find((currency) => currency.active);
    if (!active) return conflict('no currency is marked active in the currencies table');
    return { ok: true, data: active.code };
  }

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
