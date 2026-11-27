import {
  PAYMENT_METHOD_NAMES,
  PAYMENT_PROVIDER_NAMES,
  type PaymentMethodName,
  type PaymentProviderName,
} from '../../ports/i-payment-gateway';

/**
 * gateway-money — the pure data and arithmetic at the payment-provider
 * boundary (RFC 0026 section 1, rules 2 and 3).
 *
 * Three things live here, and none of them performs I/O or reads a clock:
 *
 * - `decimalToMinor` — a provider's decimal string to integer minor units,
 *   without floating point.
 * - `PAYMENT_PROVIDER_CAPABILITIES` — per provider, the methods it can settle
 *   in each currency and its dashboard URL template. **Data, not adapter
 *   behaviour**: the provider-list parser, the checkout service and the web
 *   all read this one table.
 * - The gateway reference helpers — a gateway ledger row's
 *   `external_reference` is always `<provider>:<id>`, so ids issued by two
 *   providers bound to one label can never collide.
 */

// ---------------------------------------------------------------------------
// Decimal string → integer minor units
// ---------------------------------------------------------------------------

/** Highest exponent the schema accepts: `CHECK (exponent BETWEEN 0 AND 18)`. */
const MAX_EXPONENT = 18;

const CODE_ZERO = 48; // '0'
const CODE_NINE = 57; // '9'
const CODE_DOT = 46; // '.'

/** Thrown when a provider amount is not a plain non-negative decimal that fits the currency. */
export class DecimalAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecimalAmountError';
  }
}

/**
 * Converts a provider's decimal amount (`'180.50'`) to an integer count of
 * minor units (`18050`) for a currency with `exponent` fraction digits — 2 for
 * BRL, 0 for JPY, 8 for BTC.
 *
 * The string is read character by character and the result is built from
 * integer digits only: no `parseFloat`, no `Number()`, no multiplication by a
 * power of ten of a fractional value, so nothing can drift.
 *
 * Accepted: ASCII digits with at most one `.` that has at least one digit on
 * each side, and no more fraction digits than `exponent`. Fewer are padded
 * (`'180.5'` and `'180'` at exponent 2 are `18050` and `18000`).
 *
 * Refused with a `DecimalAmountError`: an empty or blank string, a sign,
 * whitespace anywhere, a comma or any other separator, exponent notation, more
 * fraction digits than the exponent (even zeros — `'180.00'` is not a JPY
 * amount), a leading or trailing `.`, and a value above
 * `Number.MAX_SAFE_INTEGER`. A bad `exponent` is a `RangeError` — that is the
 * caller's bug, not the provider's.
 */
export function decimalToMinor(decimal: string, exponent: number): number {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > MAX_EXPONENT) {
    throw new RangeError(`exponent must be an integer between 0 and ${MAX_EXPONENT}, got ${exponent}`);
  }
  if (typeof decimal !== 'string') {
    throw new DecimalAmountError(`amount must be a decimal string, got ${typeof decimal}`);
  }
  if (decimal.length === 0) {
    throw new DecimalAmountError('amount must be a decimal string, got an empty string');
  }

  let minor = 0;
  let wholeDigits = 0;
  let fractionDigits = 0;
  let seenDot = false;

  const push = (digit: number): void => {
    minor = minor * 10 + digit;
    if (minor > Number.MAX_SAFE_INTEGER) {
      throw new DecimalAmountError('amount exceeds the largest exactly representable integer');
    }
  };

  for (let i = 0; i < decimal.length; i += 1) {
    const code = decimal.charCodeAt(i);

    if (code === CODE_DOT) {
      if (seenDot) throw new DecimalAmountError('amount has more than one decimal point');
      if (wholeDigits === 0) throw new DecimalAmountError('amount has no digit before the decimal point');
      seenDot = true;
      continue;
    }

    if (code < CODE_ZERO || code > CODE_NINE) {
      throw new DecimalAmountError(`amount has an invalid character at position ${i}`);
    }

    if (seenDot) {
      fractionDigits += 1;
      if (fractionDigits > exponent) {
        throw new DecimalAmountError(
          `amount has more fraction digits than the currency allows (${exponent})`,
        );
      }
    } else {
      wholeDigits += 1;
    }
    push(code - CODE_ZERO);
  }

  if (seenDot && fractionDigits === 0) {
    throw new DecimalAmountError('amount has no digit after the decimal point');
  }

  // Pad the fraction the provider left out: '180.5' at exponent 2 is 18050.
  for (let i = fractionDigits; i < exponent; i += 1) push(0);

  return minor;
}

// ---------------------------------------------------------------------------
// Provider capability table
// ---------------------------------------------------------------------------

export interface PaymentProviderCapability {
  /**
   * ISO currency code → the methods the provider can settle in it. A currency
   * that is not a key cannot be charged through this provider at all.
   */
  methodsByCurrency: Readonly<Record<string, ReadonlyArray<PaymentMethodName>>>;
  /**
   * The provider dashboard's page for one payment, with `{id}` standing for
   * the bare provider payment id; `null` when the provider has no stable deep
   * link. The id is public to the merchant, not a secret.
   */
  dashboardUrlTemplate: string | null;
}

