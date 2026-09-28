import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createAdminBillingApi } from '@web/lib/admin-billing-api';
import type {
  BillingEventChargeDetail,
  BillingReportCurrency,
} from '@web/lib/admin-billing-api';
import type { AdminEvent } from '@web/lib/admin-events-api';
import type { HttpTransport } from '@web/lib/api-client';
import { makeTransport } from './test-transport';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

let http: ReturnType<typeof makeTransport>;
let client: {
  adminBilling: ReturnType<typeof createAdminBillingApi>;
  adminEvents: { list: ReturnType<typeof vi.fn> };
  adminGroups: { list: ReturnType<typeof vi.fn>; listMembers: ReturnType<typeof vi.fn> };
};

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

import { ExtrasTab } from '../extras-tab';

const BRL: BillingReportCurrency = { code: 'BRL', exponent: 2, symbol: 'R$' };

const d = dictEn.admin.billing.extras;
const ledger = dictEn.admin.billing.ledger;

function eventOf(id: string, title: string, status: AdminEvent['status']): AdminEvent {
  return {
    id,
    slug: id,
    title,
    summary: '',
    content: '',
    location: '',
    startsAt: '2026-10-10T12:00:00Z',
    endsAt: null,
    timezone: 'UTC',
    status,
    audience: 'public',
    flyer: null as unknown as AdminEvent['flyer'],
    whatsappNumber: '',
    whatsappMessage: null,
    contactLabel: '',
    createdBy: 'admin',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };
}

const CHARGE: BillingEventChargeDetail = {
  id: 'ch-11111111',
  eventId: 'ev-1',
  userId: 'u1',
  description: 'Winter seminar',
  amountMinor: 15000,
  currency: 'BRL',
  termsSource: 'standard',
  termsNote: '',
  dueDate: '2026-09-08',
  graceDays: 5,
  status: 'open',
  issuedBy: 'admin',
  issuedAt: '2026-09-01T00:00:00Z',
  voidedAt: null,
  voidReason: null,
  balanceMinor: 5000,
  adjustments: [],
  payments: [
    {
      id: 'pay-22222222',
      chargeId: 'ch-11111111',
      amountMinor: 10000,
      currency: 'BRL',
      method: 'pix',
      paidAt: '2026-09-02',
      externalReference: null,
      note: '',
      reversesId: null,
      recordedBy: 'admin',
      recordedAt: '2026-09-02T00:00:00Z',
    },
  ],
};

const SUMMARY = {
  eventId: 'ev-1',
  currency: 'BRL',
  chargedMinor: 15000,
  adjustmentsMinor: 0,
  receivedMinor: 10000,
  outstandingMinor: 5000,
  chargeCount: 1,
  counts: { open: 1, paid: 0, void: 0 },
};

function renderTab() {
  return render(
    <DictProvider value={dictEn}>
      <ExtrasTab
        currency={BRL}
        nameOf={(id) => (id === 'u1' ? 'Alice Doe' : id)}
        students={[{ id: 'u1', name: 'Alice Doe', email: 'alice@dojo.test' }]}
      />
    </DictProvider>,
  );
}

const summaryReads = () =>
  http.mock.calls.filter(([, url]) => url === '/admin/billing/events/ev-1/summary').length;

async function openEventAndCharge() {
  renderTab();
  fireEvent.change(await screen.findByLabelText(d.eventLabel), { target: { value: 'ev-1' } });
  await screen.findByText('Alice Doe');
  await waitFor(() => expect(summaryReads()).toBe(1));
  fireEvent.click(screen.getByRole('button', { name: d.charges.expandAriaLabel('ch-11111') }));
  await screen.findByRole('button', { name: ledger.reverseAriaLabel('pay-2222') });
}

