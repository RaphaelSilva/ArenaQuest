/**
 * StubGatewayAdapter — a programmable `IPaymentGateway` for tests (milestone 30
 * decision 21). It never ships: nothing under `src/` imports this file, and a
 * test binds it through the registry's adapter-factory map, under any real
 * provider name:
 *
 * ```ts
 * const mp = new StubGatewayAdapter('mercadopago');
 * const env = stubPaymentsEnv('mercadopago:pix+card');
 * const { gateways } = buildPaymentsWiring(env, stubGatewayFactories(mp));
 * ```
 *
 * Programmed state is held by the instance, so one stub outlives the
 * per-request registries a test builds around it. Every port call is recorded
 * in `calls`, in order.
 */
import {
  PAYMENT_PROVIDER_NAMES,
  type CheckoutPaymentLookup,
  type CreateCheckoutRequest,
  type IPaymentGateway,
  type PaymentProviderName,
  type ProviderCheckout,
  type ProviderEvent,
  type ProviderPayment,
  type ProviderRefundResult,
} from '@arenaquest/shared/ports/i-payment-gateway';
import {
  paymentSecretKeyVar,
  paymentWebhookSecretVar,
  type PaymentsKeyMode,
} from '@api/core/payments/config';
import type {
  PaymentGatewayFactoryInput,
  PaymentGatewayFactoryMap,
} from '@api/core/payments/gateway-registry';

export type StubGatewayCall =
  | { method: 'createCheckout'; req: CreateCheckoutRequest }
  | { method: 'getPayment'; paymentId: string }
  | { method: 'findPaymentsForCheckout'; sessionId: string; checkoutId: string }
  | { method: 'refund'; paymentId: string; amountMinor: number; idempotencyKey: string }
  | {
      method: 'verifyWebhook';
      rawBody: string;
      headers: Readonly<Record<string, string>>;
      query: Readonly<Record<string, string>>;
    };

export type StubWebhookVerdict =
  | ProviderEvent
  | null
  | ((
      rawBody: string,
      headers: Readonly<Record<string, string>>,
      query: Readonly<Record<string, string>>,
    ) => ProviderEvent | null);

export class StubGatewayAdapter implements IPaymentGateway {
  /** Every port call received, oldest first. */
  readonly calls: StubGatewayCall[] = [];
  /** What the registry handed the factory, one entry per construction through `factory`. */
  readonly factoryInputs: PaymentGatewayFactoryInput[] = [];

  private readonly payments = new Map<string, ProviderPayment>();
  private readonly sessionPayments = new Map<string, string[]>();
  private readonly refundsByKey = new Map<string, ProviderRefundResult>();
  private checkoutResult: Partial<ProviderCheckout> | Error | null = null;
  private refundError: Error | null = null;
  private getPaymentError: Error | null = null;
  private webhookVerdict: StubWebhookVerdict = null;
  private refundSeq = 0;
  /** The clock a refund is stamped with; fixed so assertions stay deterministic. */
  now: () => Date = () => new Date('2026-01-01T00:00:00.000Z');

  constructor(readonly provider: PaymentProviderName) {}

  /** A factory that always returns **this** instance, so its programmed state survives a container rebuild. */
  readonly factory = (input: PaymentGatewayFactoryInput): IPaymentGateway => {
    this.factoryInputs.push(input);
    return this;
  };

  // --- programming -------------------------------------------------------

  /** Makes `getPayment(payment.id)` answer `payment`; optionally lists it under a session. */
  setPayment(payment: ProviderPayment, sessionId?: string): this {
    this.payments.set(payment.id, payment);
    if (sessionId !== undefined) {
      const ids = this.sessionPayments.get(sessionId) ?? [];
      if (!ids.includes(payment.id)) ids.push(payment.id);
      this.sessionPayments.set(sessionId, ids);
    }
    return this;
  }

  /** Makes the provider forget a payment: `getPayment` answers `null` again. */
  removePayment(paymentId: string): this {
    this.payments.delete(paymentId);
    for (const ids of this.sessionPayments.values()) {
      const at = ids.indexOf(paymentId);
      if (at !== -1) ids.splice(at, 1);
    }
    return this;
  }

  /** Overrides fields of the next sessions `createCheckout` opens, or makes it throw. `null` restores the default. */
  setCheckoutResult(result: Partial<ProviderCheckout> | Error | null): this {
    this.checkoutResult = result;
    return this;
  }

  /** Makes `getPayment` and `findPaymentsForCheckout` throw (a provider outage); `null` clears it. */
  failLookups(error: Error | null): this {
    this.getPaymentError = error;
    return this;
  }

  /** Makes `refund` throw (a provider refusal — or, with `retryable: true` on the error, a rate limit); `null` clears it. */
  failRefunds(error: Error | null): this {
    this.refundError = error;
    return this;
  }

  /** What `verifyWebhook` answers: an event, `null` ("not authentic"), or a function of the delivery. */
  setWebhookVerdict(verdict: StubWebhookVerdict): this {
    this.webhookVerdict = verdict;
    return this;
  }

