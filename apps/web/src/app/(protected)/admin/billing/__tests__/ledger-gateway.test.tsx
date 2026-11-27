import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { dictPt } from '@web/i18n/dict-pt';
import { formatExpiry } from '@web/components/billing/pay-action';
import { createAdminBillingApi } from '@web/lib/admin-billing-api';
import type {
  BillingInvoiceWithBalance,
  BillingPayment,
  BillingReportCurrency,
  BillingStudentStatement,
  PayOption,
  PendingCheckout,
} from '@web/lib/admin-billing-api';
import type { HttpTransport } from '@web/lib/api-client';
import {
  ADMIN_USER,
  CONTENT_CREATOR_USER,
  makeStatusTransport,
  type Reply,
} from './test-transport';
import { LedgerTab } from '../ledger-tab';

/**
 * Online payments on the ledger (RFC 0026 §7): how a gateway row reads, the
 * refund confirmation and every answer it can get, the pending flag, the
 * on-behalf payment link — and that none of the actions exists for a non-admin.
 */

const BRL: BillingReportCurrency = { code: 'BRL', exponent: 2, symbol: 'R$' };

const invoice: BillingInvoiceWithBalance = {
  id: 'inv-11111111-aaaa',
  subscriptionId: 'sub-1',
  userId: 'u1',
  periodStart: '2026-11-01',
  periodEnd: '2026-11-30',
  dueDate: '2026-11-10',
  amountMinor: 50000,
  balanceMinor: 50000,
  currency: 'BRL',
  graceDays: 5,
  status: 'open',
  issuedAt: '2026-11-01T00:00:00Z',
  voidedAt: null,
  voidReason: null,
};

function gatewayPayment(overrides: Partial<BillingPayment> = {}): BillingPayment {
  return {
    id: 'pay-22222222-bbbb',
    invoiceId: invoice.id,
    amountMinor: 50000,
    currency: 'BRL',
    method: 'gateway',
    paidAt: '2026-11-09',
    externalReference: 'mercadopago:123456789',
    note: '',
    reversesId: null,
    recordedBy: 'system:payment-gateway',
    recordedAt: '2026-11-09T00:00:00Z',
    ...overrides,
  };
}

const EXPIRES_AT = '2026-11-27T14:03:00.000Z';
const WHEN = formatExpiry(EXPIRES_AT, dictEn.admin.billing.money.locale);

const PENDING: PendingCheckout = {
  checkoutId: 'chk-1',
  provider: 'mercadopago',
  createdAt: '2026-11-26T14:03:00.000Z',
  expiresAt: EXPIRES_AT,
  createdBy: 'u1',
};

const ONE_PROVIDER: PayOption[] = [{ provider: 'mercadopago', methods: ['pix', 'card'] }];
const TWO_PROVIDERS: PayOption[] = [
  { provider: 'mercadopago', methods: ['pix'] },
  { provider: 'stripe', methods: ['card'] },
];

const SESSION = {
  checkoutId: 'chk-9',
  provider: 'mercadopago',
  url: 'https://pay.example.test/checkout/chk-9',
  expiresAt: EXPIRES_AT,
  amountMinor: 50000,
  currency: 'BRL',
  status: 'open',
};

let payments: BillingPayment[];
let payOptions: PayOption[];
let pendingCheckout: PendingCheckout | null;
/** What the next `POST …/reverse` answers; a queue, so a retry can differ. */
let reverseReplies: Reply[];
let checkoutReply: Reply;
let user: unknown;

function statement(): BillingStudentStatement {
  return {
    userId: 'u1',
    currency: BRL,
    studentSince: '2025-01-01',
    currentMembershipSince: '2025-01-01',
    outstandingMinor: 50000,
    contractGroups: [],
    payOptions,
    invoices: [{ ...invoice, adjustments: [], payments, pendingCheckout }],
    extras: { standing: 'good', oldestOverdueDate: null, outstandingMinor: 0, charges: [] },
  };
}

let http: ReturnType<typeof makeStatusTransport>;
let client: { adminBilling: ReturnType<typeof createAdminBillingApi> };

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client, useAuthContext: () => ({ user }) };
});

const d = dictEn.admin.billing.ledger;
const g = dictEn.admin.billing.gateway;

const callsTo = (fragment: string) =>
  http.mock.calls.filter(([, path]) => String(path).includes(fragment));

