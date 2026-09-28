import type { Entities } from '../types/entities';

/**
 * IEventChargeRepository
 *
 * Cloud-agnostic persistence port for event extras — one-off charges for an
 * event (RFC 0015 section 3). It is deliberately a **sibling** of
 * `IBillingRepository`, not an extension of it: the contract ledger and the
 * extras ledger share rules but never rows, and keeping two independent ports
 * means a future database swap still needs one adapter per port and no
 * cross-port query.
 *
 * Records are persistence-facing flat rows: dates and timestamps are `string`s
 * exactly as SQLite stores them (`YYYY-MM-DD` for dates), money is an integer
 * count of the currency's minor unit, and a relation is an id. No database
 * handle, worker `env`, HTTP-framework type or validation schema crosses this
 * boundary. `Entities.Billing` holds the richer canonical shapes.
 *
 * Invariants every implementation must honour:
 *
 * - **Append-only ledger.** `event_charge_payments` and
 *   `event_charge_adjustments` rows are never updated or deleted, which is why
 *   this port declares no `updatePayment` or `deleteAdjustment`.
 * - **Reversal by mirror row.** A payment is corrected by a new row with a
 *   negative amount whose `reversesId` names the payment it reverses; at most
 *   one reversal exists per payment.
 * - **One live charge per `(eventId, userId)`.** A voided charge does not
 *   count, so a charge issued by mistake can be voided and re-issued.
 *   `issueCharges` is idempotent against that key: a pair that already has a
 *   live charge is *absorbed* and reported, never an error.
 * - **Balance is computed, never stored:**
 *   `balanceMinor = amountMinor + SUM(adjustments) - SUM(payments)`.
 *   `status` is a cache of that sum, refreshed with every ledger write, and no
 *   report may total it.
 *
 * **No payment-gateway port is declared** (RFC 0013 #9). `externalReference`
 * and `method = 'gateway'` on the payment record are the whole of the forward
 * compatibility.
 */

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface EventPriceRecord {
  eventId: string;
  amountMinor: number;
  currency: string;
  /** Days after issue the charge falls due when the admin picks no date. */
  dueInDays: number;
  graceDays: number;
  updatedBy: string;
  updatedAt: string;
}

