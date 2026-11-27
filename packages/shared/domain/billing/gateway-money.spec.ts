import { describe, expect, it } from 'vitest';
import { Entities } from '../../types/entities';
import { PAYMENT_METHOD_NAMES, PAYMENT_PROVIDER_NAMES } from '../../ports/i-payment-gateway';
import {
  DecimalAmountError,
  PAYMENT_PROVIDER_CAPABILITIES,
  buildGatewayReference,
  decimalToMinor,
  isPaymentMethodName,
  isPaymentProviderName,
  providerCanSettle,
  providerDashboardUrl,
  providerMethodsForCurrency,
  providerSupportsCurrency,
  splitGatewayReference,
} from './gateway-money';

describe('decimalToMinor', () => {
  describe('exponent 2 (BRL)', () => {
    it('converts a full decimal', () => {
      expect(decimalToMinor('180.50', 2)).toBe(18050);
    });

    it('pads a whole amount', () => {
      expect(decimalToMinor('180', 2)).toBe(18000);
    });

    it('pads a short fraction', () => {
      expect(decimalToMinor('180.5', 2)).toBe(18050);
    });

    it('keeps sub-unit amounts and zero', () => {
      expect(decimalToMinor('0.01', 2)).toBe(1);
      expect(decimalToMinor('0.00', 2)).toBe(0);
      expect(decimalToMinor('0', 2)).toBe(0);
    });

    it('is exact where binary floating point is not', () => {
      // 1.15 * 100 is 114.99999999999999 and 0.29 * 100 is 28.999999999999996.
      expect(decimalToMinor('1.15', 2)).toBe(115);
      expect(decimalToMinor('0.29', 2)).toBe(29);
      expect(decimalToMinor('4.35', 2)).toBe(435);
    });

    it('accepts leading zeros on the whole part', () => {
      expect(decimalToMinor('007.50', 2)).toBe(750);
    });
  });

  describe('exponent 0 (JPY)', () => {
    it('passes an integer through', () => {
      expect(decimalToMinor('1500', 0)).toBe(1500);
    });

    it('refuses any fraction digit, even a zero', () => {
      expect(() => decimalToMinor('1500.0', 0)).toThrow(DecimalAmountError);
      expect(() => decimalToMinor('1500.5', 0)).toThrow(DecimalAmountError);
    });
  });

  describe('exponent 8 (BTC)', () => {
    it('converts eight fraction digits exactly', () => {
      expect(decimalToMinor('0.00100000', 8)).toBe(100000);
      expect(decimalToMinor('0.00000001', 8)).toBe(1);
      expect(decimalToMinor('21.12345678', 8)).toBe(2112345678);
    });

    it('pads a short fraction and a whole amount', () => {
      expect(decimalToMinor('0.001', 8)).toBe(100000);
      expect(decimalToMinor('1', 8)).toBe(100000000);
    });

    it('refuses a ninth fraction digit', () => {
      expect(() => decimalToMinor('0.000000001', 8)).toThrow(DecimalAmountError);
    });
  });

  describe('refusals', () => {
    it('refuses more fraction digits than the exponent', () => {
      expect(() => decimalToMinor('180.505', 2)).toThrow(/more fraction digits/);
      expect(() => decimalToMinor('180.500', 2)).toThrow(DecimalAmountError);
    });

    it.each(['-1.00', '+1.00', '1.00-'])('refuses a sign: %j', (input) => {
      expect(() => decimalToMinor(input, 2)).toThrow(DecimalAmountError);
    });

    it.each(['', ' ', '   ', '\t', ' 1.00', '1.00 ', '1 000.00', '1.00\n'])(
      'refuses a blank or whitespace: %j',
      (input) => {
        expect(() => decimalToMinor(input, 2)).toThrow(DecimalAmountError);
      },
    );

    it.each(['1,50', '1.000,50', '1,000.50', "1'000.50", '1_000.50', '1.2.3'])(
      'refuses a separator: %j',
      (input) => {
        expect(() => decimalToMinor(input, 2)).toThrow(DecimalAmountError);
      },
    );

    it.each(['1e3', '1E3', '1e-2', '0x10', 'NaN', 'Infinity', 'abc', 'R$ 10.00', '10.00 BRL', '１０'])(
      'refuses a non-digit: %j',
      (input) => {
        expect(() => decimalToMinor(input, 2)).toThrow(DecimalAmountError);
      },
    );

    it.each(['.50', '180.', '.'])('refuses a decimal point with a missing side: %j', (input) => {
      expect(() => decimalToMinor(input, 2)).toThrow(DecimalAmountError);
    });

    it('refuses a value that is not a string', () => {
      expect(() => decimalToMinor(180.5 as unknown as string, 2)).toThrow(DecimalAmountError);
      expect(() => decimalToMinor(null as unknown as string, 2)).toThrow(DecimalAmountError);
    });

    it('refuses an amount beyond the largest safe integer', () => {
      expect(decimalToMinor('90071992547409.91', 2)).toBe(Number.MAX_SAFE_INTEGER);
      expect(() => decimalToMinor('90071992547409.92', 2)).toThrow(DecimalAmountError);
      expect(() => decimalToMinor('99999999999999999999', 0)).toThrow(DecimalAmountError);
    });

    it.each([-1, 1.5, 19, Number.NaN])('refuses a bad exponent as a RangeError: %j', (exponent) => {
      expect(() => decimalToMinor('1', exponent)).toThrow(RangeError);
    });
  });
});