function renderTab() {
  return render(
    <DictProvider value={dictEn}>
      <LedgerTab
        currency={BRL}
        nameOf={(id) => (id === 'u1' ? 'Alice Doe' : id === 'admin-1' ? 'Sensei Ana' : id)}
        students={[{ id: 'u1', name: 'Alice Doe' }]}
      />
    </DictProvider>,
  );
}

async function expandInvoice() {
  renderTab();
  fireEvent.click(await screen.findByRole('button', { name: d.expandAriaLabel('inv-1111') }));
  await screen.findByText(d.paymentsHeading);
}

async function openRefund() {
  await expandInvoice();
  fireEvent.click(screen.getByRole('button', { name: g.ledger.refundAriaLabel('pay-2222') }));
  return within(screen.getByRole('dialog', { name: g.refund.dialogTitle }));
}

function confirmAndSubmit(dialog: ReturnType<typeof within>, reason = 'Paid twice.') {
  fireEvent.change(dialog.getByPlaceholderText(d.reverseReasonPlaceholder), {
    target: { value: reason },
  });
  fireEvent.click(dialog.getByRole('checkbox'));
  fireEvent.click(dialog.getByRole('button', { name: g.refund.submit }));
}

beforeEach(() => {
  vi.clearAllMocks();
  payments = [gatewayPayment()];
  payOptions = ONE_PROVIDER;
  pendingCheckout = null;
  reverseReplies = [];
  checkoutReply = { status: 201, body: SESSION };
  user = ADMIN_USER;
  http = makeStatusTransport((method, path) => {
    if (method === 'POST' && path.endsWith('/reverse')) {
      return reverseReplies.shift() ?? { status: 500, body: { error: 'UNEXPECTED' } };
    }
    if (method === 'POST' && path.endsWith('/checkouts')) return checkoutReply;
    if (path.startsWith('/admin/billing/invoices')) return { status: 200, body: [invoice] };
    if (path.includes('/statement')) return { status: 200, body: statement() };
    if (path.startsWith('/admin/billing/subscriptions')) return { status: 200, body: [] };
    return { status: 200, body: {} };
  });
  client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport, { wait: async () => {} }) };
});

