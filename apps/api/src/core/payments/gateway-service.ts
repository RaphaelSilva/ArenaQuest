/**
 * GatewayService — the collection path of RFC 0026 §4 and §5.
 *
 * `handleEvent` takes one **verified** provider event and treats it as a
 * trigger only: it records the event idempotently, fetches the payment from
 * the provider over the adapter's authenticated call, and lets the *fetched*
 * state decide. Nothing in the delivery but the payment id is believed.
 *
 * Money reaches the ledger only through the rails' gateway entry points
 * (`recordGatewayPayment`, `recordGatewayRefund`), which are idempotent on the
 * `<provider>:<id>` reference — so two deliveries, a retry and the reconcile
 * run can all race here and the ledger still admits one row per provider
 * payment and one per provider refund.
 *
 * The ledger write, the checkout close and the event outcome are **three
 * separate conditional writes**, not one database batch: they live behind
 * three ports. Each is idempotent, the order is ledger → checkout → event, and
 * an attempt that dies between two of them leaves the event unsettled, so the
 * provider's redelivery (or the reconcile run) finishes the rest.
 *
 * It never gates: no enrollment, no access, no `user`. The only hold it may
 * raise is the contract-rail dispute hold; an event charge never gets one.
 *
 * Logs carry ids and outcomes only — never a body, a secret or a provider
 * message.
 *
 * `createCheckout` is the other direction (RFC 0026 §3): it opens — or hands
 * back — the **one** live hosted checkout of a receivable, for its full open
 * balance. The row is written before the provider is called, so a crash
 * between the two can never leave a provider session nobody knows about.
 * `getCheckoutStatus` reads that row and never the provider.
 * `createCheckoutOnBehalf` is the admin's door to the same code: the owner is
 * the receivable's student, the creator is the admin.
 *
 * `refundInvoicePayment` / `refundChargePayment` are the admin's refund (RFC
 * 0026 §5): the provider is asked what it holds, then asked to return the
 * money, and the reversal is written **only when the provider accepted** —
 * under the provider's refund id, so every step is safe to repeat.
 *
 * `confirmCheckout` is the reconcile run's question about one checkout (RFC
 * 0026 §6): it asks the provider — one call, by the checkout's own reference —
 * what the checkout produced and hands every payment to `applyPayment` — the
 * landing above, not a second one.
 * `listExceptions` / `dismissException` are the admin's to-do list (§7): they
 * read and annotate the gateway's own two tables and never call a provider.
 */
import type {
  IPaymentGateway,
  PaymentMethodName,
  PaymentProviderName,
  ProviderCheckout,
  ProviderDisputeOutcome,
  ProviderEvent,
  ProviderPayment,
  ProviderRefundResult,
} from '@arenaquest/shared/ports/i-payment-gateway';
import type { EventChargePaymentRecord, PaymentRecord } from '@arenaquest/shared/ports';
import type {
  GatewayCheckoutRecord,
  GatewayEventRecord,
  GatewayExceptionRecord,
  GatewayExceptionRef,
  IGatewayRepository,
} from '@arenaquest/shared/ports/i-gateway-repository';
import type { IRateLimiter } from '@arenaquest/shared/ports/i-rate-limiter';
import { Entities } from '@arenaquest/shared/types/entities';
import {
  PAYMENT_PROVIDER_NAMES,
  PROVIDER_METHOD_LABEL_PATTERN,
  isRetryableProviderError,
  type ProviderPaymentMethod,
} from '@arenaquest/shared/ports/i-payment-gateway';
import {
  buildGatewayReference,
  providerMethodsForCurrency,
  splitGatewayReference,
} from '@arenaquest/shared/domain/billing/gateway-money';
import {
  RAIL_OF_KIND,
  fromCharge,
  fromInvoice,
  type Receivable,
  type ReceivableKind,
} from '@arenaquest/shared/domain/billing/receivable';
import {
  GATEWAY_DISPUTE_DETAIL_PREFIX,
  SYSTEM_PAYMENT_ACTOR_ID,
} from '@api/adapters/db/d1-gateway-repository';
import { PAYMENTS_CONFIG_INVALID, type PaymentsConfigResult } from '@api/core/payments/config';
import type { GatewayRegistry } from '@api/core/payments/gateway-registry';
import type { BillingService } from '@api/core/billing/billing-service';
import { toPendingCheckout, type PendingCheckout } from '@api/core/billing/accounting-service';
import { isUniqueFailure, type EventChargeService } from '@api/core/billing/event-charge-service';
import type { ControllerResult } from '@api/core/result';

const { CheckoutStatus, GatewayEventOutcome } = Entities.Config;

/** What one call to `handleEvent` answers. `failed` is the service's own error: the route answers `503`. */
export type GatewayHandleOutcome = 'applied' | 'duplicate' | 'ignored' | 'orphan' | 'mismatch' | 'failed';

export interface GatewayHandleResult {
  outcome: GatewayHandleOutcome;
  provider: PaymentProviderName;
  eventId: string;
  /** The checkout the fetched payment named, when one was resolved. */
  checkoutId: string | null;
  /** The provider payment the event pointed at (bare id); `null` for an ignored kind. */
  providerPaymentId: string | null;
}

/** The outcome of acting on one fetched payment — also what the reconcile run reads. */
export interface GatewayPaymentOutcome {
  outcome: Exclude<GatewayHandleOutcome, 'failed'>;
  checkoutId: string | null;
}

/** The contract rail, as far as the gateway may reach into it. */
export type GatewayContractLedger = Pick<
  BillingService,
  | 'recordGatewayPayment'
  | 'recordGatewayRefund'
  | 'reverseGatewayPayment'
  | 'raiseDisputeHold'
  | 'releaseDisputeHold'
  | 'getInvoice'
  | 'getPayment'
>;

/** The extras rail: money only — an event charge never gets a hold. */
export type GatewayExtrasLedger = Pick<
  EventChargeService,
  'recordGatewayPayment' | 'recordGatewayRefund' | 'reverseGatewayPayment' | 'getCharge' | 'getPayment'
>;

/** Who a hosted page is opened for: the provider wants a name and an e-mail. */
export interface CheckoutPayerRecord {
  id: string;
  name: string;
  email: string;
}

/** `null` when the user does not exist (or is not a person — the system actor). */
export type CheckoutPayerReader = (userId: string) => Promise<CheckoutPayerRecord | null>;

/**
 * What creating a checkout needs beyond the collection path. Optional as a
 * group: a service built without it (a webhook-only wiring, a unit test of
 * landing) answers `404` to `createCheckout`, as a label with no provider does.
 */
export interface GatewayCheckoutDeps {
  /** The checked provider list; `ok: false` is `500 PAYMENTS_CONFIG_INVALID`. */
  config: PaymentsConfigResult;
  /** Which providers offer which methods on this label. */
  registry: Pick<GatewayRegistry, 'isEmpty' | 'payOptions' | 'methodsOf'>;
  payer: CheckoutPayerReader;
  /** The web origin the hosted page returns to — `WEB_BASE_URL`. */
  webBaseUrl: string;
  /** Per-student budget (`rl:checkouts:<userId>`); fails open. Omitted: no limit. */
  limiter?: IRateLimiter;
}

export interface GatewayServiceDeps {
  gateways: Pick<GatewayRegistry, 'get'>;
  gatewayRepo: IGatewayRepository;
  billing: GatewayContractLedger;
  charges: GatewayExtrasLedger;
  checkout?: GatewayCheckoutDeps;
  /** The clock a payment with no `paidAt` falls back to, and the one checkouts expire against. */
  now?: () => Date;
}

// ---------------------------------------------------------------------------
// Checkout creation (RFC 0026 §3)
// ---------------------------------------------------------------------------

