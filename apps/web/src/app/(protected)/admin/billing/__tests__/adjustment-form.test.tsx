import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createAdminBillingApi } from '@web/lib/admin-billing-api';
import type {
  AdjustmentKind,
  BillingInvoiceWithBalance,
  BillingReportCurrency,
} from '@web/lib/admin-billing-api';
import type { HttpTransport } from '@web/lib/api-client';
import { makeTransport } from './test-transport';
import { AdjustmentForm } from '../adjustment-form';

const BRL: BillingReportCurrency = { code: 'BRL', exponent: 2, symbol: 'R$' };
const JPY: BillingReportCurrency = { code: 'JPY', exponent: 0, symbol: '¥' };
const BTC: BillingReportCurrency = { code: 'BTC', exponent: 8, symbol: '₿' };

function invoiceIn(code: string): BillingInvoiceWithBalance {
  return {
    id: 'inv-11111111-aaaa',
    subscriptionId: 'sub-1',
    userId: 'u1',
    periodStart: '2026-08-01',
    periodEnd: '2026-09-01',
    dueDate: '2026-08-10',
    amountMinor: 50000,
    balanceMinor: 50000,
    currency: code,
    graceDays: 5,
    status: 'open',
    issuedAt: '2026-08-01T00:00:00Z',
    voidedAt: null,
    voidReason: null,
  };
}

let http: ReturnType<typeof makeTransport>;
let client: { adminBilling: ReturnType<typeof createAdminBillingApi> };

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

const d = dictEn.admin.billing.ledger.adjustment;
const kinds = dictEn.admin.billing.ledger.adjustmentKind;
const planValidation = dictEn.admin.billing.plans.validation;

const onApplied = vi.fn();
const onClose = vi.fn();

function renderForm(currency: BillingReportCurrency | null, code = currency?.code ?? 'BRL') {
  return render(
    <DictProvider value={dictEn}>
      <AdjustmentForm
        invoice={invoiceIn(code)}
        currency={currency}
        onClose={onClose}
        onApplied={onApplied}
      />
    </DictProvider>,
  );
}

const PATH = '/admin/billing/invoices/inv-11111111-aaaa/adjustments';

async function applyKind(kind: AdjustmentKind, magnitude: string, reason = 'Agreed in March.') {
  fireEvent.click(screen.getByRole('radio', { name: new RegExp(kinds[kind]) }));
  fireEvent.change(screen.getByLabelText(d.amountLabel('BRL')), { target: { value: magnitude } });
  fireEvent.change(screen.getByPlaceholderText(d.reasonPlaceholder), {
    target: { value: reason },
  });
  fireEvent.click(screen.getByRole('button', { name: d.submit }));
}

describe('AdjustmentForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    http = makeTransport(() => ({}));
    client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };
  });

  /**
   * The finding that drives this form: the API does not validate the sign
   * against the kind, so a positive `discount` would raise the debt under a row
   * reading "Discount". The form owns the sign; the administrator types a
   * magnitude.
   */
  it.each<[AdjustmentKind, number]>([
    ['discount', -5000],
    ['credit', -5000],
    ['waiver', -5000],
    ['surcharge', 5000],
  ])('derives the sign of a %s from its kind, not from what was typed', async (kind, expected) => {
    renderForm(BRL);
    await applyKind(kind, '50');

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', PATH, {
        body: JSON.stringify({ kind, amountMinor: expected, reason: 'Agreed in March.' }),
      }),
    );
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it('offers no way to type a negative amount, so the kind stays the only source of direction', async () => {
    renderForm(BRL);
    await applyKind('discount', '-50');

    expect(await screen.findByText(planValidation.amountNegative)).toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
  });

  it('states how each kind moves the balance, and shows the signed value before submission', () => {
    renderForm(BRL);

    expect(screen.getByText(d.kindEffect.discount)).toBeInTheDocument();
    expect(screen.getByText(d.kindEffect.credit)).toBeInTheDocument();
    expect(screen.getByText(d.kindEffect.waiver)).toBeInTheDocument();
    expect(screen.getByText(d.kindEffect.surcharge)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(d.amountLabel('BRL')), { target: { value: '50' } });
    expect(screen.getByText(d.signedPreview('-R$ 50.00'))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: new RegExp(kinds.surcharge) }));
    expect(screen.getByText(d.signedPreview('R$ 50.00'))).toBeInTheDocument();
  });

  it('refuses a blank reason and issues no request', async () => {
    renderForm(BRL);

    fireEvent.change(screen.getByLabelText(d.amountLabel('BRL')), { target: { value: '50' } });
    fireEvent.change(screen.getByPlaceholderText(d.reasonPlaceholder), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    expect(await screen.findByText(d.reasonRequired)).toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
  });

  it('refuses a zero adjustment, which the server refuses too', async () => {
    renderForm(BRL);
    await applyKind('discount', '0');

    expect(await screen.findByText(d.validation.amountZero)).toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
  });

  it('submits an integer count of minor units at exponent 0', async () => {
    renderForm(JPY, 'JPY');

    fireEvent.change(screen.getByLabelText(d.amountLabel('JPY')), { target: { value: '5000' } });
    fireEvent.change(screen.getByPlaceholderText(d.reasonPlaceholder), {
      target: { value: 'Scholarship.' },
    });
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', PATH, {
        body: JSON.stringify({ kind: 'discount', amountMinor: -5000, reason: 'Scholarship.' }),
      }),
    );
  });

  it('submits an integer count of minor units at exponent 8', async () => {
    renderForm(BTC, 'BTC');

    fireEvent.change(screen.getByLabelText(d.amountLabel('BTC')), { target: { value: '0.001' } });
    fireEvent.change(screen.getByPlaceholderText(d.reasonPlaceholder), {
      target: { value: 'Scholarship.' },
    });
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', PATH, {
        body: JSON.stringify({ kind: 'discount', amountMinor: -100000, reason: 'Scholarship.' }),
      }),
    );
  });

  /**
   * Milestone Non-Goal: nothing accrues a late fee. A surcharge exists only
   * because an administrator typed one, so no percentage and no recurrence
   * control may appear on this form.
   */
  it('offers no percentage, recurrence or delete control', () => {
    const { container } = renderForm(BRL);

    expect(screen.getByText(d.manualOnlyNote)).toBeInTheDocument();

    const labels = Array.from(container.querySelectorAll('label, button')).map(
      (node) => node.getAttribute('aria-label') ?? node.textContent ?? '',
    );
    for (const label of labels) {
      expect(label).not.toMatch(/%|percent|percentual|monthly|recurring|recorrente|interest|juros/i);
      expect(label).not.toMatch(/delete|remove|erase|excluir|apagar|remover/i);
    }
    expect(within(container).queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it("surfaces the server's own refusal", async () => {
    http = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'CONFLICT', message: 'a void invoice cannot be adjusted' }),
    })) as unknown as ReturnType<typeof makeTransport>;
    client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };

    renderForm(BRL);
    await applyKind('discount', '50');

    expect(await screen.findByText('a void invoice cannot be adjusted')).toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
  });
});
