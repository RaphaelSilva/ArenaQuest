import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Entities } from '@arenaquest/shared/types/entities';
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
  adminUsers: {
    list: () => Promise<{ data: Entities.Identity.User[]; total: number }>;
  };
};

let search = '';
let exceptions: unknown[] = [];

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search),
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
    search = '';
    exceptions = [];
    http = makeTransport((_method, path) => {
      if (path.includes('/reports/aging')) return agingReport;
      if (path.endsWith('/payments/exceptions')) return { exceptions };
      return [];
    });
    client = {
      adminBilling: createAdminBillingApi(http as unknown as HttpTransport),
      adminUsers: {
        // `email` and `status` ride along on the console's existing user read
        // because the signing picker filters on the email and marks an account
        // that is not active.
        list: async () => ({
          data: [
            {
              id: 'u1',
              name: 'Alice Doe',
              email: 'alice@dojo.test',
              status: Entities.Config.UserStatus.ACTIVE,
              roles: [],
              groups: [],
              createdAt: new Date('2026-01-01T00:00:00Z'),
              timezone: 'UTC',
            },
          ],
          total: 1,
        }),
      },
    };
  });

  it('renders the four tabs as a tablist', async () => {
    renderPage();
    const tablist = await screen.findByRole('tablist', { name: d.tabsLabel });
    expect(tablist).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: d.tabs.students })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: d.tabs.ledger })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: d.tabs.reports })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: d.tabs.plans })).toBeInTheDocument();
  });

  it('opens the plan catalogue on the Plans tab', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: d.tabs.plans }));
    expect(await screen.findByText(d.plans.recurringNote)).toBeInTheDocument();
  });

  it('opens the Extras tab from the plans tab link', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: d.tabs.plans }));
    fireEvent.click(await screen.findByRole('link', { name: d.plans.extrasLink }));
    expect(screen.getByRole('tab', { name: d.tabs.extras })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('opens on the Extras tab, on the event, from the event page link', async () => {
    search = 'tab=extras&eventId=ev-1';
    renderPage();
    expect(await screen.findByRole('tab', { name: d.tabs.extras })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('GET', '/admin/billing/events/ev-1/summary'),
    );
  });

  it('ignores an unknown tab in the query', async () => {
    search = 'tab=nope';
    renderPage();
    expect(await screen.findByRole('tab', { name: d.tabs.students })).toHaveAttribute(
      'aria-selected',
      'true',
    );
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

  it('offers the payment exceptions tab with no badge while the list is empty', async () => {
    renderPage();
    const tab = await screen.findByRole('tab', { name: d.tabs.exceptions });
    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('GET', '/admin/billing/payments/exceptions'),
    );
    expect(screen.queryByTestId('exceptions-badge')).not.toBeInTheDocument();

    fireEvent.click(tab);
    expect(await screen.findByText(d.gateway.exceptions.empty.title)).toBeInTheDocument();
    expect(screen.queryByTestId('exceptions-badge')).not.toBeInTheDocument();
  });

  it('badges the tab with the number of open exceptions before it is opened', async () => {
    exceptions = [{ ref: 'event:stripe:evt_1' }, { ref: 'event:stripe:evt_2' }];
    renderPage();
    const badge = await screen.findByTestId('exceptions-badge');
    expect(badge).toHaveTextContent('2');
    expect(badge).toHaveAttribute('aria-label', d.gateway.exceptions.countLabel(2));
    // Still on the students tab: the badge is how the admin learns to look.
    expect(screen.getByRole('tab', { name: d.tabs.students })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('offers a non-admin no payment exceptions tab and reads no exception for them', async () => {
    isAdmin = false;
    exceptions = [{ ref: 'event:stripe:evt_1' }];
    renderPage();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByRole('tab', { name: d.tabs.exceptions })).not.toBeInTheDocument();
    expect(screen.queryByTestId('exceptions-badge')).not.toBeInTheDocument();
    expect(http).not.toHaveBeenCalledWith('GET', '/admin/billing/payments/exceptions');
  });
});
