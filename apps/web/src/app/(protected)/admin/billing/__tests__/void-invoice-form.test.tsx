import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createAdminBillingApi } from '@web/lib/admin-billing-api';
import type { BillingInvoiceWithBalance } from '@web/lib/admin-billing-api';
import type { HttpTransport } from '@web/lib/api-client';
import { makeTransport } from './test-transport';
import { VoidInvoiceForm } from '../void-invoice-form';

const invoice: BillingInvoiceWithBalance = {
  id: 'inv-11111111-aaaa',
  subscriptionId: 'sub-1',
  userId: 'u1',
  periodStart: '2026-08-01',
  periodEnd: '2026-09-01',
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

let http: ReturnType<typeof makeTransport>;
let client: { adminBilling: ReturnType<typeof createAdminBillingApi> };

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

const d = dictEn.admin.billing.ledger.voidInvoice;

const onVoided = vi.fn();
const onClose = vi.fn();

function renderForm() {
  return render(
    <DictProvider value={dictEn}>
      <VoidInvoiceForm invoice={invoice} onClose={onClose} onVoided={onVoided} />
    </DictProvider>,
  );
}

describe('VoidInvoiceForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    http = makeTransport(() => ({}));
    client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };
  });

  it('voids the invoice with the reason the admin typed', async () => {
    renderForm();

    fireEvent.change(screen.getByPlaceholderText(d.reasonPlaceholder), {
      target: { value: 'Issued to the wrong student.' },
    });
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/invoices/inv-11111111-aaaa/void', {
        body: JSON.stringify({ reason: 'Issued to the wrong student.' }),
      }),
    );
    expect(onVoided).toHaveBeenCalledTimes(1);
  });

  it('refuses a blank reason and issues no request', async () => {
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    expect(await screen.findByText(d.reasonRequired)).toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
    expect(onVoided).not.toHaveBeenCalled();
  });

  it('refuses a reason made only of whitespace, which the server also rejects', async () => {
    renderForm();

    fireEvent.change(screen.getByPlaceholderText(d.reasonPlaceholder), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    expect(await screen.findByText(d.reasonRequired)).toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
  });

  it('names the invoice it will void and offers no delete control', () => {
    const { container } = renderForm();

    expect(screen.getByText(d.invoiceLine('inv-1111'))).toBeInTheDocument();
    expect(screen.getByText(d.explainer)).toBeInTheDocument();

    for (const button of within(container).getAllByRole('button')) {
      const name = button.getAttribute('aria-label') ?? button.textContent ?? '';
      expect(name).not.toMatch(/delete|remove|erase|excluir|apagar|remover/i);
    }
  });

  it("surfaces the server's own refusal", async () => {
    http = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'CONFLICT', message: 'the invoice is already void' }),
    })) as unknown as ReturnType<typeof makeTransport>;
    client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };

    renderForm();
    fireEvent.change(screen.getByPlaceholderText(d.reasonPlaceholder), {
      target: { value: 'Duplicate.' },
    });
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    expect(await screen.findByText('the invoice is already void')).toBeInTheDocument();
    expect(onVoided).not.toHaveBeenCalled();
  });
});
