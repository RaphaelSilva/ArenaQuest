import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createAdminBillingApi } from '@web/lib/admin-billing-api';
import type {
  BillingReportCurrency,
  BillingStudentStatement,
  PaymentException,
  ReconcilePaymentsRun,
} from '@web/lib/admin-billing-api';
import type { HttpTransport } from '@web/lib/api-client';
import { ADMIN_USER, CONTENT_CREATOR_USER, type Reply } from './test-transport';
import { ExceptionsTab } from '../exceptions-tab';

const BRL: BillingReportCurrency = { code: 'BRL', exponent: 2, symbol: 'R$' };

const NOW = Date.parse('2026-11-26T15:00:00.000Z');

function exception(overrides: Partial<PaymentException> = {}): PaymentException {
  return {
    ref: 'event:stripe:evt_1',
    kind: 'orphan',
    source: 'event',
    provider: 'stripe',
    eventId: 'evt_1',
    eventType: 'payment',
    providerPaymentId: 'pi_orphan/1',
    checkoutId: null,
    attempts: 1,
    detail: null,
    occurredAt: '2026-11-24T15:00:00.000Z',
    receivable: null,
    ...overrides,
  };
}

const receivable = {
  kind: 'invoice' as const,
  id: 'inv-11111111-aaaa',
  userId: 'u1',
  studentName: 'Alice Doe',
  amountMinor: 15000,
  currency: 'BRL',
};

const ORPHAN = exception();
const MISMATCH_EVENT = exception({
  ref: 'event:mercadopago:evt_2',
  kind: 'mismatch',
  provider: 'mercadopago',
  eventId: 'evt_2',
  providerPaymentId: '987654',
  checkoutId: 'chk-22222222-bbbb',
  detail: 'currency mismatch: USD paid on a BRL checkout',
  occurredAt: '2026-11-25T15:00:00.000Z',
  receivable,
});
const MISMATCH_CHECKOUT = exception({
  ref: 'checkout:chk-22222222-bbbb',
  kind: 'mismatch',
  source: 'checkout',
  provider: 'mercadopago',
  eventId: null,
  eventType: null,
  attempts: null,
  providerPaymentId: '987654',
  checkoutId: 'chk-22222222-bbbb',
  detail: 'currency mismatch: USD paid on a BRL checkout',
  occurredAt: '2026-11-25T15:00:05.000Z',
  receivable,
});
const FAILED = exception({
  ref: 'event:stripe:evt_3',
  kind: 'failed',
  eventId: 'evt_3',
  providerPaymentId: null,
  attempts: 4,
  detail: 'processing failed (TypeError)',
  occurredAt: '2026-11-26T12:00:00.000Z',
});
const RECEIVED = exception({
  ref: 'event:stripe:evt_4',
  kind: 'received',
  eventId: 'evt_4',
  providerPaymentId: 'pi_4',
  attempts: 0,
  occurredAt: '2026-11-26T13:30:00.000Z',
});
const DISPUTE = exception({
  ref: 'checkout:chk-55555555-eeee',
  kind: 'dispute',
  source: 'checkout',
  eventId: null,
  eventType: null,
  attempts: null,
  providerPaymentId: 'pi_5',
  checkoutId: 'chk-55555555-eeee',
  detail: 'dispute opened',
  occurredAt: '2026-11-26T14:00:00.000Z',
  receivable,
});

