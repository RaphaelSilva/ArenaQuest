import { describe, it, expect, vi } from 'vitest';
import { createAdminBillingApi, AdminBillingApiError } from '../admin-billing-api';
import type { HttpTransport } from '../api-client';

function makeResponse(overrides: Partial<Response> & { jsonData?: unknown } = {}): Response {
  const { jsonData, ...rest } = overrides;
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(jsonData ?? {}),
    ...rest,
  } as unknown as Response;
}

function apiWith(response: Response) {
  const http = vi.fn().mockResolvedValue(response);
  return { http, api: createAdminBillingApi(http as unknown as HttpTransport) };
}

describe('createAdminBillingApi — the roster', () => {
  it('round-trips the standing filter to the API as a query parameter', async () => {
    const { http, api } = apiWith(makeResponse({ jsonData: [] }));
    await api.students.roster({ standing: 'delinquent' });
    expect(http).toHaveBeenCalledWith('GET', '/admin/billing/students?standing=delinquent');
  });

  it('sends `standing=exempt` for the held filter — there is no second spelling', async () => {
    const { http, api } = apiWith(makeResponse({ jsonData: [] }));
    await api.students.roster({ standing: 'exempt' });
    expect(http).toHaveBeenCalledWith('GET', '/admin/billing/students?standing=exempt');
  });

  it('omits the parameter entirely when no standing is selected', async () => {
    const { http, api } = apiWith(makeResponse({ jsonData: [] }));
    await api.students.roster({});
    expect(http).toHaveBeenCalledWith('GET', '/admin/billing/students');
  });

  it('sends the two rail filters independently (RFC 0015)', async () => {
    const { http, api } = apiWith(makeResponse({ jsonData: [] }));
    await api.students.roster({ contractStanding: 'good', extrasStanding: 'delinquent' });
    expect(http).toHaveBeenCalledWith(
      'GET',
      '/admin/billing/students?contractStanding=good&extrasStanding=delinquent',
    );
    await api.students.roster({ extrasStanding: 'due' });
    expect(http).toHaveBeenLastCalledWith('GET', '/admin/billing/students?extrasStanding=due');
  });
});

describe('createAdminBillingApi — aging rail', () => {
  it('omits `rail` when none is given, so the server ages the contract rail', async () => {
    const { http, api } = apiWith(makeResponse({ jsonData: {} }));
    await api.reports.aging();
    expect(http).toHaveBeenCalledWith('GET', '/admin/billing/reports/aging');
  });

  it('sends `rail=extras` with the date when asked', async () => {
    const { http, api } = apiWith(makeResponse({ jsonData: {} }));
    await api.reports.aging('2026-09-01', 'extras');
    expect(http).toHaveBeenCalledWith(
      'GET',
      '/admin/billing/reports/aging?asOf=2026-09-01&rail=extras',
    );
  });
});

describe('createAdminBillingApi — invoices', () => {
  it('serialises only the filters that were supplied', async () => {
    const { http, api } = apiWith(makeResponse({ jsonData: [] }));
    await api.invoices.list({ status: 'open', from: '2026-01-01', userId: '' });
    expect(http).toHaveBeenCalledWith(
      'GET',
      '/admin/billing/invoices?status=open&from=2026-01-01',
    );
  });
});

