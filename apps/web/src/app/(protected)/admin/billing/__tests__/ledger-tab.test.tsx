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
      // The issue form reads the contracts it can bill; none is needed here.
      if (path.startsWith('/admin/billing/subscriptions')) return [];
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

  /**
   * The four write actions this tab owns. Each opens its own form; the request
   * payloads are asserted in that form's own spec.
   */
  it('opens the three per-invoice write actions from the expanded invoice', async () => {
    renderTab();
    await expandInvoice();

    fireEvent.click(screen.getByRole('button', { name: d.payment.buttonAriaLabel('inv-1111') }));
    expect(await screen.findByRole('dialog', { name: d.payment.dialogTitle })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: d.payment.cancel }));

    fireEvent.click(screen.getByRole('button', { name: d.adjustment.buttonAriaLabel('inv-1111') }));
    expect(
      await screen.findByRole('dialog', { name: d.adjustment.dialogTitle }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: d.adjustment.cancel }));

    fireEvent.click(
      screen.getByRole('button', { name: d.voidInvoice.buttonAriaLabel('inv-1111') }),
    );
    expect(
      await screen.findByRole('dialog', { name: d.voidInvoice.dialogTitle }),
    ).toBeInTheDocument();
  });

  it('opens the issue form from the tab header', async () => {
    renderTab();
    await screen.findByText('Alice Doe');

    fireEvent.click(screen.getByRole('button', { name: d.issue.buttonAriaLabel }));
    expect(await screen.findByRole('dialog', { name: d.issue.dialogTitle })).toBeInTheDocument();
  });

  it('explains that a correction is an entry rather than an edit', async () => {
    renderTab();
    expect(await screen.findByText(d.correctionNote)).toBeInTheDocument();
  });

  /**
   * A recorded payment renders beneath its invoice with its method and its
   * author — the criterion this tab satisfies on its own.
   */
  it('renders a recorded payment beneath its invoice with its method and author', async () => {
    payments = [original];
    renderTab();
    await expandInvoice();

    expect(screen.getByText(`${d.method.cash} · R$ 500.00`)).toBeInTheDocument();
    expect(screen.getByText(`2026-08-09 · ${d.recordedBy('admin-1')}`)).toBeInTheDocument();
  });

  /**
   * A void invoice takes no further entry; the tab says so rather than offering
   * three controls the server would refuse.
   */
  it('offers no write action on a void invoice', async () => {
    http = makeTransport((method, path) => {
      if (path.startsWith('/admin/billing/invoices')) return [{ ...invoice, status: 'void' }];
      if (path.includes('/statement')) return statementWith([]);
      if (path.startsWith('/admin/billing/subscriptions')) return [];
      return {};
    });
    client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };

    renderTab();
    await expandInvoice();

    expect(screen.getByText(d.voidedNote)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: d.payment.buttonAriaLabel('inv-1111') }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: d.voidInvoice.buttonAriaLabel('inv-1111') }),
    ).not.toBeInTheDocument();
  });

  /**
   * After a write the list is re-read — so the invoice's status is the server's
   * and never a local recomputation — and the CSV export still serialises the
   * rows in memory without a request of its own.
   */
  it('re-reads the list after a write and keeps the CSV export request-free', async () => {
    const createObjectURL = vi.fn(() => 'blob:ledger');
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });

    renderTab();
    await expandInvoice();

    fireEvent.click(
      screen.getByRole('button', { name: d.voidInvoice.buttonAriaLabel('inv-1111') }),
    );
    fireEvent.change(await screen.findByPlaceholderText(d.voidInvoice.reasonPlaceholder), {
      target: { value: 'Issued to the wrong student.' },
    });
    fireEvent.click(screen.getByRole('button', { name: d.voidInvoice.submit }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(d.voidInvoice.success),
    );
    expect(http).toHaveBeenCalledWith('GET', '/admin/billing/invoices');

    http.mockClear();
    fireEvent.click(screen.getByRole('button', { name: d.exportAriaLabel }));
    expect(createObjectURL).toHaveBeenCalled();
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