function statement(): BillingStudentStatement {
  return {
    userId: 'u1',
    currency: BRL,
    studentSince: '2025-01-01',
    currentMembershipSince: '2025-01-01',
    outstandingMinor: 15000,
    contractGroups: [],
    payOptions: [],
    invoices: [
      {
        id: 'inv-11111111-aaaa',
        subscriptionId: 'sub-1',
        userId: 'u1',
        periodStart: '2026-11-01',
        periodEnd: '2026-12-01',
        dueDate: '2026-11-10',
        amountMinor: 15000,
        balanceMinor: 15000,
        currency: 'BRL',
        graceDays: 5,
        status: 'open',
        issuedAt: '2026-11-01T00:00:00Z',
        voidedAt: null,
        voidReason: null,
        adjustments: [],
        payments: [],
        pendingCheckout: null,
      },
      {
        id: 'inv-paid0000-cccc',
        subscriptionId: 'sub-1',
        userId: 'u1',
        periodStart: '2026-10-01',
        periodEnd: '2026-11-01',
        dueDate: '2026-10-10',
        amountMinor: 15000,
        balanceMinor: 0,
        currency: 'BRL',
        graceDays: 5,
        status: 'paid',
        issuedAt: '2026-10-01T00:00:00Z',
        voidedAt: null,
        voidReason: null,
        adjustments: [],
        payments: [],
        pendingCheckout: null,
      },
    ],
    extras: { standing: 'good', oldestOverdueDate: null, outstandingMinor: 0, charges: [] },
  };
}

function summary(overrides: Partial<ReconcilePaymentsRun['summary']> = {}) {
  return {
    checkoutsDue: 6,
    checkoutsAsked: 5,
    landed: 2,
    expired: 1,
    stillOpen: 2,
    abandoned: 0,
    unreachable: 0,
    mismatched: 0,
    checkoutErrors: 0,
    checkoutsDeferred: 1,
    eventsDue: 5,
    eventsRetried: 3,
    eventsSettled: 2,
    eventsFailed: 1,
    eventsDeferred: 2,
    staleOrphans: 1,
    staleMismatches: 3,
    ...overrides,
  };
}

let user: typeof ADMIN_USER | typeof CONTENT_CREATOR_USER;
let listed: PaymentException[];
let listStatus: number;
let dismissReply: (body: { ref: string; note: string }) => Reply;
let paymentReply: () => Reply;
let reconcileReply: () => Reply | Promise<Reply>;

let http: ReturnType<typeof vi.fn>;
let client: { adminBilling: ReturnType<typeof createAdminBillingApi> };

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client, useAuthContext: () => ({ user }) };
});

const g = dictEn.admin.billing.gateway;
const x = g.exceptions;
const paymentCopy = dictEn.admin.billing.ledger.payment;

const onCountChange = vi.fn();
const onOpenLedger = vi.fn();

const callsTo = (fragment: string) =>
  http.mock.calls.filter(([, path]) => String(path).includes(fragment));

const STUDENTS = [
  { id: 'u1', name: 'Alice Doe', email: 'alice@dojo.test' },
  { id: 'u2', name: 'Bruno Lima', email: 'bruno@dojo.test' },
];

function renderTab() {
  return render(
    <DictProvider value={dictEn}>
      <ExceptionsTab
        currency={BRL}
        nameOf={(id) => `name-of-${id}`}
        students={STUDENTS}
        onCountChange={onCountChange}
        onOpenLedger={onOpenLedger}
      />
    </DictProvider>,
  );
}

const rowOf = (kind: string) =>
  screen
    .getAllByTestId('payment-exception')
    .filter((row) => row.getAttribute('data-kind') === kind);

