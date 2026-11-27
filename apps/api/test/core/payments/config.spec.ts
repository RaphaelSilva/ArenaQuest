import { describe, expect, it } from 'vitest';
import {
  parsePaymentsConfig,
  paymentSecretKeyVar,
  paymentWebhookSecretVar,
  type PaymentsConfigResult,
  type PaymentsEnv,
} from '@api/core/payments/config';
import type { PaymentProviderName } from '@arenaquest/shared/ports/i-payment-gateway';
import { stubPaymentsEnv } from '../../adapters/payment/stub-gateway-adapter';

const ALL: PaymentProviderName[] = ['stripe', 'mercadopago', 'asaas', 'pagarme'];

function parse(env: PaymentsEnv, availableProviders: PaymentProviderName[] = ALL, currency?: string) {
  return parsePaymentsConfig(env, { availableProviders, currency });
}

function reasonOf(result: PaymentsConfigResult): string | null {
  return result.ok ? null : result.reason;
}

// M30 Task 02 — RFC 0026 §8.1: the list is checked, never degraded.
describe('parsePaymentsConfig', () => {
  describe('payments off', () => {
    it.each([
      ['an absent var', {}],
      ['null', { PAYMENTS_PROVIDERS: null }],
      ['none', { PAYMENTS_PROVIDERS: 'none' }],
      ['none with whitespace', { PAYMENTS_PROVIDERS: '  none \n' }],
    ])('%s is a valid, empty configuration', (_label, env) => {
      expect(parse(env)).toEqual({ ok: true, config: { entries: [], keyMode: 'test', currency: 'BRL' } });
    });

    it('needs no adapter and no secret', () => {
      expect(parse({ PAYMENTS_PROVIDERS: 'none' }, []).ok).toBe(true);
    });

    it('carries PAYMENTS_KEY_MODE through', () => {
      const r = parse({ PAYMENTS_PROVIDERS: 'none', PAYMENTS_KEY_MODE: 'live' });
      expect(r.ok && r.config.keyMode).toBe('live');
    });
  });

  describe('a valid list', () => {
    it('reads one provider with two methods', () => {
      expect(parse(stubPaymentsEnv('mercadopago:pix+card'))).toEqual({
        ok: true,
        config: {
          entries: [{ provider: 'mercadopago', methods: ['pix', 'card'] }],
          keyMode: 'test',
          currency: 'BRL',
        },
      });
    });

    it('keeps list order, for providers and for methods', () => {
      const r = parse(stubPaymentsEnv('stripe:card,mercadopago:boleto+pix'));
      expect(r.ok && r.config.entries.map(e => [e.provider, e.methods])).toEqual([
        ['stripe', ['card']],
        ['mercadopago', ['boleto', 'pix']],
      ]);
    });

    it('keeps an entry with no method bound (rule 5)', () => {
      const r = parse(stubPaymentsEnv('mercadopago:pix+card,asaas:'));
      expect(r.ok && r.config.entries).toEqual([
        { provider: 'mercadopago', methods: ['pix', 'card'] },
        { provider: 'asaas', methods: [] },
      ]);
    });

    it('ignores whitespace around entries, providers and methods', () => {
      const env = { ...stubPaymentsEnv('mercadopago:pix,asaas:'), PAYMENTS_PROVIDERS: '  mercadopago : pix + card ,\n asaas : ' };
      const r = parse(env);
      expect(r.ok && r.config.entries.map(e => [e.provider, e.methods])).toEqual([
        ['mercadopago', ['pix', 'card']],
        ['asaas', []],
      ]);
    });

    it('never copies a secret into the result', () => {
      const env = stubPaymentsEnv('mercadopago:pix');
      const serialised = JSON.stringify(parse(env));
      expect(serialised).not.toContain(env[paymentSecretKeyVar('mercadopago')]);
      expect(serialised).not.toContain(env[paymentWebhookSecretVar('mercadopago')]);
    });
  });

  describe('refusals — each rule has its own reason and nothing degrades', () => {
    const cases: Array<[string, string, string]> = [
      ['rule 1: an unknown provider', 'paypal:card', 'unknown_provider'],
      ['rule 1: a provider listed twice', 'mercadopago:pix,mercadopago:card', 'duplicate_provider'],
      ['rule 1: an unknown method', 'mercadopago:pix+cash', 'unknown_method'],
      ['rule 2: a method offered by two providers', 'mercadopago:pix+card,stripe:card', 'method_offered_twice'],
      ['rule 2: a method repeated in one entry', 'mercadopago:pix+pix', 'method_offered_twice'],
      ['casing: an upper-case provider', 'MercadoPago:pix', 'unknown_provider'],
      ['casing: an upper-case method', 'mercadopago:PIX', 'unknown_method'],
      ['casing: NONE', 'NONE', 'malformed_list'],
      ['a blank list', '   ', 'malformed_list'],
      ['an entry with no colon', 'mercadopago', 'malformed_list'],
      ['an entry with two colons', 'mercadopago:pix:card', 'malformed_list'],
      ['a trailing comma', 'mercadopago:pix,', 'malformed_list'],
      ['none mixed with an entry', 'none,mercadopago:pix', 'malformed_list'],
      ['a dangling plus', 'mercadopago:pix+', 'unknown_method'],
    ];

    it.each(cases)('%s', (_label, list, reason) => {
      const env = { ...stubPaymentsEnv('stripe:,mercadopago:,asaas:,pagarme:'), PAYMENTS_PROVIDERS: list };
      const r = parse(env);
      expect(r.ok).toBe(false);
      expect(reasonOf(r)).toBe(reason);
      expect(r).not.toHaveProperty('config');
    });

    it('rule 3: a method outside the capability table for the currency', () => {
      const r = parse(stubPaymentsEnv('mercadopago:pix'), ALL, 'USD');
      expect(reasonOf(r)).toBe('method_not_supported');
    });

    it('rule 3 does not refuse a retired entry, which offers nothing', () => {
      expect(parse(stubPaymentsEnv('asaas:'), ALL, 'USD').ok).toBe(true);
    });

    it('a listed provider with no adapter on this Worker', () => {
      const r = parse(stubPaymentsEnv('mercadopago:pix,asaas:'), ['mercadopago']);
      expect(reasonOf(r)).toBe('no_adapter');
    });

    it('with no adapter at all any list other than none is refused', () => {
      expect(reasonOf(parse(stubPaymentsEnv('mercadopago:pix'), []))).toBe('no_adapter');
    });

    it.each([
      ['the secret key', paymentSecretKeyVar('mercadopago')],
      ['the webhook secret', paymentWebhookSecretVar('mercadopago')],
    ])('rule 4: %s missing', (_label, variable) => {
      const env = { ...stubPaymentsEnv('mercadopago:pix') };
      delete env[variable];
      const r = parse(env);
      expect(reasonOf(r)).toBe('missing_secret');
      expect(!r.ok && r.detail).toContain(variable);
    });

    it('rule 4: a blank secret counts as missing', () => {
      const env = { ...stubPaymentsEnv('mercadopago:pix'), [paymentWebhookSecretVar('mercadopago')]: '  ' };
      expect(reasonOf(parse(env))).toBe('missing_secret');
    });

    it('rule 4 covers a provider listed with no method', () => {
      const env = { ...stubPaymentsEnv('mercadopago:pix+card,asaas:') };
      delete env[paymentSecretKeyVar('asaas')];
      const r = parse(env);
      expect(reasonOf(r)).toBe('missing_secret');
      expect(!r.ok && r.detail).toContain('PAYMENTS_ASAAS_SECRET_KEY');
    });

    it('an unknown PAYMENTS_KEY_MODE, even with payments off', () => {
      expect(reasonOf(parse({ PAYMENTS_PROVIDERS: 'none', PAYMENTS_KEY_MODE: 'sandbox' }))).toBe('invalid_key_mode');
      expect(reasonOf(parse({ PAYMENTS_KEY_MODE: 'LIVE' }))).toBe('invalid_key_mode');
    });

    it('the reasons above are distinct per rule', () => {
      const reasons = new Set(cases.map(c => c[2]));
      expect(reasons).toEqual(
        new Set(['unknown_provider', 'duplicate_provider', 'unknown_method', 'method_offered_twice', 'malformed_list']),
      );
    });
  });
});

