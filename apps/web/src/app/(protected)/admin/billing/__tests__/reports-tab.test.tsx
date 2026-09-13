import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createAdminBillingApi } from '@web/lib/admin-billing-api';
import type { HttpTransport } from '@web/lib/api-client';
import { ReportsTab } from '../reports-tab';

const JPY = { code: 'JPY', exponent: 0, symbol: '¥' };

const movement = {
  month: '2026-08',
  periodStart: '2026-08-01',
  periodEnd: '2026-08-31',
  currency: JPY,
  invoicedMinor: 300000,
  adjustmentsMinor: -50000,
  billedMinor: 250000,
  receivedMinor: 100000,
  outstandingMinor: 150000,
  invoicesIssued: 3,
  activeStudents: 2,
};

const aging = {
  asOf: '2026-09-01',
  currency: JPY,
  buckets: [
    { bucket: '0-30', fromDaysPastDue: 0, toDaysPastDue: 30, invoiceCount: 1, studentCount: 1, totalMinor: 50000 },
    { bucket: '31-60', fromDaysPastDue: 31, toDaysPastDue: 60, invoiceCount: 1, studentCount: 1, totalMinor: 120000 },
    { bucket: '61-90', fromDaysPastDue: 61, toDaysPastDue: 90, invoiceCount: 0, studentCount: 0, totalMinor: 0 },
    { bucket: '90+', fromDaysPastDue: 91, toDaysPastDue: null, invoiceCount: 0, studentCount: 0, totalMinor: 0 },
  ],
  totalMinor: 170000,
  invoiceCount: 2,
  studentCount: 2,
};

let client: { adminBilling: ReturnType<typeof createAdminBillingApi> };
let conflict = false;

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

function makeClient() {
  const http = vi.fn(async (_method: string, path: string) => {
    if (conflict) {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'Conflict', message: 'two currencies' }),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => (path.includes('movement') ? movement : aging),
    } as unknown as Response;
  });
  return { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };
}

const d = dictEn.admin.billing.reports;

function renderTab() {
  return render(
    <DictProvider value={dictEn}>
      <ReportsTab />
    </DictProvider>,
  );
}

describe('ReportsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conflict = false;
    client = makeClient();
  });

  it('renders the movement totals the API computed, at the currency exponent it reported', async () => {
    renderTab();
    // Exponent 0: no decimal separator, and nothing recomputed in the client.
    expect(await screen.findByText('¥ 250,000')).toBeInTheDocument();
    expect(screen.getByText('¥ 100,000')).toBeInTheDocument();
    expect(screen.getByText(d.movement.period('2026-08-01', '2026-08-31'))).toBeInTheDocument();
  });

  it('renders the four aging buckets with the API totals', async () => {
    renderTab();
    expect(await screen.findByText(d.aging.buckets['0-30'])).toBeInTheDocument();
    expect(screen.getByText(d.aging.buckets['31-60'])).toBeInTheDocument();
    expect(screen.getByText(d.aging.buckets['61-90'])).toBeInTheDocument();
    expect(screen.getByText(d.aging.buckets['90+'])).toBeInTheDocument();
    expect(screen.getByText('¥ 50,000')).toBeInTheDocument();
  });

  it('says a held balance is still counted in both reports', async () => {
    renderTab();
    expect(await screen.findByText(d.holdNote)).toBeInTheDocument();
  });

  it('explains the two-currency refusal rather than reporting a load failure', async () => {
    conflict = true;
    client = makeClient();
    renderTab();
    await waitFor(() => expect(screen.getAllByText(d.conflictNote).length).toBe(2));
  });
});
