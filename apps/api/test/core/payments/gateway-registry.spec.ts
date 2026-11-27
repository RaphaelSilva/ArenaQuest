import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPaymentsWiring,
  GatewayRegistry,
  PRODUCTION_GATEWAY_FACTORIES,
} from '@api/core/payments/gateway-registry';
import { paymentSecretKeyVar } from '@api/core/payments/config';
import { MercadoPagoGatewayAdapter } from '@api/adapters/payment/mercadopago-gateway-adapter';
import {
  StubGatewayAdapter,
  stubGatewayFactories,
  stubPayment,
  stubPaymentsEnv,
} from '../../adapters/payment/stub-gateway-adapter';

// M30 Task 02 — RFC 0026 §8.1, §9: the registry and the stub adapter.
describe('buildPaymentsWiring', () => {
  it.each([
    ['none', { PAYMENTS_PROVIDERS: 'none' }],
    ['an absent var', {}],
  ])('%s yields a valid configuration and an empty registry', (_label, env) => {
    const { config, gateways } = buildPaymentsWiring(env);
    expect(config.ok).toBe(true);
    expect(gateways.isEmpty).toBe(true);
    expect(gateways.payOptions).toEqual([]);
    expect(gateways.providers).toEqual([]);
    expect(gateways.get('mercadopago')).toBeNull();
  });

  // M30 Task 05: the production map holds the Mercado Pago adapter and nothing else (decision 21).
  it('defaults to the production map, which binds mercadopago and no other provider', () => {
    expect(Object.keys(PRODUCTION_GATEWAY_FACTORIES)).toEqual(['mercadopago']);
    expect(Object.isFrozen(PRODUCTION_GATEWAY_FACTORIES)).toBe(true);

    const { config, gateways } = buildPaymentsWiring(stubPaymentsEnv('mercadopago:pix+card'));
    expect(config.ok).toBe(true);
    expect(gateways.payOptions).toEqual([{ provider: 'mercadopago', methods: ['pix', 'card'] }]);
    const adapter = gateways.get('mercadopago');
    expect(adapter).toBeInstanceOf(MercadoPagoGatewayAdapter);
    expect(adapter?.provider).toBe('mercadopago');
    expect(gateways.get('mercadopago')).toBe(adapter);

    const other = buildPaymentsWiring(stubPaymentsEnv('stripe:card'));
    expect(other.config).toMatchObject({ ok: false, reason: 'no_adapter' });
    expect(other.gateways.isEmpty).toBe(true);
  });

  it('with the production map, mercadopago without both secrets is refused', () => {
    const env = stubPaymentsEnv('mercadopago:pix+card');
    delete env[paymentSecretKeyVar('mercadopago')];
    const { config, gateways } = buildPaymentsWiring(env);
    expect(config).toMatchObject({ ok: false, reason: 'missing_secret' });
    expect(gateways.get('mercadopago')).toBeNull();
  });

  it('mercadopago:pix+card,asaas: yields one pay option and two bound providers', () => {
    const mp = new StubGatewayAdapter('mercadopago');
    const asaas = new StubGatewayAdapter('asaas');
    const { config, gateways } = buildPaymentsWiring(
      stubPaymentsEnv('mercadopago:pix+card,asaas:'),
      stubGatewayFactories(mp, asaas),
    );

    expect(config.ok).toBe(true);
    expect(gateways.isEmpty).toBe(false);
    expect(gateways.payOptions).toEqual([{ provider: 'mercadopago', methods: ['pix', 'card'] }]);
    expect(gateways.providers).toEqual(['mercadopago', 'asaas']);
    // Retired: bound — its webhook, refunds and reconcile still resolve — but not offered.
    expect(gateways.get('asaas')).toBe(asaas);
    expect(gateways.methodsOf('asaas')).toEqual([]);
    expect(gateways.methodsOf('mercadopago')).toEqual(['pix', 'card']);
  });

  it('keeps list order in payOptions', () => {
    const stubs = [new StubGatewayAdapter('stripe'), new StubGatewayAdapter('mercadopago'), new StubGatewayAdapter('asaas')];
    const { gateways } = buildPaymentsWiring(
      stubPaymentsEnv('stripe:card,asaas:,mercadopago:boleto+pix'),
      stubGatewayFactories(...stubs),
    );
    expect(gateways.payOptions).toEqual([
      { provider: 'stripe', methods: ['card'] },
      { provider: 'mercadopago', methods: ['boleto', 'pix'] },
    ]);
  });

  it('binds two stubs under two provider names and resolves each by name', async () => {
    const mp = new StubGatewayAdapter('mercadopago').setPayment(stubPayment({ id: 'mp-1' }));
    const stripe = new StubGatewayAdapter('stripe').setPayment(stubPayment({ id: 'st-1', method: 'card' }));
    const { gateways } = buildPaymentsWiring(
      stubPaymentsEnv('mercadopago:pix,stripe:card'),
      stubGatewayFactories(mp, stripe),
    );

    expect(gateways.get('mercadopago')).toBe(mp);
    expect(gateways.get('stripe')).toBe(stripe);
    expect(gateways.get('mercadopago')?.provider).toBe('mercadopago');
    expect(await gateways.get('stripe')?.getPayment('st-1')).toMatchObject({ id: 'st-1', method: 'card' });
    expect(await gateways.get('stripe')?.getPayment('mp-1')).toBeNull();
    expect(mp.calls).toEqual([]);
    expect(stripe.callsTo('getPayment').map(c => c.paymentId)).toEqual(['st-1', 'mp-1']);
  });

  it('answers null for a provider that is not bound, known or not', () => {
    const { gateways } = buildPaymentsWiring(
      stubPaymentsEnv('mercadopago:pix'),
      stubGatewayFactories(new StubGatewayAdapter('mercadopago'), new StubGatewayAdapter('stripe')),
    );
    expect(gateways.get('stripe')).toBeNull();
    expect(gateways.get('paypal')).toBeNull();
    expect(gateways.get('')).toBeNull();
    expect(gateways.methodsOf('stripe')).toEqual([]);
  });

  it('builds an adapter lazily, once, with its own secrets and the key mode', () => {
    const mp = new StubGatewayAdapter('mercadopago');
    const asaas = new StubGatewayAdapter('asaas');
    const env = stubPaymentsEnv('mercadopago:pix,asaas:');
    const { gateways } = buildPaymentsWiring(env, stubGatewayFactories(mp, asaas));

    expect(mp.factoryInputs).toEqual([]);
    gateways.get('mercadopago');
    gateways.get('mercadopago');
    expect(mp.factoryInputs).toEqual([
      {
        provider: 'mercadopago',
        keyMode: 'test',
        secretKey: env.PAYMENTS_MERCADOPAGO_SECRET_KEY,
        webhookSecret: env.PAYMENTS_MERCADOPAGO_WEBHOOK_SECRET,
      },
    ]);
    expect(asaas.factoryInputs).toEqual([]);
  });

  it('an invalid list binds nothing — not none, not fewer methods', () => {
    const mp = new StubGatewayAdapter('mercadopago');
    const stripe = new StubGatewayAdapter('stripe');
    const { config, gateways } = buildPaymentsWiring(
      stubPaymentsEnv('mercadopago:pix+card,stripe:card'),
      stubGatewayFactories(mp, stripe),
    );
    expect(config).toMatchObject({ ok: false, reason: 'method_offered_twice' });
    expect(gateways.isEmpty).toBe(true);
    expect(gateways.payOptions).toEqual([]);
    expect(gateways.get('mercadopago')).toBeNull();
  });

  it('binds a provider whatever its key looks like, under either declared mode (decision 19)', () => {
    for (const mode of ['test', 'live'] as const) {
      const stripe = new StubGatewayAdapter('stripe');
      for (const key of ['sk_live_fixture', 'sk_test_fixture', 'opaque']) {
        const env = { ...stubPaymentsEnv('stripe:card', mode), PAYMENTS_STRIPE_SECRET_KEY: key };
        const { config, gateways } = buildPaymentsWiring(env, stubGatewayFactories(stripe));
        expect(config.ok).toBe(true);
        expect(gateways.get('stripe')).toBe(stripe);
      }
      expect(stripe.factoryInputs.map(input => input.keyMode)).toEqual([mode, mode, mode]);
    }
  });

  it('an invalid PAYMENTS_KEY_MODE value is an invalid configuration and binds nothing', () => {
    const stripe = new StubGatewayAdapter('stripe');
    const env = { ...stubPaymentsEnv('stripe:card'), PAYMENTS_KEY_MODE: 'banana' };
    const { config, gateways } = buildPaymentsWiring(env, stubGatewayFactories(stripe));
    expect(config).toMatchObject({ ok: false, reason: 'invalid_key_mode' });
    expect(gateways.isEmpty).toBe(true);
    expect(stripe.factoryInputs).toEqual([]);
  });

  it('never throws on a bad list', () => {
    for (const list of ['', ',', ':', 'x', 'mercadopago:pix,,', ':::', '+']) {
      const { config, gateways } = buildPaymentsWiring({ PAYMENTS_PROVIDERS: list });
      expect(config.ok).toBe(false);
      expect(gateways.isEmpty).toBe(true);
    }
  });
});