describe('createAdminBillingApi — the manual invoice cycle run', () => {
  it('posts an empty JSON body, not no body, when no window is given', async () => {
    // Backlog `user-experience/12`: `http()` sets the JSON content type on
    // every request, so "no body" reaches the route as malformed JSON (400).
    const { http, api } = apiWith(makeResponse({ jsonData: {} }));
    await api.invoices.run();
    expect(http).toHaveBeenCalledWith('POST', '/admin/billing/invoices/run', {
      body: JSON.stringify({}),
    });
  });

  it('posts the optional window when the screen supplied one', async () => {
    const { http, api } = apiWith(makeResponse({ jsonData: {} }));
    await api.invoices.run({ asOf: '2026-09-01', since: '2026-08-25' });
    expect(http).toHaveBeenCalledWith('POST', '/admin/billing/invoices/run', {
      body: JSON.stringify({ asOf: '2026-09-01', since: '2026-08-25' }),
    });
  });

  it('sends only the half of the window that was supplied', async () => {
    const { http, api } = apiWith(makeResponse({ jsonData: {} }));
    await api.invoices.run({ asOf: '2026-09-01' });
    expect(http).toHaveBeenCalledWith('POST', '/admin/billing/invoices/run', {
      body: JSON.stringify({ asOf: '2026-09-01' }),
    });
  });

  it('returns the report the server sent, unaltered', async () => {
    const report = {
      asOf: '2026-09-01',
      since: '2026-08-31',
      eligibleContracts: 3,
      issued: [],
      absorbed: 2,
      reminders: [],
      crossings: [],
      suppressedByHold: [],
      divergences: [],
      mailsSent: 0,
      adminsNotified: 0,
    };
    const { api } = apiWith(makeResponse({ jsonData: report }));
    await expect(api.invoices.run()).resolves.toEqual(report);
  });

  it('offers no control for repairing a divergence — the run repairs nothing', () => {
    const { api } = apiWith(makeResponse());
    expect(api.invoices).not.toHaveProperty('repair');
    expect(api.invoices).not.toHaveProperty('repairStatus');
    expect(api.invoices).not.toHaveProperty('reconcile');
  });
});

describe('createAdminBillingApi — the append-only ledger', () => {
  it('exposes no delete operation for a payment or an adjustment', () => {
    const { api } = apiWith(makeResponse());
    expect(api.payments).not.toHaveProperty('delete');
    expect(api.invoices).not.toHaveProperty('deletePayment');
    expect(api.invoices).not.toHaveProperty('deleteAdjustment');
    expect(Object.keys(api.payments)).toEqual(['reverse']);
  });

  it('reverses a payment by posting the reason', async () => {
    const { http, api } = apiWith(makeResponse({ status: 201, jsonData: { id: 'p2' } }));
    await api.payments.reverse('p1', { reason: 'Cheque bounced.' });
    expect(http).toHaveBeenCalledWith('POST', '/admin/billing/payments/p1/reverse', {
      body: JSON.stringify({ reason: 'Cheque bounced.' }),
    });
  });
});

describe('createAdminBillingApi — holds', () => {
  it('posts the reason and the optional expiry', async () => {
    const { http, api } = apiWith(makeResponse({ status: 201, jsonData: {} }));
    await api.holds.set('u1', { reason: 'Injured.', expiresAt: '2026-03-01' });
    expect(http).toHaveBeenCalledWith('POST', '/admin/billing/holds/u1', {
      body: JSON.stringify({ reason: 'Injured.', expiresAt: '2026-03-01' }),
    });
  });

  it('clears a hold with a DELETE that expects no body', async () => {
    const { http, api } = apiWith(makeResponse({ ok: true, status: 204 }));
    await api.holds.clear('u1');
    expect(http).toHaveBeenCalledWith('DELETE', '/admin/billing/holds/u1');
  });
});

describe('createAdminBillingApi — errors', () => {
  it('raises AdminBillingApiError carrying the status and the server message', async () => {
    const { api } = apiWith(
      makeResponse({
        ok: false,
        status: 409,
        jsonData: { error: 'Conflict', message: 'this report spans more than one currency' },
      }),
    );
    await expect(api.reports.movement('2026-08')).rejects.toBeInstanceOf(AdminBillingApiError);
    await api.reports.movement('2026-08').catch((error: AdminBillingApiError) => {
      expect(error.status).toBe(409);
      expect(error.detailMessage).toBe('this report spans more than one currency');
    });
  });
});

