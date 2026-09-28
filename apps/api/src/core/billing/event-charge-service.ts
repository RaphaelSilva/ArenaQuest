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
import type { ControllerResult } from '@api/core/result';

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
 */

const { ChargeStatus, ContractTermsSource, EventStatus, EventAudience } = Entities.Config;

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

  async listCharges(
    filter: EventChargeFilter,
  ): Promise<ControllerResult<EventChargeWithBalanceRecord[]>> {
    return { ok: true, data: await this.repo.listCharges(filter) };
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
    if (command.amountMinor <= 0) {
      return badRequest('a payment amount must be positive; undo a payment with a reversal');
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

    const payment = await this.repo.recordPayment({
      chargeId,
      amountMinor: command.amountMinor,
      currency: charge.currency,
      method: command.method,
      paidAt: command.paidAt ?? today(),
      externalReference: command.externalReference ?? null,
      note: command.note ?? '',
      reversesId: null,
      recordedBy: actorId,
    });

    this.audit('billing.charge.payment', actorId, {
      userId: charge.userId,
      eventId: charge.eventId,
      chargeId,
      paymentId: payment.id,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      method: payment.method,
    });

    return { ok: true, data: payment };
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