// M30 Task 17 — milestone decision 19 as rewritten: the key mode is a
// declaration the integrator owns. Nothing reads a key's content.
describe('PAYMENTS_KEY_MODE is a declaration', () => {
  /** Keys of every shape a provider (or a typo) could produce, test and live alike. */
  const KEYS = [
    'APP_USR-fixture-key',
    'TEST-fixture-key',
    'sk_live_fixture',
    'sk_test_fixture',
    '$aact_prod_fixture',
    'opaque-key-value',
    '0',
  ];

  it.each(['test', 'live'] as const)('any key passes under %s, for every provider', mode => {
    for (const provider of ALL) {
      for (const key of KEYS) {
        const env = { ...stubPaymentsEnv(`${provider}:card`, mode), [paymentSecretKeyVar(provider)]: key };
        const r = parse(env);
        expect(r).toEqual({
          ok: true,
          config: { entries: [{ provider, methods: ['card'] }], keyMode: mode, currency: 'BRL' },
        });
      }
    }
  });

  it('any key passes when the var is absent (absent means test)', () => {
    const env: Record<string, string> = {
      ...stubPaymentsEnv('mercadopago:pix+card'),
      [paymentSecretKeyVar('mercadopago')]: 'APP_USR-fixture-key',
    };
    delete env.PAYMENTS_KEY_MODE;
    const r = parse(env);
    expect(r.ok && r.config.keyMode).toBe('test');
  });

  it.each(['banana', 'sandbox', 'LIVE', 'Test', '', ' '])('the value %j is PAYMENTS_CONFIG_INVALID', value => {
    const r = parse({ ...stubPaymentsEnv('mercadopago:pix'), PAYMENTS_KEY_MODE: value });
    expect(reasonOf(r)).toBe('invalid_key_mode');
  });

  it('a result never carries a key or anything derived from one', () => {
    const key = 'APP_USR-fixture-key';
    const ok = parse({ ...stubPaymentsEnv('mercadopago:pix'), [paymentSecretKeyVar('mercadopago')]: key });
    expect(ok.ok).toBe(true);
    expect(JSON.stringify(ok)).not.toContain('APP_USR');
    expect(ok.ok && Object.keys(ok.config.entries[0])).toEqual(['provider', 'methods']);

    const invalid = parse({
      ...stubPaymentsEnv('mercadopago:pix'),
      [paymentSecretKeyVar('mercadopago')]: key,
      PAYMENTS_KEY_MODE: 'banana',
    });
    expect(JSON.stringify(invalid)).not.toContain('APP_USR');
  });

  it('still requires both secrets to be present, whatever they hold', () => {
    const env = { ...stubPaymentsEnv('mercadopago:pix'), [paymentWebhookSecretVar('mercadopago')]: '  ' };
    expect(reasonOf(parse(env))).toBe('missing_secret');
  });
});