async function renderRows() {
  renderTab();
  await screen.findAllByTestId('payment-exception');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  user = ADMIN_USER;
  listed = [];
  listStatus = 200;
  dismissReply = ({ ref }) => {
    listed = listed.filter((row) => row.ref !== ref);
    return { status: 200, body: { ref, dismissedBy: 'admin-1', dismissedAt: '2026-11-26T15:00:00.000Z' } };
  };
  paymentReply = () => ({
    status: 201,
    body: {
      id: 'pay-99999999-zzzz',
      invoiceId: 'inv-11111111-aaaa',
      amountMinor: 15000,
      currency: 'BRL',
      method: 'gateway',
      paidAt: '2026-11-26',
      externalReference: 'stripe:pi_orphan/1',
      note: '',
      reversesId: null,
      recordedBy: 'admin-1',
      recordedAt: '2026-11-26T15:00:00.000Z',
      pendingCheckout: null,
    },
  });
  reconcileReply = () => ({ status: 200, body: { status: 'ok', error: null, summary: summary() } });

  http = vi.fn(async (method: string, path: string, options?: { body?: string }) => {
    let reply: Reply;
    if (path === '/admin/billing/payments/exceptions') {
      reply =
        listStatus === 200
          ? { status: 200, body: { exceptions: listed } }
          : { status: listStatus, body: { error: listStatus === 403 ? 'Forbidden' : 'Boom' } };
    } else if (path === '/admin/billing/payments/exceptions/dismiss') {
      reply = dismissReply(JSON.parse(options?.body ?? '{}'));
    } else if (path === '/admin/billing/payments/reconcile') {
      reply = await reconcileReply();
    } else if (path.includes('/statement')) {
      reply = { status: 200, body: statement() };
    } else if (method === 'POST' && path.endsWith('/payments')) {
      reply = paymentReply();
    } else if (path.startsWith('/admin/billing/charges/')) {
      reply = { status: 200, body: { id: 'chg-1', eventId: 'ev-7' } };
    } else {
      reply = { status: 200, body: {} };
    }
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body ?? {},
    } as unknown as Response;
  });
  client = {
    adminBilling: createAdminBillingApi(http as unknown as HttpTransport, {
      wait: async () => {},
    }),
  };
});

