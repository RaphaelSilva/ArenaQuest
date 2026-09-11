import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createAdminBillingApi } from '@web/lib/admin-billing-api';
import type { HttpTransport } from '@web/lib/api-client';
import { makeTransport } from './test-transport';

const replace = vi.fn();
let isAdmin = true;

let http: ReturnType<typeof makeTransport>;
let client: {
  adminBilling: ReturnType<typeof createAdminBillingApi>;
  adminUsers: { list: () => Promise<{ data: { id: string; name: string }[]; total: number }> };
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => ({ isLoading: false }),
  useHasRole: () => isAdmin,
}));

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

import AdminBillingPage from '../page';

const BRL = { code: 'BRL', exponent: 2, symbol: 'R$' };

const agingReport = {
  asOf: '2026-09-01',
  currency: BRL,
  buckets: [],
  totalMinor: 0,
  invoiceCount: 0,
  studentCount: 0,
};

const d = dictEn.admin.billing;

function renderPage() {
  return render(
    <DictProvider value={dictEn}>
      <AdminBillingPage />
    </DictProvider>,
  );
}

describe('AdminBillingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAdmin = true;
    http = makeTransport((_method, path) => {
      if (path.includes('/reports/aging')) return agingReport;
      return [];
    });
    client = {
      adminBilling: createAdminBillingApi(http as unknown as HttpTransport),
      adminUsers: {
        list: async () => ({ data: [{ id: 'u1', name: 'Alice Doe' }], total: 1 }),
      },
    };
  });

  it('renders the three tabs as a tablist', async () => {
    renderPage();
    const tablist = await screen.findByRole('tablist', { name: d.tabsLabel });
    expect(tablist).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: d.tabs.students })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: d.tabs.ledger })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: d.tabs.reports })).toBeInTheDocument();
  });

  it('switches tabs on click', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: d.tabs.ledger }));
    expect(await screen.findByText(d.ledger.appendOnlyNote)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: d.tabs.ledger })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('moves between tabs with the arrow keys', async () => {
    renderPage();
    const first = await screen.findByRole('tab', { name: d.tabs.students });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: d.tabs.ledger })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('states, on the Students tab, that a hold stops the chasing and not the debt', async () => {
    renderPage();
    expect(await screen.findByText(d.students.holdExplainer)).toBeInTheDocument();
    expect(screen.getByText(d.students.noGateNote)).toBeInTheDocument();
  });

  it('redirects a non-admin — billing is stricter than the admin umbrella', async () => {
    isAdmin = false;
    renderPage();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
  });
});