describe('ExtrasTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    http = makeTransport((method, path) => {
      if (path === '/admin/billing/event-prices/ev-1') {
        return {
          eventId: 'ev-1',
          amountMinor: 15000,
          currency: 'BRL',
          dueInDays: 7,
          graceDays: 5,
          updatedBy: 'admin',
          updatedAt: '2026-09-01T00:00:00Z',
        };
      }
      if (path === '/admin/billing/events/ev-1/summary') return SUMMARY;
      if (path === '/admin/billing/charges?eventId=ev-1') return [CHARGE];
      if (path === '/admin/billing/charges/ch-11111111' && method === 'GET') return CHARGE;
      return {};
    });
    client = {
      adminBilling: createAdminBillingApi(http as unknown as HttpTransport),
      adminEvents: {
        // A draft slipped into the answer must still never be offered.
        list: vi.fn(async () => ({
          data: [
            eventOf('ev-1', 'Winter seminar', 'published'),
            eventOf('ev-2', 'Secret draft', 'draft'),
          ],
          total: 2,
          limit: 100,
          offset: 0,
        })),
      },
      adminGroups: { list: vi.fn(async () => []), listMembers: vi.fn(async () => []) },
    };
  });

  it('opens on the event it is handed — the admin event page link', async () => {
    render(
      <DictProvider value={dictEn}>
        <ExtrasTab currency={BRL} nameOf={(id) => id} students={[]} initialEventId="ev-1" />
      </DictProvider>,
    );
    await waitFor(() => expect(summaryReads()).toBe(1));
    expect(http).toHaveBeenCalledWith('GET', '/admin/billing/event-prices/ev-1');
    await waitFor(() =>
      expect(screen.getByLabelText(d.eventLabel)).toHaveValue('ev-1'),
    );
  });

  it('offers published events only', async () => {
    renderTab();
    const select = await screen.findByLabelText(d.eventLabel);
    expect(client.adminEvents.list).toHaveBeenCalledWith({ status: 'published', limit: 100 });
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(['', 'ev-1']);
    expect(screen.queryByText(/Secret draft/)).toBeNull();
  });

  it('shows the price, the summary and the charge list of the chosen event', async () => {
    renderTab();
    fireEvent.change(await screen.findByLabelText(d.eventLabel), { target: { value: 'ev-1' } });

    expect(await screen.findByText('Alice Doe')).toBeInTheDocument();
    expect(screen.getByLabelText(d.price.amountLabel('BRL'))).toHaveValue('150.00');
    await waitFor(() =>
      expect(screen.getByTestId('extras-summary-outstanding')).toHaveTextContent('50.00'),
    );
    expect(screen.getByText(d.summary.counts(1, 0, 0))).toBeInTheDocument();
  });

  it('saves the price as integer minor units', async () => {
    renderTab();
    fireEvent.change(await screen.findByLabelText(d.eventLabel), { target: { value: 'ev-1' } });
    const amount = await screen.findByLabelText(d.price.amountLabel('BRL'));
    await waitFor(() => expect(amount).toHaveValue('150.00'));
    fireEvent.change(amount, { target: { value: '180.50' } });
    fireEvent.click(screen.getByRole('button', { name: d.price.save }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('PUT', '/admin/billing/event-prices/ev-1', {
        body: JSON.stringify({ amountMinor: 18050, dueInDays: 7, graceDays: 5 }),
      }),
    );
  });

  it('records a payment on a charge and refreshes the summary', async () => {
    await openEventAndCharge();
    fireEvent.click(screen.getByRole('button', { name: d.paymentButtonAriaLabel('ch-11111') }));
    fireEvent.change(screen.getByLabelText(ledger.payment.amountLabel('BRL')), {
      target: { value: '50' },
    });
    fireEvent.click(screen.getByRole('button', { name: ledger.payment.submit }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/charges/ch-11111111/payments', {
        body: JSON.stringify({ amountMinor: 5000, method: 'cash' }),
      }),
    );
    expect(await screen.findByText(d.paymentSuccess)).toBeInTheDocument();
    await waitFor(() => expect(summaryReads()).toBe(2));
  });

  it('reverses a charge payment through the charge endpoint and refreshes the summary', async () => {
    await openEventAndCharge();
    fireEvent.click(screen.getByRole('button', { name: ledger.reverseAriaLabel('pay-2222') }));
    fireEvent.change(screen.getByPlaceholderText(ledger.reverseReasonPlaceholder), {
      target: { value: 'Entered twice' },
    });
    fireEvent.click(screen.getByRole('button', { name: ledger.reverseSubmit }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith(
        'POST',
        '/admin/billing/charge-payments/pay-22222222/reverse',
        { body: JSON.stringify({ reason: 'Entered twice' }) },
      ),
    );
    expect(await screen.findByText(d.reverseSuccess)).toBeInTheDocument();
    await waitFor(() => expect(summaryReads()).toBe(2));
  });

  it('voids a charge through the charge endpoint and refreshes the summary', async () => {
    await openEventAndCharge();
    fireEvent.click(screen.getByRole('button', { name: d.voidCharge.buttonAriaLabel('ch-11111') }));
    expect(screen.getByText(d.voidCharge.chargeLine('ch-11111'))).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(d.voidCharge.reasonPlaceholder), {
      target: { value: 'Seminar cancelled' },
    });
    fireEvent.click(screen.getByRole('button', { name: d.voidCharge.submit }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/charges/ch-11111111/void', {
        body: JSON.stringify({ reason: 'Seminar cancelled' }),
      }),
    );
    expect(await screen.findByText(d.voidCharge.success)).toBeInTheDocument();
    await waitFor(() => expect(summaryReads()).toBe(2));
  });

  it('shows the server sentence when voiding a paid charge is refused', async () => {
    await openEventAndCharge();
    http.mockImplementationOnce(async () =>
      ({
        ok: false,
        status: 409,
        json: async () => ({
          error: 'Conflict',
          message: 'a charge with net payments cannot be voided; reverse them first',
        }),
      }) as unknown as Response,
    );
    fireEvent.click(screen.getByRole('button', { name: d.voidCharge.buttonAriaLabel('ch-11111') }));
    fireEvent.change(screen.getByPlaceholderText(d.voidCharge.reasonPlaceholder), {
      target: { value: 'Seminar cancelled' },
    });
    fireEvent.click(screen.getByRole('button', { name: d.voidCharge.submit }));

    expect(
      await screen.findByText('a charge with net payments cannot be voided; reverse them first'),
    ).toBeInTheDocument();
  });

  it('opens the charge dialog for the chosen event', async () => {
    renderTab();
    fireEvent.change(await screen.findByLabelText(d.eventLabel), { target: { value: 'ev-1' } });
    await screen.findByText('Alice Doe');
    fireEvent.click(screen.getByRole('button', { name: d.chargeButton }));
    expect(
      screen.getByRole('dialog', { name: d.dialog.title('Winter seminar') }),
    ).toBeInTheDocument();
  });
});