describe('ExceptionsTab — the list', () => {
  it('shows the empty state as the normal state, and reports a zero count', async () => {
    renderTab();

    expect(await screen.findByText(x.empty.title)).toBeInTheDocument();
    expect(screen.getByText(x.empty.body)).toBeInTheDocument();
    expect(screen.queryByTestId('payment-exception')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onCountChange).toHaveBeenLastCalledWith(0);
  });

  it('renders one row of each kind, in the order the API gave, each with its plain explanation', async () => {
    listed = [ORPHAN, MISMATCH_EVENT, FAILED, RECEIVED, DISPUTE];
    await renderRows();

    const rows = screen.getAllByTestId('payment-exception');
    expect(rows.map((row) => row.getAttribute('data-kind'))).toEqual([
      'orphan',
      'mismatch',
      'failed',
      'received',
      'dispute',
    ]);
    for (const kind of ['orphan', 'mismatch', 'failed', 'received', 'dispute'] as const) {
      const row = rowOf(kind)[0];
      expect(within(row).getByText(x.kind[kind])).toBeInTheDocument();
      expect(within(row).getByText(x.explanation[kind])).toBeInTheDocument();
    }
    expect(onCountChange).toHaveBeenLastCalledWith(5);
  });

  it('shows an orphan with its provider ids, a deep link, its age and attempts — and no amount', async () => {
    listed = [ORPHAN];
    await renderRows();
    const row = rowOf('orphan')[0];

    expect(within(row).getByText('Stripe')).toBeInTheDocument();
    expect(within(row).getByText('evt_1')).toBeInTheDocument();
    const link = within(row).getByRole('link', {
      name: g.ledger.dashboardAriaLabel('Stripe', 'pi_orphan/1'),
    });
    expect(link).toHaveAttribute('href', 'https://dashboard.stripe.com/payments/pi_orphan%2F1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(row).getByText(new RegExp(`^${x.age.days(2)}`))).toBeInTheDocument();
    expect(within(row).getByText(x.attempts(1))).toBeInTheDocument();

    // The API knows no amount for an orphan; the row must not invent one.
    expect(within(row).queryByTestId('exception-amount')).not.toBeInTheDocument();
    expect(within(row).getByText(x.amountUnknown)).toBeInTheDocument();
    expect(row.textContent).not.toMatch(/R\$/);
    expect(within(row).getByText(x.studentUnknown)).toBeInTheDocument();
  });

  it('shows the student, the receivable and what the checkout asked for when they are known', async () => {
    listed = [MISMATCH_EVENT, MISMATCH_CHECKOUT];
    await renderRows();
    const [eventRow, checkoutRow] = rowOf('mismatch');

    expect(within(eventRow).getByText('Alice Doe')).toBeInTheDocument();
    expect(within(eventRow).getByText(x.receivableKind.invoice('inv-1111'))).toBeInTheDocument();
    expect(within(eventRow).getByTestId('exception-amount')).toHaveTextContent(
      x.amountAsked('R$ 150.00'),
    );
    expect(within(eventRow).getByText(MISMATCH_EVENT.detail as string)).toBeInTheDocument();
    // Mercado Pago has no URL template: the id is text and the row says why.
    expect(within(eventRow).queryByRole('link')).not.toBeInTheDocument();
    expect(within(eventRow).getByText(x.noDashboardLink('Mercado Pago'))).toBeInTheDocument();

    // A webhook mismatch is two rows about one checkout, and each says so.
    expect(within(eventRow).getByTestId('same-checkout')).toBeInTheDocument();
    expect(within(checkoutRow).getByTestId('same-checkout')).toBeInTheDocument();
    // A checkout row has no notification id and no attempts.
    expect(within(checkoutRow).queryByText(x.fields.attempts)).not.toBeInTheDocument();
  });

  it('offers no match on a dispute — its payment is already on the ledger', async () => {
    listed = [DISPUTE];
    await renderRows();
    const row = rowOf('dispute')[0];

    expect(within(row).queryByRole('button', { name: x.actions.match })).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: x.actions.refund })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: x.actions.dismiss })).toBeInTheDocument();
  });

  it('renders the no-access state, not an error, when the API answers 403', async () => {
    listStatus = 403;
    renderTab();

    expect(await screen.findByText(dictEn.errors.forbidden)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: x.reconcile.button })).not.toBeInTheDocument();
  });

  it('says the list could not be loaded on any other failure, and reloads on demand', async () => {
    listStatus = 500;
    renderTab();

    expect(await screen.findByText(x.loadError)).toBeInTheDocument();
    expect(screen.queryByTestId('exceptions-empty')).not.toBeInTheDocument();

    listStatus = 200;
    fireEvent.click(screen.getByRole('button', { name: x.reload }));
    expect(await screen.findByText(x.empty.title)).toBeInTheDocument();
  });

  it('renders nothing and asks the API nothing for a content creator', () => {
    user = CONTENT_CREATOR_USER;
    const { container } = renderTab();

    expect(container).toBeEmptyDOMElement();
    expect(http).not.toHaveBeenCalled();
  });
});

