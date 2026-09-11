import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createAdminBillingApi } from '@web/lib/admin-billing-api';
import type {
  BillingInvoiceWithBalance,
  BillingPayment,
  BillingReportCurrency,
  BillingStudentStatement,
} from '@web/lib/admin-billing-api';
import type { HttpTransport } from '@web/lib/api-client';
import { makeTransport } from './test-transport';
import { LedgerTab } from '../ledger-tab';

const BRL: BillingReportCurrency = { code: 'BRL', exponent: 2, symbol: 'R$' };

const invoice: BillingInvoiceWithBalance = {
  id: 'inv-11111111-aaaa',
  subscriptionId: 'sub-1',
  userId: 'u1',
  periodStart: '2026-08-01',
  periodEnd: '2026-08-31',
  dueDate: '2026-08-10',
  amountMinor: 50000,
  balanceMinor: 50000,
  currency: 'BRL',
  graceDays: 5,
  status: 'open',
  issuedAt: '2026-08-01T00:00:00Z',
  voidedAt: null,
  voidReason: null,
};

const original: BillingPayment = {
  id: 'pay-22222222-bbbb',
  invoiceId: invoice.id,
  amountMinor: 50000,
  currency: 'BRL',
  method: 'cash',
  paidAt: '2026-08-09',
  externalReference: null,
  note: '',
  reversesId: null,
  recordedBy: 'admin-1',
  recordedAt: '2026-08-09T00:00:00Z',
};

const reversal: BillingPayment = {
  id: 'pay-33333333-cccc',
  invoiceId: invoice.id,
  amountMinor: -50000,
  currency: 'BRL',
  method: 'cash',
  paidAt: '2026-08-20',
  externalReference: null,
  note: 'Cheque bounced.',
  reversesId: original.id,
  recordedBy: 'admin-7',
  recordedAt: '2026-08-20T00:00:00Z',
};

function statementWith(payments: BillingPayment[]): BillingStudentStatement {
  return {
    userId: 'u1',
    currency: BRL,
    studentSince: '2025-01-01',
    currentMembershipSince: '2025-01-01',
    outstandingMinor: 0,
    contractGroups: [],
    invoices: [
      {
        ...invoice,
        balanceMinor: 0,
        adjustments: [
          {
            id: 'adj-1',
            invoiceId: invoice.id,
            kind: 'discount',
            amountMinor: -5000,
            reason: 'Scholarship.',
            appliedBy: 'admin-1',
            appliedAt: '2026-08-02',
          },
        ],
        payments,
      },
    ],
  };
}

let http: ReturnType<typeof makeTransport>;
let client: { adminBilling: ReturnType<typeof createAdminBillingApi> };
let payments: BillingPayment[] = [];

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

const d = dictEn.admin.billing.ledger;

function renderTab() {
  return render(
    <DictProvider value={dictEn}>
      <LedgerTab
        currency={BRL}
        nameOf={() => 'Alice Doe'}
        students={[{ id: 'u1', name: 'Alice Doe' }]}
      />
    </DictProvider>,
  );
}

async function expandInvoice() {
  fireEvent.click(await screen.findByRole('button', { name: d.expandAriaLabel('inv-1111') }));
  await screen.findByText(d.paymentsHeading);
}

describe('LedgerTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    payments = [original, reversal];
    http = makeTransport((method, path) => {
      if (path.startsWith('/admin/billing/invoices')) return [invoice];
      if (path.includes('/statement')) return statementWith(payments);
      return {};
    });
    client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };
  });

  it('lists the invoices the filters fetched', async () => {
    renderTab();
    expect(await screen.findByText('Alice Doe')).toBeInTheDocument();
    // Amount and balance both render through `formatMoney`.
    expect(screen.getAllByText('R$ 500.00')).toHaveLength(2);
  });

  /**
   * The deliverable: the ledger is append-only in the UI too. Reverse is the
   * affordance, and no Delete control exists for a payment or an adjustment.
   */
  it('offers no Delete control for a payment or an adjustment', async () => {
    const { container } = renderTab();
    await expandInvoice();

    const names = within(container)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '');

    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).not.toMatch(/delete|remove|erase|excluir|apagar|remover/i);
    }
    expect(screen.queryByText(dictEn.common.delete)).not.toBeInTheDocument();
  });

  it('renders a reversal inline under its original, with its reason and its author', async () => {
    renderTab();
    await expandInvoice();

    const originalRow = screen.getByText(`${d.method.cash} · R$ 500.00`).closest('li');
    expect(originalRow).not.toBeNull();

    const scoped = within(originalRow as HTMLElement);
    expect(
      scoped.getByText(`${d.reversalOf('pay-2222')} · -R$ 500.00`),
    ).toBeInTheDocument();
    expect(scoped.getByText(d.reasonLine('Cheque bounced.'))).toBeInTheDocument();
    expect(scoped.getByText(`2026-08-20 · ${d.recordedBy('admin-7')}`)).toBeInTheDocument();
  });

  it('marks an already reversed payment instead of offering to reverse it twice', async () => {
    renderTab();
    await expandInvoice();
    expect(screen.getByText(d.alreadyReversed)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: d.reverseAriaLabel('pay-2222') }),
    ).not.toBeInTheDocument();
  });

  it('refuses to reverse a payment without a reason', async () => {
    payments = [original];
    renderTab();
    await expandInvoice();

    fireEvent.click(screen.getByRole('button', { name: d.reverseAriaLabel('pay-2222') }));
    http.mockClear();
    fireEvent.click(screen.getByRole('button', { name: d.reverseSubmit }));

    expect(await screen.findByText(d.reverseReasonRequired)).toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
  });

  it('reverses a payment with the reason the admin typed', async () => {
    payments = [original];
    renderTab();
    await expandInvoice();

    fireEvent.click(screen.getByRole('button', { name: d.reverseAriaLabel('pay-2222') }));
    fireEvent.change(screen.getByPlaceholderText(d.reverseReasonPlaceholder), {
      target: { value: 'Cheque bounced.' },
    });
    fireEvent.click(screen.getByRole('button', { name: d.reverseSubmit }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', `/admin/billing/payments/${original.id}/reverse`, {
        body: JSON.stringify({ reason: 'Cheque bounced.' }),
      }),
    );
  });

  it('exports the current view client-side, without issuing a new request', async () => {
    const createObjectURL = vi.fn(() => 'blob:ledger');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, writable: true });

    renderTab();
    await screen.findByText('Alice Doe');
    http.mockClear();

    fireEvent.click(screen.getByRole('button', { name: d.exportAriaLabel }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(http).not.toHaveBeenCalled();
  });

  it('sends the ledger filters to the API rather than narrowing the fetched rows', async () => {
    renderTab();
    await screen.findByText('Alice Doe');
    http.mockClear();

    fireEvent.change(screen.getByLabelText(d.filters.status), { target: { value: 'open' } });
    fireEvent.change(screen.getByLabelText(d.filters.from), { target: { value: '2026-08-01' } });
    fireEvent.click(screen.getByRole('button', { name: d.filters.apply }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith(
        'GET',
        '/admin/billing/invoices?status=open&from=2026-08-01',
      ),
    );
  });
});
