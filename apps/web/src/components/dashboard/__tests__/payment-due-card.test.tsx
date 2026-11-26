import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createMeBillingApi } from '@web/lib/me-billing-api';
import type { MyBillingStatement, MyStatementInvoice } from '@web/lib/me-billing-api';
import {
  JPY,
  ONE_PROVIDER,
  TWO_PROVIDERS,
  checkoutSession,
  extrasCharge,
  makeBillingTransport,
  pendingCheckout,
  statementWith,
} from '@web/components/billing/__tests__/statement-fixture';

// One stable client per mount, as `useApiClient` gives in the app.
let client: { meBilling: ReturnType<typeof createMeBillingApi> };

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

import { PaymentDueCard } from '../PaymentDueCard';
import { StandingBanner } from '@web/components/billing/standing-banner';

const d = dictEn.dashboard.paymentDue;
const pay = dictEn.settings.billing.pay;

/** The fixture's own open invoice (balance 200.00, due 2026-07-10), reshaped. */
function invoice(overrides: Partial<MyStatementInvoice> = {}): MyStatementInvoice {
  return { ...statementWith('due').invoices[0], ...overrides };
}

type Handlers = Parameters<typeof makeBillingTransport>[0];

function mount(
  statement: () => MyBillingStatement,
  options: { withBanner?: boolean; createCheckout?: Handlers['createCheckout'] } = {},
) {
  const http = makeBillingTransport({ statement, createCheckout: options.createCheckout });
  client = { meBilling: createMeBillingApi(http, { wait: async () => {} }) };
  const view = render(
    <DictProvider value={dictEn}>
      {options.withBanner && <StandingBanner />}
      <main>
        <PaymentDueCard />
      </main>
    </DictProvider>,
  );
  return { http, view };
}

const statementReads = (http: ReturnType<typeof makeBillingTransport>) =>
  http.mock.calls.filter(([method, path]) => method === 'GET' && path === '/me/billing').length;

/** Lets the statement read settle when the card is expected to stay absent. */
async function settled(http: ReturnType<typeof makeBillingTransport>) {
  await waitFor(() => expect(http).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  const tab = { closed: false, opener: {}, close: vi.fn(), location: { replace: vi.fn() } };
  vi.spyOn(window, 'open').mockImplementation(() => tab as unknown as Window);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PaymentDueCard — when it is absent', () => {
  it('renders nothing for a student with no invoice', async () => {
    const { http, view } = mount(() =>
      statementWith('good', { payOptions: ONE_PROVIDER, invoices: [] }),
    );
    await settled(http);
    expect(view.container.querySelector('main')).toBeEmptyDOMElement();
  });

  it('renders nothing when no provider offers a method', async () => {
    const { http, view } = mount(() => statementWith('delinquent', { payOptions: [] }));
    await settled(http);
    expect(view.container.querySelector('main')).toBeEmptyDOMElement();
  });

  it('renders nothing while the statement is loading — no skeleton, no placeholder', async () => {
    const { view } = mount(() => statementWith('due', { payOptions: ONE_PROVIDER }));
    expect(view.container.querySelector('main')).toBeEmptyDOMElement();
    // …and appears by itself once the read lands.
    expect(await screen.findByRole('region', { name: d.title })).toBeInTheDocument();
  });

  it('renders nothing when the statement cannot be read', async () => {
    const http = vi.fn(async () => ({
      ok: false,
      status: 500,
      headers: new Headers(),
      json: async () => ({ error: 'BOOM' }),
    })) as unknown as ReturnType<typeof makeBillingTransport>;
    client = { meBilling: createMeBillingApi(http) };
    const view = render(
      <DictProvider value={dictEn}>
        <main>
          <PaymentDueCard />
        </main>
      </DictProvider>,
    );
    await settled(http);
    expect(view.container.querySelector('main')).toBeEmptyDOMElement();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('leaves out invoices that are paid, void or settled, and every event charge', async () => {
    const { http, view } = mount(() =>
      statementWith('good', {
        payOptions: ONE_PROVIDER,
        invoices: [
          invoice({ id: 'paid', status: 'paid', balanceMinor: 0 }),
          invoice({ id: 'void', status: 'void' }),
          invoice({ id: 'settled', status: 'open', balanceMinor: 0 }),
        ],
        extras: {
          standing: 'delinquent',
          oldestOverdueDate: '2026-08-01',
          outstandingMinor: 25000,
          charges: [extrasCharge()],
        },
      }),
    );
    await settled(http);
    expect(view.container.querySelector('main')).toBeEmptyDOMElement();
  });
});

describe('PaymentDueCard — what it shows', () => {
  it('shows the balance, the due date, Pay and the link to the statement', async () => {
    mount(() =>
      statementWith('good', {
        asOf: '2026-07-05',
        payOptions: ONE_PROVIDER,
      }),
    );
    const card = await screen.findByRole('region', { name: d.title });
    expect(within(card).getByText('R$ 200.00')).toBeInTheDocument();
    expect(within(card).getByText(d.dueOn('2026-07-10'))).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: pay.action })).toBeEnabled();
    expect(within(card).getByRole('link', { name: d.statementLink })).toHaveAttribute(
      'href',
      '/settings/billing',
    );
  });

  it('marks an invoice past its due date as overdue, from the statement own date', async () => {
    mount(() => statementWith('delinquent', { asOf: '2026-09-01', payOptions: ONE_PROVIDER }));
    const card = await screen.findByRole('region', { name: d.title });
    expect(within(card).getByText(d.overdueSince('2026-07-10'))).toBeInTheDocument();
    expect(within(card).queryByText(d.dueOn('2026-07-10'))).not.toBeInTheDocument();
  });

  it('lists three open invoices one row each, earliest due first', async () => {
    mount(() =>
      statementWith('delinquent', {
        asOf: '2026-08-15',
        payOptions: ONE_PROVIDER,
        invoices: [
          invoice({ id: 'sep', dueDate: '2026-09-10', balanceMinor: 30000 }),
          invoice({ id: 'jul', dueDate: '2026-07-10', balanceMinor: 20000 }),
          invoice({ id: 'aug', dueDate: '2026-08-10', balanceMinor: 25000 }),
        ],
      }),
    );
    const card = await screen.findByRole('region', { name: d.title });
    const rows = within(card).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('R$ 200.00');
    expect(rows[0]).toHaveTextContent(d.overdueSince('2026-07-10'));
    expect(rows[1]).toHaveTextContent('R$ 250.00');
    expect(rows[1]).toHaveTextContent(d.overdueSince('2026-08-10'));
    expect(rows[2]).toHaveTextContent('R$ 300.00');
    expect(rows[2]).toHaveTextContent(d.dueOn('2026-09-10'));
    expect(within(card).getAllByRole('button', { name: pay.action })).toHaveLength(3);
  });

  it('shows Open again for an invoice with a checkout in progress', async () => {
    mount(() =>
      statementWith('due', {
        payOptions: ONE_PROVIDER,
        invoices: [invoice({ pendingCheckout: pendingCheckout() })],
      }),
    );
    const card = await screen.findByRole('region', { name: d.title });
    expect(within(card).getByRole('button', { name: pay.openAgain })).toBeEnabled();
    expect(within(card).queryByRole('button', { name: pay.action })).not.toBeInTheDocument();
  });

  it('offers the same provider choice as the statement, labelled by method', async () => {
    mount(() => statementWith('due', { payOptions: TWO_PROVIDERS }));
    const card = await screen.findByRole('region', { name: d.title });
    const labels = within(card)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(labels).toEqual([pay.payWith(pay.method.pix), pay.payWith(pay.method.card)]);
  });

  it('formats the amount with the statement currency', async () => {
    mount(() =>
      statementWith('due', {
        currency: JPY,
        payOptions: ONE_PROVIDER,
        invoices: [invoice({ currency: 'JPY', balanceMinor: 100000 })],
      }),
    );
    const card = await screen.findByRole('region', { name: d.title });
    expect(within(card).getByText('¥ 100,000')).toBeInTheDocument();
  });
});

