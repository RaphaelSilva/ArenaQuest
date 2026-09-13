import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Entities } from '@arenaquest/shared/types/entities';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createAdminBillingApi } from '@web/lib/admin-billing-api';
import type { BillingReportCurrency, BillingRosterEntry } from '@web/lib/admin-billing-api';
import type { HttpTransport } from '@web/lib/api-client';
import { makeTransport } from './test-transport';
import { StudentsTab } from '../students-tab';
import type { SignableStudent } from '../sign-contract-dialog';

const BRL: BillingReportCurrency = { code: 'BRL', exponent: 2, symbol: 'R$' };

const delinquent: BillingRosterEntry = {
  userId: 'u1',
  asOf: '2026-09-01',
  standing: 'delinquent',
  oldestOverdueDate: '2026-07-10',
  outstandingMinor: 150000,
  contractId: 'c1',
  contractGroupId: 'cg1',
  contractStatus: 'active',
  currency: 'BRL',
  nextDueDate: '2026-10-10',
  negotiatedTerms: true,
  hold: null,
};

const held: BillingRosterEntry = {
  userId: 'u2',
  asOf: '2026-09-01',
  standing: 'exempt',
  oldestOverdueDate: '2026-06-10',
  outstandingMinor: 90000,
  contractId: 'c2',
  contractGroupId: 'cg2',
  contractStatus: 'active',
  currency: 'BRL',
  nextDueDate: null,
  negotiatedTerms: false,
  hold: {
    userId: 'u2',
    reason: 'Injured until March.',
    expiresAt: null,
    setBy: 'admin-9',
    setAt: '2026-08-01T00:00:00Z',
  },
};

const NAMES: Record<string, string> = { u1: 'Alice Doe', u2: 'Bruno Lima' };

/**
 * The signing picker's candidates come from the admin user list, so `u3` — who
 * holds no contract and therefore has no roster line above — is present here
 * and nowhere else.
 */
const STUDENTS: SignableStudent[] = [
  { id: 'u1', name: 'Alice Doe', email: 'alice@dojo.test', status: Entities.Config.UserStatus.ACTIVE },
  { id: 'u2', name: 'Bruno Lima', email: 'bruno@dojo.test', status: Entities.Config.UserStatus.ACTIVE },
  { id: 'u3', name: 'Carla Souza', email: 'carla@dojo.test', status: Entities.Config.UserStatus.ACTIVE },
];

let http: ReturnType<typeof makeTransport>;
// One stable client per test: `useApiClient` returns a stable instance in the
// app, and a fresh object here would re-fire every effect that depends on it.
let client: { adminBilling: ReturnType<typeof createAdminBillingApi> };

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

const onRosterChanged = vi.fn();

function renderTab() {
  return render(
    <DictProvider value={dictEn}>
      <StudentsTab
        currency={BRL}
        nameOf={(userId) => NAMES[userId] ?? userId}
        onRosterChanged={onRosterChanged}
        students={STUDENTS}
      />
    </DictProvider>,
  );
}

const d = dictEn.admin.billing.students;

describe('StudentsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Path-aware: the signing dialog reads the plan catalogue and the active
    // contracts from the same client, and roster rows are not plans.
    http = makeTransport((_method, path) =>
      path.includes('/students') ? [delinquent, held] : [],
    );
    client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };
  });

  it('lists the roster with the standing the API resolved', async () => {
    renderTab();
    expect(await screen.findByText('Alice Doe')).toBeInTheDocument();
    // Scoped to the table: the standing filter renders the same labels as options.
    const table = within(screen.getByRole('table'));
    expect(table.getByText(dictEn.admin.billing.standing.delinquent)).toBeInTheDocument();
    expect(table.getByText(dictEn.admin.billing.standing.exempt)).toBeInTheDocument();
    expect(screen.getByText('2026-07-10')).toBeInTheDocument();
    expect(screen.getByText(d.negotiated)).toBeInTheDocument();
  });

  it('round-trips the standing filter to the API instead of filtering the cached list', async () => {
    renderTab();
    await screen.findByText('Alice Doe');
    http.mockClear();

    fireEvent.change(screen.getByLabelText(d.filterLabel), { target: { value: 'delinquent' } });

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('GET', '/admin/billing/students?standing=delinquent'),
    );
  });

  it('sends `standing=exempt` for the held filter', async () => {
    renderTab();
    await screen.findByText('Alice Doe');
    http.mockClear();

    fireEvent.change(screen.getByLabelText(d.filterLabel), { target: { value: 'exempt' } });

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('GET', '/admin/billing/students?standing=exempt'),
    );
  });

  it('shows a held student with their reason and who set it', async () => {
    renderTab();
    expect(await screen.findByText(d.heldBy('Injured until March.', 'admin-9'))).toBeInTheDocument();
  });

  it('keeps a held balance in the total on screen — a hold stops the chasing, not the debt', async () => {
    renderTab();
    await screen.findByText('Alice Doe');
    // 150000 + 90000 minor units: the held student is still counted.
    expect(screen.getByText('R$ 2,400.00')).toBeInTheDocument();
  });

  it('refuses to set a hold without a reason', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: d.holdAriaLabel('Alice Doe') }));
    http.mockClear();

    fireEvent.click(screen.getByRole('button', { name: d.holdSubmit }));

    expect(await screen.findByText(d.holdReasonRequired)).toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
  });

  it('sets a hold with its reason and notifies the nav badge', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: d.holdAriaLabel('Alice Doe') }));
    fireEvent.change(screen.getByPlaceholderText(d.holdReasonPlaceholder), {
      target: { value: 'Injured; agreed to pause chasing.' },
    });
    fireEvent.change(screen.getByLabelText(d.holdExpiresLabel), {
      target: { value: '2026-12-01' },
    });

    fireEvent.click(screen.getByRole('button', { name: d.holdSubmit }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/holds/u1', {
        body: JSON.stringify({
          reason: 'Injured; agreed to pause chasing.',
          expiresAt: '2026-12-01',
        }),
      }),
    );
    await waitFor(() => expect(onRosterChanged).toHaveBeenCalled());
  });

  it('clears a hold through the holds endpoint', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: d.clearHoldAriaLabel('Bruno Lima') }));
    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('DELETE', '/admin/billing/holds/u2'),
    );
  });

  /**
   * A student with no contract has no roster line, so the tab header is the
   * only place the first contract can be signed from.
   */
  it('opens the signing dialog from the tab header with no student pre-selected', async () => {
    renderTab();
    fireEvent.click(
      await screen.findByRole('button', { name: dictEn.admin.billing.sign.buttonAriaLabel }),
    );

    const dialog = await screen.findByRole('dialog', {
      name: dictEn.admin.billing.sign.dialogTitle,
    });
    // Carla is on no roster line above and is still reachable in the picker.
    expect(within(dialog).getByRole('radio', { name: /Carla Souza/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /Alice Doe/ })).not.toBeChecked();
  });

  /**
   * The console reports and alerts. No API suspends, locks, downgrades or
   * restricts a student's access, so no control here may imply one.
   */
  it('offers no control that would restrict a student access', async () => {
    const { container } = renderTab();
    await screen.findByText('Alice Doe');

    const names = within(container)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '');

    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).not.toMatch(/suspend|block|lock|revoke|restrict|disable|downgrade|paywall/i);
    }
  });
});