/**
 * What each provider can settle. BRL is the only currency in v1 (RFC 0026 R4),
 * and BRL with `pix` and `card` is the row every candidate fills.
 *
 * Only `mercadopago` has an adapter in milestone 30. Its row was checked
 * against the sandbox when that adapter landed (Task 05), on a Brazilian test
 * seller:
 *
 * - `card` and `boleto` are **observed**: the seller's payment methods list
 *   credit, debit and prepaid cards and `bolbradesco`, and a card payment and a
 *   boleto were made through Checkout Pro.
 * - `pix` is **kept but unverified**: RFC 0026 R7 requires it, and the test
 *   seller had no Pix key, so its method list showed none. It needs a seller
 *   with a Pix key before a label offers it.
 * - Checkout Pro also lets a payer use their Mercado Pago balance whatever is
 *   excluded. That is not a method a label lists; such a payment lands with
 *   method `other`.
 * - `dashboardUrlTemplate` stays `null`: no recorded response carries a
 *   merchant-side URL for a payment, and no stable per-payment panel URL is
 *   documented. The ledger shows the id without a link.
 *
 * A template is `null` wherever a stable per-payment URL is not known.
 */
export const PAYMENT_PROVIDER_CAPABILITIES: Readonly<Record<PaymentProviderName, PaymentProviderCapability>> =
  Object.freeze({
    stripe: Object.freeze({
      methodsByCurrency: Object.freeze({ BRL: Object.freeze(['pix', 'card', 'boleto'] as const) }),
      dashboardUrlTemplate: 'https://dashboard.stripe.com/payments/{id}',
    }),
    mercadopago: Object.freeze({
      methodsByCurrency: Object.freeze({ BRL: Object.freeze(['pix', 'card', 'boleto'] as const) }),
      dashboardUrlTemplate: null,
    }),
    asaas: Object.freeze({
      methodsByCurrency: Object.freeze({ BRL: Object.freeze(['pix', 'card', 'boleto'] as const) }),
      dashboardUrlTemplate: null,
    }),
    pagarme: Object.freeze({
      methodsByCurrency: Object.freeze({ BRL: Object.freeze(['pix', 'card', 'boleto'] as const) }),
      dashboardUrlTemplate: null,
    }),
  });

export function isPaymentProviderName(value: unknown): value is PaymentProviderName {
  return typeof value === 'string' && (PAYMENT_PROVIDER_NAMES as ReadonlyArray<string>).includes(value);
}

export function isPaymentMethodName(value: unknown): value is PaymentMethodName {
  return typeof value === 'string' && (PAYMENT_METHOD_NAMES as ReadonlyArray<string>).includes(value);
}

/**
 * The methods `provider` can settle in `currency`, in table order; empty when
 * the provider is unknown or the currency is not one it charges. The currency
 * code is matched exactly — ISO codes are upper case, as `currencies.code` is.
 */
export function providerMethodsForCurrency(provider: string, currency: string): ReadonlyArray<PaymentMethodName> {
  if (!isPaymentProviderName(provider)) return [];
  const table = PAYMENT_PROVIDER_CAPABILITIES[provider].methodsByCurrency;
  return Object.prototype.hasOwnProperty.call(table, currency) ? table[currency] : [];
}

/** May `provider` be charged in `currency` at all — whatever the method? */
export function providerSupportsCurrency(provider: string, currency: string): boolean {
  return providerMethodsForCurrency(provider, currency).length > 0;
}

/**
 * May `provider` settle `method` in `currency`? `false` for a provider, a
 * method or a currency the table does not list — never a throw, so a
 * configuration parser can turn the answer into its own refusal.
 */
export function providerCanSettle(provider: string, method: string, currency: string): boolean {
  return (providerMethodsForCurrency(provider, currency) as ReadonlyArray<string>).includes(method);
}

/**
 * The provider dashboard URL for a bare payment id, or `null` when the
 * provider has no template (or is unknown). The id is URL-encoded.
 */
export function providerDashboardUrl(provider: string, id: string): string | null {
  if (!isPaymentProviderName(provider) || id.length === 0) return null;
  const template = PAYMENT_PROVIDER_CAPABILITIES[provider].dashboardUrlTemplate;
  return template === null ? null : template.replace('{id}', encodeURIComponent(id));
}

// ---------------------------------------------------------------------------
// Gateway references — `<provider>:<id>`
// ---------------------------------------------------------------------------

const REFERENCE_SEPARATOR = ':';

export interface GatewayReference {
  provider: PaymentProviderName;
  /** The bare provider id (a payment, refund or dispute id); may itself contain a colon. */
  id: string;
}

/**
 * Builds the `external_reference` of a gateway ledger row. Throws on an
 * unknown provider or an empty id: a reference that cannot be split back is
 * never written.
 */
export function buildGatewayReference(provider: PaymentProviderName, id: string): string {
  if (!isPaymentProviderName(provider)) {
    throw new Error(`buildGatewayReference: unknown provider '${String(provider)}'`);
  }
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('buildGatewayReference: the provider id must be a non-empty string');
  }
  return `${provider}${REFERENCE_SEPARATOR}${id}`;
}

/**
 * Splits `<provider>:<id>` on the **first** colon, so an id that contains one
 * survives the round trip. `null` when the reference is not of that form —
 * no colon, an unknown provider or an empty id — which is how a free-form
 * admin-typed reference is told apart from a gateway one.
 */
export function splitGatewayReference(reference: string | null | undefined): GatewayReference | null {
  if (typeof reference !== 'string') return null;
  const at = reference.indexOf(REFERENCE_SEPARATOR);
  if (at <= 0) return null;
  const provider = reference.slice(0, at);
  const id = reference.slice(at + 1);
  if (!isPaymentProviderName(provider) || id.length === 0) return null;
  return { provider, id };
}