export interface EventChargeRecord {
  id: string;
  eventId: string;
  userId: string;
  /** Snapshot of the event title at issue. */
  description: string;
  /** Snapshots taken at issue; never re-read from the price row. */
  amountMinor: number;
  currency: string;
  termsSource: Entities.Config.ContractTermsSource;
  termsNote: string;
  /** YYYY-MM-DD. */
  dueDate: string;
  /** Snapshot; the copy standing reads. */
  graceDays: number;
  status: Entities.Config.ChargeStatus;
  issuedBy: string;
  issuedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

/**
 * A charge carrying its computed balance,
 * `amountMinor + SUM(adjustments) - SUM(payments)` — what feeds the extras
 * rail's standing through `fromCharge`.
 */
export type EventChargeWithBalanceRecord = EventChargeRecord & { balanceMinor: number };

export interface EventChargeAdjustmentRecord {
  id: string;
  chargeId: string;
  kind: Entities.Config.AdjustmentKind;
  /** Signed and never zero; negative reduces what is owed. */
  amountMinor: number;
  reason: string;
  appliedBy: string;
  appliedAt: string;
}

export interface EventChargePaymentRecord {
  id: string;
  chargeId: string;
  /** Signed and never zero; negative is a reversal. */
  amountMinor: number;
  currency: string;
  method: Entities.Config.PaymentMethod;
  /** When the money moved, not when it was typed in. */
  paidAt: string;
  externalReference: string | null;
  note: string;
  reversesId: string | null;
  recordedBy: string;
  recordedAt: string;
}

/** One row of the money history of a charge, in `occurredAt` order. */
export type ChargeLedgerEntryRecord =
  | { entry: 'payment'; payment: EventChargePaymentRecord; occurredAt: string }
  | { entry: 'adjustment'; adjustment: EventChargeAdjustmentRecord; occurredAt: string };

// ---------------------------------------------------------------------------
// Inputs and filters
// ---------------------------------------------------------------------------

/** Upsert of the event's price row. */
export interface SetEventPriceInput {
  eventId: string;
  amountMinor: number;
  currency: string;
  dueInDays?: number;
  graceDays?: number;
  updatedBy: string;
}

export interface EventChargeFilter {
  eventId?: string;
  userId?: string;
  status?: Entities.Config.ChargeStatus;
  /** YYYY-MM-DD, inclusive bounds on `dueDate`. */
  dueFrom?: string;
  dueTo?: string;
}

/** One buyer of a bulk issue, with the terms already resolved by the service. */
export interface IssueChargeItem {
  userId: string;
  amountMinor: number;
  currency: string;
  termsSource: Entities.Config.ContractTermsSource;
  termsNote?: string;
  /** YYYY-MM-DD. */
  dueDate: string;
  graceDays: number;
}

/**
 * A bulk issue for one event. The partial unique index on the live
 * `(eventId, userId)` pair is what makes re-running it safe.
 */
export interface IssueChargesInput {
  eventId: string;
  /** Event title snapshot written to every created charge. */
  description: string;
  issuedBy: string;
  items: IssueChargeItem[];
}

export interface EventChargePair {
  eventId: string;
  userId: string;
}

export interface IssueChargesResult {
  /** Only the charges this call actually created. */
  created: EventChargeRecord[];
  /** Pairs that already had a live charge and were left untouched. */
  absorbed: EventChargePair[];
}

export interface RecordChargePaymentInput {
  chargeId: string;
  /** Signed and never zero; negative is a reversal. */
  amountMinor: number;
  currency: string;
  method: Entities.Config.PaymentMethod;
  paidAt: string;
  externalReference?: string | null;
  note?: string;
  /** Set on a reversal row, naming the payment being reversed. */
  reversesId?: string | null;
  recordedBy: string;
}

export interface ApplyChargeAdjustmentInput {
  chargeId: string;
  kind: Entities.Config.AdjustmentKind;
  /** Signed and never zero; negative reduces what is owed. */
  amountMinor: number;
  reason: string;
  appliedBy: string;
}

export interface ChargeLedgerFilter {
  chargeId?: string;
  eventId?: string;
  userId?: string;
  /** YYYY-MM-DD, inclusive bounds on when the entry occurred. */
  from?: string;
  to?: string;
}

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export interface IEventChargeRepository {
  // Price — optional per event; no row means "not for sale by default".
  getPrice(eventId: string): Promise<EventPriceRecord | null>;
  /** Creates or replaces the event's price row. */
  setPrice(input: SetEventPriceInput): Promise<EventPriceRecord>;
  clearPrice(eventId: string): Promise<void>;

  // Charges.
  /** Carries each charge's balance, because this is what feeds extras standing. */
  listCharges(filter: EventChargeFilter): Promise<EventChargeWithBalanceRecord[]>;
  getCharge(id: string): Promise<EventChargeWithBalanceRecord | null>;
  /**
   * Idempotent: creates one charge per item whose `(eventId, userId)` has no
   * live charge, and reports the rest as absorbed instead of failing.
   */
  issueCharges(input: IssueChargesInput): Promise<IssueChargesResult>;
  voidCharge(id: string, reason: string, voidedBy: string): Promise<EventChargeRecord | null>;

  // Ledger — append-only on both tables.
  recordPayment(input: RecordChargePaymentInput): Promise<EventChargePaymentRecord>;
  getPayment(id: string): Promise<EventChargePaymentRecord | null>;
  applyAdjustment(input: ApplyChargeAdjustmentInput): Promise<EventChargeAdjustmentRecord>;
  listLedger(filter: ChargeLedgerFilter): Promise<ChargeLedgerEntryRecord[]>;
}
