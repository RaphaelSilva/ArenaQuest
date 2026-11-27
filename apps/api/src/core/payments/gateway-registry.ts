/**
 * GatewayRegistry — the payment adapters enabled for this label and
 * environment, resolved by provider name (RFC 0026 sections 8.1 and 9).
 *
 * Built **per request** by `buildContainer`, like every adapter: the module
 * scope holds factories, never an adapter instance. An adapter is constructed
 * the first time it is asked for, so a request that never touches payments
 * builds none.
 *
 * The registry is empty when the list is `none` *and* when the configuration
 * is invalid — an invalid list binds nothing, so a statement reads
 * `payOptions: []` (milestone 30 decision 24) while the payment routes read
 * the configuration result and answer `500 PAYMENTS_CONFIG_INVALID`.
 */
import type {
  IPaymentGateway,
  PaymentMethodName,
  PaymentProviderName,
} from '@arenaquest/shared/ports/i-payment-gateway';
import {
  parsePaymentsConfig,
  readPaymentSecrets,
  type PaymentsConfigResult,
  type PaymentsEnv,
  type PaymentsKeyMode,
} from '@api/core/payments/config';
import { mercadoPagoGatewayFactory } from '@api/adapters/payment/mercadopago-gateway-adapter';

/** What a factory is handed to build one provider's adapter. */
export interface PaymentGatewayFactoryInput {
  provider: PaymentProviderName;
  /** `PAYMENTS_<PROVIDER>_SECRET_KEY`. */
  secretKey: string;
  /** `PAYMENTS_<PROVIDER>_WEBHOOK_SECRET`. */
  webhookSecret: string;
  /** What `PAYMENTS_KEY_MODE` declares. A reminder only: no adapter may branch on a key's content. */
  keyMode: PaymentsKeyMode;
}

export type PaymentGatewayFactory = (input: PaymentGatewayFactoryInput) => IPaymentGateway;

/** The adapters a Worker can build, by provider name. */
export type PaymentGatewayFactoryMap = Readonly<Partial<Record<PaymentProviderName, PaymentGatewayFactory>>>;

/**
 * The factories a deployed Worker has: **Mercado Pago only** (milestone 30
 * Task 05), so a list naming any other provider is invalid (`no_adapter`). The
 * test stub is never listed here: tests hand `buildContainer` their own map
 * (decision 21).
 */
export const PRODUCTION_GATEWAY_FACTORIES: PaymentGatewayFactoryMap = Object.freeze({
  mercadopago: mercadoPagoGatewayFactory,
});

/** One entry a student can pay through: a provider and the methods it offers. */
export interface PayOption {
  provider: PaymentProviderName;
  methods: ReadonlyArray<PaymentMethodName>;
}

interface Binding {
  methods: ReadonlyArray<PaymentMethodName>;
  create: () => IPaymentGateway;
  instance: IPaymentGateway | null;
}

export class GatewayRegistry {
  private readonly bindings = new Map<PaymentProviderName, Binding>();

  /**
   * @param configResult An invalid result yields an empty registry.
   * @param factories The adapters this Worker can build.
   * @param env Read for the two secrets of each bound provider, nothing else.
   */
  constructor(configResult: PaymentsConfigResult, factories: PaymentGatewayFactoryMap, env: PaymentsEnv) {
    if (!configResult.ok) return;
    const { entries, keyMode } = configResult.config;
    for (const { provider, methods } of entries) {
      const factory = factories[provider];
      const secrets = readPaymentSecrets(env, provider);
      // A valid configuration guarantees both; a provider that lacks either
      // was not checked against this map and env, and stays unbound.
      if (factory === undefined || secrets === null) continue;
      this.bindings.set(provider, {
        methods,
        create: () => factory({ provider, keyMode, ...secrets }),
        instance: null,
      });
    }
  }

  /** `true` when no provider is bound: payments are off, or the configuration is invalid. */
  get isEmpty(): boolean {
    return this.bindings.size === 0;
  }

  /** Every bound provider, in list order — a retired one (`asaas:`) included. */
  get providers(): ReadonlyArray<PaymentProviderName> {
    return [...this.bindings.keys()];
  }

  /** The entries that offer at least one method, in list order. Empty means no *Pay* button. */
  get payOptions(): ReadonlyArray<PayOption> {
    const options: PayOption[] = [];
    for (const [provider, binding] of this.bindings) {
      if (binding.methods.length > 0) options.push({ provider, methods: binding.methods });
    }
    return options;
  }

  /** The methods a bound provider offers; empty for a retired or an unbound one. */
  methodsOf(provider: string): ReadonlyArray<PaymentMethodName> {
    return this.bindings.get(provider as PaymentProviderName)?.methods ?? [];
  }

  /**
   * The adapter bound under `provider`, or `null` when this label and
   * environment do not bind it. Takes any string: the name arrives from a URL
   * segment, a checkout row or the prefix of an `external_reference`.
   */
  get(provider: string): IPaymentGateway | null {
    const binding = this.bindings.get(provider as PaymentProviderName);
    if (binding === undefined) return null;
    binding.instance ??= binding.create();
    return binding.instance;
  }
}

/** What the container's `payments` group holds after this task. */
export interface PaymentsWiring {
  /**
   * The checked configuration — the list rules, both secrets present and a
   * valid `PAYMENTS_KEY_MODE` value. `ok: false` is what a payment route
   * translates into `500 PAYMENTS_CONFIG_INVALID`.
   */
  config: PaymentsConfigResult;
  gateways: GatewayRegistry;
}

/**
 * Parses the environment against `factories` and builds the registry. Never
 * throws: a bad list is a recorded state with its reason.
 */
export function buildPaymentsWiring(
  env: PaymentsEnv,
  factories: PaymentGatewayFactoryMap = PRODUCTION_GATEWAY_FACTORIES,
): PaymentsWiring {
  const availableProviders = (Object.keys(factories) as PaymentProviderName[]).filter(
    provider => factories[provider] !== undefined,
  );
  const config = parsePaymentsConfig(env, { availableProviders });
  return { config, gateways: new GatewayRegistry(config, factories, env) };
}
