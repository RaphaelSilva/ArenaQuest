import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createAdminBillingApi } from '@web/lib/admin-billing-api';
import type { BillingEventChargeSummary } from '@web/lib/admin-billing-api';
import type { HttpTransport } from '@web/lib/api-client';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

let client: { adminBilling: ReturnType<typeof createAdminBillingApi> };

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

import { EventChargesPanel, extrasTabHrefFor } from '../[eventId]/event-charges-panel';

const d = dictEn.admin.events.charges;
const BRL = { code: 'BRL', exponent: 2, symbol: 'R$' };

const PRICE = {
  eventId: 'e1',
  amountMinor: 15000,
  currency: 'BRL',
  dueInDays: 7,
  graceDays: 5,
  updatedBy: 'admin',
  updatedAt: '2026-09-01T00:00:00Z',
};

function summary(overrides: Partial<BillingEventChargeSummary> = {}): BillingEventChargeSummary {
  return {
    eventId: 'e1',
    currency: 'BRL',
    chargedMinor: 45000,
    adjustmentsMinor: -5000,
    receivedMinor: 15000,
    outstandingMinor: 25000,
    chargeCount: 4,
    counts: { open: 2, paid: 1, void: 1 },
    ...overrides,
  };
}

type Reply = { status: number; body: unknown };

/** A transport keyed by path; a missing path answers 404 like the API. */
function makeHttp(routes: Record<string, Reply>) {
  return vi.fn(async (_method: string, path: string) => {
    const reply = routes[path] ?? { status: 404, body: { error: 'NOT_FOUND' } };
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body,
    } as unknown as Response;
  });
}

const AGING = {
  status: 200,
  body: { asOf: '2026-09-01', currency: BRL, buckets: [], totalMinor: 0, invoiceCount: 0, studentCount: 0 },
};

let http: ReturnType<typeof makeHttp>;

function mount(routes: Record<string, Reply>) {
  http = makeHttp(routes);
  client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };
  return render(
    <DictProvider value={dictEn}>
      <EventChargesPanel eventId="e1" />
    </DictProvider>,
  );
}

describe('EventChargesPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the summary of a charged event and links to the Extras tab on that event', async () => {
    mount({
      '/admin/billing/event-prices/e1': { status: 200, body: PRICE },
      '/admin/billing/events/e1/summary': { status: 200, body: summary() },
      '/admin/billing/reports/aging': AGING,
    });

    const panel = within(await screen.findByRole('region', { name: d.heading }));
    expect(panel.getByText(d.chargedLabel).nextSibling).toHaveTextContent('R$ 450.00');
    expect(panel.getByText(d.adjustmentsLabel).nextSibling).toHaveTextContent('-R$ 50.00');
    expect(panel.getByText(d.receivedLabel).nextSibling).toHaveTextContent('R$ 150.00');
    expect(panel.getByText(d.outstandingLabel).nextSibling).toHaveTextContent('R$ 250.00');
    expect(panel.getByText(d.chargeCount(4))).toBeInTheDocument();
    expect(panel.getByText(d.status.open).nextSibling?.nextSibling).toHaveTextContent('2');
    expect(panel.getByText(d.status.void).nextSibling?.nextSibling).toHaveTextContent('1');

    const link = panel.getByRole('link', { name: d.link });
    expect(link).toHaveAttribute('href', '/admin/billing?tab=extras&eventId=e1');
    expect(extrasTabHrefFor('a b')).toBe('/admin/billing?tab=extras&eventId=a%20b');
  });

  it('issues GET requests only — no money is written from the events backoffice', async () => {
    mount({
      '/admin/billing/event-prices/e1': { status: 200, body: PRICE },
      '/admin/billing/events/e1/summary': { status: 200, body: summary() },
      '/admin/billing/reports/aging': AGING,
    });
    await screen.findByRole('region', { name: d.heading });
    expect(http).toHaveBeenCalled();
    for (const [method] of http.mock.calls) expect(method).toBe('GET');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows a priced event with no charge yet', async () => {
    mount({
      '/admin/billing/event-prices/e1': { status: 200, body: PRICE },
      '/admin/billing/events/e1/summary': {
        status: 200,
        body: summary({
          chargedMinor: 0,
          adjustmentsMinor: 0,
          receivedMinor: 0,
          outstandingMinor: 0,
          chargeCount: 0,
          counts: { open: 0, paid: 0, void: 0 },
        }),
      },
      '/admin/billing/reports/aging': AGING,
    });
    expect(await screen.findByText(d.chargeCount(0))).toBeInTheDocument();
  });

  it('shows a charged event whose price was removed', async () => {
    mount({
      '/admin/billing/events/e1/summary': { status: 200, body: summary() },
      '/admin/billing/reports/aging': AGING,
    });
    expect(await screen.findByRole('region', { name: d.heading })).toBeInTheDocument();
  });

  it('renders nothing for an event with no price and no charge', async () => {
    const { container } = mount({
      '/admin/billing/events/e1/summary': {
        status: 200,
        body: summary({ chargeCount: 0, counts: { open: 0, paid: 0, void: 0 } }),
      },
      '/admin/billing/reports/aging': AGING,
    });
    await waitFor(() => expect(http).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText(d.heading)).not.toBeInTheDocument();
  });

  it('withholds the amounts, not the panel, when the currency cannot be resolved', async () => {
    mount({
      '/admin/billing/event-prices/e1': { status: 200, body: PRICE },
      '/admin/billing/events/e1/summary': { status: 200, body: summary() },
      '/admin/billing/reports/aging': { status: 500, body: { error: 'BOOM' } },
    });
    const panel = within(await screen.findByRole('region', { name: d.heading }));
    expect(panel.getByText(d.chargedLabel).nextSibling).toHaveTextContent(
      dictEn.admin.billing.money.unavailable('BRL'),
    );
  });

  it('reports a summary failure', async () => {
    mount({
      '/admin/billing/event-prices/e1': { status: 200, body: PRICE },
      '/admin/billing/events/e1/summary': { status: 500, body: { error: 'BOOM' } },
      '/admin/billing/reports/aging': AGING,
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(d.loadError);
  });
});