describe('ExceptionsTab — dismiss', () => {
  it('refuses an empty or blank note on the client, without a request', async () => {
    listed = [ORPHAN];
    await renderRows();
    fireEvent.click(screen.getByRole('button', { name: x.actions.dismiss }));

    const dialog = screen.getByRole('dialog', { name: x.dismiss.dialogTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: x.dismiss.submit }));
    expect(within(dialog).getByText(x.dismiss.noteRequired)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(x.dismiss.noteLabel), {
      target: { value: '   ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: x.dismiss.submit }));
    expect(within(dialog).getByText(x.dismiss.noteRequired)).toBeInTheDocument();
    expect(callsTo('/dismiss')).toHaveLength(0);
  });

  it('refuses a note over 500 characters on the client', async () => {
    listed = [ORPHAN];
    await renderRows();
    fireEvent.click(screen.getByRole('button', { name: x.actions.dismiss }));

    const dialog = screen.getByRole('dialog', { name: x.dismiss.dialogTitle });
    fireEvent.change(within(dialog).getByLabelText(x.dismiss.noteLabel), {
      target: { value: 'n'.repeat(501) },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: x.dismiss.submit }));

    expect(within(dialog).getByText(x.dismiss.noteTooLong(500))).toBeInTheDocument();
    expect(callsTo('/dismiss')).toHaveLength(0);
  });

  it('sends the ref as given and the trimmed note, then the row is gone after the reload', async () => {
    listed = [ORPHAN, FAILED];
    await renderRows();
    fireEvent.click(within(rowOf('orphan')[0]).getByRole('button', { name: x.actions.dismiss }));

    const dialog = screen.getByRole('dialog', { name: x.dismiss.dialogTitle });
    fireEvent.change(within(dialog).getByLabelText(x.dismiss.noteLabel), {
      target: { value: '  Refunded at the provider.  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: x.dismiss.submit }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/payments/exceptions/dismiss', {
        body: JSON.stringify({ ref: 'event:stripe:evt_1', note: 'Refunded at the provider.' }),
      }),
    );
    expect(await screen.findByText(x.dismiss.success)).toBeInTheDocument();
    // The list was read again, and the server no longer lists the row.
    await waitFor(() => expect(rowOf('orphan')).toHaveLength(0));
    expect(rowOf('failed')).toHaveLength(1);
    expect(callsTo('/payments/exceptions').filter(([method]) => method === 'GET')).toHaveLength(2);
    expect(onCountChange).toHaveBeenLastCalledWith(1);
  });

  it('treats a 404 as "already off the list" and reloads', async () => {
    listed = [ORPHAN];
    dismissReply = () => {
      listed = [];
      return { status: 404, body: { error: 'NotFound' } };
    };
    await renderRows();
    fireEvent.click(screen.getByRole('button', { name: x.actions.dismiss }));
    const dialog = screen.getByRole('dialog', { name: x.dismiss.dialogTitle });
    fireEvent.change(within(dialog).getByLabelText(x.dismiss.noteLabel), {
      target: { value: 'done' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: x.dismiss.submit }));

    expect(await screen.findByText(x.dismiss.gone)).toBeInTheDocument();
    expect(await screen.findByText(x.empty.title)).toBeInTheDocument();
  });

  it('keeps the dialog open and says nothing changed when the dismissal fails', async () => {
    listed = [ORPHAN];
    dismissReply = () => ({ status: 500, body: { error: 'Boom' } });
    await renderRows();
    fireEvent.click(screen.getByRole('button', { name: x.actions.dismiss }));
    const dialog = screen.getByRole('dialog', { name: x.dismiss.dialogTitle });
    fireEvent.change(within(dialog).getByLabelText(x.dismiss.noteLabel), {
      target: { value: 'done' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: x.dismiss.submit }));

    expect(await within(dialog).findByText(x.dismiss.errors.unknown)).toBeInTheDocument();
    expect(rowOf('orphan')).toHaveLength(1);
  });
});

describe('ExceptionsTab — match by hand', () => {
  async function pickAliceInvoice() {
    listed = [ORPHAN];
    await renderRows();
    fireEvent.click(screen.getByRole('button', { name: x.actions.match }));

    const dialog = screen.getByRole('dialog', { name: x.match.dialogTitle });
    // An orphan names nobody: the student is searched for.
    fireEvent.change(within(dialog).getByLabelText(x.match.searchLabel), {
      target: { value: 'alice@' },
    });
    expect(within(dialog).queryByText('Bruno Lima')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: x.match.pickStudent('Alice Doe') }));

    // Only the open invoice with a balance is offered — never the paid one.
    const option = await within(dialog).findByRole('button', {
      name: x.match.pickReceivable(x.match.invoiceOption('inv-1111', '2026-11-10')),
    });
    expect(within(dialog).getAllByRole('button', { name: /Record the payment on/ })).toHaveLength(1);
    expect(within(dialog).getByText(x.match.balance('R$ 150.00'))).toBeInTheDocument();
    fireEvent.click(option);

    return screen.findByRole('dialog', { name: paymentCopy.dialogTitle });
  }

  it('records a gateway payment with the exception reference and dismisses the exception', async () => {
    const form = await pickAliceInvoice();

    // Method Online, provider and payment id from the exception; no amount invented.
    expect(within(form).getByLabelText(paymentCopy.methodLabel)).toHaveValue('gateway');
    expect(within(form).getByLabelText(g.form.providerLabel)).toHaveValue('stripe');
    expect(within(form).getByLabelText(g.form.paymentIdLabel)).toHaveValue('pi_orphan/1');
    expect(within(form).getByLabelText(paymentCopy.amountLabel('BRL'))).toHaveValue('');

    fireEvent.change(within(form).getByLabelText(paymentCopy.amountLabel('BRL')), {
      target: { value: '150.00' },
    });
    fireEvent.click(within(form).getByRole('button', { name: paymentCopy.submit }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/invoices/inv-11111111-aaaa/payments', {
        body: JSON.stringify({
          amountMinor: 15000,
          method: 'gateway',
          externalReference: 'stripe:pi_orphan/1',
        }),
      }),
    );
    // The exception is dismissed by itself, with a note naming the payment.
    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/payments/exceptions/dismiss', {
        body: JSON.stringify({
          ref: 'event:stripe:evt_1',
          note: x.match.note('pay-9999', 'stripe:pi_orphan/1'),
        }),
      }),
    );
    expect(await screen.findByText(x.match.success('pay-9999'))).toBeInTheDocument();
    expect(await screen.findByText(x.empty.title)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says a duplicate reference already landed and offers to dismiss', async () => {
    paymentReply = () => ({
      status: 409,
      body: { error: 'PAYMENT_REFERENCE_EXISTS', paymentId: 'pay-existing-1' },
    });
    const form = await pickAliceInvoice();
    fireEvent.change(within(form).getByLabelText(paymentCopy.amountLabel('BRL')), {
      target: { value: '150.00' },
    });
    fireEvent.click(within(form).getByRole('button', { name: paymentCopy.submit }));

    const already = await screen.findByRole('dialog', { name: x.match.already.title });
    expect(within(already).getByText(x.match.already.body('pay-exis'))).toBeInTheDocument();
    // Nothing is dismissed until the admin says so.
    expect(callsTo('/dismiss')).toHaveLength(0);

    fireEvent.click(within(already).getByRole('button', { name: x.match.already.dismiss }));
    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/payments/exceptions/dismiss', {
        body: JSON.stringify({
          ref: 'event:stripe:evt_1',
          note: x.match.already.note('pay-exis'),
        }),
      }),
    );
    expect(await screen.findByText(x.match.already.success)).toBeInTheDocument();
    expect(await screen.findByText(x.empty.title)).toBeInTheDocument();
  });

  it('warns, and keeps the row, when the payment was recorded but the dismissal failed', async () => {
    dismissReply = () => ({ status: 500, body: { error: 'Boom' } });
    const form = await pickAliceInvoice();
    fireEvent.change(within(form).getByLabelText(paymentCopy.amountLabel('BRL')), {
      target: { value: '150.00' },
    });
    fireEvent.click(within(form).getByRole('button', { name: paymentCopy.submit }));

    expect(await screen.findByText(x.match.successNotDismissed('pay-9999'))).toBeInTheDocument();
    await waitFor(() => expect(rowOf('orphan')).toHaveLength(1));
  });

  it('starts from the checkout student when the exception names a receivable', async () => {
    listed = [MISMATCH_EVENT];
    await renderRows();
    fireEvent.click(screen.getByRole('button', { name: x.actions.match }));

    const dialog = screen.getByRole('dialog', { name: x.match.dialogTitle });
    expect(within(dialog).getByText(x.match.studentFromCheckout)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(x.match.searchLabel)).not.toBeInTheDocument();
    expect(
      await within(dialog).findByText(new RegExp(x.match.fromCheckout)),
    ).toBeInTheDocument();
    expect(http).toHaveBeenCalledWith('GET', '/admin/billing/students/u1/statement');
  });
});

