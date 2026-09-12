import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createAdminBillingApi } from '@web/lib/admin-billing-api';
import type { BillingPlan, BillingReportCurrency } from '@web/lib/admin-billing-api';
import type { HttpTransport } from '@web/lib/api-client';
import { makeTransport } from './test-transport';
import { PlansTab } from '../plans-tab';

const BRL: BillingReportCurrency = { code: 'BRL', exponent: 2, symbol: 'R$' };
const JPY: BillingReportCurrency = { code: 'JPY', exponent: 0, symbol: '¥' };
const BTC: BillingReportCurrency = { code: 'BTC', exponent: 8, symbol: '₿' };

function plan(overrides: Partial<BillingPlan> = {}): BillingPlan {
  return {
    id: 'p1',
    name: 'Monthly membership',
    description: 'Unlimited classes.',
    amountMinor: 150000,
    currency: 'BRL',
    cycle: 'monthly',
    graceDays: 5,
    scopeTopicId: null,
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

let rows: BillingPlan[];
let http: ReturnType<typeof makeTransport>;
// One stable client per test, as `useApiClient` returns in the app: a fresh
// object here would re-fire every effect that depends on it.
let client: { adminBilling: ReturnType<typeof createAdminBillingApi> };

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

function renderTab(currency: BillingReportCurrency | null = BRL) {
  return render(
    <DictProvider value={dictEn}>
      <PlansTab currency={currency} />
    </DictProvider>,
  );
}

/** A transport whose writes are refused by the server, with an explanation. */
function makeRejectingTransport(message: string) {
  return vi.fn(async (method: string) => {
    if (method === 'GET') {
      return { ok: true, status: 200, json: async () => rows } as unknown as Response;
    }
    return {
      ok: false,
      status: 422,
      json: async () => ({ error: 'BILLING_PLAN_INVALID', message }),
    } as unknown as Response;
  });
}

const d = dictEn.admin.billing.plans;

describe('PlansTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rows = [plan()];
    // A fake that behaves like the endpoint: a write lands in `rows`, so what
    // the list shows afterwards is what the API would have returned, never an
    // optimistic local push.
    http = makeTransport((method, _path, options) => {
      const body = options?.body ? (JSON.parse(options.body) as Partial<BillingPlan>) : {};
      if (method === 'POST') {
        const created = plan({ ...body, id: `p${rows.length + 1}` });
        rows = [...rows, created];
        return created;
      }
      if (method === 'PATCH') {
        rows = rows.map((row) => (row.id === 'p1' ? { ...row, ...body } : row));
        return rows.find((row) => row.id === 'p1');
      }
      return rows;
    });
    client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };
  });

  it('lists the catalogue and asks the API for the active plans only', async () => {
    renderTab();
    expect(await screen.findByText('Monthly membership')).toBeInTheDocument();
    expect(screen.getByText('Unlimited classes.')).toBeInTheDocument();
    expect(screen.getByText(d.cycle.monthly)).toBeInTheDocument();
    expect(screen.getByText(d.graceDaysValue(5))).toBeInTheDocument();
    expect(http).toHaveBeenCalledWith('GET', '/admin/billing/plans?archived=false');
  });

  it('states that a plan is re-invoiced every period', async () => {
    renderTab();
    expect(await screen.findByText(d.recurringNote)).toBeInTheDocument();
  });

  it('renders a listed amount at exponent 2', async () => {
    renderTab(BRL);
    expect(await screen.findByText('R$ 1,500.00')).toBeInTheDocument();
  });

  it('renders a listed amount at exponent 0', async () => {
    rows = [plan({ amountMinor: 100000, currency: 'JPY' })];
    renderTab(JPY);
    expect(await screen.findByText('¥ 100,000')).toBeInTheDocument();
  });

  // The reason this console formats money only through the shared formatter: a
  // currency-style number formatter accepts `BTC` and renders this amount as
  // two decimals.
  it('renders a listed amount at exponent 8', async () => {
    rows = [plan({ amountMinor: 100000, currency: 'BTC' })];
    renderTab(BTC);
    expect(await screen.findByText('₿ 0.00100000')).toBeInTheDocument();
  });

  it('round-trips the archived filter to the API instead of filtering the cached list', async () => {
    renderTab();
    await screen.findByText('Monthly membership');
    http.mockClear();

    fireEvent.change(screen.getByLabelText(d.filterLabel), { target: { value: 'archived' } });
    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('GET', '/admin/billing/plans?archived=true'),
    );

    fireEvent.change(screen.getByLabelText(d.filterLabel), { target: { value: 'all' } });
    await waitFor(() => expect(http).toHaveBeenCalledWith('GET', '/admin/billing/plans'));
  });

  it('offers exactly the three periodic cycles the API accepts', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: d.createButton }));

    const select = screen.getByLabelText(d.form.cycleLabel);
    const options = within(select).getAllByRole('option');
    expect(options.map((option) => option.getAttribute('value'))).toEqual([
      'monthly',
      'quarterly',
      'yearly',
    ]);
  });

  it('shows the resolved currency as read-only context', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: d.createButton }));

    const field = screen.getByLabelText(d.form.currencyLabel);
    expect(field).toHaveValue('BRL');
    expect(field).toHaveAttribute('readonly');
  });

  it('posts the expected create payload with an integer amount in minor units', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: d.createButton }));

    fireEvent.change(screen.getByLabelText(d.form.nameLabel), {
      target: { value: '  Quarterly membership  ' },
    });
    fireEvent.change(screen.getByPlaceholderText(d.form.descriptionPlaceholder), {
      target: { value: 'Three months of classes.' },
    });
    fireEvent.change(screen.getByLabelText(d.form.amountLabel('BRL')), {
      target: { value: '150.50' },
    });
    fireEvent.change(screen.getByLabelText(d.form.cycleLabel), {
      target: { value: 'quarterly' },
    });
    fireEvent.change(screen.getByLabelText(d.form.graceDaysLabel), { target: { value: '7' } });

    fireEvent.click(screen.getByRole('button', { name: d.submitCreate }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/plans', {
        body: JSON.stringify({
          name: 'Quarterly membership',
          description: 'Three months of classes.',
          amountMinor: 15050,
          currency: 'BRL',
          cycle: 'quarterly',
          graceDays: 7,
        }),
      }),
    );
    expect(await screen.findByText('Quarterly membership')).toBeInTheDocument();
    expect(screen.getByText(d.createSuccess('Quarterly membership'))).toBeInTheDocument();
  });

  it('submits an integer at exponent 0 rather than a fraction of a unit', async () => {
    rows = [plan({ amountMinor: 100000, currency: 'JPY' })];
    renderTab(JPY);
    fireEvent.click(await screen.findByRole('button', { name: d.createButton }));

    fireEvent.change(screen.getByLabelText(d.form.nameLabel), { target: { value: 'Kihon' } });
    fireEvent.change(screen.getByLabelText(d.form.amountLabel('JPY')), {
      target: { value: '8000' },
    });
    fireEvent.click(screen.getByRole('button', { name: d.submitCreate }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/plans', {
        body: JSON.stringify({
          name: 'Kihon',
          description: '',
          amountMinor: 8000,
          currency: 'JPY',
          cycle: 'monthly',
          graceDays: 0,
        }),
      }),
    );
  });

  it('pre-fills the edit form from the stored minor units and patches without the currency', async () => {
    renderTab();
    fireEvent.click(
      await screen.findByRole('button', { name: d.editAriaLabel('Monthly membership') }),
    );
    expect(screen.getByLabelText(d.form.amountLabel('BRL'))).toHaveValue('1500.00');

    fireEvent.change(screen.getByLabelText(d.form.amountLabel('BRL')), {
      target: { value: '1600' },
    });
    fireEvent.click(screen.getByRole('button', { name: d.submitEdit }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('PATCH', '/admin/billing/plans/p1', {
        body: JSON.stringify({
          name: 'Monthly membership',
          description: 'Unlimited classes.',
          amountMinor: 160000,
          cycle: 'monthly',
          graceDays: 5,
        }),
      }),
    );
  });

  it('refuses to submit an amount that is not a whole number of minor units, and issues no request', async () => {
    renderTab();
    fireEvent.click(
      await screen.findByRole('button', { name: d.editAriaLabel('Monthly membership') }),
    );
    fireEvent.change(screen.getByLabelText(d.form.amountLabel('BRL')), {
      target: { value: '4.567' },
    });
    http.mockClear();

    fireEvent.click(screen.getByRole('button', { name: d.submitEdit }));

    expect(await screen.findByText(d.validation.amountTooPrecise(2))).toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
  });

  it('refuses to submit a plan with no name, and issues no request', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: d.createButton }));
    http.mockClear();

    fireEvent.click(screen.getByRole('button', { name: d.submitCreate }));

    expect(await screen.findByText(d.validation.nameRequired)).toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
  });

  it('archives through the update endpoint and reloads the default list', async () => {
    renderTab();
    await screen.findByText('Monthly membership');
    http.mockClear();

    fireEvent.click(screen.getByRole('button', { name: d.archiveAriaLabel('Monthly membership') }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('PATCH', '/admin/billing/plans/p1', {
        body: JSON.stringify({ archived: true }),
      }),
    );
    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('GET', '/admin/billing/plans?archived=false'),
    );
  });

  it('un-archives an archived plan from the archived view', async () => {
    rows = [plan({ archived: true })];
    renderTab();
    fireEvent.click(
      await screen.findByRole('button', { name: d.unarchiveAriaLabel('Monthly membership') }),
    );

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('PATCH', '/admin/billing/plans/p1', {
        body: JSON.stringify({ archived: false }),
      }),
    );
  });

  it('shows the server own explanation on a rejected create and adds no row', async () => {
    const rejecting = makeRejectingTransport('A plan with this name already exists.');
    client = { adminBilling: createAdminBillingApi(rejecting as unknown as HttpTransport) };

    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: d.createButton }));
    fireEvent.change(screen.getByLabelText(d.form.nameLabel), {
      target: { value: 'Monthly membership' },
    });
    fireEvent.change(screen.getByLabelText(d.form.amountLabel('BRL')), {
      target: { value: '150.00' },
    });
    fireEvent.click(screen.getByRole('button', { name: d.submitCreate }));

    expect(await screen.findByText('A plan with this name already exists.')).toBeInTheDocument();
    // Header row plus the single plan that was already there.
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.queryByText(d.createSuccess('Monthly membership'))).not.toBeInTheDocument();
  });

  it('tells a fresh tenant that a plan is the prerequisite for signing a contract', async () => {
    rows = [];
    renderTab();
    expect(await screen.findByText(d.empty)).toBeInTheDocument();
  });

  /**
   * §4.1: with no resolved currency there is no recorded exponent, and an
   * assumed two decimals is exactly the failure the shared formatter exists to
   * prevent — so writing is disabled rather than guessed.
   */
  it('disables writing when no currency could be resolved, and says why', async () => {
    renderTab(null);
    await screen.findByText(dictEn.admin.billing.money.resolveError);
    expect(screen.getByRole('button', { name: d.createButton })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: d.editAriaLabel('Monthly membership') }),
    ).toBeDisabled();
  });

  /** Archive is not delete: the API has no destructive call and contracts reference the plan. */
  it('offers no destructive control anywhere on the tab', async () => {
    const { container } = renderTab();
    await screen.findByText('Monthly membership');

    const names = within(container)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '');

    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).not.toMatch(/delete|remove|destroy|erase|drop/i);
    }
  });

  /** Nothing on this tab may gate, suspend, downgrade or paywall access. */
  it('offers no control that would restrict a student access', async () => {
    const { container } = renderTab();
    await screen.findByText('Monthly membership');

    const names = within(container)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '');

    for (const name of names) {
      expect(name).not.toMatch(/suspend|block|lock|revoke|restrict|disable|downgrade|paywall/i);
    }
  });
});