describe('GatewayRegistry', () => {
  it('leaves a provider unbound when the env it is given lacks a secret', () => {
    const mp = new StubGatewayAdapter('mercadopago');
    const env = stubPaymentsEnv('mercadopago:pix');
    const { config } = buildPaymentsWiring(env, stubGatewayFactories(mp));
    const stripped = { ...env };
    delete stripped[paymentSecretKeyVar('mercadopago')];
    expect(new GatewayRegistry(config, stubGatewayFactories(mp), stripped).isEmpty).toBe(true);
  });
});

describe('StubGatewayAdapter', () => {
  it('opens a deterministic session and records the request', async () => {
    const stub = new StubGatewayAdapter('mercadopago');
    const req = {
      checkoutId: 'co-1',
      amountMinor: 18000,
      currency: 'BRL',
      description: 'Mensalidade 2026-11',
      payer: { id: 'u-1', email: 's@example.test', name: 'Student' },
      methods: ['pix' as const],
      returnUrls: { success: 'https://web.test/ok', cancel: 'https://web.test/no' },
      notificationUrl: 'https://api.web.test/v1/webhooks/payments/mercadopago',
      expiresAt: '2026-11-27T00:00:00.000Z',
    };
    expect(await stub.createCheckout(req)).toEqual({
      sessionId: 'mercadopago-session-co-1',
      url: 'https://pay.mercadopago.invalid/checkout/co-1',
      expiresAt: '2026-11-27T00:00:00.000Z',
    });
    expect(stub.callsTo('createCheckout')).toEqual([{ method: 'createCheckout', req }]);

    stub.setCheckoutResult({ expiresAt: '2026-11-26T12:00:00.000Z' });
    expect((await stub.createCheckout(req)).expiresAt).toBe('2026-11-26T12:00:00.000Z');

    stub.setCheckoutResult(new Error('provider down'));
    await expect(stub.createCheckout(req)).rejects.toThrow('provider down');
  });

  it('serves programmed payments by id and by session', async () => {
    const stub = new StubGatewayAdapter('asaas')
      .setPayment(stubPayment({ id: 'p-1', checkoutId: 'co-1' }), 'sess-1')
      .setPayment(stubPayment({ id: 'p-2', status: 'pending', paidAt: null }), 'sess-1');

    expect(await stub.getPayment('p-1')).toMatchObject({ id: 'p-1', status: 'paid', checkoutId: 'co-1' });
    expect(await stub.getPayment('nope')).toBeNull();
    expect((await stub.findPaymentsForCheckout({ sessionId: 'sess-1', checkoutId: 'co-1' })).map(p => p.id)).toEqual(['p-1', 'p-2']);
    expect(await stub.findPaymentsForCheckout({ sessionId: 'sess-2', checkoutId: 'co-1' })).toEqual([]);

    // Both ids of the lookup are recorded: an adapter may search on either.
    expect(stub.callsTo('findPaymentsForCheckout')[0]).toEqual({
      method: 'findPaymentsForCheckout',
      sessionId: 'sess-1',
      checkoutId: 'co-1',
    });

    stub.removePayment('p-1');
    expect(await stub.getPayment('p-1')).toBeNull();
    expect((await stub.findPaymentsForCheckout({ sessionId: 'sess-1', checkoutId: 'co-1' })).map(p => p.id)).toEqual(['p-2']);

    stub.failLookups(new Error('timeout'));
    await expect(stub.getPayment('p-2')).rejects.toThrow('timeout');
    await expect(stub.findPaymentsForCheckout({ sessionId: 'sess-1', checkoutId: 'co-1' })).rejects.toThrow('timeout');
  });

  it('refunds idempotently, shows the refund on the payment, and can refuse', async () => {
    const stub = new StubGatewayAdapter('mercadopago').setPayment(stubPayment({ id: 'p-1' }));

    const first = await stub.refund('p-1', 5000, 'key-1');
    expect(first).toEqual({ refundId: 'mercadopago-refund-1' });
    expect(await stub.refund('p-1', 5000, 'key-1')).toEqual(first);
    expect(await stub.refund('p-1', 1000, 'key-2')).toEqual({ refundId: 'mercadopago-refund-2' });
    expect((await stub.getPayment('p-1'))?.refunds).toEqual([
      { id: 'mercadopago-refund-1', amountMinor: 5000, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'mercadopago-refund-2', amountMinor: 1000, createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(stub.callsTo('refund')).toHaveLength(3);

    stub.failRefunds(new Error('refused'));
    await expect(stub.refund('p-1', 1, 'key-3')).rejects.toThrow('refused');
  });

  it('answers the programmed webhook verdict and records the delivery', async () => {
    const stub = new StubGatewayAdapter('stripe');
    expect(await stub.verifyWebhook('{}', {}, {})).toBeNull();

    const event = { kind: 'payment' as const, eventId: 'evt-1', paymentId: 'p-1', occurredAt: '2026-01-01T00:00:00.000Z' };
    stub.setWebhookVerdict(event);
    expect(await stub.verifyWebhook('{"a":1}', { 'x-signature': 's' }, { id: '1' })).toEqual(event);

    stub.setWebhookVerdict((_body, headers) => (headers['x-signature'] === 'good' ? event : null));
    expect(await stub.verifyWebhook('{}', { 'x-signature': 'bad' }, {})).toBeNull();
    expect(await stub.verifyWebhook('{}', { 'x-signature': 'good' }, {})).toEqual(event);

    expect(stub.callsTo('verifyWebhook')[1]).toEqual({
      method: 'verifyWebhook',
      rawBody: '{"a":1}',
      headers: { 'x-signature': 's' },
      query: { id: '1' },
    });
  });

  it('never ships: nothing under src/ imports it', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (readFileSync(path, 'utf8').includes('stub-gateway-adapter')) offenders.push(path);
      }
    };
    walk(join(__dirname, '../../../src'));
    expect(offenders).toEqual([]);
  });
});
