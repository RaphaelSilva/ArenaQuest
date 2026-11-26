/**
 * Payment configuration — turns `PAYMENTS_PROVIDERS` and `PAYMENTS_KEY_MODE`
 * into a checked {@link PaymentsConfig}, per request (RFC 0026 sections 8 and
 * 8.1; milestone 30 decisions 6, 13, 19 and 24).
 *
 * Grammar of the list:
 *
 * ```text
 * none                            payments off (also what an absent var means)
 * mercadopago:pix+card            one provider, two methods
 * mercadopago:pix,stripe:card     two providers
 * mercadopago:pix+card,asaas:     asaas retired: still bound, offers nothing
 * ```
 *
 * Whitespace around an entry, a provider or a method is ignored. Names are
 * **lower case and matched exactly**: `MercadoPago:pix` is an unknown provider,
 * not a spelling of `mercadopago` — the deployment schema's `~=` operator reads
 * the same list, and one spelling keeps the two from disagreeing.
 *
 * Returned, never thrown, and **never degraded**: a list that breaks a rule is
 * `{ ok: false, reason, detail }`, not `none` and not "the entries that were
 * fine". The payment routes translate that state into
 * `500 PAYMENTS_CONFIG_INVALID` (the `SUBMISSIONS_*` precedent in
 * `core/submissions/config.ts`); statements answer `payOptions: []`.
 *
 * Pure — no I/O, no clock, no logging. A secret is read only to learn whether
 * it is present and which mode its prefix declares; no key, and no part of
 * one, is ever copied into a result, a reason or a detail.
 *
 * Takes a structural env type rather than the generated `Env`: the provider
 * secrets exist only on a Worker that binds that provider.
 */
import {
  PAYMENT_METHOD_NAMES,
  PAYMENT_PROVIDER_NAMES,
  type PaymentMethodName,
  type PaymentProviderName,
} from '@arenaquest/shared/ports/i-payment-gateway';
import { providerMethodsForCurrency } from '@arenaquest/shared/domain/billing/gateway-money';

/** The error code a payment route answers with when the configuration is invalid. */
export const PAYMENTS_CONFIG_INVALID = 'PAYMENTS_CONFIG_INVALID';

/**
 * The currency the list is checked against. BRL is the only active currency
 * (RFC 0013 #4, RFC 0026 R4); the row in `currencies` is checked again when a
 * checkout is created (`409 PAYMENTS_UNSUPPORTED_CURRENCY`), because the
 * container is built synchronously and cannot read it.
 */
export const PAYMENTS_DEFAULT_CURRENCY = 'BRL';

export const PAYMENTS_KEY_MODES = ['test', 'live'] as const;

export type PaymentsKeyMode = (typeof PAYMENTS_KEY_MODES)[number];

/** What an absent `PAYMENTS_KEY_MODE` means (milestone 30 decision 19). */
export const PAYMENTS_DEFAULT_KEY_MODE: PaymentsKeyMode = 'test';

/** The slice of the Worker env the payment configuration reads. */
export type PaymentsEnv = Readonly<Record<string, unknown>>;

export interface PaymentsProviderEntry {
  provider: PaymentProviderName;
  /** The methods this provider offers, in list order; empty for a retired entry (`asaas:`). */
  methods: ReadonlyArray<PaymentMethodName>;
  /**
   * The mode this provider's secret key declares by its prefix; `null` when
   * the prefix is not one the platform recognises. Never the key itself.
   */
  secretKeyMode: PaymentsKeyMode | null;
}

export interface PaymentsConfig {
  /** Every bound provider, in list order; empty when payments are off. */
  entries: ReadonlyArray<PaymentsProviderEntry>;
  /** `PAYMENTS_KEY_MODE`, defaulted. */
  keyMode: PaymentsKeyMode;
  /** The currency rule 3 was checked against. */
  currency: string;
}

/** One distinct code per way a configuration can be refused. */
export type PaymentsConfigInvalidReason =
  /** The list is present but blank, or an entry is not `provider:method+method`. */
  | 'malformed_list'
  /** Rule 1. */
  | 'unknown_provider'
  | 'duplicate_provider'
  | 'unknown_method'
  /** Rule 2 — also a method repeated inside one entry. */
  | 'method_offered_twice'
  /** Rule 3. */
  | 'method_not_supported'
  /** The Worker has no adapter for a listed provider. */
  | 'no_adapter'
  /** Rule 4. */
  | 'missing_secret'
  /** `PAYMENTS_KEY_MODE` is present and neither `test` nor `live`. */
  | 'invalid_key_mode'
  /** A secret key whose prefix declares no mode the platform recognises. */
  | 'unrecognised_key'
  /** A live key under `test`, or a test key under `live`. */
  | 'key_mode_mismatch';

