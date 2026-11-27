/**
 * MercadoPagoGatewayAdapter — `IPaymentGateway` over Mercado Pago Checkout Pro
 * (RFC 0026 sections 1, 4 and 8; milestone 30 Task 05).
 *
 * The only file that knows a Mercado Pago field name. `fetch` and Web Crypto
 * only: no SDK, no dependency. Every provider call is bounded by a 10-second
 * timeout.
 *
 * What is pinned to the sandbox, and what is not, is listed in
 * `apps/api/test/fixtures/mercadopago/README.md`. In short: preferences,
 * approved / pending / refunded payments, the search, refunds and the error
 * bodies were **recorded**; a rejected or cancelled payment, an approved Pix,
 * a charged-back payment and every signed notification were **not observable**
 * on the test account and are mapped from the provider's published contract.
 *
 * Money (port rule 2). Mercado Pago speaks decimals **as JSON numbers**
 * (`"transaction_amount":12.34`, `1000`, `180.5`). `JSON.parse` would turn
 * those into binary floats, so a response is never parsed directly:
 * {@link quoteJsonNumbers} first rewrites the raw text so that every number
 * token becomes a string holding the digits exactly as the provider wrote
 * them, and `decimalToMinor` reads those digits. Going out, an amount is a
 * decimal literal built from the integer minor units by string slicing
 * ({@link minorToDecimal}) and spliced into the request body as written. No
 * `parseFloat`, no `Number()`, no arithmetic on a fractional value anywhere.
 * A welcome side effect: the 12-digit payment and refund ids never pass
 * through a float either.
 *
 * Secrets. The access token is sent in the `Authorization` header and nowhere
 * else; the webhook secret only keys an HMAC. Neither is ever copied into an
 * error: an error carries the HTTP status and the provider's error code, never
 * a response body.
 */
import type {
  CreateCheckoutRequest,
  IPaymentGateway,
  PaymentMethodName,
  ProviderCheckout,
  ProviderEvent,
  ProviderPayment,
  ProviderPaymentMethod,
  ProviderPaymentStatus,
  ProviderRefund,
  ProviderRefundResult,
} from '@arenaquest/shared/ports/i-payment-gateway';
import { decimalToMinor } from '@arenaquest/shared/domain/billing/gateway-money';
import type { PaymentGatewayFactory } from '@api/core/payments/gateway-registry';

export const MERCADOPAGO_API_BASE = 'https://api.mercadopago.com';

/** The bound on one provider call, body read included. */
export const MERCADOPAGO_TIMEOUT_MS = 10_000;

/** How far a notification's `ts` may be from the clock — also the replay window (RFC 0026 section 4). */
export const MERCADOPAGO_WEBHOOK_TOLERANCE_MS = 5 * 60_000;

/**
 * Fraction digits of the currencies this adapter charges. The capability
 * table lists BRL only; a currency that is not a key here is refused before
 * any provider call rather than guessed at.
 */
const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = Object.freeze({ BRL: 2 });

/** The provider payment types behind each method the platform offers by name. */
const METHOD_PAYMENT_TYPES: Readonly<Record<PaymentMethodName, ReadonlyArray<string>>> = Object.freeze({
  pix: ['bank_transfer'],
  card: ['credit_card', 'debit_card', 'prepaid_card'],
  boleto: ['ticket'],
});

/** Payment types no method stands for, always excluded from the hosted page. */
const NEVER_OFFERED_PAYMENT_TYPES: ReadonlyArray<string> = ['atm'];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * How a provider call failed, so a caller can tell a timeout from a refusal:
 *
 * - `timeout` — no answer within the bound; the outcome is unknown.
 * - `unavailable` — the provider (or the network) failed: `5xx`, `408`, `429`
 *   (`refund_quota_exceeded` was recorded when refunds are fired back to back).
 *   Asking again later is the right move.
 * - `refused` — the provider understood and said no (any other `4xx`); asking
 *   again with the same input gets the same answer.
 * - `invalid_response` — a `2xx` whose body the adapter cannot use: not JSON,
 *   a field missing, a status it does not know, or an amount that does not fit
 *   the currency. Never rounded, never guessed.
 */