describe('createAdminBillingApi — online payments (RFC 0026)', () => {
  const SESSION = {
    checkoutId: 'chk-1',
    provider: 'mercadopago',
    url: 'https://pay.example.test/chk-1',
    expiresAt: '2026-11-27T14:03:00.000Z',
    amountMinor: 15000,
    currency: 'BRL',
    status: 'open',
  };

  it('creates a checkout on behalf on each rail, with a strict body that names no user', async () => {
    const { http, api } = apiWith(makeResponse({ status: 201, jsonData: SESSION }));

    await expect(api.invoices.createCheckout('inv-1')).resolves.toEqual({
      session: SESSION,
      reused: false,
    });
    expect(http).toHaveBeenLastCalledWith('POST', '/admin/billing/invoices/inv-1/checkouts', {
      body: '{}',
    });

    await api.extras.createCheckout('ch-1', { provider: 'stripe' });
    // Decision 22: the charge route lives under the billing router.
    expect(http).toHaveBeenLastCalledWith('POST', '/admin/billing/charges/ch-1/checkouts', {
      body: JSON.stringify({ provider: 'stripe' }),
    });
  });

  it('reports the live checkout handed back (200) as reused', async () => {
    const { api } = apiWith(makeResponse({ status: 200, jsonData: SESSION }));
    await expect(api.invoices.createCheckout('inv-1')).resolves.toMatchObject({ reused: true });
  });

  it('retries a lost creation race once, then gives the refusal back', async () => {
    const lost = makeResponse({
      ok: false,
      status: 409,
      jsonData: { error: 'CHECKOUT_IN_PROGRESS' },
    });
    const wait = vi.fn(async () => {});
    const http = vi
      .fn()
      .mockResolvedValueOnce(lost)
      .mockResolvedValueOnce(makeResponse({ status: 201, jsonData: SESSION }));
    const api = createAdminBillingApi(http as unknown as HttpTransport, { wait });

    await expect(api.invoices.createCheckout('inv-1')).resolves.toMatchObject({ reused: false });
    expect(http).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);

    const always = vi.fn().mockResolvedValue(lost);
    const stuck = createAdminBillingApi(always as unknown as HttpTransport, { wait });
    await stuck.invoices.createCheckout('inv-1').catch((error: AdminBillingApiError) => {
      expect(error.checkoutKind).toBe('in_progress');
    });
    expect(always).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['PAYMENTS_REFUND_REFUSED', 409, 'refused'],
    ['PAYMENTS_PROVIDER_NOT_ENABLED', 409, 'provider_not_enabled'],
    ['PAYMENTS_REFUND_UNRECORDED', 503, 'unrecorded'],
    ['PAYMENTS_PROVIDER_BUSY', 503, 'provider_busy'],
    ['PAYMENTS_CONFIG_INVALID', 500, 'configuration'],
    ['PAYMENTS_PROVIDER_ERROR', 502, 'provider_unavailable'],
    ['Conflict', 409, 'conflict'],
    ['SOMETHING_ELSE', 500, 'unknown'],
  ] as const)('maps the reverse refusal %s to the refund kind', async (code, status, kind) => {
    const { api } = apiWith(
      makeResponse({ ok: false, status, jsonData: { error: code, refundId: 're_1' } }),
    );
    for (const call of [
      () => api.payments.reverse('pay-1', { reason: 'r' }),
      () => api.extras.reversePayment('pay-1', { reason: 'r' }),
    ]) {
      await call().then(
        () => expect.unreachable(),
        (error: AdminBillingApiError) => {
          expect(error.refundKind).toBe(kind);
          expect(error.refundId).toBe('re_1');
        },
      );
    }
  });

  it('exposes the existing payment of a duplicate gateway reference, and of nothing else', async () => {
    const { api } = apiWith(
      makeResponse({
        ok: false,
        status: 409,
        jsonData: { error: 'PAYMENT_REFERENCE_EXISTS', paymentId: 'pay-9' },
      }),
    );
    await api.invoices
      .addPayment('inv-1', { amountMinor: 1, method: 'gateway', externalReference: 'stripe:pi_1' })
      .catch((error: AdminBillingApiError) => expect(error.existingPaymentId).toBe('pay-9'));

    const other = apiWith(
      makeResponse({ ok: false, status: 409, jsonData: { error: 'Conflict', paymentId: 'pay-9' } }),
    );
    await other.api.invoices
      .addPayment('inv-1', { amountMinor: 1, method: 'cash' })
      .catch((error: AdminBillingApiError) => expect(error.existingPaymentId).toBeNull());
  });
});