export type PaymentsConfigResult =
  | { ok: true; config: PaymentsConfig }
  | { ok: false; reason: PaymentsConfigInvalidReason; detail: string };

export interface ParsePaymentsConfigOptions {
  /** The providers the Worker has an adapter factory for. */
  availableProviders: ReadonlyArray<PaymentProviderName>;
  /** Defaults to {@link PAYMENTS_DEFAULT_CURRENCY}. */
  currency?: string;
}

/** `PAYMENTS_MERCADOPAGO_SECRET_KEY`, … */
export function paymentSecretKeyVar(provider: PaymentProviderName): string {
  return `PAYMENTS_${provider.toUpperCase()}_SECRET_KEY`;
}

/** `PAYMENTS_MERCADOPAGO_WEBHOOK_SECRET`, … */
export function paymentWebhookSecretVar(provider: PaymentProviderName): string {
  return `PAYMENTS_${provider.toUpperCase()}_WEBHOOK_SECRET`;
}

export interface PaymentProviderSecrets {
  secretKey: string;
  webhookSecret: string;
}

/** Both secrets of a provider, or `null` when either is absent or blank. */
export function readPaymentSecrets(env: PaymentsEnv, provider: PaymentProviderName): PaymentProviderSecrets | null {
  const secretKey = presentString(env[paymentSecretKeyVar(provider)]);
  const webhookSecret = presentString(env[paymentWebhookSecretVar(provider)]);
  if (secretKey === null || webhookSecret === null) return null;
  return { secretKey, webhookSecret };
}

/**
 * Per provider, the secret-key prefixes that declare each mode. Longest match
 * wins, so Pagar.me's `sk_test_` is not read as its live `sk_`.
 *
 * Only `mercadopago` has an adapter in milestone 30; its row is the one RFC
 * 0026 section 8 names and is pinned against the sandbox when that adapter
 * lands.
 */
const KEY_MODE_PREFIXES: Readonly<Record<PaymentProviderName, ReadonlyArray<readonly [string, PaymentsKeyMode]>>> = {
  stripe: [
    ['sk_live_', 'live'],
    ['rk_live_', 'live'],
    ['sk_test_', 'test'],
    ['rk_test_', 'test'],
  ],
  mercadopago: [
    ['APP_USR-', 'live'],
    ['TEST-', 'test'],
  ],
  asaas: [
    ['$aact_prod_', 'live'],
    ['$aact_hmlg_', 'test'],
  ],
  pagarme: [
    ['sk_test_', 'test'],
    ['sk_', 'live'],
  ],
};

/** The mode a provider's secret key declares by its prefix, with no provider call; `null` when unrecognised. */
export function secretKeyMode(provider: PaymentProviderName, secretKey: string): PaymentsKeyMode | null {
  let best: readonly [string, PaymentsKeyMode] | null = null;
  for (const rule of KEY_MODE_PREFIXES[provider]) {
    if (secretKey.startsWith(rule[0]) && (best === null || rule[0].length > best[0].length)) best = rule;
  }
  return best === null ? null : best[1];
}

/**
 * Applies the five rules of RFC 0026 section 8.1 to `PAYMENTS_PROVIDERS`.
 *
 * The key mode is *read* here (an unknown `PAYMENTS_KEY_MODE` is refused) but
 * compared with the keys by {@link assertPaymentsKeyMode}, so a route or the
 * reconcile run can run that assertion on its own.
 */
