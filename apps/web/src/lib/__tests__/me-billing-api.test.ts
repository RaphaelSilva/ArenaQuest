import { describe, it, expect, vi } from 'vitest';
import { createMeBillingApi, MeBillingApiError, CHECKOUT_RETRY_DELAY_MS } from '../me-billing-api';
import type { CheckoutErrorKind } from '../me-billing-api';
import type { HttpTransport } from '../api-client';

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const SESSION = {
  checkoutId: 'co1',
  provider: 'mercadopago',
  url: 'https://pay.example.test/co1',
  expiresAt: '2026-11-27T14:03:00.000Z',
  amountMinor: 15000,
  currency: 'BRL',
  status: 'open',
};

function apiWith(...replies: Response[]) {
  const http = vi.fn();
  for (const r of replies) http.mockResolvedValueOnce(r);
  const wait = vi.fn(async () => {});
  return { http, wait, api: createMeBillingApi(http as unknown as HttpTransport, { wait }) };
}

async function refusal(run: () => Promise<unknown>): Promise<MeBillingApiError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof MeBillingApiError) return err;
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('createMeBillingApi — the statement', () => {
  it('asks for the caller statement with no parameter', async () => {
    const { http, api } = apiWith(reply(200, { payOptions: [] }));
    await api.getMyStatement();
    expect(http).toHaveBeenCalledWith('GET', '/me/billing');
  });

  it('throws the API code on a failure', async () => {
    const { api } = apiWith(reply(500, { error: 'BOOM' }));
    const err = await refusal(() => api.getMyStatement());
    expect(err.code).toBe('BOOM');
    expect(err.status).toBe(500);
  });
});

describe('createMeBillingApi — createCheckout', () => {
  it('posts only kind and id when no provider is named', async () => {
    const { http, api } = apiWith(reply(201, SESSION));
    const session = await api.createCheckout({ kind: 'invoice', id: 'inv1' });
    expect(session).toEqual(SESSION);
    expect(http).toHaveBeenCalledTimes(1);
    expect(http).toHaveBeenCalledWith('POST', '/me/billing/checkouts', {
      body: JSON.stringify({ kind: 'invoice', id: 'inv1' }),
    });
  });

  it('sends the chosen provider and accepts the reused checkout (200)', async () => {
    const { http, api } = apiWith(reply(200, SESSION));
    await api.createCheckout({ kind: 'event_charge', id: 'ch1', provider: 'stripe' });
    expect(http).toHaveBeenCalledWith('POST', '/me/billing/checkouts', {
      body: JSON.stringify({ kind: 'event_charge', id: 'ch1', provider: 'stripe' }),
    });
  });

  it('never forwards a key the strict body would refuse', async () => {
    const { http, api } = apiWith(reply(201, SESSION));
    await api.createCheckout({ kind: 'invoice', id: 'inv1', userId: 'someone-else' } as never);
    expect(JSON.parse(http.mock.calls[0][2].body)).toEqual({ kind: 'invoice', id: 'inv1' });
  });

  it('retries a lost creation race exactly once, after a wait', async () => {
    const { http, wait, api } = apiWith(
      reply(409, { error: 'CHECKOUT_IN_PROGRESS' }),
      reply(200, SESSION),
    );
    await expect(api.createCheckout({ kind: 'invoice', id: 'inv1' })).resolves.toEqual(SESSION);
    expect(http).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(CHECKOUT_RETRY_DELAY_MS);
  });

  it('gives up after the single retry', async () => {
    const { http, api } = apiWith(
      reply(409, { error: 'CHECKOUT_IN_PROGRESS' }),
      reply(409, { error: 'CHECKOUT_IN_PROGRESS' }),
    );
    const err = await refusal(() => api.createCheckout({ kind: 'invoice', id: 'inv1' }));
    expect(err.checkoutKind).toBe('in_progress');
    expect(http).toHaveBeenCalledTimes(2);
  });

  const cases: Array<[number, string, CheckoutErrorKind, boolean]> = [
    [409, 'RECEIVABLE_NOT_PAYABLE', 'not_payable', true],
    [409, 'PAYMENTS_UNSUPPORTED_CURRENCY', 'not_payable', true],
    [502, 'PAYMENTS_PROVIDER_ERROR', 'provider_unavailable', false],
    [429, 'TooManyRequests', 'too_many_attempts', false],
    [500, 'PAYMENTS_CONFIG_INVALID', 'configuration', false],
    [400, 'PAYMENT_PROVIDER_REQUIRED', 'provider_required', true],
    [404, 'NotFound', 'not_found', true],
    [400, 'ValidationError', 'unknown', false],
  ];

  it.each(cases)('maps %i %s to "%s"', async (status, code, kind, stale) => {
    const { http, api } = apiWith(reply(status, { error: code }));
    const err = await refusal(() => api.createCheckout({ kind: 'invoice', id: 'inv1' }));
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
    expect(err.checkoutKind).toBe(kind);
    expect(err.statementIsStale).toBe(stale);
    // Only the lost race is ever retried.
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('carries Retry-After from a 429', async () => {
    const { api } = apiWith(reply(429, { error: 'TooManyRequests' }, { 'Retry-After': '120' }));
    const err = await refusal(() => api.createCheckout({ kind: 'invoice', id: 'inv1' }));
    expect(err.retryAfterSeconds).toBe(120);
  });

  it('reads a body-less failure as unknown', async () => {
    const http = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.reject(new Error('not json')),
    });
    const api = createMeBillingApi(http as unknown as HttpTransport);
    const err = await refusal(() => api.createCheckout({ kind: 'invoice', id: 'inv1' }));
    expect(err.code).toBe('CHECKOUT_CREATE_FAILED');
    expect(err.checkoutKind).toBe('unknown');
    expect(err.retryAfterSeconds).toBeNull();
  });
});

describe('createMeBillingApi — getCheckout', () => {
  it('reads one checkout by id', async () => {
    const status = { checkoutId: 'co1', status: 'open' };
    const { http, api } = apiWith(reply(200, status));
    await expect(api.getCheckout('co1')).resolves.toEqual(status);
    expect(http).toHaveBeenCalledWith('GET', '/me/billing/checkouts/co1');
  });

  it('encodes the id into the path', async () => {
    const { http, api } = apiWith(reply(200, {}));
    await api.getCheckout('a/b?c');
    expect(http).toHaveBeenCalledWith('GET', '/me/billing/checkouts/a%2Fb%3Fc');
  });

  it('throws not_found for a checkout that is not the caller’s', async () => {
    const { api } = apiWith(reply(404, { error: 'NotFound' }));
    const err = await refusal(() => api.getCheckout('nope'));
    expect(err.status).toBe(404);
    expect(err.checkoutKind).toBe('not_found');
  });
});
