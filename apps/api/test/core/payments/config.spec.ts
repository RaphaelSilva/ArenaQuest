import { describe, expect, it } from 'vitest';
import {
  assertPaymentsKeyMode,
  parsePaymentsConfig,
  paymentSecretKeyVar,
  paymentWebhookSecretVar,
  secretKeyMode,
  type PaymentsConfigResult,
  type PaymentsEnv,
} from '@api/core/payments/config';
import type { PaymentProviderName } from '@arenaquest/shared/ports/i-payment-gateway';
import { stubPaymentsEnv, stubSecretKey } from '../../adapters/payment/stub-gateway-adapter';

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
          entries: [{ provider: 'mercadopago', methods: ['pix', 'card'], secretKeyMode: 'test' }],
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
        { provider: 'mercadopago', methods: ['pix', 'card'], secretKeyMode: 'test' },
        { provider: 'asaas', methods: [], secretKeyMode: 'test' },
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

describe('secretKeyMode', () => {
  it.each(ALL.filter(p => p !== 'mercadopago'))('reads both modes of %s from the prefix', provider => {
    expect(secretKeyMode(provider, stubSecretKey(provider, 'test'))).toBe('test');
    expect(secretKeyMode(provider, stubSecretKey(provider, 'live'))).toBe('live');
  });

  it('names the Stripe prefix RFC 0026 §8 cites', () => {
    expect(secretKeyMode('stripe', 'sk_live_abc')).toBe('live');
  });

  // M30 Task 05: observed on the sandbox — a test user's credentials start with
  // `APP_USR-` exactly like production ones, so that prefix proves neither mode.
  it('reads the Mercado Pago APP_USR- prefix as either mode, and TEST- as test only', () => {
    expect(secretKeyMode('mercadopago', 'APP_USR-123')).toBe('either');
    expect(secretKeyMode('mercadopago', stubSecretKey('mercadopago', 'live'))).toBe('either');
    expect(secretKeyMode('mercadopago', 'TEST-123')).toBe('test');
    expect(secretKeyMode('mercadopago', stubSecretKey('mercadopago', 'test'))).toBe('test');
  });

  it('answers null for a prefix it does not know', () => {
    expect(secretKeyMode('mercadopago', 'sk_test_abc')).toBeNull();
    expect(secretKeyMode('stripe', '')).toBeNull();
  });
});

describe('assertPaymentsKeyMode', () => {
  it('passes when every key declares the configured mode', () => {
    const test = parse(stubPaymentsEnv('mercadopago:pix,stripe:card', 'test'));
    expect(assertPaymentsKeyMode(test)).toBe(test);
    expect(assertPaymentsKeyMode(parse(stubPaymentsEnv('mercadopago:pix', 'live'))).ok).toBe(true);
  });

  it('passes with payments off, whatever the mode', () => {
    expect(assertPaymentsKeyMode(parse({ PAYMENTS_KEY_MODE: 'live' })).ok).toBe(true);
  });

  it('refuses a live key under PAYMENTS_KEY_MODE=test', () => {
    const env = { ...stubPaymentsEnv('stripe:card', 'live'), PAYMENTS_KEY_MODE: 'test' };
    const r = assertPaymentsKeyMode(parse(env));
    expect(reasonOf(r)).toBe('key_mode_mismatch');
  });

  it('refuses a live key when PAYMENTS_KEY_MODE is absent (absent means test)', () => {
    const env: Record<string, string> = { ...stubPaymentsEnv('stripe:card', 'live') };
    delete env.PAYMENTS_KEY_MODE;
    expect(reasonOf(assertPaymentsKeyMode(parse(env)))).toBe('key_mode_mismatch');
  });

  it('accepts a Mercado Pago APP_USR- key under both modes: the prefix cannot tell them apart', () => {
    for (const mode of ['test', 'live'] as const) {
      const env = {
        ...stubPaymentsEnv('mercadopago:pix+card', mode),
        [paymentSecretKeyVar('mercadopago')]: 'APP_USR-fixture-key',
      };
      const r = assertPaymentsKeyMode(parse(env));
      expect(r.ok).toBe(true);
      expect(r.ok && r.config.entries[0].secretKeyMode).toBe('either');
      expect(r.ok && r.config.keyMode).toBe(mode);
    }
  });

  it('still refuses a Mercado Pago TEST- key under PAYMENTS_KEY_MODE=live', () => {
    const env = {
      ...stubPaymentsEnv('mercadopago:pix', 'live'),
      [paymentSecretKeyVar('mercadopago')]: 'TEST-fixture-key',
    };
    const r = assertPaymentsKeyMode(parse(env));
    expect(reasonOf(r)).toBe('key_mode_mismatch');
    expect(JSON.stringify(r)).not.toContain('TEST-fixture-key');
  });

  it('refuses a test key under PAYMENTS_KEY_MODE=live', () => {
    const env = { ...stubPaymentsEnv('mercadopago:pix', 'test'), PAYMENTS_KEY_MODE: 'live' };
    expect(reasonOf(assertPaymentsKeyMode(parse(env)))).toBe('key_mode_mismatch');
  });

  it('checks a retired provider too, and one mismatch among several is enough', () => {
    const env = {
      ...stubPaymentsEnv('mercadopago:pix,asaas:', 'test'),
      [paymentSecretKeyVar('asaas')]: stubSecretKey('asaas', 'live'),
    };
    const r = assertPaymentsKeyMode(parse(env));
    expect(reasonOf(r)).toBe('key_mode_mismatch');
    expect(!r.ok && r.detail).toContain('PAYMENTS_ASAAS_SECRET_KEY');
  });

  it('refuses a key whose prefix declares no mode', () => {
    const env = { ...stubPaymentsEnv('mercadopago:pix'), [paymentSecretKeyVar('mercadopago')]: 'opaque-key-value' };
    const r = assertPaymentsKeyMode(parse(env));
    expect(reasonOf(r)).toBe('unrecognised_key');
    expect(JSON.stringify(r)).not.toContain('opaque-key-value');
  });

  it('never puts any part of a key in the refusal', () => {
    const env: Record<string, string> = { ...stubPaymentsEnv('stripe:card', 'live'), PAYMENTS_KEY_MODE: 'test' };
    const refusal = assertPaymentsKeyMode(parse(env));
    expect(reasonOf(refusal)).toBe('key_mode_mismatch');
    const serialised = JSON.stringify(refusal);
    expect(serialised).not.toContain('sk_live');
    expect(serialised).not.toContain(env[paymentSecretKeyVar('stripe')]);
  });

  it('passes an already invalid result through unchanged', () => {
    const invalid = parse({ PAYMENTS_PROVIDERS: 'paypal:card' });
    expect(assertPaymentsKeyMode(invalid)).toBe(invalid);
  });
});