export function parsePaymentsConfig(env: PaymentsEnv, options: ParsePaymentsConfigOptions): PaymentsConfigResult {
  const currency = options.currency ?? PAYMENTS_DEFAULT_CURRENCY;

  const rawMode = env.PAYMENTS_KEY_MODE;
  let keyMode = PAYMENTS_DEFAULT_KEY_MODE;
  if (rawMode !== undefined && rawMode !== null) {
    const mode = String(rawMode).trim();
    if (!isKeyMode(mode)) return fail('invalid_key_mode', "PAYMENTS_KEY_MODE must be exactly 'test' or 'live'");
    keyMode = mode;
  }

  const rawList = env.PAYMENTS_PROVIDERS;
  if (rawList === undefined || rawList === null) return { ok: true, config: { entries: [], keyMode, currency } };
  const list = String(rawList).trim();
  if (list === 'none') return { ok: true, config: { entries: [], keyMode, currency } };
  if (list === '') return fail('malformed_list', "PAYMENTS_PROVIDERS is blank; write 'none' to turn payments off");

  // Rule 1 — shape, known names, a provider at most once.
  const parsed: Array<{ provider: PaymentProviderName; methods: PaymentMethodName[] }> = [];
  for (const rawEntry of list.split(',')) {
    const entry = rawEntry.trim();
    const colon = entry.indexOf(':');
    if (colon <= 0 || entry.indexOf(':', colon + 1) !== -1) {
      return fail('malformed_list', `entry '${entry}' is not 'provider:method+method'`);
    }
    const provider = entry.slice(0, colon).trim();
    if (!isProvider(provider)) return fail('unknown_provider', `provider '${provider}' is not known`);
    if (parsed.some(e => e.provider === provider)) {
      return fail('duplicate_provider', `provider '${provider}' is listed more than once`);
    }

    const methods: PaymentMethodName[] = [];
    const rawMethods = entry.slice(colon + 1).trim();
    if (rawMethods !== '') {
      for (const rawMethod of rawMethods.split('+')) {
        const method = rawMethod.trim();
        if (!isMethod(method)) return fail('unknown_method', `method '${method}' of '${provider}' is not known`);
        if (methods.includes(method)) {
          return fail('method_offered_twice', `method '${method}' is repeated for '${provider}'`);
        }
        methods.push(method);
      }
    }
    parsed.push({ provider, methods });
  }

  // Rule 2 — who processes a method must have exactly one answer.
  const offeredBy = new Map<PaymentMethodName, PaymentProviderName>();
  for (const { provider, methods } of parsed) {
    for (const method of methods) {
      const other = offeredBy.get(method);
      if (other !== undefined) {
        return fail('method_offered_twice', `method '${method}' is offered by both '${other}' and '${provider}'`);
      }
      offeredBy.set(method, provider);
    }
  }

  // Rule 3 — a list cannot enable what the adapter cannot settle.
  for (const { provider, methods } of parsed) {
    const supported = providerMethodsForCurrency(provider, currency);
    for (const method of methods) {
      if (!supported.includes(method)) {
        return fail('method_not_supported', `'${provider}' cannot settle '${method}' in ${currency}`);
      }
    }
  }

  for (const { provider } of parsed) {
    if (!options.availableProviders.includes(provider)) {
      return fail('no_adapter', `this Worker has no adapter for '${provider}'`);
    }
  }

  // Rules 4 and 5 — both secrets for every listed provider, a retired one included.
  const entries: PaymentsProviderEntry[] = [];
  for (const { provider, methods } of parsed) {
    const secretKey = presentString(env[paymentSecretKeyVar(provider)]);
    if (secretKey === null) return fail('missing_secret', `${paymentSecretKeyVar(provider)} is not set`);
    if (presentString(env[paymentWebhookSecretVar(provider)]) === null) {
      return fail('missing_secret', `${paymentWebhookSecretVar(provider)} is not set`);
    }
    entries.push({ provider, methods, secretKeyMode: secretKeyMode(provider, secretKey) });
  }

  return { ok: true, config: { entries, keyMode, currency } };
}

/**
 * The key-mode assertion (milestone 30 decision 19): every bound provider's
 * secret key must declare the mode `PAYMENTS_KEY_MODE` says, so a staging
 * Worker collects nothing real and production never runs on a sandbox key.
 *
 * A function of the configuration alone — no env, no provider call — so a
 * route and the reconcile run can both call it. An already invalid result
 * passes through unchanged.
 */
export function assertPaymentsKeyMode(result: PaymentsConfigResult): PaymentsConfigResult {
  if (!result.ok) return result;
  const { keyMode, entries } = result.config;
  for (const entry of entries) {
    if (entry.secretKeyMode === null) {
      return fail(
        'unrecognised_key',
        `${paymentSecretKeyVar(entry.provider)} declares neither a test nor a live key by its prefix`,
      );
    }
    if (entry.secretKeyMode !== keyMode) {
      return fail(
        'key_mode_mismatch',
        `${paymentSecretKeyVar(entry.provider)} is a ${entry.secretKeyMode} key but PAYMENTS_KEY_MODE is '${keyMode}'`,
      );
    }
  }
  return result;
}

function fail(reason: PaymentsConfigInvalidReason, detail: string): PaymentsConfigResult {
  return { ok: false, reason, detail };
}

function presentString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim() === '' ? null : value;
}

function isKeyMode(value: string): value is PaymentsKeyMode {
  return (PAYMENTS_KEY_MODES as ReadonlyArray<string>).includes(value);
}

function isProvider(value: string): value is PaymentProviderName {
  return (PAYMENT_PROVIDER_NAMES as ReadonlyArray<string>).includes(value);
}

function isMethod(value: string): value is PaymentMethodName {
  return (PAYMENT_METHOD_NAMES as ReadonlyArray<string>).includes(value);
}