describe('ExceptionsTab — refund', () => {
  it('points at the provider dashboard when nothing landed, and hands over to dismiss', async () => {
    listed = [ORPHAN];
    await renderRows();
    fireEvent.click(screen.getByRole('button', { name: x.actions.refund }));

    const dialog = screen.getByRole('dialog', { name: x.refund.dialogTitle });
    expect(within(dialog).getByText(x.refund.atProvider.explainer)).toBeInTheDocument();
    expect(within(dialog).getByText(x.refund.atProvider.afterHint)).toBeInTheDocument();
    expect(
      within(dialog).getByRole('link', {
        name: g.ledger.dashboardAriaLabel('Stripe', 'pi_orphan/1'),
      }),
    ).toHaveAttribute('href', 'https://dashboard.stripe.com/payments/pi_orphan%2F1');

    fireEvent.click(within(dialog).getByRole('button', { name: x.refund.atProvider.dismissNow }));
    expect(screen.getByRole('dialog', { name: x.dismiss.dialogTitle })).toBeInTheDocument();
    // The panel never calls a refund endpoint.
    expect(callsTo('/reverse')).toHaveLength(0);
    expect(http.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  });

  it('says so when the row carries no provider payment id', async () => {
    listed = [FAILED];
    await renderRows();
    fireEvent.click(screen.getByRole('button', { name: x.actions.refund }));

    const dialog = screen.getByRole('dialog', { name: x.refund.dialogTitle });
    expect(within(dialog).getByText(x.refund.atProvider.noPaymentId)).toBeInTheDocument();
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument();
  });

  it('links a dispute to its ledger entry — the reversal is the refund', async () => {
    listed = [DISPUTE];
    await renderRows();
    fireEvent.click(screen.getByRole('button', { name: x.actions.refund }));

    const dialog = screen.getByRole('dialog', { name: x.refund.dialogTitle });
    expect(within(dialog).getByText(x.refund.onLedger.explainer)).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        x.refund.onLedger.target('Alice Doe', x.receivableKind.invoice('inv-1111')),
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: x.refund.atProvider.dismissNow }),
    ).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: x.refund.onLedger.openLedger }));
    expect(onOpenLedger).toHaveBeenCalledWith({ tab: 'ledger', userId: 'u1' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(callsTo('/reverse')).toHaveLength(0);
  });

  it('resolves the event of a disputed charge and opens it in Extras', async () => {
    listed = [
      { ...DISPUTE, receivable: { ...receivable, kind: 'event_charge', id: 'chg-1' } },
    ];
    await renderRows();
    fireEvent.click(screen.getByRole('button', { name: x.actions.refund }));
    fireEvent.click(screen.getByRole('button', { name: x.refund.onLedger.openExtras }));

    await waitFor(() =>
      expect(onOpenLedger).toHaveBeenCalledWith({ tab: 'extras', eventId: 'ev-7' }),
    );
    expect(http).toHaveBeenCalledWith('GET', '/admin/billing/charges/chg-1');
  });
});