/** `400`: several providers offer a method and none was named, or the one named offers nothing here. */
export const PAYMENT_PROVIDER_REQUIRED = 'PAYMENT_PROVIDER_REQUIRED';
/** `409`: the receivable is void, settled or has no balance left. */
export const RECEIVABLE_NOT_PAYABLE = 'RECEIVABLE_NOT_PAYABLE';
/** `409`: the provider cannot settle the receivable's currency; decided before the provider is called. */
export const PAYMENTS_UNSUPPORTED_CURRENCY = 'PAYMENTS_UNSUPPORTED_CURRENCY';
/** `502`: the provider refused or failed to open the session; the row is closed `failed`. */
export const PAYMENTS_PROVIDER_ERROR = 'PAYMENTS_PROVIDER_ERROR';
/** `409`: another request is opening this receivable's checkout right now; ask again. */
export const CHECKOUT_IN_PROGRESS = 'CHECKOUT_IN_PROGRESS';

/** The expiry asked of the provider — an upper bound; the provider may grant less. */
export const CHECKOUT_TTL_MS = 24 * 60 * 60_000;
/** An open checkout is handed back only while more than this remains before its expiry. */
export const CHECKOUT_REUSE_MIN_MS = 5 * 60_000;

/** What the row holds until the provider answers; never served. */
const CHECKOUT_URL_PLACEHOLDER = 'about:blank';

export interface CreateCheckoutInput {
  kind: ReceivableKind;
  /** The receivable's id. */
  id: string;
  /** Required when several providers offer a method. */
  provider?: string;
  /**
   * The origin of the API request that asks for the checkout
   * (`https://api.example.test`). The provider is told to notify
   * `<apiOrigin>/v1/webhooks/payments/<provider>`, so each environment — a
   * preview included — receives the deliveries of the checkouts it created.
   * Omitted or not an `http(s)` origin: the checkout carries no notification
   * URL and the provider falls back to its dashboard registration.
   */
  apiOrigin?: string | null;
}

/** The path every provider's notifications are received on, under the API origin. */
export const PAYMENTS_WEBHOOK_PATH = '/v1/webhooks/payments';

/**
 * `<origin>/v1/webhooks/payments/<provider>`, or `null` when `apiOrigin` is
 * absent or not an absolute `http(s)` URL. Only the origin is kept: a path,
 * query or credentials on the input never reach the provider.
 */
export function checkoutNotificationUrl(
  apiOrigin: string | null | undefined,
  provider: PaymentProviderName,
): string | null {
  if (typeof apiOrigin !== 'string' || apiOrigin === '') return null;
  let url: URL;
  try {
    url = new URL(apiOrigin);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return `${url.origin}${PAYMENTS_WEBHOOK_PATH}/${provider}`;
}

export interface CheckoutActor {
  /** The student who owes the receivable; anything owed by someone else is `404`. */
  userId: string;
  /** Who pressed the button: the student, or an admin acting on their behalf. */
  createdBy: string;
}

/** Who a checkout is opened for, as the one creation path sees it. */
interface CheckoutParty {
  /** `null`: whoever owes the receivable — the admin's on-behalf door, which names no student. */
  userId: string | null;
  createdBy: string;
  /** Whether the owner's hourly budget is consulted and charged; never for an admin. */
  budgeted: boolean;
}

/** A hosted session the caller can be sent to. */
export interface CheckoutSession {
  checkoutId: string;
  provider: PaymentProviderName;
  /** The provider's hosted page. */
  url: string;
  expiresAt: string;
  /** The receivable's full open balance when the checkout was created. */
  amountMinor: number;
  currency: string;
  status: 'open';
}

export interface CreateCheckoutResult {
  checkout: CheckoutSession;
  /** `true` when an open checkout was handed back (`200`), `false` when this call opened one (`201`). */
  reused: boolean;
}

/** One checkout as its row stands — the provider is never asked. */
export interface CheckoutStatusView {
  checkoutId: string;
  provider: PaymentProviderName;
  kind: ReceivableKind;
  /** The invoice or event charge it collects. */
  receivableId: string;
  status: Entities.Config.CheckoutStatus;
  amountMinor: number;
  currency: string;
  createdAt: string;
  expiresAt: string;
  /** `null` while the checkout is `open`. */
  closedAt: string | null;
}

// ---------------------------------------------------------------------------
// Refunds (RFC 0026 §5) and live checkouts (§7)
// ---------------------------------------------------------------------------

/** `409`: the payment's provider is not bound on this label any more; nothing is written. */
export const PAYMENTS_PROVIDER_NOT_ENABLED = 'PAYMENTS_PROVIDER_NOT_ENABLED';
/** `409`: the provider did not return the money (or holds no full refund to record); nothing is written. */
export const PAYMENTS_REFUND_REFUSED = 'PAYMENTS_REFUND_REFUSED';
/**
 * `503`: the provider could not take the request **right now** — a rate limit
 * (Mercado Pago answers `429` to refunds fired back to back), a timeout, an
 * outage. Not a refusal: nothing is written and the same request, repeated a
 * few seconds later, completes. If the provider had in fact accepted before
 * timing out, the repeat finds that refund and records it instead of asking
 * for a second one.
 */
export const PAYMENTS_PROVIDER_BUSY = 'PAYMENTS_PROVIDER_BUSY';
/**
 * `503`: the provider **did** return the money and the reversal could not be
 * written. Never "refund failed": repeating the same request completes it.
 */
export const PAYMENTS_REFUND_UNRECORDED = 'PAYMENTS_REFUND_UNRECORDED';

/** The idempotency key of an admin refund: one per ledger row, so a second click cannot refund twice. */
export function refundIdempotencyKey(paymentId: string): string {
  return `rev:${paymentId}`;
}

export interface RefundPaymentCommand {
  /** Mandatory, as on every reversal; it becomes the reversal row's note. */
  reason: string;
  /** `YYYY-MM-DD`; defaults to the provider's refund date, else today. */
  paidAt?: string;
}

export interface RefundPaymentResult<P> {
  /** The reversal row — the one this call wrote, or the one already on the ledger. */
  payment: P;
  /** `false` when the refund id was already on the ledger and nothing was written. */
  created: boolean;
  /** The provider's refund id (bare). */
  refundId: string;
}

/** The two rails' ledger rows, as far as a refund reads them. */
type LedgerPayment = PaymentRecord | EventChargePaymentRecord;

/** How a gateway ledger row was paid, for the admin ledger (never the student statement). */
export interface GatewayPaidMethod {
  /** The normalised method; `null` when the row was not landed by a checkout. */
  gatewayMethod: ProviderPaymentMethod | null;
  /** The provider's own name for it (`account_money`, `credit_card/visa`); `null` when unknown. */
  gatewayMethodLabel: string | null;
}

/** What a row no checkout landed reads: a hand-matched payment, a refund, any non-gateway row. */
export const NO_GATEWAY_PAID_METHOD: GatewayPaidMethod = Object.freeze({
  gatewayMethod: null,
  gatewayMethodLabel: null,
});

/** A label is stored only when it is what the port promises; anything else is dropped, never trimmed into shape. */
function storableMethodLabel(label: string | null): string | null {
  return label !== null && PROVIDER_METHOD_LABEL_PATTERN.test(label) ? label : null;
}

/** One receivable's payment in progress, for the set-based admin reads. */
export interface LiveCheckout {
  receivableKind: ReceivableKind;
  receivableId: string;
  /** The student who owes the receivable. */
  userId: string;
  pending: PendingCheckout;
}

// ---------------------------------------------------------------------------
// Reconciliation (RFC 0026 §6) and exceptions (§7)
// ---------------------------------------------------------------------------

/** An `open` checkout with no provider session is given up on once it is this old. */
export const CHECKOUT_SESSIONLESS_AFTER_MS = 30 * 60_000;

/** Thrown inside the service when a provider call outlives its budget; only its name is ever stored. */
export class ProviderTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`the provider did not answer within ${timeoutMs} ms`);
    this.name = 'ProviderTimeoutError';
  }
}

