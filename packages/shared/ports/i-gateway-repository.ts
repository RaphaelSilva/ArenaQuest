import type { Entities } from '../types/entities';
import type { ReceivableKind } from '../domain/billing/receivable';
import type { PaymentProviderName } from './i-payment-gateway';

/**
 * IGatewayRepository
 *
 * Cloud-agnostic persistence port for the payment gateway's own two tables
 * (RFC 0026 sections 2 and 9): `gateway_checkouts` — one attempt to collect
 * one receivable through a provider's hosted page — and `gateway_events` —
 * webhook de-duplication and audit.
 *
 * **Neither table is money.** Money stays a row in `payments` or
 * `event_charge_payments`, written through `IBillingRepository` and
 * `IEventChargeRepository`; this port never sums, lands or reverses anything.
 *
 * Records are persistence-facing flat rows: timestamps are `string`s exactly as
 * the database stores them, amounts are integer minor units, and a relation is
 * an id. No database handle, worker `env`, HTTP-framework type or validation
 * schema crosses this boundary. `Entities.Billing` holds the canonical shapes.
 *
 * Invariants every implementation must honour:
 *
 * - **One open checkout per receivable.** A second `createCheckout` for a
 *   `(receivableKind, receivableId)` that already has an `open` row fails.
 * - **Idempotency lives in the store.** `recordEvent` inserts at most one row
 *   per `(provider, eventId)` however many times it is called, concurrently or
 *   not; `markEvent` and `closeCheckout` are conditional writes that report
 *   whether *this* call changed the row.
 * - **A settled event is never overwritten.** Only `received` and `failed` are
 *   unsettled; every other outcome is final.
 * - **A dismissal changes neither a status nor an outcome** (milestone 30,
 *   decision 20): it hides a row from `listExceptions` and nothing else.
 */

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface GatewayCheckoutRecord {
  /** Also the provider idempotency key and the metadata back-reference. */
  id: string;
  provider: PaymentProviderName;
  receivableKind: ReceivableKind;
  receivableId: string;
  /** The student who owes it. */
  userId: string;
  /** Who pressed the button: the student, or an admin acting on their behalf. */
  createdBy: string;
  /** The balance at creation — what the provider was asked to collect. Always positive. */
  amountMinor: number;
  currency: string;
  status: Entities.Config.CheckoutStatus;
  /** The hosted session / preference id (bare); `null` until the provider answered. */
  providerSessionId: string | null;
  /** The provider payment id (bare); set when a payment is confirmed. */
  providerPaymentId: string | null;
  /** Set on a `paid` invoice checkout; never together with `chargePaymentId`. */
  invoicePaymentId: string | null;
  /** Set on a `paid` event-charge checkout; never together with `invoicePaymentId`. */
  chargePaymentId: string | null;
  checkoutUrl: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  /** Last time the reconcile run asked the provider about this checkout. */
  lastCheckedAt: string | null;
  /** Provider status / mismatch / dispute description; never a body. */
  failureDetail: string | null;
  dismissedAt: string | null;
  dismissedBy: string | null;
  dismissNote: string | null;
}

export interface GatewayEventRecord {
  provider: PaymentProviderName;
  /** The provider's own event / notification id. */
  eventId: string;
  /** The event kind, or the provider's own type name for an ignored one. */
  type: string;
  providerPaymentId: string | null;
  checkoutId: string | null;
  receivedAt: string;
  processedAt: string | null;
  /** The row's *current* state; `received` and `failed` are not final. */
  outcome: Entities.Config.GatewayEventOutcome;
  /** Every processing attempt, whoever made it. */
  attempts: number;
  /** A message truncated to 1024 characters; never a body. */
  error: string | null;
  dismissedAt: string | null;
  dismissedBy: string | null;
  dismissNote: string | null;
}

/** One row of the admin exceptions list, oldest first. */
export type GatewayExceptionRecord =
  /** An `orphan`, `mismatch` or `failed` event, or one left `received` for over an hour. */
  | { kind: 'event'; event: GatewayEventRecord; checkout: GatewayCheckoutRecord | null; occurredAt: string }
  /** A checkout in `mismatch`, or one under dispute. */
  | { kind: 'checkout'; checkout: GatewayCheckoutRecord; occurredAt: string };

/** Names one exception row for `dismissException`. */
export type GatewayExceptionRef =
  | { kind: 'event'; provider: PaymentProviderName; eventId: string }
  | { kind: 'checkout'; checkoutId: string };

// ---------------------------------------------------------------------------
// Inputs and results
// ---------------------------------------------------------------------------

export interface CreateGatewayCheckoutInput {
  /** Chosen by the caller, because the provider call that follows is keyed on it. */
  id: string;
  provider: PaymentProviderName;
  receivableKind: ReceivableKind;
  receivableId: string;
  userId: string;
  createdBy: string;
  amountMinor: number;
  currency: string;
  /** A placeholder until the provider answers (the row is written first — RFC 0026 section 3 step 5). */
  checkoutUrl: string;
  /** The requested expiry; `updateCheckout` narrows it to the provider's when that is earlier. */
  expiresAt: string;
}

/**
 * A write that does not change the checkout's status: the provider's answer to
 * `createCheckout`, a note about the last provider status, a dispute's state.
 * An omitted key is left untouched.
 */
export interface UpdateGatewayCheckoutInput {
  providerSessionId?: string;
  checkoutUrl?: string;
  expiresAt?: string;
  failureDetail?: string | null;
  /** Returns a dismissed checkout to the exceptions list (a new dispute state — decision 20). */
  clearDismissal?: boolean;
}

