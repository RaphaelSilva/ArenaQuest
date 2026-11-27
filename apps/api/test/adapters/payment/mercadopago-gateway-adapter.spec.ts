import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MERCADOPAGO_TIMEOUT_MS,
  MERCADOPAGO_WEBHOOK_TOLERANCE_MS,
  MercadoPagoError,
  MercadoPagoGatewayAdapter,
  MercadoPagoRefusalError,
  MercadoPagoResponseError,
  MercadoPagoTimeoutError,
  MercadoPagoUnavailableError,
  mercadoPagoGatewayFactory,
  minorToDecimal,
  quoteJsonNumbers,
} from '@api/adapters/payment/mercadopago-gateway-adapter';
import type { CreateCheckoutRequest, PaymentMethodName } from '@arenaquest/shared/ports/i-payment-gateway';
import {
  MP_EXPECTED_PAYMENTS,
  MP_FIXTURE_ACCESS_TOKEN,
  MP_FIXTURE_WEBHOOK_AT,
  MP_FIXTURE_WEBHOOK_SECRET,
  mpDelivery,
  mpFakeProvider,
  mpFixture,
  mpReply,
  signMpDelivery,
  type MpFakeProvider,
} from '../../fixtures/mercadopago';

/**
 * M30 Task 05 — the Mercado Pago adapter against the fixtures of
 * `test/fixtures/mercadopago/`. A fixture whose name starts with `derived-`
 * was never observed on the sandbox (see that directory's README); every
 * other one is a scrubbed raw response.
 */

function adapter(provider: MpFakeProvider, options: { now?: Date; timeoutMs?: number; webhookSecret?: string } = {}) {
  return new MercadoPagoGatewayAdapter({
    secretKey: MP_FIXTURE_ACCESS_TOKEN,
    webhookSecret: options.webhookSecret ?? MP_FIXTURE_WEBHOOK_SECRET,
    fetch: provider.fetch,
    now: () => options.now ?? MP_FIXTURE_WEBHOOK_AT,
    timeoutMs: options.timeoutMs,
  });
}

/** Catches the error of a call that must fail. */
async function failure(call: Promise<unknown>): Promise<MercadoPagoError> {
  try {
    await call;
  } catch (error) {
    expect(error).toBeInstanceOf(MercadoPagoError);
    return error as MercadoPagoError;
  }
  throw new Error('the call was expected to fail');
}

