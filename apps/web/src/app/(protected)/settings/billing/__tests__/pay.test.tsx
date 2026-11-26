import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createMeBillingApi } from '@web/lib/me-billing-api';
import type { CheckoutStatus, MyBillingStatement } from '@web/lib/me-billing-api';
import { formatExpiry } from '@web/components/billing/pay-action';
import {
  ONE_PROVIDER,
  TWO_PROVIDERS,
  checkoutSession,
  checkoutStatus,
  extrasCharge,
  makeBillingTransport,
  pendingCheckout,
  statementWith,
} from '@web/components/billing/__tests__/statement-fixture';
import { CHECKOUT_POLL_GAPS_MS } from '../use-checkout-return';

let http: ReturnType<typeof makeBillingTransport>;
let client: { meBilling: ReturnType<typeof createMeBillingApi> };

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

import StudentBillingPage from '../page';

const d = dictEn.settings.billing;
const p = d.pay;
const LOCALE = d.locale;

type Handlers = Parameters<typeof makeBillingTransport>[0];

function mount(handlers: Handlers) {
  http = makeBillingTransport(handlers);
  client = { meBilling: createMeBillingApi(http, { wait: async () => {} }) };
  return render(
    <DictProvider value={dictEn}>
      <StudentBillingPage />
    </DictProvider>,
  );
}

const calls = (method: string, prefix: string) =>
  http.mock.calls.filter(([m, path]) => m === method && path.startsWith(prefix));
const statementReads = () =>
  http.mock.calls.filter(([m, path]) => m === 'GET' && path === '/me/billing').length;
const statusReads = () => calls('GET', '/me/billing/checkouts/').length;

/** A statement with one open invoice and one open event charge. */
function payable(overrides: Partial<MyBillingStatement> = {}): MyBillingStatement {
  return statementWith('delinquent', {
    payOptions: ONE_PROVIDER,
    extras: {
      standing: 'due',
      oldestOverdueDate: null,
      outstandingMinor: 25000,
      charges: [extrasCharge()],
    },
    ...overrides,
  });
}

const invoiceRow = async () => {
  const period = await screen.findByText(d.invoices.periodValue('2026-07-01', '2026-07-31'));
  return within(period.closest('div')?.parentElement as HTMLElement);
};
const extrasRegion = async () =>
  within(await screen.findByRole('region', { name: d.extras.heading }));

let tab: { closed: boolean; opener: unknown; close: () => void; location: { replace: ReturnType<typeof vi.fn> } } | null;