/** Bounds one provider call. The timer is always cleared; `undefined` means no bound. */
async function withProviderTimeout<T>(call: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (timeoutMs === undefined) return call;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProviderTimeoutError(timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([call, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface ProviderCallOptions {
  /** Upper bound of each provider call, in milliseconds. Omitted: unbounded. */
  timeoutMs?: number;
}

export interface ConfirmCheckoutOptions extends ProviderCallOptions {
  /**
   * `false` when the caller's budget of provider calls is spent: a checkout
   * that needs one is answered `deferred` and left untouched, while the cases
   * that cost no call are still handled.
   */
  ask?: boolean;
}

/**
 * What asking about one checkout came to:
 * - `landed` — the provider holds a payment and the checkout is now `paid`;
 * - `mismatch` — a payment was found that does not fit; nothing landed;
 * - `expired` — nothing paid and the checkout is past its expiry: closed;
 * - `open` — nothing paid yet, not yet expired;
 * - `closed` — an already closed checkout got its final ask and nothing changed;
 * - `abandoned` — `open` with no provider session for over 30 minutes: closed `failed`, no call;
 * - `unreachable` — its provider is no longer bound: expired without a call;
 * - `deferred` — needs a provider call the caller could not afford;
 * - `error` — the provider (or the landing) failed; asked again next run.
 */
export type ConfirmCheckoutOutcome =
  | 'landed'
  | 'mismatch'
  | 'expired'
  | 'open'
  | 'closed'
  | 'abandoned'
  | 'unreachable'
  | 'deferred'
  | 'error';

export interface ConfirmCheckoutResult {
  outcome: ConfirmCheckoutOutcome;
  /** Whether a provider call was made — what the caller's cap counts. */
  asked: boolean;
}

/** Why a row is on the exceptions list. */
export type PaymentExceptionKind = 'orphan' | 'mismatch' | 'failed' | 'received' | 'dispute';

/** One row of the admin exceptions list (RFC 0026 §7). Ids and states only — never a body. */
export interface PaymentExceptionView {
  /** Stable handle for `dismissException`: `event:<provider>:<eventId>` or `checkout:<checkoutId>`. */
  ref: string;
  kind: PaymentExceptionKind;
  /** Which table the row lives in. */
  source: 'event' | 'checkout';
  provider: PaymentProviderName;
  /** The provider's notification id; `null` for a checkout row. */
  eventId: string | null;
  /** `gateway_events.type`; `null` for a checkout row. */
  eventType: string | null;
  /** The provider's payment id (bare), when one is known. */
  providerPaymentId: string | null;
  checkoutId: string | null;
  /** Processing attempts of an event; `null` for a checkout row. */
  attempts: number | null;
  /** The stored failure / mismatch / dispute description; never a provider message. */
  detail: string | null;
  /** When the event was received, or the checkout last changed. */
  occurredAt: string;
  /** What the checkout was collecting — `null` when no checkout is known (an orphan). */
  receivable: {
    kind: ReceivableKind;
    id: string;
    userId: string;
    /** `null` when the student no longer resolves. */
    studentName: string | null;
    /** What the checkout asked for — not what the provider captured. */
    amountMinor: number;
    currency: string;
  } | null;
}

export interface DismissedException {
  ref: string;
  dismissedBy: string;
  dismissedAt: string;
}

const EVENT_REF_PREFIX = 'event:';
const CHECKOUT_REF_PREFIX = 'checkout:';

/** The stable string form of an exception's identity. An event id may itself contain `:`. */
export function formatExceptionRef(ref: GatewayExceptionRef): string {
  return ref.kind === 'event'
    ? `${EVENT_REF_PREFIX}${ref.provider}:${ref.eventId}`
    : `${CHECKOUT_REF_PREFIX}${ref.checkoutId}`;
}

/** The inverse of `formatExceptionRef`; `null` for anything it would not have produced. */
export function parseExceptionRef(ref: string): GatewayExceptionRef | null {
  if (ref.startsWith(CHECKOUT_REF_PREFIX)) {
    const checkoutId = ref.slice(CHECKOUT_REF_PREFIX.length);
    return checkoutId === '' ? null : { kind: 'checkout', checkoutId };
  }
  if (!ref.startsWith(EVENT_REF_PREFIX)) return null;
  const rest = ref.slice(EVENT_REF_PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon <= 0) return null;
  const provider = PAYMENT_PROVIDER_NAMES.find((name) => name === rest.slice(0, colon));
  const eventId = rest.slice(colon + 1);
  return provider && eventId !== '' ? { kind: 'event', provider, eventId } : null;
}

function exceptionRefOf(row: GatewayExceptionRecord): GatewayExceptionRef {
  return row.kind === 'event'
    ? { kind: 'event', provider: row.event.provider, eventId: row.event.eventId }
    : { kind: 'checkout', checkoutId: row.checkout.id };
}

function refusal(status: number, error: string, meta?: Record<string, unknown>): ControllerResult<never> {
  return meta ? { ok: false, status, error, meta } : { ok: false, status, error };
}

const CHECKOUT_NOT_FOUND = refusal(404, 'NotFound');

/** The earlier of two ISO instants; `fallback` when `candidate` is not a date. */
function earlierInstant(candidate: string, fallback: string): string {
  const at = Date.parse(candidate);
  return Number.isFinite(at) && at < Date.parse(fallback) ? new Date(at).toISOString() : fallback;
}

/** `gateway_events.type` of a dispute event: the kind plus its outcome, so a stored row can be replayed. */
const DISPUTE_TYPE_PREFIX = 'dispute.';

/** A checkout in one of these still takes a late payment (RFC 0026 §5). */
const PAYABLE_FROM = [CheckoutStatus.OPEN, CheckoutStatus.EXPIRED, CheckoutStatus.CANCELLED] as const;

const SETTLED: ReadonlySet<string> = new Set([
  GatewayEventOutcome.APPLIED,
  GatewayEventOutcome.DUPLICATE,
  GatewayEventOutcome.IGNORED,
  GatewayEventOutcome.ORPHAN,
  GatewayEventOutcome.MISMATCH,
]);

const STORED_OUTCOME: Readonly<Record<GatewayPaymentOutcome['outcome'], Entities.Config.GatewayEventOutcome>> = {
  applied: GatewayEventOutcome.APPLIED,
  duplicate: GatewayEventOutcome.DUPLICATE,
  ignored: GatewayEventOutcome.IGNORED,
  orphan: GatewayEventOutcome.ORPHAN,
  mismatch: GatewayEventOutcome.MISMATCH,
};

/** `true` when a stored event outcome is final (anything but `received` / `failed`). */
export function isSettledEventOutcome(outcome: string): boolean {
  return SETTLED.has(outcome);
}

/** What `gateway_events.type` holds for an event. */
export function storedEventType(event: ProviderEvent): string {
  if (event.kind === 'ignored') return event.type;
  if (event.kind === 'dispute') return `${DISPUTE_TYPE_PREFIX}${event.outcome}`;
  return event.kind;
}

/**
 * Rebuilds the event a stored, unsettled row stands for, so the reconcile run
 * can hand it back to `handleEvent`. `null` when the row carries no payment id
 * or a type this service never stores for a retryable event. A `refund` comes
 * back as a `payment` event: the refund id is not stored and is not needed —
 * every refund of the fetched payment lands whatever the event called itself.
 */
export function eventFromRecord(record: GatewayEventRecord): ProviderEvent | null {
  if (record.providerPaymentId === null) return null;
  const base = { eventId: record.eventId, paymentId: record.providerPaymentId, occurredAt: record.receivedAt };
  if (record.type === 'payment' || record.type === 'refund') return { kind: 'payment', ...base };
  if (record.type.startsWith(DISPUTE_TYPE_PREFIX)) {
    const outcome = record.type.slice(DISPUTE_TYPE_PREFIX.length);
    if (outcome === 'opened' || outcome === 'won' || outcome === 'lost') {
      return { kind: 'dispute', outcome, ...base };
    }
  }
  return null;
}

/** The ledger reference of a lost dispute: its own id space inside the provider's, keyed on the payment. */
export function disputeReference(provider: PaymentProviderName, paymentId: string): string {
  return buildGatewayReference(provider, `dispute-${paymentId}`);
}

/** A failure description that can never carry a body: the error's class name and nothing else. */
function describeFailure(error: unknown): string {
  const name = error instanceof Error && error.name ? error.name : 'Error';
  return `processing failed (${name})`;
}

export class GatewayService {
  private readonly now: () => Date;

  constructor(private readonly deps: GatewayServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * One verified delivery. Never throws: the service's own failure is the
   * outcome `failed`, with the event left unsettled so a redelivery is
   * processed again. `options.timeoutMs` bounds the provider read — the
   * reconcile run sets it; a webhook request leaves it to the platform.
   */
  async handleEvent(
    provider: PaymentProviderName,
    event: ProviderEvent,
    options: ProviderCallOptions = {},
  ): Promise<GatewayHandleResult> {
    const providerPaymentId = event.kind === 'ignored' ? null : event.paymentId;
    const result = (outcome: GatewayHandleOutcome, checkoutId: string | null = null): GatewayHandleResult => {
      const answer = { outcome, provider, eventId: event.eventId, checkoutId, providerPaymentId };
      console.info(JSON.stringify({ event: 'payments.webhook_event', ...answer, at: this.now().toISOString() }));
      return answer;
    };

    const repo = this.deps.gatewayRepo;
    try {
      const recorded = await repo.recordEvent({
        provider,
        eventId: event.eventId,
        type: storedEventType(event),
        providerPaymentId,
      });
      if (!recorded.inserted) {
        // The stored outcome answers a known event: a settled one is a
        // duplicate and nothing is written; an unsettled one is tried again.
        if (isSettledEventOutcome(recorded.event.outcome)) {
          return result('duplicate', recorded.event.checkoutId);
        }
        await repo.markEvent(provider, event.eventId, {
          outcome: GatewayEventOutcome.RECEIVED,
          countAttempt: true,
        });
      }
    } catch {
      // Not even recorded: the provider's redelivery starts from nothing.
      return result('failed');
    }

    try {
      if (event.kind === 'ignored') {
        await repo.markEvent(provider, event.eventId, { outcome: GatewayEventOutcome.IGNORED, error: null });
        return result('ignored');
      }

      const gateway = this.deps.gateways.get(provider);
      if (!gateway) throw new Error(`no adapter is bound for ${provider}`);

      const payment = await withProviderTimeout(gateway.getPayment(event.paymentId), options.timeoutMs);
      const acted: GatewayPaymentOutcome = payment
        ? await this.applyPayment(provider, payment, {
            occurredAt: event.occurredAt,
            dispute: event.kind === 'dispute' ? event.outcome : null,
          })
        : { outcome: 'orphan', checkoutId: null };

      await repo.markEvent(provider, event.eventId, {
        outcome: STORED_OUTCOME[acted.outcome],
        checkoutId: acted.checkoutId,
        error: null,
      });
      return result(acted.outcome, acted.checkoutId);
    } catch (error) {
      try {
        await repo.markEvent(provider, event.eventId, {
          outcome: GatewayEventOutcome.FAILED,
          error: describeFailure(error),
        });
      } catch {
        // The row stays `received`; it is retried the same way.
      }
      return result('failed');
    }
  }

  /**
   * Acts on one payment **as fetched from the provider**. The webhook reaches
   * it through `handleEvent`; the reconcile run calls it with what
   * `findPaymentsForCheckout` returned. Throws on the service's own failure.
   *
   * @param context.occurredAt The date a payment without `paidAt`, and a lost
   *   dispute, are booked on; defaults to now.
   * @param context.dispute The outcome a verified dispute event carried.
   */
  async applyPayment(
    provider: PaymentProviderName,
    payment: ProviderPayment,
    context: { occurredAt?: string | null; dispute?: ProviderDisputeOutcome | null } = {},
  ): Promise<GatewayPaymentOutcome> {
    const repo = this.deps.gatewayRepo;

    // The back-reference must name a checkout of this very provider.
    const checkout = payment.checkoutId === null ? null : await repo.getCheckout(payment.checkoutId);
    if (!checkout || checkout.provider !== provider) return { outcome: 'orphan', checkoutId: null };

    if (payment.currency !== checkout.currency) {
      await repo.closeCheckout(checkout.id, {
        status: CheckoutStatus.MISMATCH,
        from: PAYABLE_FROM,
        failureDetail: `currency mismatch: the payment is in ${payment.currency}, the checkout in ${checkout.currency}`,
      });
      return { outcome: 'mismatch', checkoutId: checkout.id };
    }

    if (payment.status === 'pending') return { outcome: 'ignored', checkoutId: checkout.id };

    if (payment.status === 'failed' || payment.status === 'expired') {
      // The student may try again inside the same session; keep the last status.
      if (checkout.status === CheckoutStatus.OPEN) {
        await repo.updateCheckout(checkout.id, { failureDetail: `payment ${payment.status}` });
      }
      return { outcome: 'ignored', checkoutId: checkout.id };
    }

    // `paid`, `refunded` or `disputed`: the money was captured, so it lands
    // first if it never did — also on a checkout already expired or cancelled.
    const fallbackDate = context.occurredAt ?? this.now().toISOString();
    const landed = await this.landPayment(provider, checkout, payment, payment.paidAt ?? fallbackDate);
    if (landed === 'refused') return { outcome: 'mismatch', checkoutId: checkout.id };
    let changed = landed === 'created';

    // Every refund the provider holds, whatever the event called itself.
    for (const refund of payment.refunds) {
      const written = await this.ledgerRefund(checkout, {
        amountMinor: refund.amountMinor,
        currency: payment.currency,
        paidAt: refund.createdAt,
        externalReference: buildGatewayReference(provider, refund.id),
      });
      changed ||= written;
    }

    const dispute = context.dispute ?? (payment.status === 'disputed' ? 'opened' : null);
    if (dispute) changed = (await this.applyDispute(provider, checkout, payment, dispute, fallbackDate)) || changed;

    return { outcome: changed ? 'applied' : 'duplicate', checkoutId: checkout.id };
  }

  /** Lands the captured amount and closes the checkout as `paid`. */
  private async landPayment(
    provider: PaymentProviderName,
    checkout: GatewayCheckoutRecord,
    payment: ProviderPayment,
    paidAt: string,
  ): Promise<'created' | 'existing' | 'refused'> {
    const command = {
      // What the provider captured, not what the checkout asked for (R14).
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      paidAt,
      externalReference: buildGatewayReference(provider, payment.id),
    };
    const isInvoice = checkout.receivableKind === 'invoice';
    const written = isInvoice
      ? await this.deps.billing.recordGatewayPayment(checkout.receivableId, command)
      : await this.deps.charges.recordGatewayPayment(checkout.receivableId, command);

    if (!written.ok) {
      // The ledger refused what an admin payment would be refused too (a void
      // receivable, a currency the receivable is not in). The money is at the
      // provider and not on the ledger: an exception an admin resolves, and
      // nothing a redelivery could change.
      await this.deps.gatewayRepo.closeCheckout(checkout.id, {
        status: CheckoutStatus.MISMATCH,
        from: PAYABLE_FROM,
        providerPaymentId: payment.id,
        failureDetail:
          written.status === 409
            ? 'payment not landed: the receivable is void'
            : `payment not landed: refused by the ledger (${written.status})`,
      });
      return 'refused';
    }

    // Also on `created: false`: an earlier attempt may have written the row
    // and died before closing the checkout. A second payment on a checkout
    // that is already `paid` changes nothing here — the write is conditional.
    await this.deps.gatewayRepo.closeCheckout(checkout.id, {
      status: CheckoutStatus.PAID,
      from: PAYABLE_FROM,
      providerPaymentId: payment.id,
      // How it was paid, for the admin ledger: the normalised method and the
      // provider's own name for it (never free text — the adapter builds it
      // from provider identifiers and it is checked again here).
      paidMethod: payment.method,
      paidMethodLabel: storableMethodLabel(payment.methodLabel),
      ...(isInvoice
        ? { invoicePaymentId: written.data.payment.id }
        : { chargePaymentId: written.data.payment.id }),
    });
    return written.data.created ? 'created' : 'existing';
  }

  /** One negative gateway row; `true` when this call wrote it. Throws when the ledger refuses it. */
  private async ledgerRefund(
    checkout: GatewayCheckoutRecord,
    command: {
      amountMinor: number;
      currency: string;
      paidAt: string;
      externalReference: string;
      kind?: 'refund' | 'dispute';
    },
  ): Promise<boolean> {
    const written =
      checkout.receivableKind === 'invoice'
        ? await this.deps.billing.recordGatewayRefund(checkout.receivableId, command)
        : await this.deps.charges.recordGatewayRefund(checkout.receivableId, command);
    if (!written.ok) throw new Error(`the ledger refused a provider refund (${written.status})`);
    return written.data.created;
  }

  /**
   * A dispute's state on the checkout, the contract-rail hold and — when lost —
   * the money that left. `true` when this call changed anything.
   */
  private async applyDispute(
    provider: PaymentProviderName,
    checkout: GatewayCheckoutRecord,
    payment: ProviderPayment,
    outcome: ProviderDisputeOutcome,
    occurredAt: string,
  ): Promise<boolean> {
    const detail = `${GATEWAY_DISPUTE_DETAIL_PREFIX}${outcome}`;
    // Re-read: the landing above may have just closed the checkout.
    const current = (await this.deps.gatewayRepo.getCheckout(checkout.id)) ?? checkout;
    const known = current.failureDetail;
    const closed =
      known === `${GATEWAY_DISPUTE_DETAIL_PREFIX}won` || known === `${GATEWAY_DISPUTE_DETAIL_PREFIX}lost`;
    // A late `opened` never reopens a dispute the provider already closed.
    const isNewState = known !== detail && !(outcome === 'opened' && closed);
    const onContractRail = RAIL_OF_KIND[checkout.receivableKind] === 'contract';
    let changed = false;

    if (outcome === 'opened') {
      // Hold first, note second: a retry after a crash in between raises it
      // again (idempotent), while a redelivery of a recorded state does not
      // re-raise a hold an admin lifted early.
      if (isNewState && onContractRail) {
        const hold = await this.deps.billing.raiseDisputeHold(checkout.userId);
        if (!hold.ok) throw new Error(`the dispute hold could not be raised (${hold.status})`);
      }
    } else {
      if (outcome === 'lost') {
        const refunded = payment.refunds.reduce((sum, refund) => sum + refund.amountMinor, 0);
        const lostMinor = payment.amountMinor - refunded;
        if (lostMinor > 0) {
          changed = await this.ledgerRefund(checkout, {
            amountMinor: lostMinor,
            currency: payment.currency,
            paidAt: occurredAt,
            externalReference: disputeReference(provider, payment.id),
            kind: 'dispute',
          });
        }
      }
      if (onContractRail) {
        const released = await this.deps.billing.releaseDisputeHold(checkout.userId);
        if (!released.ok) throw new Error(`the dispute hold could not be released (${released.status})`);
      }
    }

    if (isNewState) {
      await this.deps.gatewayRepo.updateCheckout(checkout.id, { failureDetail: detail, clearDismissal: true });
      console.info(
        JSON.stringify({
          event: outcome === 'opened' ? 'payments.dispute_opened' : 'payments.dispute_closed',
          actor: SYSTEM_PAYMENT_ACTOR_ID,
          provider,
          rail: RAIL_OF_KIND[checkout.receivableKind],
          outcome,
          userId: checkout.userId,
          checkoutId: checkout.id,
          at: this.now().toISOString(),
        }),
      );
      changed = true;
    }
    return changed;
  }

  // -------------------------------------------------------------------------
  // Checkouts (RFC 0026 §3)
  // -------------------------------------------------------------------------

  /**
   * Whether the checkout routes exist on this label at all: `null` when they
   * do, otherwise the refusal — `500 PAYMENTS_CONFIG_INVALID` for an invalid
   * provider list, `404` when no provider is bound. A route asks this before
   * it validates anything, so a label under `none` answers `404` to any body.
   *
   * An invalid list binds nothing, so the configuration is asked first:
   * otherwise its `500` would hide behind the empty registry's `404`.
   */
  checkoutGate(): ControllerResult<never> | null {
    const deps = this.deps.checkout;
    if (!deps) return CHECKOUT_NOT_FOUND;
    if (!deps.config.ok) {
      console.error(
        JSON.stringify({ event: 'payments.config_invalid', reason: deps.config.reason, detail: deps.config.detail }),
      );
      return refusal(500, PAYMENTS_CONFIG_INVALID);
    }
    return deps.registry.isEmpty ? CHECKOUT_NOT_FOUND : null;
  }

  /**
   * Opens — or hands back — the one live hosted checkout of a receivable.
   *
   * The refusals come in a fixed order: configuration (`500`) and feature gate
   * (`404`) → provider (`400`) → the receivable exists and is `actor.userId`'s
   * (`404`) → payable (`409`) → currency (`409`, before any provider call) →
   * an open checkout worth reusing is returned → the per-student budget
   * (`429`) → the row → the provider (`502`, row closed `failed`).
   *
   * The budget counts provider calls, not button presses: handing back an open
   * checkout costs nothing, and a checkout an admin opens on a student's
   * behalf (`createdBy !== userId`) does not draw on the student's budget.
   */
  async createCheckout(
    input: CreateCheckoutInput,
    actor: CheckoutActor,
  ): Promise<ControllerResult<CreateCheckoutResult>> {
    return this.openCheckout(input, { ...actor, budgeted: actor.createdBy === actor.userId });
  }

  /**
   * The admin's door (RFC 0026 §3, "on behalf of a student"): the same rules
   * and the same refusal order, with the owner read **from the receivable** —
   * the request names no student — and `createdBy` the admin. The student's
   * hourly budget is neither consulted nor charged, even for an admin who
   * happens to owe the receivable themselves. The hosted URL in the answer is
   * what the admin hands over; nothing is charged to anyone until it is paid.
   */
  async createCheckoutOnBehalf(
    input: CreateCheckoutInput,
    adminId: string,
  ): Promise<ControllerResult<CreateCheckoutResult>> {
    return this.openCheckout(input, { userId: null, createdBy: adminId, budgeted: false });
  }

  private async openCheckout(
    input: CreateCheckoutInput,
    actor: CheckoutParty,
  ): Promise<ControllerResult<CreateCheckoutResult>> {
    const deps = this.deps.checkout;
    const closed = this.checkoutGate();
    if (closed || !deps) return closed ?? CHECKOUT_NOT_FOUND;

    // 1. The provider: the one named, or the only one that offers a method.
    const options = deps.registry.payOptions;
    const option =
      input.provider === undefined
        ? options.length === 1
          ? options[0]
          : undefined
        : options.find((candidate) => candidate.provider === input.provider);
    const gateway = option ? this.deps.gateways.get(option.provider) : null;
    if (!option || !gateway) return refusal(400, PAYMENT_PROVIDER_REQUIRED);
    const provider = option.provider;

    // 2. The receivable, and whose it is. Someone else's is a missing one.
    const receivable = await this.readReceivable(input.kind, input.id);
    if (!receivable || (actor.userId !== null && receivable.userId !== actor.userId)) {
      return CHECKOUT_NOT_FOUND;
    }

    // 3. Payable, and in a currency this provider settles.
    if (receivable.status !== 'open' || receivable.balanceMinor <= 0) {
      return refusal(409, RECEIVABLE_NOT_PAYABLE);
    }
    const settles: ReadonlyArray<string> = providerMethodsForCurrency(provider, receivable.currency);
    const methods: PaymentMethodName[] = deps.registry
      .methodsOf(provider)
      .filter((method) => settles.includes(method));
    if (methods.length === 0) return refusal(409, PAYMENTS_UNSUPPORTED_CURRENCY);

    // 4. One live attempt.
    const repo = this.deps.gatewayRepo;
    const now = this.now();
    const existing = await repo.findOpenCheckout(receivable.kind, receivable.id);
    const disposition = existing ? this.dispose(existing, provider, receivable, now) : 'none';
    if (existing && disposition === 'reuse') {
      return { ok: true, data: { checkout: toSession(existing), reused: true } };
    }

    const limited = actor.budgeted ? await this.checkoutBudget(deps.limiter, receivable.userId) : null;
    if (limited) return limited;

    const payer = await deps.payer(receivable.userId);
    if (!payer) return CHECKOUT_NOT_FOUND;

    // 5. Row first. An open row that never got its session is called again
    //    under its own id; anything else stale is closed before the new one.
    let row: GatewayCheckoutRecord;
    if (existing && disposition === 'retry') {
      row = existing;
    } else {
      if (existing) {
        await repo.closeCheckout(existing.id, {
          status: disposition === 'expire' ? CheckoutStatus.EXPIRED : CheckoutStatus.CANCELLED,
        });
      }
      try {
        row = await repo.createCheckout({
          id: crypto.randomUUID(),
          provider,
          receivableKind: receivable.kind,
          receivableId: receivable.id,
          userId: receivable.userId,
          createdBy: actor.createdBy,
          amountMinor: receivable.balanceMinor,
          currency: receivable.currency,
          checkoutUrl: CHECKOUT_URL_PLACEHOLDER,
          expiresAt: new Date(now.getTime() + CHECKOUT_TTL_MS).toISOString(),
        });
      } catch (error) {
        if (!isUniqueFailure(error)) throw error;
        // A concurrent request won the one-open-row index. Its checkout is the
        // answer when it is already usable; otherwise it is still being opened.
        const winner = await repo.findOpenCheckout(receivable.kind, receivable.id);
        if (winner && this.dispose(winner, provider, receivable, now) === 'reuse') {
          return { ok: true, data: { checkout: toSession(winner), reused: true } };
        }
        return refusal(409, CHECKOUT_IN_PROGRESS);
      }
    }

    // 6. Provider second, keyed on the row's id.
    let opened: ProviderCheckout;
    try {
      opened = await gateway.createCheckout({
        checkoutId: row.id,
        amountMinor: row.amountMinor,
        currency: row.currency,
        description: checkoutDescription(receivable),
        payer: { id: payer.id, name: payer.name, email: payer.email },
        methods,
        returnUrls: this.returnUrls(deps.webBaseUrl, row.id),
        notificationUrl: checkoutNotificationUrl(input.apiOrigin, provider),
        expiresAt: row.expiresAt,
      });
      if (!opened.sessionId || !opened.url) throw new TypeError('the provider returned no session');
    } catch (error) {
      // The index is released; the next Pay starts a new attempt.
      await repo.closeCheckout(row.id, {
        status: CheckoutStatus.FAILED,
        failureDetail: `provider call failed (${error instanceof Error && error.name ? error.name : 'Error'})`,
      });
      return refusal(502, PAYMENTS_PROVIDER_ERROR);
    }

    // The provider's expiry when it is earlier than the one asked for.
    const expiresAt = earlierInstant(opened.expiresAt, row.expiresAt);
    const stored = await repo.updateCheckout(row.id, {
      providerSessionId: opened.sessionId,
      checkoutUrl: opened.url,
      expiresAt,
    });

    console.info(
      JSON.stringify({
        event: 'payments.checkout_created',
        actor: actor.createdBy,
        userId: receivable.userId,
        checkoutId: row.id,
        provider,
        rail: receivable.rail,
        receivableId: receivable.id,
        at: this.now().toISOString(),
      }),
    );

    return {
      ok: true,
      data: {
        checkout: toSession({ ...(stored ?? row), checkoutUrl: opened.url, expiresAt }),
        reused: false,
      },
    };
  }

  /**
   * One checkout of `userId`'s, as its row stands. Reads the database only —
   * the provider is never called, so polling this costs one read. A checkout
   * that is someone else's is `404`, the same as one that does not exist.
   */
  async getCheckoutStatus(checkoutId: string, userId: string): Promise<ControllerResult<CheckoutStatusView>> {
    const checkout = await this.deps.gatewayRepo.getCheckout(checkoutId);
    if (!checkout || checkout.userId !== userId) return CHECKOUT_NOT_FOUND;
    return {
      ok: true,
      data: {
        checkoutId: checkout.id,
        provider: checkout.provider,
        kind: checkout.receivableKind,
        receivableId: checkout.receivableId,
        status: checkout.status,
        amountMinor: checkout.amountMinor,
        currency: checkout.currency,
        createdAt: checkout.createdAt,
        expiresAt: checkout.expiresAt,
        closedAt: checkout.closedAt,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Live checkouts — the admin's "pending online payment" (RFC 0026 §7)
  // -------------------------------------------------------------------------

  /**
   * Every payment in progress, in **one** read: what the roster and the charge
   * list join in memory. "In progress" is the statement's own rule
   * (`toPendingCheckout`): open, with its provider session, not past expiry.
   */
  async listLiveCheckouts(): Promise<LiveCheckout[]> {
    const now = this.now();
    const live: LiveCheckout[] = [];
    for (const checkout of await this.deps.gatewayRepo.listOpenCheckouts()) {
      const pending = toPendingCheckout(checkout, now);
      if (!pending) continue;
      live.push({
        receivableKind: checkout.receivableKind,
        receivableId: checkout.receivableId,
        userId: checkout.userId,
        pending,
      });
    }
    return live;
  }

  /**
   * How each of the given ledger rows of one rail was paid, in **one** read:
   * the map holds an entry only for a row a `paid` checkout landed. Everything
   * else — a hand-matched gateway row, a refund, a second payment on one
   * checkout, any other method — is absent and reads as
   * {@link NO_GATEWAY_PAID_METHOD}. Database only; no provider is called.
   */
  async paidMethodsOf(
    kind: ReceivableKind,
    paymentIds: ReadonlyArray<string>,
  ): Promise<Map<string, GatewayPaidMethod>> {
    const methods = new Map<string, GatewayPaidMethod>();
    if (paymentIds.length === 0) return methods;
    for (const record of await this.deps.gatewayRepo.listPaidMethods(kind, paymentIds)) {
      methods.set(record.paymentId, { gatewayMethod: record.method, gatewayMethodLabel: record.methodLabel });
    }
    return methods;
  }

  /** One receivable's payment in progress, or `null` — whatever the receivable's own status. */
  async findLiveCheckout(kind: ReceivableKind, receivableId: string): Promise<PendingCheckout | null> {
    return toPendingCheckout(await this.deps.gatewayRepo.findOpenCheckout(kind, receivableId), this.now());
  }

  // -------------------------------------------------------------------------
  // Reconciliation (RFC 0026 §6) and exceptions (§7)
  // -------------------------------------------------------------------------

  /**
   * Asks the provider about one checkout the reconcile run found due — **one
   * provider call**, by the checkout's own id, the reference sent at creation —
   * and lands whatever it holds through `applyPayment` — the webhook's own
   * path, idempotent on the reference index. Never throws.
   *
   * Two cases cost no provider call: an `open` checkout that never got its
   * session (the create call died) is closed `failed` once it is 30 minutes
   * old; a checkout whose provider is no longer bound cannot be asked about,
   * so it is expired and reported `unreachable`.
   *
   * `lastCheckedAt` is stamped whenever the question was answered. After a
   * provider error it is stamped only on an `open` checkout — so one failing
   * row rotates to the back of the queue — while a closed one keeps its claim
   * to the single final ask.
   */
  async confirmCheckout(
    checkout: GatewayCheckoutRecord,
    options: ConfirmCheckoutOptions = {},
  ): Promise<ConfirmCheckoutResult> {
    const repo = this.deps.gatewayRepo;
    const now = this.now();
    const wasOpen = checkout.status === CheckoutStatus.OPEN;
    const sessionId = checkout.providerSessionId;
    const gateway = this.deps.gateways.get(checkout.provider);
    try {
      if (wasOpen && sessionId === null) {
        if (now.getTime() - Date.parse(checkout.createdAt) <= CHECKOUT_SESSIONLESS_AFTER_MS) {
          return { outcome: 'open', asked: false };
        }
        await repo.closeCheckout(checkout.id, {
          status: CheckoutStatus.FAILED,
          failureDetail: 'no provider session after 30 minutes',
        });
        return { outcome: 'abandoned', asked: false };
      }

      if (!gateway) {
        if (wasOpen) {
          await repo.closeCheckout(checkout.id, {
            status: CheckoutStatus.EXPIRED,
            failureDetail: 'provider no longer bound',
          });
        }
        await repo.markChecked(checkout.id);
        return { outcome: 'unreachable', asked: false };
      }

      if (sessionId === null) {
        // Closed before any session existed: there is nothing to ask about.
        await repo.markChecked(checkout.id);
        return { outcome: 'closed', asked: false };
      }
    } catch {
      return { outcome: 'error', asked: false };
    }
    if (!gateway || sessionId === null) return { outcome: 'error', asked: false };

    if (options.ask === false) return { outcome: 'deferred', asked: false };

    try {
      const payments = await withProviderTimeout(
        gateway.findPaymentsForCheckout({ sessionId, checkoutId: checkout.id }),
        options.timeoutMs,
      );
      for (const payment of payments) await this.applyPayment(checkout.provider, payment);

      const current = (await repo.getCheckout(checkout.id)) ?? checkout;
      let outcome: ConfirmCheckoutOutcome;
      if (current.status === CheckoutStatus.PAID && checkout.status !== CheckoutStatus.PAID) {
        outcome = 'landed';
      } else if (current.status === CheckoutStatus.MISMATCH && checkout.status !== CheckoutStatus.MISMATCH) {
        outcome = 'mismatch';
      } else if (current.status === CheckoutStatus.OPEN) {
        if (Date.parse(current.expiresAt) <= now.getTime()) {
          await repo.closeCheckout(current.id, { status: CheckoutStatus.EXPIRED });
          outcome = 'expired';
        } else {
          outcome = 'open';
        }
      } else {
        outcome = 'closed';
      }
      // After the close, so an expired row is not due again for its "final ask".
      await repo.markChecked(checkout.id);
      return { outcome, asked: true };
    } catch {
      if (wasOpen) {
        try {
          await repo.markChecked(checkout.id);
        } catch {
          // It is asked about again next run either way.
        }
      }
      return { outcome: 'error', asked: true };
    }
  }

  /**
   * The admin's to-do list, oldest first: `orphan`, `mismatch` and `failed`
   * events, events left `received` for over an hour, checkouts in `mismatch`
   * and checkouts under dispute — dismissed rows excluded. Reads the database
   * only; no provider is ever called.
   */
  async listExceptions(): Promise<PaymentExceptionView[]> {
    const rows = await this.deps.gatewayRepo.listExceptions();
    const names = new Map<string, string | null>();
    const payer = this.deps.checkout?.payer;
    const nameOf = async (userId: string): Promise<string | null> => {
      if (!names.has(userId)) {
        let name: string | null = null;
        try {
          name = payer ? ((await payer(userId))?.name ?? null) : null;
        } catch {
          // A name is a courtesy; the row is listed without it.
        }
        names.set(userId, name);
      }
      return names.get(userId) ?? null;
    };

    const views: PaymentExceptionView[] = [];
    for (const row of rows) {
      const checkout = row.checkout;
      const receivable = checkout
        ? {
            kind: checkout.receivableKind,
            id: checkout.receivableId,
            userId: checkout.userId,
            studentName: await nameOf(checkout.userId),
            amountMinor: checkout.amountMinor,
            currency: checkout.currency,
          }
        : null;
      const ref = formatExceptionRef(exceptionRefOf(row));
      if (row.kind === 'event') {
        views.push({
          ref,
          kind: row.event.outcome as PaymentExceptionKind,
          source: 'event',
          provider: row.event.provider,
          eventId: row.event.eventId,
          eventType: row.event.type,
          providerPaymentId: row.event.providerPaymentId ?? checkout?.providerPaymentId ?? null,
          checkoutId: checkout?.id ?? row.event.checkoutId,
          attempts: row.event.attempts,
          detail: row.event.error,
          occurredAt: row.occurredAt,
          receivable,
        });
      } else {
        views.push({
          ref,
          kind: row.checkout.status === CheckoutStatus.MISMATCH ? 'mismatch' : 'dispute',
          source: 'checkout',
          provider: row.checkout.provider,
          eventId: null,
          eventType: null,
          providerPaymentId: row.checkout.providerPaymentId,
          checkoutId: row.checkout.id,
          attempts: null,
          detail: row.checkout.failureDetail,
          occurredAt: row.occurredAt,
          receivable,
        });
      }
    }
    return views;
  }

  /**
   * Dismisses one row **currently on the list** (milestone 30, decision 20):
   * who, when and the note are stored and the row leaves the list and the
   * stale count. No status, no outcome and no ledger row changes. A `ref` that
   * is malformed is `400`; one that names nothing on the list — unknown,
   * already dismissed, or not an exception at all — is `404`.
   */
  async dismissException(
    ref: string,
    note: string,
    adminId: string,
  ): Promise<ControllerResult<DismissedException>> {
    const parsed = parseExceptionRef(ref);
    if (!parsed) return refusal(400, 'ValidationError', { message: 'the ref is not an exception reference' });
    const canonical = formatExceptionRef(parsed);

    const repo = this.deps.gatewayRepo;
    const listed = (await repo.listExceptions()).some((row) => formatExceptionRef(exceptionRefOf(row)) === canonical);
    if (!listed) return CHECKOUT_NOT_FOUND;
    if (!(await repo.dismissException(parsed, { dismissedBy: adminId, note }))) return CHECKOUT_NOT_FOUND;

    const dismissedAt = this.now().toISOString();
    // The note is the admin's free text and stays in the row, not in the log.
    console.info(
      JSON.stringify({ event: 'payments.exception_dismissed', actor: adminId, ref: canonical, at: dismissedAt }),
    );
    return { ok: true, data: { ref: canonical, dismissedBy: adminId, dismissedAt } };
  }

  // -------------------------------------------------------------------------
  // Admin refunds (RFC 0026 §5)
  // -------------------------------------------------------------------------

  /** Refunds a gateway payment of a contract invoice at its provider, then writes the reversal. */
  async refundInvoicePayment(
    paymentId: string,
    command: RefundPaymentCommand,
    adminId: string,
  ): Promise<ControllerResult<RefundPaymentResult<PaymentRecord>>> {
    const { billing } = this.deps;
    return this.refundPayment('contract', paymentId, command, adminId, {
      read: (id) => billing.getPayment(id),
      reverse: (id, reversal) => billing.reverseGatewayPayment(id, reversal),
    });
  }

  /** The extras rail's twin of `refundInvoicePayment`. */
  async refundChargePayment(
    paymentId: string,
    command: RefundPaymentCommand,
    adminId: string,
  ): Promise<ControllerResult<RefundPaymentResult<EventChargePaymentRecord>>> {
    const { charges } = this.deps;
    return this.refundPayment('extras', paymentId, command, adminId, {
      read: (id) => charges.getPayment(id),
      reverse: (id, reversal) => charges.reverseGatewayPayment(id, reversal),
    });
  }

  /**
   * The order is the contract (RFC 0026 §5):
   *
   * 1. the row is a positive `gateway` payment (anything else never reaches a
   *    provider) and the request carries a reason;
   * 2. the adapter comes from the reference's provider prefix — an invalid
   *    provider list is `500 PAYMENTS_CONFIG_INVALID`, a provider no longer
   *    bound is `409 PAYMENTS_PROVIDER_NOT_ENABLED`;
   * 3. **ask before refunding**: the payment is read from the provider. A full
   *    refund it already holds is not requested again — the reversal is
   *    recorded under that refund id (or the row already carrying it is
   *    returned);
   * 4. only a payment with no refund at all reaches `gateway.refund`, for the
   *    original's full amount, under `rev:<payment id>`. A refusal is `409
   *    PAYMENTS_REFUND_REFUSED` and **nothing is written**; an error that only
   *    means "not now" (a rate limit, a timeout — at this step or at step 3)
   *    is `503 PAYMENTS_PROVIDER_BUSY`, also with nothing written, and the
   *    same request repeated completes;
   * 5. the reversal is written with the provider's refund id as its reference.
   *    If that write fails after the provider accepted, the answer is `503
   *    PAYMENTS_REFUND_UNRECORDED` naming the refund — and the same request,
   *    repeated, finds the refund at step 3 and completes it.
   */
  private async refundPayment<P extends LedgerPayment>(
    rail: 'contract' | 'extras',
    paymentId: string,
    command: RefundPaymentCommand,
    adminId: string,
    ledger: {
      read(id: string): Promise<ControllerResult<P>>;
      reverse(
        id: string,
        reversal: { externalReference: string; paidAt: string; note: string; recordedBy: string },
      ): Promise<ControllerResult<{ payment: P; created: boolean }>>;
    },
  ): Promise<ControllerResult<RefundPaymentResult<P>>> {
    if (command.reason.trim() === '') {
      return refusal(400, 'ValidationError', { message: 'a reversal requires a reason' });
    }

    // 1. The row.
    const read = await ledger.read(paymentId);
    if (!read.ok) return read;
    const original = read.data;
    if (original.method !== Entities.Config.PaymentMethod.GATEWAY) {
      return refusal(409, 'Conflict', { message: 'only a gateway payment is refunded through its provider' });
    }
    if (original.reversesId !== null || original.amountMinor <= 0) {
      return refusal(409, 'Conflict', { message: 'a reversal cannot itself be reversed' });
    }

    // 2. The adapter, from the reference's own provider prefix.
    const config = this.deps.checkout?.config;
    if (config && !config.ok) {
      console.error(
        JSON.stringify({ event: 'payments.config_invalid', reason: config.reason, detail: config.detail }),
      );
      return refusal(500, PAYMENTS_CONFIG_INVALID);
    }
    const reference = splitGatewayReference(original.externalReference);
    const gateway = reference ? this.deps.gateways.get(reference.provider) : null;
    if (!reference || !gateway) return refusal(409, PAYMENTS_PROVIDER_NOT_ENABLED);
    const provider = reference.provider;

    // 3. Ask before refunding.
    let held: ProviderPayment | null;
    try {
      held = await gateway.getPayment(reference.id);
    } catch (error) {
      // Nothing was asked of the provider and nothing is written.
      if (isRetryableProviderError(error)) return refusal(503, PAYMENTS_PROVIDER_BUSY);
      return refusal(502, PAYMENTS_PROVIDER_ERROR);
    }
    if (!held) {
      return refusal(409, PAYMENTS_REFUND_REFUSED, { message: 'the provider does not know this payment' });
    }

    const today = this.now().toISOString();
    const write = async (refundId: string, paidAt: string, accepted: boolean) => {
      let written: ControllerResult<{ payment: P; created: boolean }>;
      try {
        written = await ledger.reverse(original.id, {
          externalReference: buildGatewayReference(provider, refundId),
          paidAt,
          note: command.reason.trim(),
          recordedBy: adminId,
        });
      } catch {
        // The money left and the ledger does not say so yet.
        return refusal(503, PAYMENTS_REFUND_UNRECORDED, { refundId });
      }
      if (!written.ok) {
        // A refund this very call obtained and could not book is said out loud;
        // a ledger refusal about a refund that was already there is passed on.
        return accepted ? refusal(503, PAYMENTS_REFUND_UNRECORDED, { refundId }) : written;
      }
      return { ok: true as const, data: { ...written.data, refundId } };
    };

    if (held.refunds.length > 0) {
      const full = held.refunds.find((refund) => refund.amountMinor === original.amountMinor);
      if (!full) {
        // Partial refunds were made at the provider; they land on their own
        // (unlinked) and the full mirror row would count them twice.
        return refusal(409, PAYMENTS_REFUND_REFUSED, {
          message: 'the provider already holds a partial refund of this payment; refund the rest at the provider',
        });
      }
      return write(full.id, command.paidAt ?? full.createdAt, false);
    }

    // 4. The refund itself: full amount, keyed on the ledger row.
    this.auditRefund('payments.refund_requested', adminId, rail, provider, original.id);
    let refund: ProviderRefundResult;
    try {
      refund = await this.requestRefund(gateway, reference.id, original);
    } catch (error) {
      // "Not now" is not "no": a rate limit or a timeout leaves the question
      // open, and the repeat starts at step 3 — so a refund the provider did
      // accept before timing out is found there and never asked for twice.
      if (isRetryableProviderError(error)) return refusal(503, PAYMENTS_PROVIDER_BUSY);
      return refusal(409, PAYMENTS_REFUND_REFUSED);
    }

    // 5. The reversal, under the provider's refund id.
    return write(refund.refundId, command.paidAt ?? today, true);
  }

  private async requestRefund(
    gateway: IPaymentGateway,
    providerPaymentId: string,
    original: LedgerPayment,
  ): Promise<ProviderRefundResult> {
    const refund = await gateway.refund(providerPaymentId, original.amountMinor, refundIdempotencyKey(original.id));
    if (!refund.refundId) throw new TypeError('the provider returned no refund id');
    return refund;
  }

  /** Ids only: never an amount, a reason or a provider message. */
  private auditRefund(
    event: string,
    actor: string,
    rail: 'contract' | 'extras',
    provider: PaymentProviderName,
    paymentId: string,
  ): void {
    console.info(JSON.stringify({ event, actor, rail, provider, paymentId, at: this.now().toISOString() }));
  }

  private async readReceivable(kind: ReceivableKind, id: string): Promise<Receivable | null> {
    if (kind === 'invoice') {
      const invoice = await this.deps.billing.getInvoice(id);
      return invoice.ok ? fromInvoice(invoice.data) : null;
    }
    const charge = await this.deps.charges.getCharge(id);
    return charge.ok ? fromCharge(charge.data) : null;
  }

  /**
   * What an open checkout is worth to a new *Pay*:
   * - `reuse` — same provider, has its session, still for the receivable's
   *   balance, and more than five minutes from its expiry;
   * - `retry` — same provider and still good, but the provider call never
   *   completed: it is made again under the same id;
   * - `expire` — at or within five minutes of its expiry;
   * - `cancel` — on another provider (the student changed how to pay), or for
   *   an amount the receivable no longer owes.
   */
  private dispose(
    checkout: GatewayCheckoutRecord,
    provider: PaymentProviderName,
    receivable: Receivable,
    now: Date,
  ): 'reuse' | 'retry' | 'expire' | 'cancel' {
    if (checkout.provider !== provider) return 'cancel';
    const remaining = Date.parse(checkout.expiresAt) - now.getTime();
    if (!(remaining > CHECKOUT_REUSE_MIN_MS)) return 'expire';
    if (checkout.amountMinor !== receivable.balanceMinor || checkout.currency !== receivable.currency) {
      return 'cancel';
    }
    return checkout.providerSessionId === null ? 'retry' : 'reuse';
  }

  /** `429` once the student's budget is spent; a limiter outage never blocks a payment. */
  private async checkoutBudget(
    limiter: IRateLimiter | undefined,
    userId: string,
  ): Promise<ControllerResult<never> | null> {
    if (!limiter) return null;
    try {
      const state = await limiter.peek(userId);
      if (!state.allowed) {
        return refusal(429, 'TooManyRequests', { retryAfterSeconds: state.retryAfterSeconds ?? 1 });
      }
      await limiter.hit(userId);
    } catch {
      console.error('[rate-limit] checkouts limiter failed, failing open');
    }
    return null;
  }

  /** Hints only: the page that reads them asks `getCheckoutStatus` and believes that. */
  private returnUrls(webBaseUrl: string, checkoutId: string): { success: string; cancel: string } {
    const base = `${webBaseUrl.replace(/\/+$/, '')}/settings/billing?checkout=${encodeURIComponent(checkoutId)}`;
    return { success: `${base}&outcome=success`, cancel: `${base}&outcome=cancel` };
  }
}

/**
 * What the hosted page shows. An invoice is named by its period, in the wording
 * the port documents ("Mensalidade 2026-11") — the API holds no dictionary; an
 * event charge by the event title snapshotted when it was issued.
 */
function checkoutDescription(receivable: Receivable): string {
  return receivable.kind === 'invoice' ? `Mensalidade ${receivable.label}` : receivable.label;
}

function toSession(checkout: GatewayCheckoutRecord): CheckoutSession {
  return {
    checkoutId: checkout.id,
    provider: checkout.provider,
    url: checkout.checkoutUrl,
    expiresAt: checkout.expiresAt,
    amountMinor: checkout.amountMinor,
    currency: checkout.currency,
    status: 'open',
  };
}
