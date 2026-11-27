/**
 * IPaymentGateway
 *
 * Cloud- and provider-agnostic port for a hosted-checkout payment provider
 * (RFC 0026 section 1). One implementation per provider lives under
 * `apps/api/src/adapters/payment/`; the registry resolves it by `provider`.
 *
 * Everything here is a plain record: no worker `env`, no `Request` or
 * `Headers` object, no provider SDK type and no validation schema crosses this
 * boundary. Four rules make the port safe across providers:
 *
 * 1. **The webhook is a trigger.** `verifyWebhook` yields *ids*. Amount,
 *    currency, status and the checkout back-reference come only from
 *    `getPayment`, over an authenticated call the adapter makes with the
 *    secret key — a forged body can at most make the API look a payment up.
 * 2. **Money crosses the boundary as integers.** Every amount is an integer
 *    count of the currency's minor unit plus an ISO currency code. A provider
 *    that speaks decimals is converted inside its adapter with
 *    `decimalToMinor` (`domain/billing/gateway-money.ts`); no floating point.
 * 3. **The capability table is data** (`PAYMENT_PROVIDER_CAPABILITIES`, same
 *    module): which methods a provider can settle in which currency is checked
 *    before the provider is called, never discovered from its refusal.
 * 4. **`eventId` names the event, never the payment.** One payment emits
 *    several events over its life; an adapter that keyed `eventId` on the
 *    payment id would have the approval swallowed as a duplicate of the
 *    creation.
 */

/** Every provider the platform knows by name. Constrained again by the `provider` CHECK on `gateway_checkouts`. */
export const PAYMENT_PROVIDER_NAMES = ['stripe', 'mercadopago', 'asaas', 'pagarme'] as const;

export type PaymentProviderName = (typeof PAYMENT_PROVIDER_NAMES)[number];

/** The methods a tenant may offer on a hosted page (RFC 0026 section 8.1). */
export const PAYMENT_METHOD_NAMES = ['pix', 'card', 'boleto'] as const;

export type PaymentMethodName = (typeof PAYMENT_METHOD_NAMES)[number];

export interface CheckoutPayer {
  /** The student's user id. */
  id: string;
  email: string;
  name: string;
}

export interface CheckoutReturnUrls {
  success: string;
  cancel: string;
}

export interface CreateCheckoutRequest {
  /** `gateway_checkouts.id` — also the provider idempotency key and the metadata back-reference. */
  checkoutId: string;
  /** Integer minor units; always positive. */
  amountMinor: number;
  /** ISO code, already checked against the capability table. */
  currency: string;
  /** What the hosted page shows, e.g. "Mensalidade 2026-11". */
  description: string;
  payer: CheckoutPayer;
  /** The methods this label enabled for this provider — the hosted page offers these and nothing else. */
  methods: ReadonlyArray<PaymentMethodName>;
  /** Hints only: the page a student returns to never trusts them. */
  returnUrls: CheckoutReturnUrls;
  /**
   * Where the provider should send this checkout's notifications:
   * `<origin of the API that created it>/v1/webhooks/payments/<provider>`. One
   * URL per checkout, so staging, a preview and production each receive their
   * own deliveries from one provider account. `null` when the caller knows no
   * origin; an adapter may also leave it out when the provider could not reach
   * it (loopback), and the provider then falls back to whatever is registered
   * in its dashboard. It changes nothing about verification: a delivery is
   * still authenticated by `verifyWebhook`.
   */
  notificationUrl: string | null;
  /**
   * ISO timestamp of the latest expiry the caller accepts. The adapter asks the
   * provider for it; the provider may grant less, and says so in the result.
   */
  expiresAt: string;
}

/** The hosted session a provider opened for one checkout. */
export interface ProviderCheckout {
  /** The provider's session / preference id (bare, not provider-qualified). */
  sessionId: string;
  /** The hosted page the student is sent to. */
  url: string;
  /**
   * ISO timestamp of when `url` stops working, as the provider reports it —
   * the requested expiry when the provider reports none.
   */
  expiresAt: string;
}

export type ProviderPaymentStatus = 'pending' | 'paid' | 'failed' | 'expired' | 'refunded' | 'disputed';

/** How the payer actually paid; `other` is anything the platform does not offer by name. */
export type ProviderPaymentMethod = PaymentMethodName | 'other';

export interface ProviderRefund {
  /** The provider's refund id (bare) — what a refund's ledger reference is built from. */
  id: string;
  /** Integer minor units; always positive. */
  amountMinor: number;
  /** ISO timestamp. */
  createdAt: string;
}

