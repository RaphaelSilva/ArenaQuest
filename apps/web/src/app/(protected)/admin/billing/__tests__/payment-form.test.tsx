import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createAdminBillingApi } from '@web/lib/admin-billing-api';
import type {
  BillingInvoiceWithBalance,
  BillingReportCurrency,
} from '@web/lib/admin-billing-api';
import type { HttpTransport } from '@web/lib/api-client';
import { makeTransport } from './test-transport';
import { PaymentForm } from '../payment-form';

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

const d = dictEn.admin.billing.ledger.payment;
const planValidation = dictEn.admin.billing.plans.validation;

const onRecorded = vi.fn();
const onClose = vi.fn();

function renderForm(currency: BillingReportCurrency | null, code = currency?.code ?? 'BRL') {
  return render(
    <DictProvider value={dictEn}>
      <PaymentForm
        invoice={invoiceIn(code)}
        currency={currency}
        onClose={onClose}
        onRecorded={onRecorded}
      />
    </DictProvider>,
  );
}

describe('PaymentForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    http = makeTransport(() => ({}));
    client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };
  });

  it('records a payment as integer minor units, with the method and no currency of its own', async () => {
    renderForm(BRL);

    fireEvent.change(screen.getByLabelText(d.amountLabel('BRL')), { target: { value: '199.99' } });
    fireEvent.change(screen.getByLabelText(d.methodLabel), { target: { value: 'pix' } });
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/invoices/inv-11111111-aaaa/payments', {
        // No `currency`: the server records the invoice's own, so a mismatch is
        // unreachable rather than merely unlikely.
        body: JSON.stringify({ amountMinor: 19999, method: 'pix' }),
      }),
    );
    expect(onRecorded).toHaveBeenCalledTimes(1);
  });

  it('sends the paid-at date and the external reference only when they were filled', async () => {
    renderForm(BRL);

    fireEvent.change(screen.getByLabelText(d.amountLabel('BRL')), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(d.paidAtLabel), { target: { value: '2026-08-09' } });
    fireEvent.change(screen.getByLabelText(d.referenceLabel), { target: { value: 'E12345' } });
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/invoices/inv-11111111-aaaa/payments', {
        body: JSON.stringify({
          amountMinor: 5000,
          method: 'cash',
          paidAt: '2026-08-09',
          externalReference: 'E12345',
        }),
      }),
    );
  });

  /** Exponents 0 and 8: the amount is scaled by the currency's own exponent. */
  it('submits at exponent 0 without a separator', async () => {
    renderForm(JPY, 'JPY');

    fireEvent.change(screen.getByLabelText(d.amountLabel('JPY')), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/invoices/inv-11111111-aaaa/payments', {
        body: JSON.stringify({ amountMinor: 5000, method: 'cash' }),
      }),
    );
  });

  it('submits at exponent 8 without a floating-point round trip', async () => {
    renderForm(BTC, 'BTC');

    fireEvent.change(screen.getByLabelText(d.amountLabel('BTC')), { target: { value: '0.001' } });
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/invoices/inv-11111111-aaaa/payments', {
        // 0.001 * 1e8 read as a float is 100000.00000000001.
        body: JSON.stringify({ amountMinor: 100000, method: 'cash' }),
      }),
    );
  });

  it('refuses an amount more precise than the currency, issuing no request', async () => {
    renderForm(JPY, 'JPY');

    fireEvent.change(screen.getByLabelText(d.amountLabel('JPY')), { target: { value: '10.5' } });
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    expect(await screen.findByText(planValidation.amountTooPrecise(0))).toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
  });

  it('refuses a zero payment and points at the reversal instead', async () => {
    renderForm(BRL);

    fireEvent.change(screen.getByLabelText(d.amountLabel('BRL')), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    expect(await screen.findByText(d.validation.amountZero)).toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
  });

  it("surfaces the server's own refusal rather than a generic failure", async () => {
    http = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'CONFLICT', message: 'a void invoice cannot receive a payment' }),
    })) as unknown as ReturnType<typeof makeTransport>;
    client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };

    renderForm(BRL);
    fireEvent.change(screen.getByLabelText(d.amountLabel('BRL')), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    expect(
      await screen.findByText('a void invoice cannot receive a payment'),
    ).toBeInTheDocument();
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('previews no resulting status or balance, and offers no delete control', () => {
    const { container } = renderForm(BRL);

    // The balance shown is the one the server reported, unmodified.
    expect(screen.getByText(d.balanceLabel)).toBeInTheDocument();
    expect(screen.getByText('R$ 500.00')).toBeInTheDocument();

    for (const button of within(container).getAllByRole('button')) {
      const name = button.getAttribute('aria-label') ?? button.textContent ?? '';
      expect(name).not.toMatch(/delete|remove|erase|excluir|apagar|remover/i);
    }
  });
});