export type MercadoPagoErrorKind = 'timeout' | 'unavailable' | 'refused' | 'invalid_response';

/** Base of every error this adapter throws. Carries a status and a code — never a body, never a key. */
export class MercadoPagoError extends Error {
  constructor(
    readonly kind: MercadoPagoErrorKind,
    message: string,
    /** The provider's HTTP status; `null` when no response was received. */
    readonly httpStatus: number | null = null,
    /** The provider's own error code (`120013`, `not_found`, …); `null` when it sent none. */
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'MercadoPagoError';
  }

  /** `true` when the same call may succeed later. */
  get retryable(): boolean {
    return this.kind === 'timeout' || this.kind === 'unavailable';
  }
}

export class MercadoPagoTimeoutError extends MercadoPagoError {
  constructor(timeoutMs: number) {
    super('timeout', `Mercado Pago did not answer within ${timeoutMs} ms`);
    this.name = 'MercadoPagoTimeoutError';
  }
}

export class MercadoPagoUnavailableError extends MercadoPagoError {
  constructor(httpStatus: number | null, code: string | null) {
    super('unavailable', `Mercado Pago is unavailable (${describe(httpStatus, code)})`, httpStatus, code);
    this.name = 'MercadoPagoUnavailableError';
  }
}

/** The provider said no; `code` is its reason (e.g. `120013`: refund above the refundable balance). */
export class MercadoPagoRefusalError extends MercadoPagoError {
  constructor(httpStatus: number, code: string | null) {
    super('refused', `Mercado Pago refused the request (${describe(httpStatus, code)})`, httpStatus, code);
    this.name = 'MercadoPagoRefusalError';
  }
}

export class MercadoPagoResponseError extends MercadoPagoError {
  constructor(what: string, httpStatus: number | null = null) {
    super('invalid_response', `Mercado Pago answered with a body this adapter cannot use: ${what}`, httpStatus);
    this.name = 'MercadoPagoResponseError';
  }
}

function describe(httpStatus: number | null, code: string | null): string {
  const status = httpStatus === null ? 'no response' : `HTTP ${httpStatus}`;
  return code === null ? status : `${status}, code ${code}`;
}

// ---------------------------------------------------------------------------
// Lossless JSON numbers, and decimals out
// ---------------------------------------------------------------------------

/**
 * Rewrites JSON text so that every number token becomes a string holding the
 * same characters: `{"a":12.34,"b":"x 5"}` → `{"a":"12.34","b":"x 5"}`.
 *
 * Outside a string literal, a JSON document holds only structural characters,
 * the literals `true` / `false` / `null`, and numbers — so a `-` or a digit met
 * outside a string always starts a number. String literals are copied through
 * untouched, escapes included. Parsing the result with `JSON.parse` therefore
 * yields the provider's digits as written, with no float in between.
 */