describe('provider capability table', () => {
  it('has exactly one row per provider name', () => {
    expect(Object.keys(PAYMENT_PROVIDER_CAPABILITIES).sort()).toEqual([...PAYMENT_PROVIDER_NAMES].sort());
  });

  it('lists only known methods', () => {
    for (const provider of PAYMENT_PROVIDER_NAMES) {
      for (const methods of Object.values(PAYMENT_PROVIDER_CAPABILITIES[provider].methodsByCurrency)) {
        expect(methods.length).toBeGreaterThan(0);
        for (const method of methods) expect(PAYMENT_METHOD_NAMES).toContain(method);
      }
    }
  });

  it.each(PAYMENT_PROVIDER_NAMES)('%s settles pix and card in BRL', (provider) => {
    expect(providerCanSettle(provider, 'pix', 'BRL')).toBe(true);
    expect(providerCanSettle(provider, 'card', 'BRL')).toBe(true);
    expect(providerSupportsCurrency(provider, 'BRL')).toBe(true);
  });

  it.each(PAYMENT_PROVIDER_NAMES)('%s refuses a method the table does not list', (provider) => {
    for (const method of ['other', 'gateway', 'cash', 'bank_transfer', 'PIX', '', 'toString']) {
      expect(providerCanSettle(provider, method, 'BRL')).toBe(false);
    }
  });

  it.each(PAYMENT_PROVIDER_NAMES)('%s refuses a currency the table does not list', (provider) => {
    for (const currency of ['USD', 'JPY', 'BTC', 'brl', '', 'toString', '__proto__', 'constructor']) {
      expect(providerSupportsCurrency(provider, currency)).toBe(false);
      expect(providerMethodsForCurrency(provider, currency)).toEqual([]);
      for (const method of PAYMENT_METHOD_NAMES) {
        expect(providerCanSettle(provider, method, currency)).toBe(false);
      }
    }
  });

  it('refuses an unknown provider', () => {
    for (const provider of ['paypal', 'Stripe', '', 'none', 'toString', '__proto__']) {
      expect(providerCanSettle(provider, 'pix', 'BRL')).toBe(false);
      expect(providerSupportsCurrency(provider, 'BRL')).toBe(false);
      expect(providerMethodsForCurrency(provider, 'BRL')).toEqual([]);
    }
  });

  it('cannot be mutated', () => {
    expect(Object.isFrozen(PAYMENT_PROVIDER_CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(PAYMENT_PROVIDER_CAPABILITIES.mercadopago.methodsByCurrency)).toBe(true);
    expect(Object.isFrozen(PAYMENT_PROVIDER_CAPABILITIES.mercadopago.methodsByCurrency.BRL)).toBe(true);
  });

  // M30 Task 05: the row as checked against the sandbox. `pix` is listed on RFC
  // 0026 R7's authority (unverified there); no stable dashboard URL is known.
  it('pins the Mercado Pago row: BRL with pix, card and boleto, and no dashboard link', () => {
    expect(PAYMENT_PROVIDER_CAPABILITIES.mercadopago.methodsByCurrency).toEqual({ BRL: ['pix', 'card', 'boleto'] });
    expect(PAYMENT_PROVIDER_CAPABILITIES.mercadopago.dashboardUrlTemplate).toBeNull();
    expect(providerDashboardUrl('mercadopago', '191926322032')).toBeNull();
  });

  it('narrows provider and method names', () => {
    expect(isPaymentProviderName('mercadopago')).toBe(true);
    expect(isPaymentProviderName('paypal')).toBe(false);
    expect(isPaymentProviderName(undefined)).toBe(false);
    expect(isPaymentMethodName('boleto')).toBe(true);
    expect(isPaymentMethodName('other')).toBe(false);
    expect(isPaymentMethodName(3)).toBe(false);
  });

  describe('dashboard URL template', () => {
    it('is null or an https URL holding the {id} placeholder exactly once', () => {
      for (const provider of PAYMENT_PROVIDER_NAMES) {
        const template = PAYMENT_PROVIDER_CAPABILITIES[provider].dashboardUrlTemplate;
        if (template === null) continue;
        expect(template.startsWith('https://')).toBe(true);
        expect(template.split('{id}')).toHaveLength(2);
      }
    });

    it('builds a link from a template and encodes the id', () => {
      expect(providerDashboardUrl('stripe', 'pi_3Q')).toBe('https://dashboard.stripe.com/payments/pi_3Q');
      expect(providerDashboardUrl('stripe', 'a/b?c')).toBe('https://dashboard.stripe.com/payments/a%2Fb%3Fc');
    });

    it('answers null without a template, for an unknown provider or an empty id', () => {
      for (const provider of PAYMENT_PROVIDER_NAMES) {
        if (PAYMENT_PROVIDER_CAPABILITIES[provider].dashboardUrlTemplate === null) {
          expect(providerDashboardUrl(provider, '123')).toBeNull();
        }
      }
      expect(providerDashboardUrl('paypal', '123')).toBeNull();
      expect(providerDashboardUrl('stripe', '')).toBeNull();
    });
  });
});

describe('gateway references', () => {
  it.each(PAYMENT_PROVIDER_NAMES)('round-trips a %s id', (provider) => {
    const reference = buildGatewayReference(provider, '1327');
    expect(reference).toBe(`${provider}:1327`);
    expect(splitGatewayReference(reference)).toEqual({ provider, id: '1327' });
  });

  it('round-trips an id that itself contains a colon', () => {
    const reference = buildGatewayReference('asaas', 'pay:0001:refund');
    expect(reference).toBe('asaas:pay:0001:refund');
    expect(splitGatewayReference(reference)).toEqual({ provider: 'asaas', id: 'pay:0001:refund' });
  });

  it('keeps ids that only differ by provider apart', () => {
    expect(buildGatewayReference('stripe', '42')).not.toBe(buildGatewayReference('mercadopago', '42'));
  });

  it.each([
    'receipt 0042',
    '1327',
    ':1327',
    'mercadopago:',
    'paypal:1327',
    'MercadoPago:1327',
    ' mercadopago:1327',
    '',
  ])('does not read a free-form reference as a gateway one: %j', (reference) => {
    expect(splitGatewayReference(reference)).toBeNull();
  });

  it('answers null for a missing reference', () => {
    expect(splitGatewayReference(null)).toBeNull();
    expect(splitGatewayReference(undefined)).toBeNull();
  });

  it('refuses to build from an unknown provider or an empty id', () => {
    expect(() => buildGatewayReference('paypal' as never, '1')).toThrow(/unknown provider/);
    expect(() => buildGatewayReference('stripe', '')).toThrow(/non-empty/);
  });
});

describe('shared enums the gateway adds', () => {
  it('has the system user status and the reconcile job name', () => {
    expect(Entities.Config.UserStatus.SYSTEM).toBe('system');
    expect(Entities.Config.JobName.RECONCILE_PAYMENTS).toBe('reconcile_payments');
  });

  it('mirrors the CHECK lists of RFC 0026 section 2', () => {
    expect(Object.values(Entities.Config.CheckoutStatus)).toEqual([
      'open',
      'paid',
      'expired',
      'cancelled',
      'failed',
      'mismatch',
    ]);
    expect(Object.values(Entities.Config.GatewayEventOutcome)).toEqual([
      'received',
      'applied',
      'duplicate',
      'ignored',
      'orphan',
      'mismatch',
      'failed',
    ]);
  });
});
