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

function contract(
  overrides: Partial<NonNullable<BillingRosterEntry['contract']>> = {},
): NonNullable<BillingRosterEntry['contract']> {
  return {
    id: 'c1',
    groupId: 'cg1',
    status: 'active',
    nextDueDate: '2026-10-10',
    negotiatedTerms: false,
    standing: 'good',
    oldestOverdueDate: null,
    outstandingMinor: 0,
    ...overrides,
  };
}

const delinquent: BillingRosterEntry = {
  userId: 'u1',
  asOf: '2026-09-01',
  currency: 'BRL',
  contract: contract({
    standing: 'delinquent',
    oldestOverdueDate: '2026-07-10',
    outstandingMinor: 150000,
    negotiatedTerms: true,
  }),
  extras: null,
  hold: null,
};

const held: BillingRosterEntry = {
  userId: 'u2',
  asOf: '2026-09-01',
  currency: 'BRL',
  contract: contract({
    id: 'c2',
    groupId: 'cg2',
    standing: 'exempt',
    oldestOverdueDate: '2026-06-10',
    outstandingMinor: 90000,
    nextDueDate: null,
  }),
  extras: null,
  hold: {
    userId: 'u2',
    reason: 'Injured until March.',
    expiresAt: null,
    setBy: 'admin-9',
    setAt: '2026-08-01T00:00:00Z',
  },
};

/** RFC 0015 isolation case: the monthly fee is paid up, an extra slipped. */
const paidUpWithLateExtra: BillingRosterEntry = {
  userId: 'u4',
  asOf: '2026-09-01',
  currency: 'BRL',
  contract: contract({ id: 'c4', groupId: 'cg4' }),
  extras: {
    standing: 'delinquent',
    oldestOverdueDate: '2026-08-01',
    outstandingMinor: 25000,
    openCharges: 2,
    overdueCharges: 1,
  },
  hold: null,
};

/** A buyer with no contract at all: listed only because of a charge. */
const extrasOnly: BillingRosterEntry = {
  userId: 'u5',
  asOf: '2026-09-01',
  currency: 'BRL',
  contract: null,
  extras: {
    standing: 'due',
    oldestOverdueDate: null,
    outstandingMinor: 40000,
    openCharges: 1,
    overdueCharges: 0,
  },
  hold: null,
};

const NAMES: Record<string, string> = {
  u1: 'Alice Doe',
  u2: 'Bruno Lima',
  u4: 'Diego Reis',
  u5: 'Elisa Prado',
};

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
const standingDict = dictEn.admin.billing.standing;
const rails = dictEn.admin.billing.rails;

/** The table row whose student cell names `name`. */
function rowOf(name: string) {
  return screen.getByText(name).closest('tr') as HTMLElement;
}

/** The cells of a row, in column order: student, monthly fee, extras, terms, actions. */
function cellsOf(name: string) {
  return within(rowOf(name)).getAllByRole('cell');
}