export interface CloseGatewayCheckoutInput {
  /** The status the checkout moves to; never `open`. */
  status: Exclude<Entities.Config.CheckoutStatus, Entities.Config.CheckoutStatus.OPEN>;
  /**
   * The write happens only while the row's current status is one of these.
   * Defaults to `['open']`. A payment that arrives on an `expired` or
   * `cancelled` checkout still lands, so the caller names those when closing as
   * `paid`.
   */
  from?: ReadonlyArray<Entities.Config.CheckoutStatus>;
  /** Set when a payment was confirmed (bare provider id). */
  providerPaymentId?: string;
  /** The ledger row a `paid` invoice checkout produced. */
  invoicePaymentId?: string;
  /** The ledger row a `paid` event-charge checkout produced. */
  chargePaymentId?: string;
  failureDetail?: string | null;
}

export interface RecordGatewayEventInput {
  provider: PaymentProviderName;
  eventId: string;
  type: string;
  providerPaymentId?: string | null;
}

export interface RecordGatewayEventResult {
  /** `true` when this call wrote the row; `false` when the event was already known. */
  inserted: boolean;
  /** The row as stored — the new one, or the existing one with its *stored* outcome. */
  event: GatewayEventRecord;
}

export interface MarkGatewayEventInput {
  /**
   * The event's new current state. `received` with `countAttempt` re-opens an
   * unsettled event for another processing attempt.
   */
  outcome: Entities.Config.GatewayEventOutcome;
  /** Adds one to `attempts` — set when a new processing attempt starts on a known event. */
  countAttempt?: boolean;
  checkoutId?: string | null;
  providerPaymentId?: string | null;
  /** Truncated to 1024 characters by the implementation; never a body. */
  error?: string | null;
}

export interface DismissGatewayExceptionInput {
  dismissedBy: string;
  /** 1–500 characters, validated by the caller. */
  note: string;
}

/** A capped work list plus how many rows were due in all, so the caller can count what it deferred. */
export interface GatewayWorkList<T> {
  items: T[];
  /** Rows matching the rule, including those beyond `limit`. */
  total: number;
}

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export interface IGatewayRepository {
  // Checkouts.

  /** Writes the row with `status = 'open'`. Fails when the receivable already has an open checkout. */
  createCheckout(input: CreateGatewayCheckoutInput): Promise<GatewayCheckoutRecord>;
  getCheckout(id: string): Promise<GatewayCheckoutRecord | null>;
  /** The one `open` checkout of a receivable, on whatever provider. */
  findOpenCheckout(receivableKind: ReceivableKind, receivableId: string): Promise<GatewayCheckoutRecord | null>;
  /**
   * Every `open` checkout, across all receivables and students, oldest first —
   * the one set-based read behind the admin roster and charge list, which
   * would otherwise ask once per receivable. Bounded by the number of open
   * receivables (one open checkout each). A row past its `expiresAt` is still
   * `open` until the reconcile run closes it; the caller decides what counts
   * as a payment in progress.
   */
  listOpenCheckouts(): Promise<GatewayCheckoutRecord[]>;
  /** Status-preserving write; `null` when the checkout does not exist. */
  updateCheckout(id: string, patch: UpdateGatewayCheckoutInput): Promise<GatewayCheckoutRecord | null>;
  /**
   * Conditional transition out of `input.from`. Returns the row when **this
   * call** changed it, and `null` when the checkout is missing or its status
   * was not one of `from` — another writer got there first.
   */
  closeCheckout(id: string, input: CloseGatewayCheckoutInput): Promise<GatewayCheckoutRecord | null>;

  // Events.

  /**
   * Idempotent on `(provider, eventId)`: inserts the row with
   * `outcome = 'received'` and `attempts = 1`, or — when the event already
   * exists — writes nothing and returns it with its stored outcome.
   */
  recordEvent(input: RecordGatewayEventInput): Promise<RecordGatewayEventResult>;
  /**
   * Conditional on the stored outcome being unsettled (`received` or `failed`).
   * Returns the row when this call changed it, `null` when the event is
   * missing or already settled.
   */
  markEvent(
    provider: PaymentProviderName,
    eventId: string,
    input: MarkGatewayEventInput,
  ): Promise<GatewayEventRecord | null>;

  // Exceptions — the admin's to-do list.

  /**
   * `orphan`, `mismatch` and `failed` events, events left `received` for more
   * than an hour, checkouts in `mismatch` and checkouts under dispute — oldest
   * first, dismissed rows excluded.
   */
  listExceptions(): Promise<GatewayExceptionRecord[]>;
  /**
   * Records who dismissed an exception, when and why. Changes no status, no
   * outcome and no ledger row. `false` when the row does not exist or is
   * already dismissed.
   */
  dismissException(ref: GatewayExceptionRef, input: DismissGatewayExceptionInput): Promise<boolean>;

  // Reconciliation work lists (RFC 0026 section 6).

  /**
   * Checkouts the reconcile run should ask the provider about: `open` past
   * `expiresAt`; `open` and created more than 30 minutes ago; `expired` or
   * `cancelled` and not asked since `closedAt`. Order: past expiry or closed
   * first, then least recently asked, never-asked first.
   */
  listCheckoutsToConfirm(limit: number): Promise<GatewayWorkList<GatewayCheckoutRecord>>;
  /** Stamps `lastCheckedAt = now`. */
  markChecked(id: string): Promise<void>;
  /**
   * Events whose outcome is `failed` or `received`, received more than 15
   * minutes and less than 72 hours ago, fewest `attempts` first.
   */
  listUnsettledEvents(limit: number): Promise<GatewayWorkList<GatewayEventRecord>>;
}