/** The provider's own record of a payment, as fetched over an authenticated call. */
export interface ProviderPayment {
  /** The provider's payment id (bare) — what lands in `external_reference` as `<provider>:<id>`. */
  id: string;
  status: ProviderPaymentStatus;
  /** What the provider captured, in integer minor units, converted at the adapter boundary. */
  amountMinor: number;
  currency: string;
  method: ProviderPaymentMethod;
  /**
   * How the payer paid **in the provider's own words** — its identifiers, never
   * a translation and never free text from a payer (e.g. Mercado Pago's
   * `account_money`, `credit_card/visa`, `bank_transfer/pix`). At most
   * {@link PROVIDER_METHOD_LABEL_MAX_LENGTH} characters of `[a-z0-9_/-]`;
   * `null` when the provider names none. Shown to an admin beside `method`,
   * which stays the only value the platform reasons about.
   */
  methodLabel: string | null;
  /** ISO timestamp; `null` until the payment is paid. */
  paidAt: string | null;
  /** Our checkout id, read back from the provider's metadata; `null` when the payment carries none. */
  checkoutId: string | null;
  /** Every refund the provider holds for this payment, oldest first; empty when none. */
  refunds: ReadonlyArray<ProviderRefund>;
}

/** The longest `ProviderPayment.methodLabel` (and `gateway_checkouts.paid_method_label`). */
export const PROVIDER_METHOD_LABEL_MAX_LENGTH = 64;

/** What a method label may hold: lower-case provider identifiers, `/` between two of them. */
export const PROVIDER_METHOD_LABEL_PATTERN = /^[a-z0-9_/-]{1,64}$/;

export type ProviderDisputeOutcome = 'opened' | 'won' | 'lost';

/**
 * Names one checkout to a provider when no webhook named its payment. Both
 * ids are given because providers differ in which one they can search on:
 * `checkoutId` is the back-reference the adapter sent at creation,
 * `sessionId` the hosted session the provider answered with.
 */
export interface CheckoutPaymentLookup {
  /** `gateway_checkouts.id` — what `createCheckout` sent as the provider's external reference. */
  checkoutId: string;
  /** The provider's session / preference id (bare). */
  sessionId: string;
}

/**
 * One verified webhook delivery, reduced to ids. `eventId` identifies this
 * event, never the payment: one payment emits several (rule 4).
 */
export type ProviderEvent =
  | { kind: 'payment'; eventId: string; paymentId: string; occurredAt: string }
  | { kind: 'refund'; eventId: string; paymentId: string; refundId: string; occurredAt: string }
  | {
      kind: 'dispute';
      eventId: string;
      paymentId: string;
      outcome: ProviderDisputeOutcome;
      occurredAt: string;
    }
  /** A delivery the adapter authenticated but does not act on; `type` is the provider's own name for it. */
  | { kind: 'ignored'; eventId: string; type: string };

export type ProviderEventKind = ProviderEvent['kind'];

/**
 * Whether an error an adapter threw says "ask again later" rather than "no":
 * a rate limit, a timeout, a provider outage. The convention is structural so
 * that no caller imports an adapter's error classes — an adapter marks such an
 * error with a `retryable: true` property (or getter). Anything else,
 * including a plain `Error`, is not retryable.
 */
export function isRetryableProviderError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { retryable?: unknown }).retryable === true;
}

export interface ProviderRefundResult {
  /** The provider's refund id (bare). */
  refundId: string;
}

export interface IPaymentGateway {
  readonly provider: PaymentProviderName;

  /** Opens a hosted session for one checkout; `req.checkoutId` is the idempotency key. */
  createCheckout(req: CreateCheckoutRequest): Promise<ProviderCheckout>;

  /** `null` when the provider does not know the id. */
  getPayment(paymentId: string): Promise<ProviderPayment | null>;

  /**
   * Locates the payment(s) a checkout produced when no webhook named one —
   * reconciliation. An adapter spends **at most one provider call** on it: the
   * reconcile run's subrequest budget counts one call per checkout (milestone
   * 30 decision 17). `[]` when nothing was paid.
   */
  findPaymentsForCheckout(lookup: CheckoutPaymentLookup): Promise<ProviderPayment[]>;

  /**
   * Asks the provider to return `amountMinor` of a payment. Idempotent on
   * `idempotencyKey`: a repeated call must not refund twice. A provider refusal
   * is thrown, never reported as a result; an error that only means "not now"
   * (rate limit, timeout, outage) is thrown marked as retryable — see
   * {@link isRetryableProviderError}.
   */
  refund(paymentId: string, amountMinor: number, idempotencyKey: string): Promise<ProviderRefundResult>;

  /**
   * Verifies and parses one delivery. `null` means "not authentic": the router
   * answers 401 and writes nothing.
   *
   * @param rawBody The request body exactly as received — verification must
   *   run on these bytes, never on re-serialised JSON.
   * @param headers The request headers as a plain map, **names lower-cased**.
   * @param query The URL's query parameters as a plain map (first value wins).
   */
  verifyWebhook(
    rawBody: string,
    headers: Readonly<Record<string, string>>,
    query: Readonly<Record<string, string>>,
  ): Promise<ProviderEvent | null>;
}