describe('StudentsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Path-aware: the signing dialog reads the plan catalogue and the active
    // contracts from the same client, and roster rows are not plans.
    http = makeTransport((_method, path) =>
      path.includes('/students') ? [delinquent, held, paidUpWithLateExtra, extrasOnly] : [],
    );
    client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };
  });

  it('lists the roster with the standing the API resolved', async () => {
    renderTab();
    expect(await screen.findByText('Alice Doe')).toBeInTheDocument();
    const [, fee] = cellsOf('Alice Doe');
    expect(within(fee).getByText(standingDict.delinquent)).toBeInTheDocument();
    expect(within(fee).getByText(d.oldestOverdue('2026-07-10'))).toBeInTheDocument();
    expect(within(cellsOf('Bruno Lima')[1]).getByText(standingDict.exempt)).toBeInTheDocument();
    expect(within(rowOf('Alice Doe')).getByText(d.negotiated)).toBeInTheDocument();
  });

  it('shows a paid-up monthly fee beside a delinquent extra, never merged', async () => {
    renderTab();
    await screen.findByText('Diego Reis');
    const [, fee, extras] = cellsOf('Diego Reis');

    expect(within(fee).getByText(standingDict.good)).toBeInTheDocument();
    expect(fee).toHaveTextContent(`${rails.contract}: ${standingDict.good}`);
    expect(within(fee).getByText('R$ 0.00')).toBeInTheDocument();

    expect(within(extras).getByText(standingDict.delinquent)).toBeInTheDocument();
    expect(extras).toHaveTextContent(`${rails.extras}: ${standingDict.delinquent}`);
    expect(within(extras).getByText('R$ 250.00')).toBeInTheDocument();
    expect(within(extras).getByText(d.extrasCounts(1, 2))).toBeInTheDocument();
  });

  it('lists an extras-only buyer with "no contract" and their resolved extras badge', async () => {
    renderTab();
    await screen.findByText('Elisa Prado');
    const [, fee, extras, terms] = cellsOf('Elisa Prado');

    expect(within(fee).getByText(d.noContract)).toBeInTheDocument();
    expect(within(extras).getByText(standingDict.due)).toBeInTheDocument();
    expect(within(extras).getByText('R$ 400.00')).toBeInTheDocument();
    expect(terms).toHaveTextContent(d.none);
    // A hold is contract-only, so there is nothing to hold on this row.
    expect(
      screen.queryByRole('button', { name: d.holdAriaLabel('Elisa Prado') }),
    ).not.toBeInTheDocument();
  });

  it('shows a dash on the extras rail of someone never charged', async () => {
    renderTab();
    await screen.findByText('Alice Doe');
    expect(cellsOf('Alice Doe')[2]).toHaveTextContent(d.none);
  });

  it('keeps one total per rail and never a merged one', async () => {
    renderTab();
    await screen.findByText('Alice Doe');
    // Monthly fees: 150000 + 90000 (held, still counted) + 0.
    expect(screen.getByText(d.contractTotalOutstanding).parentElement).toHaveTextContent(
      'R$ 2,400.00',
    );
    // Extras: 25000 + 40000.
    expect(screen.getByText(d.extrasTotalOutstanding).parentElement).toHaveTextContent(
      'R$ 650.00',
    );
    // 2,400 + 650 is shown nowhere.
    expect(screen.queryByText('R$ 3,050.00')).not.toBeInTheDocument();
  });

  it('round-trips each rail filter to the API independently', async () => {
    renderTab();
    await screen.findByText('Alice Doe');
    http.mockClear();

    fireEvent.change(screen.getByLabelText(d.contractFilterLabel), {
      target: { value: 'delinquent' },
    });
    await waitFor(() =>
      expect(http).toHaveBeenCalledWith(
        'GET',
        '/admin/billing/students?contractStanding=delinquent',
      ),
    );

    fireEvent.change(screen.getByLabelText(d.extrasFilterLabel), {
      target: { value: 'delinquent' },
    });
    await waitFor(() =>
      expect(http).toHaveBeenCalledWith(
        'GET',
        '/admin/billing/students?contractStanding=delinquent&extrasStanding=delinquent',
      ),
    );

    fireEvent.change(screen.getByLabelText(d.contractFilterLabel), { target: { value: '' } });
    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('GET', '/admin/billing/students?extrasStanding=delinquent'),
    );
  });

  it('sends `contractStanding=exempt` for the held filter and offers no held extras filter', async () => {
    renderTab();
    await screen.findByText('Alice Doe');
    http.mockClear();

    fireEvent.change(screen.getByLabelText(d.contractFilterLabel), { target: { value: 'exempt' } });

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('GET', '/admin/billing/students?contractStanding=exempt'),
    );
    const extrasFilter = screen.getByLabelText(d.extrasFilterLabel);
    expect(
      within(extrasFilter).queryByRole('option', { name: standingDict.exempt }),
    ).not.toBeInTheDocument();
  });

  it('shows a held student with their reason and who set it', async () => {
    renderTab();
    expect(await screen.findByText(d.heldBy('Injured until March.', 'admin-9'))).toBeInTheDocument();
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
