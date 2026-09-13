import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computePeriod } from '@arenaquest/shared/domain/billing/billing-cycle';
import { Entities } from '@arenaquest/shared/types/entities';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createAdminBillingApi } from '@web/lib/admin-billing-api';
import type {
  BillingReportCurrency,
  BillingSubscription,
} from '@web/lib/admin-billing-api';
import type { HttpTransport } from '@web/lib/api-client';
import { makeTransport } from './test-transport';
import { IssueInvoiceForm } from '../issue-invoice-form';

const BRL: BillingReportCurrency = { code: 'BRL', exponent: 2, symbol: 'R$' };

const active: BillingSubscription = {
  id: 'sub-1',
  userId: 'u1',
  planId: 'plan-1',
  contractGroupId: 'grp-1',
  supersedesId: null,
  termsSource: 'standard',
  amountMinor: 50000,
  currency: 'BRL',
  cycle: 'monthly',
  graceDays: 5,
  dueDay: 10,
  status: 'active',
  startDate: '2026-01-15',
  endDate: null,
  termsNote: '',
  signedBy: 'admin-1',
  signedAt: '2026-01-15T00:00:00Z',
  updatedAt: '2026-01-15T00:00:00Z',
};

const cancelled: BillingSubscription = {
  ...active,
  id: 'sub-2',
  userId: 'u2',
  contractGroupId: 'grp-2',
  status: 'cancelled',
  endDate: '2026-06-30',
};

const NAMES: Record<string, string> = { u1: 'Alice Doe', u2: 'Bob Roe' };
const nameOf = (userId: string) => NAMES[userId] ?? userId;

let http: ReturnType<typeof makeTransport>;
let client: { adminBilling: ReturnType<typeof createAdminBillingApi> };

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

const d = dictEn.admin.billing.ledger.issue;

const onIssued = vi.fn();
const onClose = vi.fn();

function renderForm() {
  return render(
    <DictProvider value={dictEn}>
      <IssueInvoiceForm
        currency={BRL}
        nameOf={nameOf}
        onClose={onClose}
        onIssued={onIssued}
      />
    </DictProvider>,
  );
}

/** The same shared implementation the service bills with — not a second copy. */
const expected = computePeriod(
  Entities.Config.BillingCycle.MONTHLY,
  active.startDate,
  active.dueDay,
  '2026-08-20',
);

async function chooseActiveContract() {
  fireEvent.click(await screen.findByRole('radio', { name: /Alice Doe/ }));
  fireEvent.change(screen.getByLabelText(d.referenceDateLabel), {
    target: { value: '2026-08-20' },
  });
}

describe('IssueInvoiceForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    http = makeTransport((method, path) => {
      if (method === 'GET' && path.startsWith('/admin/billing/subscriptions')) {
        return [active, cancelled];
      }
      return { id: 'inv-99999999-zzzz' };
    });
    client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };
  });

  it('names the contract and the period it bills, resolved by the shared rule', async () => {
    renderForm();
    await chooseActiveContract();

    expect(screen.getByText(d.periodValue(expected.periodStart, expected.periodEnd))).toBeInTheDocument();
    expect(screen.getByText(expected.dueDate)).toBeInTheDocument();
    // The contract's own recorded amount, which is what the server bills.
    expect(screen.getByText('R$ 500.00')).toBeInTheDocument();
  });

  it('submits the period and due date explicitly, so the server cannot store another', async () => {
    renderForm();
    await chooseActiveContract();
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/invoices', {
        body: JSON.stringify({
          subscriptionId: 'sub-1',
          periodStart: expected.periodStart,
          periodEnd: expected.periodEnd,
          dueDate: expected.dueDate,
        }),
      }),
    );
    expect(onIssued).toHaveBeenCalledWith('inv-9999');
  });

  it('moves the resolved period when the reference date moves', async () => {
    renderForm();
    await chooseActiveContract();

    fireEvent.change(screen.getByLabelText(d.referenceDateLabel), {
      target: { value: '2026-09-20' },
    });

    const next = computePeriod(
      Entities.Config.BillingCycle.MONTHLY,
      active.startDate,
      active.dueDay,
      '2026-09-20',
    );
    expect(screen.getByText(d.periodValue(next.periodStart, next.periodEnd))).toBeInTheDocument();
  });

  /**
   * `UNIQUE (subscription_id, period_start)` is what makes the daily run
   * idempotent. A second attempt is refused by the server, and the refusal is
   * reported as exactly that rather than swallowed as success.
   */
  it("reports the already-issued refusal in the server's own words and creates nothing", async () => {
    const message = 'the contract already has an invoice for the period starting 2026-08-15';
    let posts = 0;
    http = vi.fn(async (method: string) => {
      if (method === 'GET') {
        return { ok: true, status: 200, json: async () => [active] } as unknown as Response;
      }
      posts += 1;
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'CONFLICT', message }),
      } as unknown as Response;
    }) as unknown as ReturnType<typeof makeTransport>;
    client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };

    renderForm();
    await chooseActiveContract();
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(posts).toBe(1);
    expect(onIssued).not.toHaveBeenCalled();
  });

  it('lists a contract the server will refuse rather than hiding it, and reports that refusal', async () => {
    renderForm();

    // The cancelled contract is listed with its status: the refusal belongs to
    // the server, and a hidden row would teach a rule the client only guesses.
    const row = await screen.findByRole('radio', { name: /Bob Roe/ });
    expect(row).toBeInTheDocument();
    expect(
      screen.getByText(
        d.contractMeta(
          dictEn.admin.billing.plans.cycle.monthly,
          d.contractStatus.cancelled,
          active.startDate,
        ),
      ),
    ).toBeInTheDocument();
  });

  it('refuses to submit without a contract, issuing no write', async () => {
    renderForm();
    await screen.findByRole('radio', { name: /Alice Doe/ });
    http.mockClear();

    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    expect(await screen.findByText(d.contractRequired)).toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
  });

  it('presents itself as billing a contract period and never as a way to sell something', async () => {
    const { container } = renderForm();
    await screen.findByRole('radio', { name: /Alice Doe/ });

    expect(screen.getByText(d.explainer)).toBeInTheDocument();
    expect(screen.getByText(d.notASaleNote)).toBeInTheDocument();
    expect(screen.getByText(d.uniquenessNote)).toBeInTheDocument();

    // No free-text amount, item or description control: the amount billed is
    // the contract's, and there is nothing else here to charge for. The only
    // free-text field is the picker's search box, which is a `searchbox`.
    expect(within(container).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(container).queryAllByRole('spinbutton')).toHaveLength(0);
    expect(within(container).getAllByRole('searchbox')).toHaveLength(1);
  });

  it('offers no delete control', async () => {
    const { container } = renderForm();
    await screen.findByRole('radio', { name: /Alice Doe/ });

    for (const button of within(container).getAllByRole('button')) {
      const name = button.getAttribute('aria-label') ?? button.textContent ?? '';
      expect(name).not.toMatch(/delete|remove|erase|excluir|apagar|remover/i);
    }
  });
});