export function quoteJsonNumbers(json: string): string {
  let out = '';
  let i = 0;
  const n = json.length;
  while (i < n) {
    const ch = json[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < n && json[j] !== '"') j += json[j] === '\\' ? 2 : 1;
      out += json.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let j = i + 1;
      while (j < n && isNumberChar(json[j])) j += 1;
      out += `"${json.slice(i, j)}"`;
      i = j;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

function isNumberChar(ch: string): boolean {
  return (ch >= '0' && ch <= '9') || ch === '.' || ch === 'e' || ch === 'E' || ch === '+' || ch === '-';
}

/**
 * Integer minor units to the exact decimal literal the provider expects:
 * `18050` at exponent 2 is `180.50`, `5` is `0.05`, `1234` at exponent 0 is
 * `1234`. Built by slicing the integer's digits — never by dividing.
 */
export function minorToDecimal(amountMinor: number, exponent: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new RangeError('amountMinor must be a positive safe integer');
  }
  const digits = String(amountMinor);
  if (exponent === 0) return digits;
  const padded = digits.padStart(exponent + 1, '0');
  return `${padded.slice(0, -exponent)}.${padded.slice(-exponent)}`;
}

/** The currency's fraction digits, or `null` for a currency this adapter does not charge. */
function exponentOf(currency: string): number | null {
  return Object.prototype.hasOwnProperty.call(CURRENCY_EXPONENTS, currency) ? CURRENCY_EXPONENTS[currency] : null;
}

// ---------------------------------------------------------------------------
// Field access over a parsed (numbers-as-strings) body
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** An ISO instant in UTC, or `null` when the provider's text is absent or not a date. */
function isoInstant(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** A provider code reduced to a short token, so nothing free-form rides on an error. */
function safeToken(value: unknown): string | null {
  const raw = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null;
  if (raw === null) return null;
  return /^[A-Za-z0-9_.-]{1,64}$/.test(raw) ? raw : null;
}

/**
 * The provider's error code out of an error body. Recorded shapes:
 * `{ message, error, status, cause: [{ code, description, data }] }`,
 * `{ message, error, status, cause: null }` and `{ code, message }` (the `429`).
 */
function errorCode(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(quoteJsonNumbers(body));
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;
  const cause = parsed.cause;
  if (Array.isArray(cause) && isObject(cause[0])) {
    const code = safeToken(cause[0].code);
    if (code !== null) return code;
  }
  return safeToken(parsed.error) ?? safeToken(parsed.code);
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export interface MercadoPagoGatewayOptions {
  /** `PAYMENTS_MERCADOPAGO_SECRET_KEY` — the access token. */
  secretKey: string;
  /** `PAYMENTS_MERCADOPAGO_WEBHOOK_SECRET` — the notification signing secret. */
  webhookSecret: string;
  /** Injected in tests; defaults to the runtime's `fetch`. */
  fetch?: typeof fetch;
  /** Injected in tests; defaults to the wall clock. */
  now?: () => Date;
  /** Defaults to {@link MERCADOPAGO_TIMEOUT_MS}. */
  timeoutMs?: number;
}

interface ProviderResponse {
  status: number;
  body: string;
}

export class MercadoPagoGatewayAdapter implements IPaymentGateway {
  readonly provider = 'mercadopago' as const;

  private readonly secretKey: string;
  private readonly webhookSecret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(options: MercadoPagoGatewayOptions) {
    this.secretKey = options.secretKey;
    this.webhookSecret = options.webhookSecret;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? MERCADOPAGO_TIMEOUT_MS;
  }

  // -------------------------------------------------------------------------
  // createCheckout — one Checkout Pro preference
  // -------------------------------------------------------------------------

  async createCheckout(req: CreateCheckoutRequest): Promise<ProviderCheckout> {
    const exponent = exponentOf(req.currency);
    // The capability table is checked before the adapter is called; reaching this is the caller's bug.
    if (exponent === null) throw new RangeError('createCheckout: a currency this adapter does not charge');
    const unitPrice = minorToDecimal(req.amountMinor, exponent);
    const expiresAt = new Date(req.expiresAt).toISOString();

    const excluded = new Set<string>(NEVER_OFFERED_PAYMENT_TYPES);
    for (const method of Object.keys(METHOD_PAYMENT_TYPES) as PaymentMethodName[]) {
      if (!req.methods.includes(method)) for (const type of METHOD_PAYMENT_TYPES[method]) excluded.add(type);
    }

    // `unit_price` must leave as the exact decimal literal, so it is spliced
    // into the serialised body in place of a placeholder string. A quote inside
    // any other value is escaped by `JSON.stringify`, so the quoted placeholder
    // can only match the one field it was written into.
    const PLACEHOLDER = '@@unit_price@@';
    const body = JSON.stringify({
      items: [
        {
          id: req.checkoutId,
          title: req.description,
          quantity: 1,
          currency_id: req.currency,
          unit_price: PLACEHOLDER,
        },
      ],
      payer: { email: req.payer.email, name: req.payer.name },
      // The back-reference, twice: `external_reference` is what the payment
      // search filters on, `metadata.checkout_id` is the copy the payment
      // carries. Both were recorded coming back on the payment.
      external_reference: req.checkoutId,
      metadata: { checkout_id: req.checkoutId },
      back_urls: {
        success: req.returnUrls.success,
        pending: req.returnUrls.success,
        failure: req.returnUrls.cancel,
      },
      payment_methods: {
        excluded_payment_types: [...excluded].map(id => ({ id })),
        installments: 1,
      },
      // The preference stops accepting payers at the checkout's expiry. A
      // boleto issued before that keeps its own due date; a payment that
      // arrives after the checkout expired still lands (RFC 0026 section 5).
      expires: true,
      expiration_date_to: expiresAt,
    }).replace(`"${PLACEHOLDER}"`, () => unitPrice);

    // NOT idempotent at the provider: the sandbox answered the same
    // `X-Idempotency-Key` and body with a second preference (a different id).
    // The key is still sent — it costs nothing — but a retried call opens a
    // second hosted page. That is harmless: both preferences carry the same
    // `external_reference`, so a payment on either one finds the checkout.
    const res = await this.call('POST', '/checkout/preferences', { body, idempotencyKey: req.checkoutId });
    const preference = this.expectObject(res, 'preference');

    const sessionId = text(preference.id);
    const url = text(preference.init_point);
    if (sessionId === null || url === null) {
      throw new MercadoPagoResponseError('the preference has no id or no init_point', res.status);
    }
    return {
      sessionId,
      url,
      // The provider echoes the expiry it accepted; the requested one when it reports none.
      expiresAt: isoInstant(preference.expiration_date_to) ?? expiresAt,
    };
  }

  // -------------------------------------------------------------------------
  // getPayment / findPaymentsForCheckout
  // -------------------------------------------------------------------------

  async getPayment(paymentId: string): Promise<ProviderPayment | null> {
    // Every payment id the sandbox issued is an integer; anything else cannot
    // name a payment, and is not sent to the provider as a path segment.
    if (!/^\d{1,32}$/.test(paymentId)) return null;
    const res = await this.call('GET', `/v1/payments/${paymentId}`, {}, [404]);
    if (res.status === 404) return null;
    return this.toPayment(this.expectObject(res, 'payment'), res.status);
  }

  /**
   * Two recorded lookups: the preference names its `external_reference` (our
   * checkout id), and the payment search filters on it. A payment does not
   * carry its preference id reliably — the recorded account-money payment
   * references an order instead — so the search by reference is the lookup
   * that works for every method. A preference nobody paid is `[]`.
   */
  async findPaymentsForCheckout(sessionId: string): Promise<ProviderPayment[]> {
    if (!/^[A-Za-z0-9-]{1,128}$/.test(sessionId)) return [];
    const prefRes = await this.call('GET', `/checkout/preferences/${sessionId}`, {}, [404]);
    if (prefRes.status === 404) return [];
    const reference = text(this.expectObject(prefRes, 'preference').external_reference);
    if (reference === null) return [];

    const res = await this.call('GET', `/v1/payments/search?external_reference=${encodeURIComponent(reference)}`);
    const results = this.expectObject(res, 'payment search').results;
    if (!Array.isArray(results)) throw new MercadoPagoResponseError('the payment search has no results list', res.status);

    const payments: ProviderPayment[] = [];
    for (const item of results) {
      if (!isObject(item)) throw new MercadoPagoResponseError('a search result is not an object', res.status);
      const payment = this.toPayment(item, res.status);
      if (payment.checkoutId === reference) payments.push(payment);
    }
    return payments;
  }

  // -------------------------------------------------------------------------
  // refund
  // -------------------------------------------------------------------------

  /**
   * Idempotent at the provider: the sandbox answered a repeated
   * `X-Idempotency-Key` with the **same** refund id. A refusal (recorded: `400`
   * with cause code `120013`, the amount is above what is left to refund; `401`
   * with cause code `7`) throws a {@link MercadoPagoRefusalError}; a `429`
   * (`refund_quota_exceeded`, recorded when refunds are fired back to back)
   * throws a retryable {@link MercadoPagoUnavailableError}.
   */
  async refund(paymentId: string, amountMinor: number, idempotencyKey: string): Promise<ProviderRefundResult> {
    if (!/^\d{1,32}$/.test(paymentId)) throw new MercadoPagoRefusalError(404, 'not_found');
    // The refund is asked for in the payment's own currency; BRL is the only
    // one this adapter charges, so its exponent is the one that applies.
    const amount = minorToDecimal(amountMinor, CURRENCY_EXPONENTS.BRL);
    const res = await this.call('POST', `/v1/payments/${paymentId}/refunds`, {
      body: `{"amount":${amount}}`,
      idempotencyKey,
    });
    const refundId = text(this.expectObject(res, 'refund').id);
    if (refundId === null) throw new MercadoPagoResponseError('the refund has no id', res.status);
    return { refundId };
  }

  // -------------------------------------------------------------------------
  // verifyWebhook
  // -------------------------------------------------------------------------

  /**
   * Verifies one notification. The provider signs **three values, not the
   * body**: `x-signature: ts=<ts>,v1=<hex>` is HMAC-SHA256, keyed with the
   * webhook secret, over the manifest
   *
   * ```text
   * id:<data.id of the query string>;request-id:<x-request-id header>;ts:<ts>;
   * ```
   *
   * (a part whose value the delivery does not carry is left out; an
   * alphanumeric `data.id` is lower-cased). So the payment id is taken from the
   * signed query parameter, and a body whose `data.id` disagrees with it is
   * refused. `eventId` is the notification's own top-level `id` — never the
   * payment id (port rule 4); that field is not signed, which is why it is a
   * de-duplication aid and nothing more (RFC 0026 section 1, rule 4).
   *
   * Never throws: anything it cannot verify or read is `null`.
   *
   * No signed delivery could be recorded from the sandbox (it needs a public
   * URL and the panel's secret), so this follows the provider's published
   * scheme; Task 16 re-records real deliveries on staging.
   */
  async verifyWebhook(
    rawBody: string,
    headers: Readonly<Record<string, string>>,
    query: Readonly<Record<string, string>>,
  ): Promise<ProviderEvent | null> {
    try {
      return await this.verify(rawBody, headers, query);
    } catch {
      return null;
    }
  }

  private async verify(
    rawBody: string,
    headers: Readonly<Record<string, string>>,
    query: Readonly<Record<string, string>>,
  ): Promise<ProviderEvent | null> {
    const signature = parseSignatureHeader(headers['x-signature']);
    if (signature === null) return null;

    const tsMs = timestampMs(signature.ts);
    if (tsMs === null) return null;
    if (Math.abs(this.now().getTime() - tsMs) > MERCADOPAGO_WEBHOOK_TOLERANCE_MS) return null;

    const requestId = text(headers['x-request-id']);
    const queryDataId = text(query['data.id']);

    let manifest = '';
    if (queryDataId !== null) manifest += `id:${/^[A-Za-z0-9]+$/.test(queryDataId) ? queryDataId.toLowerCase() : queryDataId};`;
    if (requestId !== null) manifest += `request-id:${requestId};`;
    manifest += `ts:${signature.ts};`;

    const expected = await hmacSha256Hex(this.webhookSecret, manifest);
    if (!constantTimeEqual(expected, signature.v1.toLowerCase())) return null;

    // Authentic. The body is read for the notification's id, its type and its date.
    const parsed: unknown = JSON.parse(quoteJsonNumbers(rawBody));
    if (!isObject(parsed)) return null;

    const data = isObject(parsed.data) ? parsed.data : {};
    const bodyDataId = text(data.id);
    // The body is not signed: one that names another payment than the signed query does is not the delivery that was signed.
    if (queryDataId !== null && bodyDataId !== null && bodyDataId !== queryDataId) return null;
    const dataId = queryDataId ?? bodyDataId;

    // The notification's own id. A delivery that carries none — or whose `id`
    // merely repeats the payment id — is keyed on its (signed) request id,
    // which also names the delivery and never the payment.
    const bodyId = text(parsed.id);
    const notificationId = bodyId !== null && bodyId !== dataId ? bodyId : null;
    const eventId = notificationId ?? (requestId === null ? null : `request:${requestId}`);
    if (eventId === null) return null;

    const type = text(parsed.type) ?? text(parsed.topic) ?? text(query.type) ?? text(query.topic) ?? 'unknown';

    // Every change to a payment — created, approved, refunded, charged back —
    // is a `payment` notification: the fetched payment decides what it means.
    // Any other topic (`merchant_order`, `chargebacks`, …) is authenticated and
    // not acted on.
    if (type !== 'payment' || dataId === null || !/^\d{1,32}$/.test(dataId)) {
      return { kind: 'ignored', eventId, type: safeToken(type) ?? 'unknown' };
    }

    return {
      kind: 'payment',
      eventId,
      paymentId: dataId,
      occurredAt: isoInstant(parsed.date_created) ?? new Date(tsMs).toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Mapping
  // -------------------------------------------------------------------------

  private toPayment(payment: Json, httpStatus: number): ProviderPayment {
    const id = text(payment.id);
    const currency = text(payment.currency_id);
    const amount = text(payment.transaction_amount);
    if (id === null || currency === null || amount === null) {
      throw new MercadoPagoResponseError('the payment has no id, currency or amount', httpStatus);
    }
    const exponent = exponentOf(currency);
    if (exponent === null) {
      throw new MercadoPagoResponseError('the payment is in a currency this adapter does not charge', httpStatus);
    }

    const refunds: ProviderRefund[] = [];
    for (const refund of Array.isArray(payment.refunds) ? payment.refunds : []) {
      if (!isObject(refund)) throw new MercadoPagoResponseError('a refund is not an object', httpStatus);
      // Every recorded refund is `approved`; one in any other state has not returned money (yet).
      if (refund.status !== 'approved') continue;
      const refundId = text(refund.id);
      const refundAmount = text(refund.amount);
      const createdAt = isoInstant(refund.date_created);
      if (refundId === null || refundAmount === null || createdAt === null) {
        throw new MercadoPagoResponseError('a refund has no id, amount or date', httpStatus);
      }
      refunds.push({ id: refundId, amountMinor: this.toMinor(refundAmount, exponent, httpStatus), createdAt });
    }
    refunds.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

    const metadata = isObject(payment.metadata) ? payment.metadata : {};
    return {
      id,
      status: toStatus(text(payment.status), text(payment.status_detail), httpStatus),
      amountMinor: this.toMinor(amount, exponent, httpStatus),
      currency,
      method: toMethod(text(payment.payment_type_id), text(payment.payment_method_id)),
      paidAt: isoInstant(payment.date_approved),
      checkoutId: text(payment.external_reference) ?? text(metadata.checkout_id),
      refunds,
    };
  }

  /** A provider amount that does not fit the currency is an adapter error, never a rounded value. */
  private toMinor(decimal: string, exponent: number, httpStatus: number): number {
    try {
      return decimalToMinor(decimal, exponent);
    } catch {
      throw new MercadoPagoResponseError('an amount is not a decimal that fits the currency', httpStatus);
    }
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  /**
   * One provider call, bounded by the timeout (the body read included).
   * `allow` lists the non-2xx statuses the caller handles itself.
   */
  private async call(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: string; idempotencyKey?: string } = {},
    allow: ReadonlyArray<number> = [],
  ): Promise<ProviderResponse> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`,
      Accept: 'application/json',
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.idempotencyKey !== undefined) headers['X-Idempotency-Key'] = options.idempotencyKey;

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    let status: number;
    let body: string;
    try {
      const res = await this.fetchImpl(`${MERCADOPAGO_API_BASE}${path}`, {
        method,
        headers,
        body: options.body,
        signal: controller.signal,
      });
      status = res.status;
      body = await res.text();
    } catch {
      // The cause is dropped on purpose: a runtime error message may quote the request.
      if (timedOut) throw new MercadoPagoTimeoutError(this.timeoutMs);
      throw new MercadoPagoUnavailableError(null, null);
    } finally {
      clearTimeout(timer);
    }

    if ((status >= 200 && status < 300) || allow.includes(status)) return { status, body };
    const code = errorCode(body);
    if (status >= 500 || status === 429 || status === 408) throw new MercadoPagoUnavailableError(status, code);
    throw new MercadoPagoRefusalError(status, code);
  }

  private expectObject(res: ProviderResponse, what: string): Json {
    let parsed: unknown;
    try {
      parsed = JSON.parse(quoteJsonNumbers(res.body));
    } catch {
      throw new MercadoPagoResponseError(`the ${what} is not JSON`, res.status);
    }
    if (!isObject(parsed)) throw new MercadoPagoResponseError(`the ${what} is not an object`, res.status);
    return parsed;
  }
}

/** The production factory: what `PRODUCTION_GATEWAY_FACTORIES.mercadopago` builds per request. */
export const mercadoPagoGatewayFactory: PaymentGatewayFactory = ({ secretKey, webhookSecret }) =>
  new MercadoPagoGatewayAdapter({ secretKey, webhookSecret });

// ---------------------------------------------------------------------------
// Status and method tables
// ---------------------------------------------------------------------------

/**
 * Provider status → port status. `approved`, `pending` and `refunded` were
 * recorded (a partial refund leaves the payment `approved` with
 * `status_detail: partially_refunded`, so it stays `paid`). The other rows
 * follow the provider's published status list and are exercised by derived
 * fixtures only. A status that is not in this table is an error, not a guess.
 */
function toStatus(status: string | null, detail: string | null, httpStatus: number): ProviderPaymentStatus {
  switch (status) {
    case 'approved':
      return 'paid';
    case 'pending':
    case 'in_process':
    case 'authorized':
      return 'pending';
    case 'rejected':
      return 'failed';
    case 'cancelled':
      return detail === 'expired' ? 'expired' : 'failed';
    case 'refunded':
      return 'refunded';
    case 'charged_back':
    case 'in_mediation':
      return 'disputed';
    default:
      throw new MercadoPagoResponseError('the payment has a status this adapter does not know', httpStatus);
  }
}

/**
 * Provider payment type → port method. Recorded: `credit_card` (visa),
 * `ticket` (bolbradesco) and `account_money` — the payer's Mercado Pago
 * balance, which Checkout Pro offers whatever is excluded, and which is
 * `other`: the payment still lands. Pix (`bank_transfer` / `pix`) follows the
 * published contract; the test seller lists no Pix.
 */
function toMethod(type: string | null, methodId: string | null): ProviderPaymentMethod {
  if (type === 'credit_card' || type === 'debit_card' || type === 'prepaid_card') return 'card';
  if (type === 'ticket') return 'boleto';
  if (type === 'bank_transfer' && methodId === 'pix') return 'pix';
  return 'other';
}

// ---------------------------------------------------------------------------
// Signature helpers
// ---------------------------------------------------------------------------

function parseSignatureHeader(header: string | undefined): { ts: string; v1: string } | null {
  if (typeof header !== 'string' || header.length === 0 || header.length > 512) return null;
  let ts: string | null = null;
  let v1: string | null = null;
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 'ts') ts = value;
    else if (key === 'v1') v1 = value;
  }
  if (ts === null || v1 === null) return null;
  if (!/^\d{1,16}$/.test(ts) || !/^[0-9a-fA-F]{64}$/.test(v1)) return null;
  return { ts, v1 };
}

/**
 * The signature's `ts` as epoch milliseconds. The published examples show
 * seconds (10 digits) and deliveries are reported with milliseconds (13); a
 * value too small to be milliseconds of this century is read as seconds.
 */
function timestampMs(ts: string): number | null {
  const value = Number.parseInt(ts, 10);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value < 100_000_000_000 ? value * 1000 : value;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
  let hex = '';
  for (const byte of mac) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** Compares two strings in time that depends on their length only, never on where they differ. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
