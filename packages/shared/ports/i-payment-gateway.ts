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
  /** ISO timestamp; `null` until the payment is paid. */
  paidAt: string | null;
  /** Our checkout id, read back from the provider's metadata; `null` when the payment carries none. */
  checkoutId: string | null;
  /** Every refund the provider holds for this payment, oldest first; empty when none. */
  refunds: ReadonlyArray<ProviderRefund>;
}

export type ProviderDisputeOutcome = 'opened' | 'won' | 'lost';

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

  /** Locates the payment(s) a session produced when no webhook named one — reconciliation. */
  findPaymentsForCheckout(sessionId: string): Promise<ProviderPayment[]>;

  /**
   * Asks the provider to return `amountMinor` of a payment. Idempotent on
   * `idempotencyKey`: a repeated call must not refund twice. A provider refusal
   * is thrown, never reported as a result.
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