beforeEach(() => {
  window.history.replaceState(null, '', '/settings/billing');
  tab = { closed: false, opener: {}, close: vi.fn(), location: { replace: vi.fn() } };
  vi.spyOn(window, 'open').mockImplementation(() => tab as unknown as Window);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Student statement — with no online method', () => {
  it('renders as it always did: no Pay, no new copy', async () => {
    const view = mount({ statement: () => payable({ payOptions: [] }) });
    await screen.findByText(d.invoices.heading);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText(d.paymentNote)).toBeInTheDocument();
    const text = view.container.textContent ?? '';
    for (const copy of [p.note, p.groupLabel, p.openAgain, p.opening, p.blocked]) {
      expect(text).not.toContain(copy);
    }
  });

  it('shows no Pay even when a checkout is still pending', async () => {
    mount({
      statement: () => {
        const statement = payable({ payOptions: [] });
        statement.invoices[0].pendingCheckout = pendingCheckout();
        return statement;
      },
    });
    await screen.findByText(d.invoices.heading);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('Student statement — Pay', () => {
  it('offers Pay on the open invoice and on the open event charge', async () => {
    mount({ statement: () => payable() });
    expect((await invoiceRow()).getByRole('button', { name: p.action })).toBeEnabled();
    expect((await extrasRegion()).getByRole('button', { name: p.action })).toBeEnabled();
    // The "nothing to pay here" note would now be untrue.
    expect(screen.queryByText(d.paymentNote)).not.toBeInTheDocument();
    expect(screen.getByText(p.note)).toBeInTheDocument();
  });

  it('offers nothing on a paid or void receivable', async () => {
    mount({
      statement: () => {
        const statement = payable({
          extras: {
            standing: 'good',
            oldestOverdueDate: null,
            outstandingMinor: 0,
            charges: [
              extrasCharge({ id: 'ch1', status: 'paid', balanceMinor: 0 }),
              extrasCharge({ id: 'ch2', status: 'void' }),
            ],
          },
        });
        statement.invoices[0] = { ...statement.invoices[0], status: 'paid', balanceMinor: 0 };
        return statement;
      },
    });
    await screen.findByText(d.invoices.heading);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('asks how to pay, by method, when several providers offer one', async () => {
    mount({ statement: () => payable({ payOptions: TWO_PROVIDERS }) });
    const row = await invoiceRow();
    expect(row.getAllByRole('button').map((b) => b.textContent)).toEqual([
      p.payWith(p.method.pix),
      p.payWith(p.method.card),
    ]);
  });

  it('opens the hosted page in a new tab and turns the row into "in progress" with no reload', async () => {
    let created = false;
    mount({
      statement: () => {
        const statement = payable();
        if (created) statement.invoices[0].pendingCheckout = pendingCheckout();
        return statement;
      },
      createCheckout: () => {
        created = true;
        return { status: 201, body: checkoutSession() };
      },
    });

    const row = await invoiceRow();
    const heading = screen.getByText(d.invoices.heading);
    fireEvent.click(row.getByRole('button', { name: p.action }));

    expect(window.open).toHaveBeenCalledWith('', '_blank');
    await waitFor(() =>
      expect(tab?.location.replace).toHaveBeenCalledWith('https://pay.example.test/checkout/co1'),
    );
    expect(calls('POST', '/me/billing/checkouts').map(([, , o]) => JSON.parse(String(o?.body)))).toEqual([
      { kind: 'invoice', id: 'inv1' },
    ]);

    expect(
      await row.findByText(p.inProgress(formatExpiry('2099-01-01T12:00:00.000Z', LOCALE))),
    ).toBeInTheDocument();
    expect(row.getByRole('button', { name: p.openAgain })).toBeInTheDocument();
    expect(row.queryByRole('button', { name: p.action })).not.toBeInTheDocument();

    // The statement was read again quietly: same DOM node, no spinner swap.
    await waitFor(() => expect(statementReads()).toBe(2));
    expect(screen.getByText(d.invoices.heading)).toBe(heading);
    // The other receivable is untouched.
    expect((await extrasRegion()).getByRole('button', { name: p.action })).toBeEnabled();
  });

  it('pays an event charge as an event_charge', async () => {
    mount({
      statement: () => payable(),
      createCheckout: () => ({ status: 201, body: checkoutSession({ checkoutId: 'co2' }) }),
    });
    fireEvent.click((await extrasRegion()).getByRole('button', { name: p.action }));
    await waitFor(() => expect(tab?.location.replace).toHaveBeenCalled());
    expect(JSON.parse(String(calls('POST', '/me/billing/checkouts')[0][2]?.body))).toEqual({
      kind: 'event_charge',
      id: 'ch1',
    });
  });

  it('shows a pending checkout from the statement, and Pay again once it expired', async () => {
    mount({
      statement: () => {
        const statement = payable();
        statement.invoices[0].pendingCheckout = pendingCheckout({
          expiresAt: '2099-05-06T07:08:00.000Z',
        });
        statement.extras.charges[0].pendingCheckout = pendingCheckout({
          checkoutId: 'co-old',
          expiresAt: '2020-01-01T00:00:00.000Z',
        });
        return statement;
      },
    });
    const row = await invoiceRow();
    expect(
      row.getByText(p.inProgress(formatExpiry('2099-05-06T07:08:00.000Z', LOCALE))),
    ).toBeInTheDocument();
    expect(row.getByRole('button', { name: p.openAgain })).toBeInTheDocument();

    const extras = await extrasRegion();
    expect(extras.getByRole('button', { name: p.action })).toBeInTheDocument();
    expect(extras.queryByRole('button', { name: p.openAgain })).not.toBeInTheDocument();
  });

  it('refreshes the statement when the receivable changed underneath', async () => {
    let paid = false;
    mount({
      statement: () => {
        const statement = payable();
        if (paid) statement.invoices[0] = { ...statement.invoices[0], status: 'paid', balanceMinor: 0 };
        return statement;
      },
      createCheckout: () => {
        paid = true;
        return { status: 409, body: { error: 'RECEIVABLE_NOT_PAYABLE' } };
      },
    });
    const row = await invoiceRow();
    fireEvent.click(row.getByRole('button', { name: p.action }));

    // The row now tells the truth: paid, and nothing left to press.
    await waitFor(() => expect(row.queryByRole('button')).not.toBeInTheDocument());
    expect(row.getByText(d.invoiceStatus.paid)).toBeInTheDocument();
    expect(statementReads()).toBe(2);
    expect(tab?.close).toHaveBeenCalled();
  });

  it('keeps the statement on screen and explains a provider failure', async () => {
    mount({
      statement: () => payable(),
      createCheckout: () => ({ status: 502, body: { error: 'PAYMENTS_PROVIDER_ERROR' } }),
    });
    const row = await invoiceRow();
    fireEvent.click(row.getByRole('button', { name: p.action }));
    expect(await row.findByRole('alert')).toHaveTextContent(p.errors.provider_unavailable);
    expect(statementReads()).toBe(1);
    expect(row.getByRole('button', { name: p.action })).toBeEnabled();
  });
});

describe('Student statement — payment history', () => {
  const gateway = (overrides: Record<string, unknown> = {}) => ({
    id: 'gw1',
    invoiceId: 'inv1',
    amountMinor: 20000,
    currency: 'BRL',
    method: 'gateway' as const,
    paidAt: '2026-07-09T13:45:00.000Z',
    externalReference: 'mercadopago:123',
    note: '',
    reversesId: null,
    recordedBy: 'system:payment-gateway',
    recordedAt: '2026-07-09T13:45:02.000Z',
    ...overrides,
  });

  const withPayments = (payments: ReturnType<typeof gateway>[]) => () => {
    const statement = payable({ payOptions: [] });
    statement.invoices[0] = {
      ...statement.invoices[0],
      status: 'paid',
      balanceMinor: 0,
      payments: [...statement.invoices[0].payments, ...payments],
    };
    return statement;
  };

  it('reads a gateway payment as "Paid online" with its date', async () => {
    mount({ statement: withPayments([gateway()]) });
    const row = await invoiceRow();
    expect(row.getByText(p.history.paidOnline('2026-07-09'))).toBeInTheDocument();
    // A payment an admin recorded reads as before.
    expect(row.getByText(`${d.paymentMethod.pix} · 2026-07-08T00:00:00Z`)).toBeInTheDocument();
  });

  it('reads a refunded gateway payment as refunded', async () => {
    mount({
      statement: withPayments([
        gateway(),
        gateway({
          id: 'gw2',
          amountMinor: -20000,
          paidAt: '2026-07-12T10:00:00.000Z',
          reversesId: 'gw1',
          externalReference: 'mercadopago:refund-9',
        }),
      ]),
    });
    const row = await invoiceRow();
    expect(
      row.getByText(`${p.history.paidOnline('2026-07-09')} · ${p.history.refundedTag}`),
    ).toBeInTheDocument();
    expect(row.getByText(p.history.refund('2026-07-12'))).toBeInTheDocument();
    expect(row.getByText('-R$ 200.00')).toBeInTheDocument();
  });

  it('reads a provider-side refund (no mirror link) as a refund', async () => {
    mount({
      statement: withPayments([
        gateway(),
        gateway({ id: 'gw3', amountMinor: -5000, paidAt: '2026-07-15T10:00:00.000Z' }),
      ]),
    });
    const row = await invoiceRow();
    expect(row.getByText(p.history.paidOnline('2026-07-09'))).toBeInTheDocument();
    expect(row.getByText(p.history.refund('2026-07-15'))).toBeInTheDocument();
  });
});

describe('Student statement — returning from the hosted page', () => {
  const TOTAL_MS = CHECKOUT_POLL_GAPS_MS.reduce((sum, gap) => sum + gap, 0);

  let visibility: DocumentVisibilityState;

  function setVisibility(next: DocumentVisibilityState) {
    visibility = next;
    document.dispatchEvent(new Event('visibilitychange'));
  }

  /** Lets pending promises and state updates settle under fake timers. */
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  async function arrive(query: string, handlers: Omit<Handlers, 'statement'> & Partial<Handlers>) {
    window.history.replaceState(null, '', `/settings/billing${query}`);
    const view = mount({ statement: () => payable(), ...handlers });
    await advance(0);
    return view;
  }

  const open = (): { status: number; body: CheckoutStatus } => ({
    status: 200,
    body: checkoutStatus(),
  });

  beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  });

  it('does nothing without the hint', async () => {
    await arrive('', { getCheckout: open });
    await advance(TOTAL_MS * 2);
    expect(statusReads()).toBe(0);
    expect(statementReads()).toBe(1);
    expect(screen.queryByText(p.returned.confirming)).not.toBeInTheDocument();
  });

  it('removes the hint from the URL once read, keeping the rest', async () => {
    await arrive('?checkout=co1&outcome=success&tab=x#top', { getCheckout: open });
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      '/settings/billing?tab=x#top',
    );
  });

  it('never shows Paid from outcome=success while the checkout is still open', async () => {
    const view = await arrive('?checkout=co1&outcome=success', { getCheckout: open });
    expect(screen.getByText(p.returned.confirming)).toBeInTheDocument();

    for (const gap of CHECKOUT_POLL_GAPS_MS) {
      await advance(gap);
      expect(view.container.textContent).not.toContain(p.returned.paid);
      expect(screen.queryByText(d.invoiceStatus.paid)).not.toBeInTheDocument();
    }
    expect(screen.getByText(p.returned.still_confirming)).toBeInTheDocument();
  });

  it('reads the status at most five times — after 2, 4, 8, 15 and 30 s — then refreshes once', async () => {
    await arrive('?checkout=co1&outcome=success', { getCheckout: open });
    expect(CHECKOUT_POLL_GAPS_MS).toEqual([2000, 4000, 8000, 15000, 30000]);
    expect(statusReads()).toBe(0);

    let expected = 0;
    for (const gap of CHECKOUT_POLL_GAPS_MS) {
      await advance(gap - 1);
      expect(statusReads()).toBe(expected);
      await advance(1);
      expected += 1;
      expect(statusReads()).toBe(expected);
    }
    expect(calls('GET', '/me/billing/checkouts/').map(([, path]) => path)).toEqual(
      Array(5).fill('/me/billing/checkouts/co1'),
    );

    await advance(10 * 60 * 1000);
    expect(statusReads()).toBe(5);
    // The first read of the page, plus exactly one refresh.
    expect(statementReads()).toBe(2);
    expect(screen.getByText(p.returned.still_confirming)).toBeInTheDocument();
  });

  it('stops at the first settled answer and refreshes the statement', async () => {
    let reads = 0;
    let landed = false;
    await arrive('?checkout=co1&outcome=success', {
      statement: () => {
        const statement = payable();
        if (landed) statement.invoices[0] = { ...statement.invoices[0], status: 'paid', balanceMinor: 0 };
        return statement;
      },
      getCheckout: () => {
        reads += 1;
        if (reads < 2) return open();
        landed = true;
        return { status: 200, body: checkoutStatus({ status: 'paid', closedAt: '2026-09-01T12:01:00.000Z' }) };
      },
    });

    await advance(2000);
    expect(screen.getByText(p.returned.confirming)).toBeInTheDocument();
    await advance(4000);

    expect(screen.getByText(p.returned.paid)).toBeInTheDocument();
    expect(statementReads()).toBe(2);
    // Synchronous lookup: `findBy*` would wait on the faked clock.
    const period = screen.getByText(d.invoices.periodValue('2026-07-01', '2026-07-31'));
    const row = within(period.closest('div')?.parentElement as HTMLElement);
    expect(row.getByText(d.invoiceStatus.paid)).toBeInTheDocument();
    expect(row.queryByRole('button')).not.toBeInTheDocument();

    await advance(TOTAL_MS * 2);
    expect(statusReads()).toBe(2);
    expect(statementReads()).toBe(2);
  });

  it('sends nothing while the tab is hidden, and reads on the way back', async () => {
    await arrive('?checkout=co1&outcome=success', { getCheckout: open });
    setVisibility('hidden');

    await advance(TOTAL_MS * 3);
    expect(statusReads()).toBe(0);

    await act(async () => {
      setVisibility('visible');
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(statusReads()).toBe(1);

    // Hidden again in the middle of the sequence: the next read waits too.
    setVisibility('hidden');
    await advance(TOTAL_MS);
    expect(statusReads()).toBe(1);
    await act(async () => {
      setVisibility('visible');
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(statusReads()).toBe(2);

    await advance(TOTAL_MS * 3);
    expect(statusReads()).toBe(5);
  });

  it.each([
    ['cancelled', 'cancelled'],
    ['expired', 'expired'],
    ['failed', 'failed'],
    ['mismatch', 'failed'],
  ] as const)('says a %s checkout is over', async (status, phase) => {
    await arrive('?checkout=co1&outcome=success', {
      getCheckout: () => ({ status: 200, body: checkoutStatus({ status }) }),
    });
    await advance(2000);
    expect(screen.getByText(p.returned[phase])).toBeInTheDocument();
    expect(statusReads()).toBe(1);
    expect(statementReads()).toBe(2);
  });

  it('asks once on outcome=cancel and says the payment was not completed', async () => {
    const view = await arrive('?checkout=co1&outcome=cancel', { getCheckout: open });
    await advance(0);
    expect(statusReads()).toBe(1);
    expect(screen.getByText(p.returned.cancelled)).toBeInTheDocument();
    expect(view.container.textContent).not.toContain(p.returned.confirming);

    await advance(TOTAL_MS * 2);
    expect(statusReads()).toBe(1);
    expect(statementReads()).toBe(2);
  });

  it('still reports a payment that landed despite outcome=cancel', async () => {
    await arrive('?checkout=co1&outcome=cancel', {
      getCheckout: () => ({ status: 200, body: checkoutStatus({ status: 'paid' }) }),
    });
    await advance(0);
    expect(screen.getByText(p.returned.paid)).toBeInTheDocument();
  });

  it('says nothing about a checkout that is not the caller’s', async () => {
    const view = await arrive('?checkout=someone-elses&outcome=success', {
      getCheckout: () => ({ status: 404, body: { error: 'NotFound' } }),
    });
    await advance(TOTAL_MS * 2);
    expect(statusReads()).toBe(1);
    for (const message of Object.values(p.returned)) {
      expect(view.container.textContent).not.toContain(message);
    }
  });

  it('keeps asking through a failed read and never invents an answer', async () => {
    const view = await arrive('?checkout=co1&outcome=success', {
      getCheckout: () => ({ status: 500, body: { error: 'PAYMENTS_CONFIG_INVALID' } }),
    });
    await advance(TOTAL_MS * 2);
    expect(statusReads()).toBe(5);
    expect(view.container.textContent).not.toContain(p.returned.paid);
    expect(screen.getByText(p.returned.still_confirming)).toBeInTheDocument();
  });

  it('ignores a malformed checkout id but still cleans the URL', async () => {
    await arrive('?checkout=..%2F..%2Fadmin&outcome=success', { getCheckout: open });
    await advance(TOTAL_MS * 2);
    expect(statusReads()).toBe(0);
    expect(window.location.search).toBe('');
    expect(screen.queryByText(p.returned.confirming)).not.toBeInTheDocument();
  });

  it('stops asking when the page is left', async () => {
    const view = await arrive('?checkout=co1&outcome=success', { getCheckout: open });
    await advance(2000);
    expect(statusReads()).toBe(1);
    view.unmount();
    await advance(TOTAL_MS * 2);
    expect(statusReads()).toBe(1);
  });
});
