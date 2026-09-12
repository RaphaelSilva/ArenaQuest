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
  it('posts to the run endpoint with no body at all when no window is given', async () => {
    const { http, api } = apiWith(makeResponse({ jsonData: {} }));
    await api.invoices.run();
    expect(http).toHaveBeenCalledWith('POST', '/admin/billing/invoices/run', undefined);
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