  /** Calls received for one port method. */
  callsTo<M extends StubGatewayCall['method']>(method: M): Array<Extract<StubGatewayCall, { method: M }>> {
    return this.calls.filter((c): c is Extract<StubGatewayCall, { method: M }> => c.method === method);
  }

  // --- IPaymentGateway ---------------------------------------------------

  async createCheckout(req: CreateCheckoutRequest): Promise<ProviderCheckout> {
    this.calls.push({ method: 'createCheckout', req });
    if (this.checkoutResult instanceof Error) throw this.checkoutResult;
    return {
      sessionId: `${this.provider}-session-${req.checkoutId}`,
      url: `https://pay.${this.provider}.invalid/checkout/${req.checkoutId}`,
      expiresAt: req.expiresAt,
      ...(this.checkoutResult ?? {}),
    };
  }

  async getPayment(paymentId: string): Promise<ProviderPayment | null> {
    this.calls.push({ method: 'getPayment', paymentId });
    if (this.getPaymentError) throw this.getPaymentError;
    return this.payments.get(paymentId) ?? null;
  }

  async findPaymentsForCheckout({ sessionId, checkoutId }: CheckoutPaymentLookup): Promise<ProviderPayment[]> {
    this.calls.push({ method: 'findPaymentsForCheckout', sessionId, checkoutId });
    if (this.getPaymentError) throw this.getPaymentError;
    return (this.sessionPayments.get(sessionId) ?? [])
      .map(id => this.payments.get(id))
      .filter((p): p is ProviderPayment => p !== undefined);
  }

  /**
   * Idempotent on `idempotencyKey`. A new refund is appended to the stored
   * payment's `refunds`, so a later `getPayment` shows it, as a provider would.
   */
  async refund(paymentId: string, amountMinor: number, idempotencyKey: string): Promise<ProviderRefundResult> {
    this.calls.push({ method: 'refund', paymentId, amountMinor, idempotencyKey });
    if (this.refundError) throw this.refundError;
    const known = this.refundsByKey.get(idempotencyKey);
    if (known) return known;

    this.refundSeq += 1;
    const result: ProviderRefundResult = { refundId: `${this.provider}-refund-${this.refundSeq}` };
    this.refundsByKey.set(idempotencyKey, result);
    const payment = this.payments.get(paymentId);
    if (payment) {
      this.payments.set(paymentId, {
        ...payment,
        refunds: [...payment.refunds, { id: result.refundId, amountMinor, createdAt: this.now().toISOString() }],
      });
    }
    return result;
  }

  async verifyWebhook(
    rawBody: string,
    headers: Readonly<Record<string, string>>,
    query: Readonly<Record<string, string>>,
  ): Promise<ProviderEvent | null> {
    this.calls.push({ method: 'verifyWebhook', rawBody, headers, query });
    return typeof this.webhookVerdict === 'function'
      ? this.webhookVerdict(rawBody, headers, query)
      : this.webhookVerdict;
  }
}

/** A factory map binding each stub under its own provider name. */
export function stubGatewayFactories(...stubs: StubGatewayAdapter[]): PaymentGatewayFactoryMap {
  const map: Partial<Record<PaymentProviderName, StubGatewayAdapter['factory']>> = {};
  for (const stub of stubs) map[stub.provider] = stub.factory;
  return map;
}

/** A provider payment with sensible defaults — a paid Pix of R$ 180,00. */
export function stubPayment(overrides: Partial<ProviderPayment> & { id: string }): ProviderPayment {
  return {
    status: 'paid',
    amountMinor: 18000,
    currency: 'BRL',
    method: 'pix',
    methodLabel: null,
    paidAt: '2026-01-01T00:00:00.000Z',
    checkoutId: null,
    refunds: [],
    ...overrides,
  };
}

/**
 * A fake secret key for a provider. Deliberately shapeless: no code may read a
 * key's content (milestone 30 decision 19), so a stub key carries no prefix a
 * rule could latch on to. Not a credential.
 */
export function stubSecretKey(provider: PaymentProviderName): string {
  return `stub-secret-key-${provider}`;
}

/**
 * The env slice for a provider list: the list, the declared key mode, and both
 * secrets for every provider named in it. Spread it into a Worker env.
 */
export function stubPaymentsEnv(list: string, keyMode: PaymentsKeyMode = 'test'): Record<string, string> {
  const env: Record<string, string> = { PAYMENTS_PROVIDERS: list, PAYMENTS_KEY_MODE: keyMode };
  for (const provider of PAYMENT_PROVIDER_NAMES) {
    if (!new RegExp(`(^|,)\\s*${provider}\\s*:`).test(list)) continue;
    env[paymentSecretKeyVar(provider)] = stubSecretKey(provider);
    env[paymentWebhookSecretVar(provider)] = `whsec-stub-${provider}`;
  }
  return env;
}