/** Nothing free-form and no credential may ride on an error. */
function expectClean(error: MercadoPagoError, ...forbidden: string[]): void {
  const surface = `${error.name} ${error.message} ${JSON.stringify(error)} ${String(error.stack)}`;
  for (const text of [MP_FIXTURE_ACCESS_TOKEN, MP_FIXTURE_WEBHOOK_SECRET, ...forbidden]) {
    expect(surface).not.toContain(text);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Money: decimals in and out without a float
// ---------------------------------------------------------------------------

describe('quoteJsonNumbers', () => {
  it('turns every number token into a string holding the same characters', () => {
    expect(quoteJsonNumbers('{"a":12.34,"b":1000,"c":180.5,"d":[0,-1,2.50],"e":1e3}')).toBe(
      '{"a":"12.34","b":"1000","c":"180.5","d":["0","-1","2.50"],"e":"1e3"}',
    );
  });

  it('leaves strings alone, digits, quotes and escapes included', () => {
    const json = '{"title":"R$ 12.34 \\"x\\" 5\\\\","n":7,"empty":"","t":true,"z":null}';
    expect(quoteJsonNumbers(json)).toBe('{"title":"R$ 12.34 \\"x\\" 5\\\\","n":"7","empty":"","t":true,"z":null}');
    expect(JSON.parse(quoteJsonNumbers(json))).toEqual({ title: 'R$ 12.34 "x" 5\\', n: '7', empty: '', t: true, z: null });
  });

  it('keeps ids beyond the float-safe range intact', () => {
    expect(JSON.parse(quoteJsonNumbers('{"id":90071992547409931234}')).id).toBe('90071992547409931234');
  });

  it('keeps every number of a recorded payment as the provider wrote it', () => {
    const parsed = JSON.parse(quoteJsonNumbers(mpFixture('payment-refunded')));
    expect(parsed.transaction_amount).toBe('12.34');
    expect(parsed.id).toBe('191919776844');
    expect(parsed.refunds.map((r: { amount: string }) => r.amount)).toEqual(['2.34', '10']);
    expect(parsed.live_mode).toBe(true);
    expect(parsed.date_of_expiration).toBeNull();
  });
});

describe('minorToDecimal', () => {
  it.each([
    [1234, 2, '12.34'],
    [100000, 2, '1000.00'],
    [18050, 2, '180.50'],
    [5, 2, '0.05'],
    [50, 2, '0.50'],
    [1234, 0, '1234'],
    [1, 8, '0.00000001'],
  ])('%i minor units at exponent %i is %s', (minor, exponent, decimal) => {
    expect(minorToDecimal(minor, exponent)).toBe(decimal);
  });

  it.each([0, -1, 12.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2])('refuses %s', value => {
    expect(() => minorToDecimal(value, 2)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// createCheckout
// ---------------------------------------------------------------------------

const CHECKOUT: CreateCheckoutRequest = {
  checkoutId: '0f6b1c2e-5a4d-4e8b-9c1a-2b3c4d5e6f70',
  amountMinor: 18050,
  currency: 'BRL',
  description: 'Mensalidade 2026-11',
  payer: { id: 'user-1', email: 'student@example.invalid', name: 'Aluno Teste' },
  methods: ['card'],
  returnUrls: {
    success: 'https://example.com/settings/billing?checkout=x&outcome=success',
    cancel: 'https://example.com/settings/billing?checkout=x&outcome=cancel',
  },
  expiresAt: '2026-11-28T13:46:28.231Z',
};

/** The body this adapter sent to the sandbox when `preference-created.json` was recorded. */
const RECORDED_PREFERENCE_REQUEST =
  '{"items":[{"id":"0f6b1c2e-5a4d-4e8b-9c1a-2b3c4d5e6f70","title":"Mensalidade 2026-11","quantity":1,"currency_id":"BRL","unit_price":180.50}],' +
  '"payer":{"email":"student@example.invalid","name":"Aluno Teste"},' +
  '"external_reference":"0f6b1c2e-5a4d-4e8b-9c1a-2b3c4d5e6f70","metadata":{"checkout_id":"0f6b1c2e-5a4d-4e8b-9c1a-2b3c4d5e6f70"},' +
  '"back_urls":{"success":"https://example.com/settings/billing?checkout=x&outcome=success","pending":"https://example.com/settings/billing?checkout=x&outcome=success","failure":"https://example.com/settings/billing?checkout=x&outcome=cancel"},' +
  '"payment_methods":{"excluded_payment_types":[{"id":"atm"},{"id":"bank_transfer"},{"id":"ticket"}],"installments":1},' +
  '"expires":true,"expiration_date_to":"2026-11-28T13:46:28.231Z"}';

describe('createCheckout', () => {
  it('opens the recorded preference: session id, hosted URL and the expiry the provider accepted', async () => {
    const mp = mpFakeProvider().on('POST', '/checkout/preferences', mpReply(201, 'preference-created'));

    const checkout = await adapter(mp).createCheckout(CHECKOUT);

    expect(checkout).toEqual({
      sessionId: '1000000001-76a3350c-d4f6-4c0c-9a76-f170d37f7775',
      url: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=1000000001-76a3350c-d4f6-4c0c-9a76-f170d37f7775',
      expiresAt: '2026-11-28T13:46:28.231Z',
    });
  });

  it('sends exactly the request that was recorded: reference, metadata, exclusions, expiry, exact decimal', async () => {
    const mp = mpFakeProvider().on('POST', '/checkout/preferences', mpReply(201, 'preference-created'));

    await adapter(mp).createCheckout(CHECKOUT);

    expect(mp.calls).toHaveLength(1);
    expect(mp.calls[0].body).toBe(RECORDED_PREFERENCE_REQUEST);
    expect(mp.calls[0].headers).toEqual({
      Authorization: `Bearer ${MP_FIXTURE_ACCESS_TOKEN}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Idempotency-Key': CHECKOUT.checkoutId,
    });
    // The checkout id comes back on the preference the provider stored.
    const stored = JSON.parse(mpFixture('preference-created'));
    expect(stored.external_reference).toBe(CHECKOUT.checkoutId);
    expect(stored.metadata).toEqual({ checkout_id: CHECKOUT.checkoutId });
  });

  it.each<[PaymentMethodName[], string[]]>([
    [['card'], ['atm', 'bank_transfer', 'ticket']],
    [['pix'], ['atm', 'credit_card', 'debit_card', 'prepaid_card', 'ticket']],
    [['boleto'], ['atm', 'bank_transfer', 'credit_card', 'debit_card', 'prepaid_card']],
    [['pix', 'card'], ['atm', 'ticket']],
    [['pix', 'card', 'boleto'], ['atm']],
  ])('offers %j and excludes every other payment type', async (methods, excluded) => {
    const mp = mpFakeProvider().on('POST', '/checkout/preferences', mpReply(201, 'preference-created'));

    await adapter(mp).createCheckout({ ...CHECKOUT, methods });

    const sent = JSON.parse(mp.calls[0].body ?? '{}');
    const ids = (sent.payment_methods.excluded_payment_types as Array<{ id: string }>).map(t => t.id).sort();
    expect(ids).toEqual(excluded);
  });

  it.each([
    [1234, '"unit_price":12.34}'],
    [100000, '"unit_price":1000.00}'],
    [18050, '"unit_price":180.50}'],
    [5, '"unit_price":0.05}'],
  ])('writes %i minor units as an exact decimal literal', async (amountMinor, literal) => {
    const mp = mpFakeProvider().on('POST', '/checkout/preferences', mpReply(201, 'preference-created'));

    await adapter(mp).createCheckout({ ...CHECKOUT, amountMinor });

    expect(mp.calls[0].body).toContain(literal);
  });

  it('cannot be tricked by a description that looks like the amount placeholder', async () => {
    const mp = mpFakeProvider().on('POST', '/checkout/preferences', mpReply(201, 'preference-created'));
    const description = 'x"@@unit_price@@"y';

    await adapter(mp).createCheckout({ ...CHECKOUT, description });

    const sent = JSON.parse(mp.calls[0].body ?? '{}');
    expect(sent.items[0].title).toBe(description);
    expect(sent.items[0].unit_price).toBe(180.5);
  });

  it('reports the earlier expiry when the provider grants less than was asked', async () => {
    const granted = mpFixture('preference-created').replace(
      '"expiration_date_to":"2026-11-28T13:46:28.231+00:00"',
      '"expiration_date_to":"2026-11-27T20:00:00.000-04:00"',
    );
    const mp = mpFakeProvider().on('POST', '/checkout/preferences', { status: 201, body: granted });

    expect((await adapter(mp).createCheckout(CHECKOUT)).expiresAt).toBe('2026-11-28T00:00:00.000Z');
  });

  it('falls back to the requested expiry when the provider reports none', async () => {
    // Recorded: a preference created without an expiry answers `expiration_date_to: null`.
    const mp = mpFakeProvider().on('POST', '/checkout/preferences', mpReply(201, 'preference-paid-card'));

    expect((await adapter(mp).createCheckout(CHECKOUT)).expiresAt).toBe(CHECKOUT.expiresAt);
  });

  it('records that the provider does NOT de-duplicate preferences on the idempotency key', () => {
    // Same key, same body, sent twice to the sandbox: two different preferences.
    const first = JSON.parse(mpFixture('preference-same-key-first'));
    const second = JSON.parse(mpFixture('preference-same-key-second'));
    expect(first.id).not.toBe(second.id);
    // Harmless: both name the same checkout, so a payment on either finds it.
    expect(first.external_reference).toBe(second.external_reference);
    expect(first.metadata).toEqual(second.metadata);
  });

  it('throws a refusal carrying the status and the provider code on a 400', async () => {
    const mp = mpFakeProvider().on('POST', '/checkout/preferences', mpReply(400, 'preference-invalid-400'));

    const error = await failure(adapter(mp).createCheckout(CHECKOUT));

    expect(error).toBeInstanceOf(MercadoPagoRefusalError);
    expect(error).toMatchObject({ kind: 'refused', httpStatus: 400, code: 'invalid_items', retryable: false });
    expect(error.name).toBe('MercadoPagoRefusalError');
    expectClean(error, 'items needed');
  });

  it('refuses a currency it does not charge before calling the provider', async () => {
    const mp = mpFakeProvider();

    await expect(adapter(mp).createCheckout({ ...CHECKOUT, currency: 'USD' })).rejects.toBeInstanceOf(RangeError);
    expect(mp.calls).toEqual([]);
  });

  it('fails when the provider answers 2xx without a session', async () => {
    const mp = mpFakeProvider().on('POST', '/checkout/preferences', { status: 201, body: '{"id":"","init_point":null}' });

    expect(await failure(adapter(mp).createCheckout(CHECKOUT))).toBeInstanceOf(MercadoPagoResponseError);
  });
});

// ---------------------------------------------------------------------------
// getPayment
// ---------------------------------------------------------------------------

describe('getPayment', () => {
  it.each(Object.keys(MP_EXPECTED_PAYMENTS))('maps %s', async name => {
    const expected = MP_EXPECTED_PAYMENTS[name];
    const mp = mpFakeProvider().on('GET', `/v1/payments/${expected.id}`, mpReply(200, name));

    const payment = await adapter(mp).getPayment(expected.id);

    expect(payment).toEqual(expected);
    expect(Number.isInteger(payment?.amountMinor)).toBe(true);
    for (const refund of payment?.refunds ?? []) expect(Number.isInteger(refund.amountMinor)).toBe(true);
    expect(mp.calls).toHaveLength(1);
    expect(mp.calls[0].headers.Authorization).toBe(`Bearer ${MP_FIXTURE_ACCESS_TOKEN}`);
  });

  it('covers every case the task names', () => {
    const statuses = Object.fromEntries(Object.entries(MP_EXPECTED_PAYMENTS).map(([name, p]) => [name, `${p.status}/${p.method}`]));
    expect(statuses).toMatchObject({
      'derived-payment-approved-pix': 'paid/pix',
      'payment-approved-card': 'paid/card',
      'payment-pending-boleto': 'pending/boleto',
      'derived-payment-rejected-card': 'failed/card',
      'payment-partially-refunded': 'paid/other',
      'payment-refunded': 'refunded/other',
      'derived-payment-charged-back': 'disputed/card',
    });
  });

  it('keeps a partially refunded payment paid, and a fully refunded one whole', async () => {
    const partial = MP_EXPECTED_PAYMENTS['payment-partially-refunded'];
    const full = MP_EXPECTED_PAYMENTS['payment-refunded'];
    expect(partial.status).toBe('paid');
    expect(partial.refunds).toHaveLength(1);
    expect(full.status).toBe('refunded');
    // Two refunds, oldest first, adding up to exactly what was captured.
    expect(full.refunds.map(r => r.amountMinor)).toEqual([234, 1000]);
    expect(full.refunds.reduce((sum, r) => sum + r.amountMinor, 0)).toBe(full.amountMinor);
    // A refund id never equals the payment id.
    for (const refund of full.refunds) expect(refund.id).not.toBe(full.id);
  });

  it('answers null for an id the provider does not know (recorded 404)', async () => {
    const mp = mpFakeProvider().on('GET', '/v1/payments/999999999999', mpReply(404, 'payment-unknown-404'));

    expect(await adapter(mp).getPayment('999999999999')).toBeNull();
  });

  it.each(['', 'abc', '12 34', '../v1/users/me', '191926322032?x=1', '１２３'])(
    'answers null for %j without calling the provider',
    async id => {
      const mp = mpFakeProvider();

      expect(await adapter(mp).getPayment(id)).toBeNull();
      expect(mp.calls).toEqual([]);
    },
  );

  it.each([
    ['12.34', 1234],
    ['1000', 100000],
    ['180.5', 18050],
    ['0.1', 10],
    ['1000.00', 100000],
    ['0.07', 7],
    ['4.35', 435],
    ['1.15', 115],
  ])('reads transaction_amount %s as %i minor units, from the characters of the response', async (literal, minor) => {
    const body = mpFixture('payment-approved-card').replace('"transaction_amount":12.34,', `"transaction_amount":${literal},`);
    expect(body).toContain(`"transaction_amount":${literal},`);
    const mp = mpFakeProvider().on('GET', '/v1/payments/191926322032', { status: 200, body });

    expect((await adapter(mp).getPayment('191926322032'))?.amountMinor).toBe(minor);
  });

  it.each([
    ['more fraction digits than the currency allows', 'derived-payment-three-decimals'],
    ['a currency this adapter does not charge', 'derived-payment-usd'],
  ])('fails, never rounds, on %s', async (_label, name) => {
    const mp = mpFakeProvider().on('GET', '/v1/payments/191926322032', mpReply(200, name));

    const error = await failure(adapter(mp).getPayment('191926322032'));

    expect(error).toBeInstanceOf(MercadoPagoResponseError);
    expect(error).toMatchObject({ kind: 'invalid_response', httpStatus: 200, retryable: false });
  });

  it.each(['1e3', '-12.34', '12.340'])('fails on the amount literal %s', async literal => {
    const body = mpFixture('payment-approved-card').replace('"transaction_amount":12.34,', `"transaction_amount":${literal},`);
    const mp = mpFakeProvider().on('GET', '/v1/payments/191926322032', { status: 200, body });

    expect(await failure(adapter(mp).getPayment('191926322032'))).toBeInstanceOf(MercadoPagoResponseError);
  });

  it('fails on a status it does not know rather than guessing one', async () => {
    const body = mpFixture('payment-approved-card').replace('"status":"approved","status_detail":"accredited"', '"status":"teleported","status_detail":"accredited"');
    const mp = mpFakeProvider().on('GET', '/v1/payments/191926322032', { status: 200, body });

    expect(await failure(adapter(mp).getPayment('191926322032'))).toBeInstanceOf(MercadoPagoResponseError);
  });

  it('ignores a refund that is not approved', async () => {
    const body = mpFixture('payment-partially-refunded').replace('"status":"approved","transaction_references"', '"status":"in_process","transaction_references"');
    expect(body).not.toBe(mpFixture('payment-partially-refunded'));
    const mp = mpFakeProvider().on('GET', '/v1/payments/191919776844', { status: 200, body });

    expect((await adapter(mp).getPayment('191919776844'))?.refunds).toEqual([]);
  });

  it('reads the back-reference from metadata when the payment carries no external_reference', async () => {
    const body = mpFixture('payment-approved-card').replace('"external_reference":"aqrec-1795785192-E-card-approved"', '"external_reference":null');
    const mp = mpFakeProvider().on('GET', '/v1/payments/191926322032', { status: 200, body });

    expect((await adapter(mp).getPayment('191926322032'))?.checkoutId).toBe('aqrec-1795785192-E-card-approved');
  });

  it('throws a refusal on the recorded 401 (a bad access token), with code 5 and no body', async () => {
    const mp = mpFakeProvider().on('GET', '/v1/payments/191926322032', mpReply(401, 'payment-unauthorized-401'));

    const error = await failure(adapter(mp).getPayment('191926322032'));

    expect(error).toMatchObject({ name: 'MercadoPagoRefusalError', kind: 'refused', httpStatus: 401, code: '5' });
    expectClean(error, 'Must provide your access_token');
  });
});

// ---------------------------------------------------------------------------
// findPaymentsForCheckout
// ---------------------------------------------------------------------------

describe('findPaymentsForCheckout', () => {
  const SESSION = '1000000001-deaaa0c1-cce7-4556-a775-9cea42b239ef';
  const SEARCH = '/v1/payments/search?external_reference=aqrec-1795785192-E-card-approved';

  it('finds the payment made on a preference: the preference names the reference, the search filters on it', async () => {
    const mp = mpFakeProvider()
      .on('GET', `/checkout/preferences/${SESSION}`, mpReply(200, 'preference-paid-card'))
      .on('GET', SEARCH, mpReply(200, 'search-by-reference-card'));

    const payments = await adapter(mp).findPaymentsForCheckout(SESSION);

    expect(payments).toEqual([MP_EXPECTED_PAYMENTS['payment-approved-card']]);
    expect(mp.calls.map(c => `${c.method} ${c.path}`)).toEqual([`GET /checkout/preferences/${SESSION}`, `GET ${SEARCH}`]);
  });

  it('finds a pending boleto the same way', async () => {
    const body = mpFixture('preference-paid-card').replace('aqrec-1795785192-E-card-approved', 'aqrec-1795785652-G-boleto-pending');
    const mp = mpFakeProvider()
      .on('GET', `/checkout/preferences/${SESSION}`, { status: 200, body })
      .on('GET', '/v1/payments/search?external_reference=aqrec-1795785652-G-boleto-pending', mpReply(200, 'search-by-reference-boleto'));

    expect(await adapter(mp).findPaymentsForCheckout(SESSION)).toEqual([MP_EXPECTED_PAYMENTS['payment-pending-boleto']]);
  });

  it('answers [] — not a throw — for a preference nobody paid (recorded empty search)', async () => {
    const mp = mpFakeProvider()
      .on('GET', `/checkout/preferences/${SESSION}`, mpReply(200, 'preference-paid-card'))
      .on('GET', SEARCH, mpReply(200, 'search-empty'));

    expect(await adapter(mp).findPaymentsForCheckout(SESSION)).toEqual([]);
  });

  it('answers [] for a preference the provider does not know (recorded 404), without searching', async () => {
    const mp = mpFakeProvider().on('GET', `/checkout/preferences/${SESSION}`, mpReply(404, 'preference-unknown-404'));

    expect(await adapter(mp).findPaymentsForCheckout(SESSION)).toEqual([]);
    expect(mp.calls).toHaveLength(1);
  });

  it('returns every payment of the session: a rejected card, then the approved one', async () => {
    const mp = mpFakeProvider()
      .on('GET', `/checkout/preferences/${SESSION}`, mpReply(200, 'preference-paid-card'))
      .on('GET', SEARCH, mpReply(200, 'derived-search-two-payments'));

    const payments = await adapter(mp).findPaymentsForCheckout(SESSION);

    expect(payments.map(p => [p.id, p.status])).toEqual([
      ['191926322101', 'failed'],
      ['191926322032', 'paid'],
    ]);
    expect(payments.every(p => p.checkoutId === 'aqrec-1795785192-E-card-approved')).toBe(true);
  });

  it('URL-encodes the reference it searches on', async () => {
    const body = mpFixture('preference-paid-card').replace('aqrec-1795785192-E-card-approved', 'a b&c=d');
    const mp = mpFakeProvider()
      .on('GET', `/checkout/preferences/${SESSION}`, { status: 200, body })
      .on('GET', '/v1/payments/search?external_reference=a%20b%26c%3Dd', mpReply(200, 'search-empty'));

    expect(await adapter(mp).findPaymentsForCheckout(SESSION)).toEqual([]);
  });

  it.each(['', 'a/b', '../x', 'id?x=1'])('answers [] for the session id %j without calling the provider', async id => {
    const mp = mpFakeProvider();

    expect(await adapter(mp).findPaymentsForCheckout(id)).toEqual([]);
    expect(mp.calls).toEqual([]);
  });

  it('propagates a provider failure so the caller asks again', async () => {
    const mp = mpFakeProvider()
      .on('GET', `/checkout/preferences/${SESSION}`, mpReply(200, 'preference-paid-card'))
      .on('GET', SEARCH, { status: 503, body: 'upstream unavailable' });

    expect(await failure(adapter(mp).findPaymentsForCheckout(SESSION))).toBeInstanceOf(MercadoPagoUnavailableError);
  });
});

// ---------------------------------------------------------------------------
// refund
// ---------------------------------------------------------------------------

describe('refund', () => {
  const PATH = '/v1/payments/191919776844/refunds';
  const KEY = 'rev:5f0c2a9e-7b1d-4c3a-9e2f-0a1b2c3d4e5f';

  it('asks for a partial refund by exact amount, with the idempotency key', async () => {
    const mp = mpFakeProvider().on('POST', PATH, mpReply(201, 'refund-partial-201'));

    const result = await adapter(mp).refund('191919776844', 234, KEY);

    expect(result).toEqual({ refundId: '3546618035' });
    expect(mp.calls[0].body).toBe('{"amount":2.34}');
    expect(mp.calls[0].headers['X-Idempotency-Key']).toBe(KEY);
    expect(mp.calls[0].headers.Authorization).toBe(`Bearer ${MP_FIXTURE_ACCESS_TOKEN}`);
  });

  it('is idempotent on the key: the recorded repeat answers the same refund id', async () => {
    const replies = [mpReply(201, 'refund-partial-201'), mpReply(201, 'refund-partial-same-key-201')];
    const mp = mpFakeProvider().on('POST', PATH, () => replies.shift() ?? new Error('unexpected third call'));
    const gateway = adapter(mp);

    const first = await gateway.refund('191919776844', 234, KEY);
    const second = await gateway.refund('191919776844', 234, KEY);

    expect(second).toEqual(first);
    expect(mp.calls.map(c => c.headers['X-Idempotency-Key'])).toEqual([KEY, KEY]);
  });

  it('refunds the rest: 1000 minor units leave as 10.00 and come back as another refund id', async () => {
    const mp = mpFakeProvider().on('POST', PATH, mpReply(201, 'refund-rest-201'));

    expect(await adapter(mp).refund('191919776844', 1000, 'rev:other')).toEqual({ refundId: '3611872278' });
    expect(mp.calls[0].body).toBe('{"amount":10.00}');
  });

  it('throws a refusal with cause code 120013 when the amount is above what is left (recorded 400)', async () => {
    const mp = mpFakeProvider().on('POST', PATH, mpReply(400, 'refund-over-balance-400'));

    const error = await failure(adapter(mp).refund('191919776844', 99999, KEY));

    expect(error).toBeInstanceOf(MercadoPagoRefusalError);
    expect(error).toMatchObject({ kind: 'refused', httpStatus: 400, code: '120013', retryable: false });
    expectClean(error, 'Refund requested amount');
  });

  it('throws a retryable provider error — not a refusal — on the recorded 429 refund_quota_exceeded', async () => {
    const mp = mpFakeProvider().on('POST', PATH, mpReply(429, 'refund-quota-429'));

    const error = await failure(adapter(mp).refund('191919776844', 234, KEY));

    expect(error).toBeInstanceOf(MercadoPagoUnavailableError);
    expect(error).not.toBeInstanceOf(MercadoPagoRefusalError);
    expect(error).toMatchObject({ kind: 'unavailable', httpStatus: 429, code: 'too_many_requests', retryable: true });
  });

  it('throws a refusal on the recorded 401 (cause code 7)', async () => {
    const mp = mpFakeProvider().on('POST', '/v1/payments/191926322032/refunds', mpReply(401, 'refund-unauthorized-401'));

    const error = await failure(adapter(mp).refund('191926322032', 1234, KEY));

    expect(error).toMatchObject({ name: 'MercadoPagoRefusalError', httpStatus: 401, code: '7' });
    expectClean(error, 'Unauthorized use of live credentials');
  });

  it('never returns a result for a 2xx that carries no refund id', async () => {
    const mp = mpFakeProvider().on('POST', PATH, { status: 201, body: '{"status":"approved"}' });

    expect(await failure(adapter(mp).refund('191919776844', 234, KEY))).toBeInstanceOf(MercadoPagoResponseError);
  });

  it('refuses a payment id that cannot exist without calling the provider', async () => {
    const mp = mpFakeProvider();

    expect(await failure(adapter(mp).refund('not-a-payment', 234, KEY))).toBeInstanceOf(MercadoPagoRefusalError);
    expect(mp.calls).toEqual([]);
  });

  it.each([0, -5, 1.5])('refuses the amount %s before any call', async amount => {
    const mp = mpFakeProvider();

    await expect(adapter(mp).refund('191919776844', amount, KEY)).rejects.toBeInstanceOf(RangeError);
    expect(mp.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Transport: 5xx, timeout, network
// ---------------------------------------------------------------------------

describe('provider failures', () => {
  const BODY_MARKER = 'BODY-MARKER-5d1e';

  it.each([500, 502, 503, 504])('a %i is a retryable provider error that carries no body', async status => {
    const mp = mpFakeProvider().on('GET', '/v1/payments/191926322032', { status, body: `<html>${BODY_MARKER}</html>` });

    const error = await failure(adapter(mp).getPayment('191926322032'));

    expect(error).toBeInstanceOf(MercadoPagoUnavailableError);
    expect(error).toMatchObject({ kind: 'unavailable', httpStatus: status, code: null, retryable: true });
    expectClean(error, BODY_MARKER);
  });

  it('a call that outlives the bound fails as a timeout the caller can tell from a refusal', async () => {
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const gateway = new MercadoPagoGatewayAdapter({
      secretKey: MP_FIXTURE_ACCESS_TOKEN,
      webhookSecret: MP_FIXTURE_WEBHOOK_SECRET,
      fetch: hang,
      timeoutMs: 20,
    });

    const error = await failure(gateway.getPayment('191926322032'));

    expect(error).toBeInstanceOf(MercadoPagoTimeoutError);
    expect(error).not.toBeInstanceOf(MercadoPagoRefusalError);
    expect(error).toMatchObject({ name: 'MercadoPagoTimeoutError', kind: 'timeout', httpStatus: null, retryable: true });
    expectClean(error);
  });

  it('the bound is 10 seconds by default: nothing at 9 999 ms, a timeout at 10 000', async () => {
    expect(MERCADOPAGO_TIMEOUT_MS).toBe(10_000);
    vi.useFakeTimers();
    let aborted = false;
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const gateway = new MercadoPagoGatewayAdapter({
      secretKey: MP_FIXTURE_ACCESS_TOKEN,
      webhookSecret: MP_FIXTURE_WEBHOOK_SECRET,
      fetch: hang,
    });
    let settled: unknown = 'pending';
    const call = gateway.refund('191926322032', 1234, 'rev:x').catch(error => {
      settled = error;
    });

    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe('pending');
    expect(aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await call;
    expect(aborted).toBe(true);
    expect(settled).toBeInstanceOf(MercadoPagoTimeoutError);
  });

  it('a body that stalls after the headers is still bounded', async () => {
    const stall: typeof fetch = async (_input, init) =>
      ({
        status: 200,
        text: () =>
          new Promise<string>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      }) as Response;
    const gateway = new MercadoPagoGatewayAdapter({
      secretKey: MP_FIXTURE_ACCESS_TOKEN,
      webhookSecret: MP_FIXTURE_WEBHOOK_SECRET,
      fetch: stall,
      timeoutMs: 20,
    });

    expect(await failure(gateway.getPayment('191926322032'))).toBeInstanceOf(MercadoPagoTimeoutError);
  });

  it('a network failure is a provider error whose message quotes nothing of the request', async () => {
    const mp = mpFakeProvider().on(
      'GET',
      '/v1/payments/191926322032',
      new TypeError(`fetch failed: Authorization: Bearer ${MP_FIXTURE_ACCESS_TOKEN}`),
    );

    const error = await failure(adapter(mp).getPayment('191926322032'));

    expect(error).toBeInstanceOf(MercadoPagoUnavailableError);
    expect(error).toMatchObject({ httpStatus: null, code: null, retryable: true });
    expect(error.cause).toBeUndefined();
    expectClean(error);
  });

  it('a 2xx that is not JSON is an invalid response, not a payment', async () => {
    const mp = mpFakeProvider().on('GET', '/v1/payments/191926322032', { status: 200, body: `<html>${BODY_MARKER}` });

    const error = await failure(adapter(mp).getPayment('191926322032'));

    expect(error).toBeInstanceOf(MercadoPagoResponseError);
    expectClean(error, BODY_MARKER);
  });

  it('drops a provider code that is not a short token', async () => {
    const body = JSON.stringify({ error: `free text ${BODY_MARKER}`, cause: [{ code: `also free ${BODY_MARKER}` }] });
    const mp = mpFakeProvider().on('GET', '/v1/payments/191926322032', { status: 400, body });

    const error = await failure(adapter(mp).getPayment('191926322032'));

    expect(error).toMatchObject({ kind: 'refused', httpStatus: 400, code: null });
    expectClean(error, BODY_MARKER);
  });
});

// ---------------------------------------------------------------------------
// verifyWebhook — DERIVED deliveries (the published x-signature scheme, a fixture-only secret)
// ---------------------------------------------------------------------------

describe('verifyWebhook', () => {
  const none = mpFakeProvider();
  const PAYMENT_ID = '191926322032';

  it('turns a good delivery into a payment event keyed on the notification id, never the payment id', async () => {
    const d = mpDelivery('derived-webhook-payment-updated');

    const event = await adapter(none).verifyWebhook(d.body, d.headers, d.query);

    expect(event).toEqual({
      kind: 'payment',
      eventId: '127381900002',
      paymentId: PAYMENT_ID,
      occurredAt: '2026-11-27T13:33:21.000Z',
    });
    expect(event?.eventId).not.toBe(PAYMENT_ID);
    // Verification asks the provider nothing.
    expect(none.calls).toEqual([]);
  });

  it('gives two deliveries about one payment two event ids', async () => {
    const created = mpDelivery('derived-webhook-payment-created');
    const updated = mpDelivery('derived-webhook-payment-updated');
    const gateway = adapter(none);

    const first = await gateway.verifyWebhook(created.body, created.headers, created.query);
    const second = await gateway.verifyWebhook(updated.body, updated.headers, updated.query);

    expect(first).toMatchObject({ kind: 'payment', paymentId: PAYMENT_ID, eventId: '127381900001' });
    expect(second).toMatchObject({ kind: 'payment', paymentId: PAYMENT_ID, eventId: '127381900002' });
  });

  it('refuses a body tampered to name another payment', async () => {
    const d = mpDelivery('derived-webhook-payment-updated');
    const body = d.body.replace(`"data":{"id":"${PAYMENT_ID}"}`, '"data":{"id":"191919776844"}');
    expect(body).not.toBe(d.body);

    expect(await adapter(none).verifyWebhook(body, d.headers, d.query)).toBeNull();
  });

  it('refuses a query tampered to name another payment', async () => {
    const d = mpDelivery('derived-webhook-payment-updated');

    expect(await adapter(none).verifyWebhook(d.body, d.headers, { ...d.query, 'data.id': '191919776844' })).toBeNull();
    // …also when the body is changed to agree with it.
    const body = d.body.replace(PAYMENT_ID, '191919776844');
    expect(await adapter(none).verifyWebhook(body, d.headers, { ...d.query, 'data.id': '191919776844' })).toBeNull();
  });

  it('refuses a tampered ts', async () => {
    const d = mpDelivery('derived-webhook-payment-updated');
    const headers = { ...d.headers, 'x-signature': d.headers['x-signature'].replace('ts=1795786401000', 'ts=1795786402000') };

    // Still inside the tolerance: it is the signature that fails, not the clock.
    expect(await adapter(none).verifyWebhook(d.body, headers, d.query)).toBeNull();
  });

  it('refuses a tampered request id and a tampered signature', async () => {
    const d = mpDelivery('derived-webhook-payment-updated');
    const flipped = d.headers['x-signature'].replace(/.$/, c => (c === '0' ? '1' : '0'));

    expect(await adapter(none).verifyWebhook(d.body, { ...d.headers, 'x-request-id': 'another-request' }, d.query)).toBeNull();
    expect(await adapter(none).verifyWebhook(d.body, { ...d.headers, 'x-signature': flipped }, d.query)).toBeNull();
  });

  it('refuses a good delivery checked against another secret', async () => {
    const d = mpDelivery('derived-webhook-payment-updated');

    expect(await adapter(none, { webhookSecret: 'whsec-of-another-provider' }).verifyWebhook(d.body, d.headers, d.query)).toBeNull();
  });

  it('refuses a delivery signed with another secret', async () => {
    const d = mpDelivery('derived-webhook-payment-updated');
    const signature = await signMpDelivery({
      dataId: PAYMENT_ID,
      requestId: d.headers['x-request-id'],
      ts: '1795786401000',
      secret: 'whsec-of-another-provider',
    });

    expect(await adapter(none).verifyWebhook(d.body, { ...d.headers, 'x-signature': signature }, d.query)).toBeNull();
  });

  it('enforces the 5-minute tolerance on ts, both ways', async () => {
    expect(MERCADOPAGO_WEBHOOK_TOLERANCE_MS).toBe(300_000);
    const d = mpDelivery('derived-webhook-payment-updated');
    const at = (offsetMs: number) => new Date(MP_FIXTURE_WEBHOOK_AT.getTime() + offsetMs);
    const verify = (now: Date) => adapter(none, { now }).verifyWebhook(d.body, d.headers, d.query);

    expect(await verify(at(300_000))).not.toBeNull();
    expect(await verify(at(300_001))).toBeNull();
    expect(await verify(at(-300_000))).not.toBeNull();
    expect(await verify(at(-300_001))).toBeNull();
    expect(await verify(at(24 * 3600_000))).toBeNull();
  });

  it('accepts a ts written in seconds as well as in milliseconds', async () => {
    const d = mpDelivery('derived-webhook-payment-updated');
    const signature = await signMpDelivery({ dataId: PAYMENT_ID, requestId: d.headers['x-request-id'], ts: '1795786401' });

    const event = await adapter(none).verifyWebhook(d.body, { ...d.headers, 'x-signature': signature }, d.query);

    expect(event).toMatchObject({ kind: 'payment', paymentId: PAYMENT_ID });
  });

  it('settles a topic it does not act on as ignored, under the notification id and the provider name for it', async () => {
    const d = mpDelivery('derived-webhook-merchant-order');

    expect(await adapter(none).verifyWebhook(d.body, d.headers, d.query)).toEqual({
      kind: 'ignored',
      eventId: '127381900003',
      type: 'topic_merchant_order_wh',
    });
  });

  it('keys an authentic delivery on its request id when the body id only repeats the payment id', async () => {
    const d = mpDelivery('derived-webhook-payment-updated');
    const body = d.body.replace('"id":127381900002', `"id":${PAYMENT_ID}`);

    const event = await adapter(none).verifyWebhook(body, d.headers, d.query);

    expect(event).toMatchObject({ kind: 'payment', paymentId: PAYMENT_ID, eventId: `request:${d.headers['x-request-id']}` });
    expect(event?.eventId).not.toBe(PAYMENT_ID);
  });

  it('an altered notification id inside the window still verifies — the id is a de-duplication aid only', async () => {
    // RFC 0026 §1 rule 4: the provider signs data.id, x-request-id and ts — not the body's id.
    const d = mpDelivery('derived-webhook-payment-updated');
    const body = d.body.replace('"id":127381900002', '"id":999');

    expect(await adapter(none).verifyWebhook(body, d.headers, d.query)).toMatchObject({ eventId: '999', paymentId: PAYMENT_ID });
  });

  it.each([
    ['no x-signature', {}],
    ['an empty x-signature', { 'x-signature': '' }],
    ['a signature with no ts', { 'x-signature': 'v1=' + 'a'.repeat(64) }],
    ['a signature with no v1', { 'x-signature': 'ts=1795786401000' }],
    ['a ts that is not a number', { 'x-signature': 'ts=soon,v1=' + 'a'.repeat(64) }],
    ['a v1 that is not a digest', { 'x-signature': 'ts=1795786401000,v1=zz' }],
    ['garbage', { 'x-signature': ',,=,=,' }],
  ])('answers null for %s', async (_label, headers) => {
    const d = mpDelivery('derived-webhook-payment-updated');

    expect(await adapter(none).verifyWebhook(d.body, { 'x-request-id': d.headers['x-request-id'], ...headers }, d.query)).toBeNull();
  });

  it.each(['', 'not json', '[]', '"text"', 'null', '{"id":', '{}'])(
    'never throws on the body %j, even when the signature is good',
    async body => {
      const d = mpDelivery('derived-webhook-payment-updated');
      const result = await adapter(none).verifyWebhook(body, d.headers, d.query);

      // `{}` is authentic and carries no notification id: keyed on the request id, and still a payment trigger.
      if (body === '{}') expect(result).toMatchObject({ eventId: `request:${d.headers['x-request-id']}` });
      else expect(result).toBeNull();
    },
  );

  it('never throws when crypto itself fails', async () => {
    const d = mpDelivery('derived-webhook-payment-updated');
    const spy = vi.spyOn(crypto.subtle, 'importKey').mockRejectedValueOnce(new Error('boom'));

    expect(await adapter(none).verifyWebhook(d.body, d.headers, d.query)).toBeNull();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// The factory, and what the fixtures may not contain
// ---------------------------------------------------------------------------

describe('mercadoPagoGatewayFactory', () => {
  it('builds the adapter from the two secrets it is handed', () => {
    const gateway = mercadoPagoGatewayFactory({
      provider: 'mercadopago',
      secretKey: MP_FIXTURE_ACCESS_TOKEN,
      webhookSecret: MP_FIXTURE_WEBHOOK_SECRET,
      keyMode: 'test',
    });

    expect(gateway).toBeInstanceOf(MercadoPagoGatewayAdapter);
    expect(gateway.provider).toBe('mercadopago');
    // Neither secret is an enumerable, serialisable part of the adapter's public face.
    expect(JSON.stringify({ provider: gateway.provider })).not.toContain(MP_FIXTURE_ACCESS_TOKEN);
  });
});

describe('the fixtures', () => {
  const files = import.meta.glob('../../fixtures/mercadopago/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

  it('are all here', () => {
    expect(Object.keys(files).filter(f => f.endsWith('.json')).length).toBe(36);
    expect(Object.keys(files).some(f => f.endsWith('/README.md'))).toBe(true);
  });

  it.each(Object.keys(files))('%s holds no access token, no test-account e-mail and no card or document number', file => {
    const text = files[file];
    expect(text).not.toMatch(/APP_USR-|TEST-[0-9]|testuser\.com/);
    for (const match of text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g) ?? []) {
      expect(match.endsWith('@example.invalid')).toBe(true);
    }
    expect(text).not.toMatch(/"(first_six_digits|last_four_digits|bin)":"(?!0+")[^"]*"/);
    expect(text).not.toMatch(/"identification":\{"number":"(?!0*")[^"]*"/);
  });

  it('names every derived file as derived, and every payment fixture has an expectation', () => {
    const names = Object.keys(files).map(f => f.split('/').pop() ?? '').filter(f => f.endsWith('.json'));
    const payments = names.filter(n => /^(derived-)?payment-/.test(n) && !/-(404|401)\.json$/.test(n)).map(n => n.replace('.json', ''));
    const unexpected = payments.filter(n => !(n in MP_EXPECTED_PAYMENTS) && !['derived-payment-usd', 'derived-payment-three-decimals'].includes(n));
    expect(unexpected).toEqual([]);
    for (const name of names.filter(n => n.startsWith('derived-webhook-'))) {
      expect(JSON.parse(files[Object.keys(files).find(f => f.endsWith(`/${name}`)) ?? '']).derived).toBe(true);
    }
  });
});