describe('ExceptionsTab — run reconcile now', () => {
  it('cannot be pressed twice while a run is in flight, then shows the summary and reloads', async () => {
    let release: (reply: Reply) => void = () => {};
    reconcileReply = () => new Promise<Reply>((resolve) => (release = resolve));
    renderTab();
    await screen.findByText(x.empty.title);

    const button = screen.getByRole('button', { name: x.reconcile.button });
    fireEvent.click(button);
    fireEvent.click(button);

    const running = await screen.findByRole('button', { name: x.reconcile.running });
    expect(running).toBeDisabled();
    fireEvent.click(running);
    expect(callsTo('/payments/reconcile')).toHaveLength(1);
    expect(http).toHaveBeenCalledWith('POST', '/admin/billing/payments/reconcile', { body: '{}' });

    listed = [ORPHAN];
    release({ status: 200, body: { status: 'ok', error: null, summary: summary() } });

    expect(await screen.findByText(x.reconcile.ok)).toBeInTheDocument();
    expect(screen.getByTestId('reconcile-confirmed')).toHaveTextContent('5');
    expect(screen.getByTestId('reconcile-landed')).toHaveTextContent('2');
    expect(screen.getByTestId('reconcile-expired')).toHaveTextContent('1');
    // Checkouts and notifications left for the next run, together.
    expect(screen.getByTestId('reconcile-deferred')).toHaveTextContent('3');
    expect(screen.getByTestId('reconcile-retried')).toHaveTextContent('3');
    // Orphans and mismatches older than seven days, together.
    expect(screen.getByTestId('reconcile-stale')).toHaveTextContent('4');
    expect(screen.getByTestId('reconcile-unreachable')).toHaveTextContent('0');
    expect(screen.getByText(x.reconcile.counts.eventsFailed)).toBeInTheDocument();

    // The list is read again when the run returns.
    expect(await screen.findByTestId('payment-exception')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: x.reconcile.button })).toBeEnabled();
  });

  it('renders a 200 run whose status is failed as a failure, with its reason and its counts', async () => {
    const reason = '2 checkout(s) on a provider that is no longer bound were expired without being asked about';
    reconcileReply = () => ({
      status: 200,
      body: { status: 'failed', error: reason, summary: summary({ unreachable: 2 }) },
    });
    renderTab();
    await screen.findByText(x.empty.title);
    fireEvent.click(screen.getByRole('button', { name: x.reconcile.button }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(x.reconcile.failed(reason));
    expect(screen.queryByText(x.reconcile.ok)).not.toBeInTheDocument();
    expect(screen.getByTestId('reconcile-unreachable')).toHaveTextContent('2');
  });

  it('reports an invalid configuration as the failure it is', async () => {
    reconcileReply = () => ({ status: 500, body: { error: 'PAYMENTS_CONFIG_INVALID' } });
    renderTab();
    await screen.findByText(x.empty.title);
    fireEvent.click(screen.getByRole('button', { name: x.reconcile.button }));

    expect(await screen.findByRole('alert')).toHaveTextContent(x.reconcile.configuration);
    expect(screen.queryByTestId('reconcile-result')).not.toBeInTheDocument();
  });

  it('says payments are off — not an error — on a label with no provider', async () => {
    reconcileReply = () => ({ status: 404, body: { error: 'NotFound' } });
    renderTab();
    await screen.findByText(x.empty.title);
    fireEvent.click(screen.getByRole('button', { name: x.reconcile.button }));

    expect(await screen.findByText(x.reconcile.off)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says the run could not be made on any other failure', async () => {
    reconcileReply = () => ({ status: 502, body: { error: 'Boom' } });
    renderTab();
    await screen.findByText(x.empty.title);
    fireEvent.click(screen.getByRole('button', { name: x.reconcile.button }));

    expect(await screen.findByRole('alert')).toHaveTextContent(x.reconcile.unknown);
  });

  it.each(['test', 'live'] as const)('shows the declared key mode (%s) with the summary', async (keyMode) => {
    reconcileReply = () => ({
      status: 200,
      body: { status: 'ok', error: null, keyMode, summary: summary() },
    });
    renderTab();
    await screen.findByText(x.empty.title);
    fireEvent.click(screen.getByRole('button', { name: x.reconcile.button }));

    expect(await screen.findByTestId('reconcile-key-mode')).toHaveTextContent(
      x.reconcile.keyMode[keyMode],
    );
  });

  it('shows no key-mode line when the answer does not carry one', async () => {
    renderTab();
    await screen.findByText(x.empty.title);
    fireEvent.click(screen.getByRole('button', { name: x.reconcile.button }));

    expect(await screen.findByText(x.reconcile.ok)).toBeInTheDocument();
    expect(screen.queryByTestId('reconcile-key-mode')).not.toBeInTheDocument();
  });
});