describe('PaymentDueCard — one statement, shared', () => {
  it('issues a single statement request with the standing notice on screen', async () => {
    const { http } = mount(() => statementWith('due', { payOptions: ONE_PROVIDER }), {
      withBanner: true,
    });
    await screen.findByRole('region', { name: d.title });
    // Both readers are on screen, fed by the one read.
    expect(screen.getByRole('status', { name: dictEn.layout.standingBanner.label })).toBeInTheDocument();
    await settled(http);
    expect(statementReads(http)).toBe(1);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('pays through the shared action and re-reads the statement once, quietly', async () => {
    let current = statementWith('due', { payOptions: ONE_PROVIDER });
    const { http } = mount(() => current, {
      withBanner: true,
      createCheckout: () => ({ status: 201, body: checkoutSession() }),
    });
    const card = await screen.findByRole('region', { name: d.title });

    current = statementWith('due', {
      payOptions: ONE_PROVIDER,
      invoices: [invoice({ pendingCheckout: pendingCheckout() })],
    });
    fireEvent.click(within(card).getByRole('button', { name: pay.action }));

    await within(card).findByRole('button', { name: pay.openAgain });
    await waitFor(() => expect(statementReads(http)).toBe(2));

    const posts = http.mock.calls.filter(([method]) => method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0][1]).toBe('/me/billing/checkouts');
    expect(JSON.parse(String(posts[0][2]?.body))).toEqual({ kind: 'invoice', id: 'inv1' });
    // The card never left the screen while the statement was re-read.
    expect(screen.getByRole('region', { name: d.title })).toBe(card);
  });

  it('drops the card once the refreshed statement holds nothing to pay', async () => {
    let current = statementWith('due', { payOptions: ONE_PROVIDER });
    const { http } = mount(() => current, {
      createCheckout: () => ({ status: 409, body: { error: 'RECEIVABLE_NOT_PAYABLE' } }),
    });
    const card = await screen.findByRole('region', { name: d.title });

    current = statementWith('good', { payOptions: ONE_PROVIDER, invoices: [] });
    fireEvent.click(within(card).getByRole('button', { name: pay.action }));

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: d.title })).not.toBeInTheDocument(),
    );
    expect(statementReads(http)).toBe(2);
  });
});