describe('createAdminBillingApi — payment exceptions and reconcile (RFC 0026 §7)', () => {
  it('reads the exceptions list and unwraps it', async () => {
    const row = { ref: 'event:stripe:evt_1', kind: 'orphan' };
    const { http, api } = apiWith(makeResponse({ jsonData: { exceptions: [row] } }));
    await expect(api.gateway.listExceptions()).resolves.toEqual([row]);
    expect(http).toHaveBeenCalledWith('GET', '/admin/billing/payments/exceptions');
  });

  it('answers an empty list when the body carries none', async () => {
    const { api } = apiWith(makeResponse({ jsonData: {} }));
    await expect(api.gateway.listExceptions()).resolves.toEqual([]);
  });

  it('tells a 403 on the list apart from any other failure', async () => {
    const forbidden = apiWith(makeResponse({ ok: false, status: 403, jsonData: { error: 'Forbidden' } }));
    await forbidden.api.gateway.listExceptions().then(
      () => expect.unreachable(),
      (error: AdminBillingApiError) => expect(error.exceptionsKind).toBe('forbidden'),
    );
    const broken = apiWith(makeResponse({ ok: false, status: 500, jsonData: {} }));
    await broken.api.gateway.listExceptions().then(
      () => expect.unreachable(),
      (error: AdminBillingApiError) => {
        expect(error.exceptionsKind).toBe('unknown');
        expect(error.code).toBe('BILLING_PAYMENT_EXCEPTIONS_FAILED');
      },
    );
  });

  it('dismisses with the ref as given and the trimmed note — a strict two-key body', async () => {
    const { http, api } = apiWith(
      makeResponse({ jsonData: { ref: 'checkout:c1', dismissedBy: 'a1', dismissedAt: 'now' } }),
    );
    await api.gateway.dismissException({ ref: 'checkout:c1', note: '  seen  ' });
    expect(http).toHaveBeenCalledWith('POST', '/admin/billing/payments/exceptions/dismiss', {
      body: JSON.stringify({ ref: 'checkout:c1', note: 'seen' }),
    });
  });

  it('maps every documented refusal of a dismissal to one kind', async () => {
    const cases = [
      [404, 'NotFound', 'gone'],
      [400, 'ValidationError', 'invalid'],
      [403, 'Forbidden', 'forbidden'],
      [500, 'Boom', 'unknown'],
    ] as const;
    for (const [status, error, kind] of cases) {
      const { api } = apiWith(makeResponse({ ok: false, status, jsonData: { error } }));
      await api.gateway.dismissException({ ref: 'checkout:c1', note: 'n' }).then(
        () => expect.unreachable(),
        (thrown: AdminBillingApiError) => expect(thrown.dismissKind).toBe(kind),
      );
    }
  });

  it('posts the reconcile run as an empty JSON object and hands back a failed run as data', async () => {
    const run = { status: 'failed', error: 'unreachable', summary: { unreachable: 1 } };
    const { http, api } = apiWith(makeResponse({ jsonData: run }));
    // A failed run is a `200`: it must reach the caller, not be thrown.
    await expect(api.gateway.reconcile()).resolves.toEqual(run);
    expect(http).toHaveBeenCalledWith('POST', '/admin/billing/payments/reconcile', { body: '{}' });
  });

  it('maps every documented refusal of a reconcile run to one kind', async () => {
    const cases = [
      [404, 'NotFound', 'off'],
      [500, 'PAYMENTS_CONFIG_INVALID', 'configuration'],
      [403, 'Forbidden', 'forbidden'],
      [500, 'Boom', 'unknown'],
    ] as const;
    for (const [status, error, kind] of cases) {
      const { api } = apiWith(makeResponse({ ok: false, status, jsonData: { error } }));
      await api.gateway.reconcile().then(
        () => expect.unreachable(),
        (thrown: AdminBillingApiError) => expect(thrown.reconcileKind).toBe(kind),
      );
    }
  });
});