describe('LedgerTab — a gateway row', () => {
  it('reads Online, with the provider payment id as text when the provider has no dashboard template', async () => {
    await expandInvoice();

    const row = screen.getByText(`${d.method.gateway} · R$ 500.00`).closest('li') as HTMLElement;
    expect(d.method.gateway).toBe('Online');
    expect(within(row).getByText(g.ledger.paymentId('Mercado Pago', '123456789'))).toBeInTheDocument();
    // No template in the capability table → no link, the id stays readable.
    expect(within(row).queryByRole('link')).not.toBeInTheDocument();
  });

  it('deep-links into the provider dashboard when the capability table has a template', async () => {
    payments = [gatewayPayment({ externalReference: 'stripe:pi_3Abc/9' })];
    await expandInvoice();

    const link = screen.getByRole('link', {
      name: g.ledger.dashboardAriaLabel('Stripe', 'pi_3Abc/9'),
    });
    // Built on the client from `<provider>:<id>`; the id is URL-encoded.
    expect(link).toHaveAttribute('href', 'https://dashboard.stripe.com/payments/pi_3Abc%2F9');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('labels the reversal of a gateway payment as a refund, with the refund id', async () => {
    payments = [
      gatewayPayment(),
      gatewayPayment({
        id: 'pay-33333333-cccc',
        amountMinor: -50000,
        reversesId: 'pay-22222222-bbbb',
        externalReference: 'mercadopago:re_777',
        note: 'Paid twice.',
        recordedBy: 'admin-1',
      }),
    ];
    await expandInvoice();

    const row = screen.getByText(`${d.method.gateway} · R$ 500.00`).closest('li') as HTMLElement;
    const scoped = within(row);
    expect(scoped.getByText(`${g.ledger.refundOf('pay-2222')} · -R$ 500.00`)).toBeInTheDocument();
    expect(scoped.getByText(g.ledger.refundId('Mercado Pago', 're_777'))).toBeInTheDocument();
    expect(scoped.getByText(g.ledger.refunded)).toBeInTheDocument();
    expect(scoped.getByText(d.reasonLine('Paid twice.'))).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: g.ledger.refundAriaLabel('pay-2222') }),
    ).not.toBeInTheDocument();
  });

  it('labels a refund made on the provider dashboard, which has no original to point at', async () => {
    payments = [
      gatewayPayment(),
      gatewayPayment({
        id: 'pay-44444444-dddd',
        amountMinor: -12000,
        reversesId: null,
        externalReference: 'mercadopago:re_partial',
        note: 'provider refund re_partial',
      }),
    ];
    await expandInvoice();

    const row = screen
      .getByText(`${g.ledger.providerRefund} · -R$ 120.00`)
      .closest('li') as HTMLElement;
    expect(within(row).getByText(g.ledger.refundId('Mercado Pago', 're_partial'))).toBeInTheDocument();
    expect(within(row).getByText(g.ledger.providerRefundNote)).toBeInTheDocument();
    // Nothing here to reverse: the row offers no action at all.
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([
    ['account_money', g.methodLabel.accountMoney],
    ['credit_card/visa', g.methodLabel.creditCardBrand('visa')],
    ['credit_card', g.methodLabel.creditCard],
    ['debit_card/elo', g.methodLabel.debitCardBrand('elo')],
    ['ticket/bolbradesco', g.methodLabel.boleto],
    ['bank_transfer/pix', g.methodLabel.pix],
    // Unknown to the dictionary: the provider's own words, untouched.
    ['bank_transfer/pse', 'bank_transfer/pse'],
    ['crypto_transfer', 'crypto_transfer'],
  ])('reads Online · <label> for the method label %s', async (gatewayMethodLabel, label) => {
    payments = [gatewayPayment({ gatewayMethod: 'other', gatewayMethodLabel })];
    await expandInvoice();

    expect(
      screen.getByText(`${g.ledger.methodWithLabel(d.method.gateway, label)} · R$ 500.00`),
    ).toBeInTheDocument();
    expect(g.ledger.methodWithLabel(d.method.gateway, label)).toBe(`Online · ${label}`);
  });

  it('names the known labels in words', () => {
    expect(g.methodLabel.accountMoney).toBe('Mercado Pago balance');
    expect(g.methodLabel.creditCardBrand('visa')).toBe('credit card (visa)');
    expect(dictPt.admin.billing.gateway.methodLabel.accountMoney).toBe('saldo Mercado Pago');
    expect(dictPt.admin.billing.gateway.methodLabel.creditCardBrand('visa')).toBe(
      'cartão de crédito (visa)',
    );
  });

  it.each([[null], [undefined]])('stays plain Online when the label is %s', async (gatewayMethodLabel) => {
    payments = [gatewayPayment({ gatewayMethodLabel })];
    await expandInvoice();
    expect(screen.getByText(`${d.method.gateway} · R$ 500.00`)).toBeInTheDocument();
  });

  it('never puts a label on a row that is not a gateway payment', async () => {
    payments = [
      gatewayPayment({ method: 'pix', externalReference: null, gatewayMethodLabel: 'account_money' }),
    ];
    await expandInvoice();
    expect(screen.getByText(`${d.method.pix} · R$ 500.00`)).toBeInTheDocument();
  });
});

describe('LedgerTab — refunding a gateway payment', () => {
  it('says which provider is asked, the amount, and when the reversal is written', async () => {
    const dialog = await openRefund();

    expect(dialog.getByTestId('refund-confirmation')).toHaveTextContent(
      g.refund.explainer('Mercado Pago', 'R$ 500.00'),
    );
    expect(dialog.getByText(g.refund.fullOnly)).toBeInTheDocument();
    expect(
      dialog.getByRole('checkbox', { name: g.refund.confirmLabel('Mercado Pago', 'R$ 500.00') }),
    ).not.toBeChecked();
    // Not the plain reversal's dialog.
    expect(screen.queryByRole('dialog', { name: d.reverseDialogTitle })).not.toBeInTheDocument();
  });

  it('sends no request when the admin cancels', async () => {
    const dialog = await openRefund();
    http.mockClear();
    fireEvent.click(dialog.getByRole('button', { name: d.reverseCancel }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
  });

  it('needs the explicit confirmation, on top of the reason', async () => {
    const dialog = await openRefund();
    http.mockClear();
    fireEvent.change(dialog.getByPlaceholderText(d.reverseReasonPlaceholder), {
      target: { value: 'Paid twice.' },
    });
    fireEvent.click(dialog.getByRole('button', { name: g.refund.submit }));

    expect(await dialog.findByRole('alert')).toHaveTextContent(g.refund.confirmRequired);
    expect(http).not.toHaveBeenCalled();
  });

  it('accepted: closes, says so, and re-reads the entries', async () => {
    reverseReplies = [
      {
        status: 200,
        body: gatewayPayment({
          id: 'pay-33333333-cccc',
          amountMinor: -50000,
          reversesId: 'pay-22222222-bbbb',
          externalReference: 'mercadopago:re_777',
        }),
      },
    ];
    const dialog = await openRefund();
    const statementReads = callsTo('/statement').length;
    confirmAndSubmit(dialog);

    expect(await screen.findByText(g.refund.outcomes.accepted('Mercado Pago'))).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(http).toHaveBeenCalledWith('POST', '/admin/billing/payments/pay-22222222-bbbb/reverse', {
      body: JSON.stringify({ reason: 'Paid twice.' }),
    });
    await waitFor(() => expect(callsTo('/statement').length).toBe(statementReads + 1));
  });

  it('already refunded: the row the provider landed first is reported as recorded, not refunded again', async () => {
    reverseReplies = [
      {
        status: 200,
        body: gatewayPayment({
          id: 'pay-55555555-eeee',
          amountMinor: -50000,
          reversesId: null,
          externalReference: 'mercadopago:re_777',
        }),
      },
    ];
    confirmAndSubmit(await openRefund());

    expect(
      await screen.findByText(g.refund.outcomes.alreadyRefunded('Mercado Pago')),
    ).toBeInTheDocument();
  });

  it('refused: shows the provider refusal and leaves the ledger view unchanged', async () => {
    reverseReplies = [
      {
        status: 409,
        body: { error: 'PAYMENTS_REFUND_REFUSED', message: 'The payment holds a partial refund.' },
      },
    ];
    const dialog = await openRefund();
    const listReads = callsTo('/admin/billing/invoices').length;
    const statementReads = callsTo('/statement').length;
    confirmAndSubmit(dialog);

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      g.refund.outcomes.refusedDetail('Mercado Pago', 'The payment holds a partial refund.'),
    );
    // Nothing was written, so nothing is re-read and the row still offers Refund.
    expect(callsTo('/statement').length).toBe(statementReads);
    expect(callsTo('/admin/billing/invoices').filter(([method]) => method === 'GET').length).toBe(
      listReads,
    );
    fireEvent.click(dialog.getByRole('button', { name: d.reverseCancel }));
    expect(
      screen.getByRole('button', { name: g.ledger.refundAriaLabel('pay-2222') }),
    ).toBeInTheDocument();
    expect(screen.queryByText(g.ledger.refunded)).not.toBeInTheDocument();
  });

  it.each([
    [
      'provider not enabled',
      { status: 409, body: { error: 'PAYMENTS_PROVIDER_NOT_ENABLED' } },
      g.refund.outcomes.providerNotEnabled('Mercado Pago'),
    ],
    [
      'refused without a message',
      { status: 409, body: { error: 'PAYMENTS_REFUND_REFUSED' } },
      g.refund.outcomes.refused('Mercado Pago'),
    ],
    [
      'configuration',
      { status: 500, body: { error: 'PAYMENTS_CONFIG_INVALID' } },
      g.refund.outcomes.configuration,
    ],
    [
      'provider unavailable',
      { status: 502, body: { error: 'PAYMENTS_PROVIDER_ERROR' } },
      g.refund.outcomes.providerUnavailable('Mercado Pago'),
    ],
    ['already reversed', { status: 409, body: { error: 'Conflict' } }, g.refund.outcomes.conflict],
    ['anything else', { status: 500, body: {} }, g.refund.outcomes.unknown],
  ])('%s has its own message', async (_name, reply, message) => {
    reverseReplies = [reply];
    const dialog = await openRefund();
    confirmAndSubmit(dialog);
    expect(await dialog.findByRole('alert')).toHaveTextContent(message);
  });

  it('accepted but not recorded: says the money moved and Try again repeats the same request', async () => {
    reverseReplies = [
      { status: 503, body: { error: 'PAYMENTS_REFUND_UNRECORDED', refundId: 're_777' } },
      {
        status: 200,
        body: gatewayPayment({
          id: 'pay-33333333-cccc',
          amountMinor: -50000,
          reversesId: 'pay-22222222-bbbb',
          externalReference: 'mercadopago:re_777',
        }),
      },
    ];
    const dialog = await openRefund();
    confirmAndSubmit(dialog, 'Paid twice.');

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      g.refund.outcomes.unrecorded('Mercado Pago', 're_777'),
    );
    // Never "refund failed": the action left is a retry.
    expect(dialog.queryByRole('button', { name: g.refund.submit })).not.toBeInTheDocument();

    fireEvent.click(dialog.getByRole('button', { name: g.refund.retry }));
    expect(await screen.findByText(g.refund.outcomes.accepted('Mercado Pago'))).toBeInTheDocument();

    const posts = callsTo('/reverse');
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
  });

  it('keeps the plain reversal for a payment that is not a gateway row', async () => {
    payments = [gatewayPayment({ method: 'cash', externalReference: null, recordedBy: 'admin-1' })];
    await expandInvoice();
    fireEvent.click(screen.getByRole('button', { name: d.reverseAriaLabel('pay-2222') }));

    const dialog = within(screen.getByRole('dialog', { name: d.reverseDialogTitle }));
    expect(dialog.getByText(d.reverseExplainer)).toBeInTheDocument();
    expect(dialog.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(dialog.queryByTestId('refund-confirmation')).not.toBeInTheDocument();
  });

  it('provider busy: says nothing changed and Try again repeats the same request', async () => {
    reverseReplies = [
      { status: 503, body: { error: 'PAYMENTS_PROVIDER_BUSY' } },
      {
        status: 200,
        body: gatewayPayment({
          id: 'pay-33333333-cccc',
          amountMinor: -50000,
          reversesId: 'pay-22222222-bbbb',
          externalReference: 'mercadopago:re_778',
        }),
      },
    ];
    const dialog = await openRefund();
    confirmAndSubmit(dialog, 'Paid twice.');

    const alert = await dialog.findByRole('alert');
    expect(alert).toHaveTextContent(g.refund.outcomes.providerBusy('Mercado Pago'));
    // Its own message — neither "could not be reached" nor the generic failure.
    expect(alert).not.toHaveTextContent(g.refund.outcomes.unknown);
    expect(dialog.queryByRole('button', { name: g.refund.submit })).not.toBeInTheDocument();
    // The reason is frozen, so the repeat cannot differ from the first request.
    expect(dialog.getByPlaceholderText(d.reverseReasonPlaceholder)).toHaveAttribute('readonly');

    fireEvent.click(dialog.getByRole('button', { name: g.refund.retry }));
    expect(await screen.findByText(g.refund.outcomes.accepted('Mercado Pago'))).toBeInTheDocument();

    const posts = callsTo('/reverse');
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
  });
});

describe('LedgerTab — pending online payment and the payment link', () => {
  const writeText = vi.fn(async () => {});

  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });

  it('shows the pending online payment of an invoice with its expiry and who opened it', async () => {
    pendingCheckout = PENDING;
    await expandInvoice();
    expect(screen.getByTestId('pending-online-payment')).toHaveTextContent(
      `${g.pending.line(WHEN)} · ${g.pending.openedByStudent}`,
    );
  });

  it('names the admin who created the link on behalf', async () => {
    pendingCheckout = { ...PENDING, createdBy: 'admin-1' };
    await expandInvoice();
    expect(screen.getByTestId('pending-online-payment')).toHaveTextContent(
      g.pending.openedOnBehalf('Sensei Ana'),
    );
  });

  it('creates a payment link on behalf and copies it', async () => {
    await expandInvoice();
    fireEvent.click(screen.getByRole('button', { name: g.link.invoiceAriaLabel('inv-1111') }));
    const dialog = within(screen.getByRole('dialog', { name: g.link.dialogTitle }));
    // One offering provider: nothing to choose.
    expect(dialog.queryByRole('radio')).not.toBeInTheDocument();

    fireEvent.click(dialog.getByRole('button', { name: g.link.create }));

    const field = await dialog.findByLabelText(g.link.urlLabel);
    expect(field).toHaveValue(SESSION.url);
    expect(dialog.getByText(g.link.created)).toBeInTheDocument();
    expect(dialog.getByText(g.link.expires(WHEN))).toBeInTheDocument();
    // The strict body: no provider with one option, and never a user id.
    expect(http).toHaveBeenCalledWith(
      'POST',
      '/admin/billing/invoices/inv-11111111-aaaa/checkouts',
      { body: '{}' },
    );

    fireEvent.click(dialog.getByRole('button', { name: g.link.copy }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SESSION.url));
    expect(await dialog.findByText(g.link.copied)).toBeInTheDocument();
  });

  it('asks which provider when several offer a method, starting on the live checkout', async () => {
    payOptions = TWO_PROVIDERS;
    pendingCheckout = { ...PENDING, provider: 'stripe' };
    checkoutReply = { status: 200, body: { ...SESSION, provider: 'stripe' } };
    await expandInvoice();
    fireEvent.click(screen.getByRole('button', { name: g.link.invoiceAriaLabel('inv-1111') }));
    const dialog = within(screen.getByRole('dialog', { name: g.link.dialogTitle }));

    expect(dialog.getByText(g.link.liveNote(WHEN))).toBeInTheDocument();
    const stripe = dialog.getByRole('radio', { name: g.link.providerOption('Stripe', 'Card') });
    expect(stripe).toBeChecked();
    expect(
      dialog.getByRole('radio', { name: g.link.providerOption('Mercado Pago', 'Pix') }),
    ).not.toBeChecked();

    fireEvent.click(dialog.getByRole('button', { name: g.link.create }));

    // `200` is the live link handed back, and the dialog says so.
    expect(await dialog.findByText(g.link.reused)).toBeInTheDocument();
    expect(http).toHaveBeenCalledWith(
      'POST',
      '/admin/billing/invoices/inv-11111111-aaaa/checkouts',
      { body: JSON.stringify({ provider: 'stripe' }) },
    );
  });

  it('leaves the link selected when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await expandInvoice();
    fireEvent.click(screen.getByRole('button', { name: g.link.invoiceAriaLabel('inv-1111') }));
    const dialog = within(screen.getByRole('dialog', { name: g.link.dialogTitle }));
    fireEvent.click(dialog.getByRole('button', { name: g.link.create }));
    await dialog.findByLabelText(g.link.urlLabel);

    fireEvent.click(dialog.getByRole('button', { name: g.link.copy }));
    expect(await dialog.findByText(g.link.copyFailed)).toBeInTheDocument();
  });

  it('explains a refusal instead of showing a link', async () => {
    checkoutReply = { status: 409, body: { error: 'RECEIVABLE_NOT_PAYABLE' } };
    await expandInvoice();
    fireEvent.click(screen.getByRole('button', { name: g.link.invoiceAriaLabel('inv-1111') }));
    const dialog = within(screen.getByRole('dialog', { name: g.link.dialogTitle }));
    fireEvent.click(dialog.getByRole('button', { name: g.link.create }));

    expect(await dialog.findByRole('alert')).toHaveTextContent(g.link.errors.not_payable);
    expect(dialog.queryByLabelText(g.link.urlLabel)).not.toBeInTheDocument();
  });

  it('offers no payment link on a label with no online method', async () => {
    payOptions = [];
    await expandInvoice();
    expect(
      screen.queryByRole('button', { name: g.link.invoiceAriaLabel('inv-1111') }),
    ).not.toBeInTheDocument();
  });

  it('warns on the payment form and still records cash on an invoice with an open checkout', async () => {
    pendingCheckout = PENDING;
    await expandInvoice();
    fireEvent.click(screen.getByRole('button', { name: d.payment.buttonAriaLabel('inv-1111') }));
    const dialog = within(screen.getByRole('dialog', { name: d.payment.dialogTitle }));

    expect(dialog.getByTestId('open-checkout-warning')).toHaveTextContent(
      g.form.openCheckoutWarning(WHEN),
    );
    fireEvent.change(dialog.getByLabelText(d.payment.amountLabel('BRL')), {
      target: { value: '500' },
    });
    fireEvent.click(dialog.getByRole('button', { name: d.payment.submit }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/invoices/inv-11111111-aaaa/payments', {
        body: JSON.stringify({ amountMinor: 50000, method: 'cash' }),
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('LedgerTab — a non-admin', () => {
  it('sees the gateway row and the pending flag, and no gateway action', async () => {
    user = CONTENT_CREATOR_USER;
    pendingCheckout = PENDING;
    await expandInvoice();

    // Legible…
    expect(screen.getByText(`${d.method.gateway} · R$ 500.00`)).toBeInTheDocument();
    expect(screen.getByTestId('pending-online-payment')).toBeInTheDocument();
    // …but neither a refund nor a payment link is offered.
    expect(
      screen.queryByRole('button', { name: g.ledger.refundAriaLabel('pay-2222') }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: g.link.invoiceAriaLabel('inv-1111') }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(g.ledger.refundButton)).not.toBeInTheDocument();
    expect(screen.queryByText(g.link.button)).not.toBeInTheDocument();
  });
});