describe('PaymentForm — Online (gateway)', () => {
  const g = dictEn.admin.billing.gateway.form;
  const providers = dictEn.admin.billing.gateway.provider;
  const onReferenceExists = vi.fn();

  const PENDING = {
    checkoutId: 'chk-1',
    provider: 'mercadopago' as const,
    createdAt: '2026-11-26T14:03:00.000Z',
    expiresAt: '2026-11-27T14:03:00.000Z',
    createdBy: 'u1',
  };

  function renderGateway(props: Partial<React.ComponentProps<typeof PaymentForm>> = {}) {
    return render(
      <DictProvider value={dictEn}>
        <PaymentForm
          invoice={invoiceIn('BRL')}
          currency={BRL}
          onClose={onClose}
          onRecorded={onRecorded}
          onReferenceExists={onReferenceExists}
          {...props}
        />
      </DictProvider>,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    http = makeTransport(() => ({}));
    client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };
  });

  it('replaces the free-form reference with a provider and its payment id', () => {
    renderGateway({ payOptions: [{ provider: 'mercadopago', methods: ['pix'] }] });
    expect(screen.getByLabelText(d.referenceLabel)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(d.methodLabel), { target: { value: 'gateway' } });

    expect(screen.queryByLabelText(d.referenceLabel)).not.toBeInTheDocument();
    const select = screen.getByLabelText(g.providerLabel) as HTMLSelectElement;
    // The bound list, not every provider the platform knows.
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      providers.mercadopago,
    ]);
    expect(screen.getByLabelText(g.paymentIdLabel)).toBeInTheDocument();
  });

  it('refuses an online payment without the provider payment id, issuing no request', async () => {
    renderGateway();
    fireEvent.change(screen.getByLabelText(d.amountLabel('BRL')), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText(d.methodLabel), { target: { value: 'gateway' } });
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    expect(await screen.findByText(g.paymentIdRequired)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(g.paymentIdLabel), { target: { value: '123 456' } });
    fireEvent.click(screen.getByRole('button', { name: d.submit }));
    expect(await screen.findByText(g.paymentIdInvalid)).toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
  });

  it('records the reference as <provider>:<id>', async () => {
    renderGateway({
      payOptions: [
        { provider: 'mercadopago', methods: ['pix'] },
        { provider: 'stripe', methods: ['card'] },
      ],
    });
    fireEvent.change(screen.getByLabelText(d.amountLabel('BRL')), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText(d.methodLabel), { target: { value: 'gateway' } });
    fireEvent.change(screen.getByLabelText(g.providerLabel), { target: { value: 'stripe' } });
    fireEvent.change(screen.getByLabelText(g.paymentIdLabel), { target: { value: ' pi_3Abc ' } });
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/invoices/inv-11111111-aaaa/payments', {
        body: JSON.stringify({
          amountMinor: 50000,
          method: 'gateway',
          externalReference: 'stripe:pi_3Abc',
        }),
      }),
    );
    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
  });

  it('opens prefilled for a match by hand — method, provider, id, amount and date', async () => {
    renderGateway({
      // The exception row's provider is offered even when it is no longer bound.
      payOptions: [{ provider: 'stripe', methods: ['card'] }],
      prefill: {
        method: 'gateway',
        provider: 'mercadopago',
        providerPaymentId: '123456789',
        amountMinor: 18050,
        paidAt: '2026-11-20',
      },
    });

    expect(screen.getByLabelText(d.methodLabel)).toHaveValue('gateway');
    expect(screen.getByLabelText(g.providerLabel)).toHaveValue('mercadopago');
    expect(screen.getByLabelText(g.paymentIdLabel)).toHaveValue('123456789');
    expect(screen.getByLabelText(d.amountLabel('BRL'))).toHaveValue('180.50');
    expect(screen.getByLabelText(d.paidAtLabel)).toHaveValue('2026-11-20');

    fireEvent.click(screen.getByRole('button', { name: d.submit }));
    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/invoices/inv-11111111-aaaa/payments', {
        body: JSON.stringify({
          amountMinor: 18050,
          method: 'gateway',
          paidAt: '2026-11-20',
          externalReference: 'mercadopago:123456789',
        }),
      }),
    );
  });

  it('names the existing payment when the reference already landed, and records nothing', async () => {
    http.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'PAYMENT_REFERENCE_EXISTS',
        message: 'a gateway payment with this reference already exists',
        paymentId: 'pay-99999999-zzzz',
      }),
    } as unknown as Response);
    renderGateway({
      prefill: { method: 'gateway', provider: 'mercadopago', providerPaymentId: '123456789' },
    });
    fireEvent.change(screen.getByLabelText(d.amountLabel('BRL')), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(g.duplicate('pay-9999'));
    expect(onReferenceExists).toHaveBeenCalledWith('pay-99999999-zzzz');
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('warns about an open checkout without blocking the payment', async () => {
    http = makeTransport(() => ({ id: 'pay-1', pendingCheckout: PENDING }));
    client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };
    renderGateway({ pendingCheckout: PENDING });

    expect(screen.getByTestId('open-checkout-warning')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: d.submit });
    expect(submit).toBeEnabled();

    fireEvent.change(screen.getByLabelText(d.amountLabel('BRL')), { target: { value: '500' } });
    fireEvent.click(submit);

    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
    // The recorded row tells the caller the checkout is still live.
    expect(onRecorded.mock.calls[0][0]).toMatchObject({ pendingCheckout: PENDING });
  });

  it('shows no warning on a receivable without a checkout', () => {
    renderGateway();
    expect(screen.queryByTestId('open-checkout-warning')).not.toBeInTheDocument();
  });
});
