import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createMeBillingApi } from '@web/lib/me-billing-api';
import type { MyBillingStatement } from '@web/lib/me-billing-api';
import {
  BTC,
  JPY,
  emptyStatement,
  makeStatementTransport,
  statementWith,
} from '@web/components/billing/__tests__/statement-fixture';

let http: ReturnType<typeof makeStatementTransport>;
let client: { meBilling: ReturnType<typeof createMeBillingApi> };

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

import StudentBillingPage from '../page';

const d = dictEn.settings.billing;
const banner = dictEn.layout.standingBanner;

function mount(next: () => MyBillingStatement | Error) {
  http = makeStatementTransport(next);
  client = { meBilling: createMeBillingApi(http) };
  return render(
    <DictProvider value={dictEn}>
      <StudentBillingPage />
    </DictProvider>,
  );
}

describe('Student statement — the golden path', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks for the caller statement with no parameter', async () => {
    mount(() => statementWith('delinquent'));
    await screen.findByText(d.invoices.heading);
    expect(http).toHaveBeenCalledWith('GET', '/me/billing');
  });

  it('renders the outstanding total, the membership dates and the as-of date', async () => {
    mount(() => statementWith('due'));
    expect(await screen.findByText('R$ 1,500.00')).toBeInTheDocument();
    expect(screen.getByText('2024-02-01')).toBeInTheDocument();
    expect(screen.getAllByText('2026-01-01').length).toBeGreaterThan(0);
    expect(screen.getByText(d.asOf('2026-09-01'))).toBeInTheDocument();
  });

  it('renders the contract terms the API returned', async () => {
    mount(() => statementWith('good'));
    await screen.findByText(d.contracts.heading);
    expect(screen.getByText(d.contracts.openEnded('2026-01-01'))).toBeInTheDocument();
    expect(screen.getByText(d.contractStatus.active)).toBeInTheDocument();
    expect(screen.getByText(d.cycle.monthly)).toBeInTheDocument();
    expect(screen.getByText(d.contracts.graceDaysValue(5))).toBeInTheDocument();
    expect(screen.getByText(d.contracts.versions(1))).toBeInTheDocument();
    expect(screen.getByText(d.contracts.negotiated)).toBeInTheDocument();
  });

  it('renders each invoice with its due date, balance, payments and adjustments', async () => {
    mount(() => statementWith('delinquent'));
    await screen.findByText(d.invoices.heading);
    expect(
      screen.getByText(d.invoices.periodValue('2026-07-01', '2026-07-31')),
    ).toBeInTheDocument();
    expect(screen.getByText('2026-07-10')).toBeInTheDocument();
    expect(screen.getByText(d.invoiceStatus.open)).toBeInTheDocument();
    expect(screen.getByText('R$ 200.00')).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(d.paymentMethod.pix)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(d.adjustmentKind.discount)).length).toBeGreaterThan(0);
    expect(screen.getByText('-R$ 50.00')).toBeInTheDocument();
  });

  // No payment affordance exists here by design: money arrives out of band and
  // an admin records it. The page states that rather than offering a checkout.
  it('offers no payment affordance, only the note explaining why', async () => {
    mount(() => statementWith('delinquent'));
    expect(await screen.findByText(d.paymentNote)).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('Student statement — a member with no contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads as a normal empty state, not an error, and shows no banner', async () => {
    mount(() => emptyStatement());
    expect(await screen.findByText(d.emptyStatement)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(d.loadError)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: d.retry })).not.toBeInTheDocument();
    expect(screen.queryByText(banner.due('R$ 0.00'))).not.toBeInTheDocument();
  });

  it('still states the outstanding total as zero', async () => {
    mount(() => emptyStatement());
    expect(await screen.findByText('R$ 0.00')).toBeInTheDocument();
  });
});

describe('Student statement — the error path', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports a failure and retries on demand', async () => {
    let fail = true;
    mount(() => (fail ? new Error('boom') : statementWith('good')));

    expect(await screen.findByRole('alert')).toHaveTextContent(d.loadError);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: d.retry }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByText(d.invoices.heading)).toBeInTheDocument();
  });
});

describe('Student statement — money', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders an exponent-2 currency at two decimals', async () => {
    mount(() => statementWith('due', { outstandingMinor: 150000 }));
    expect(await screen.findByText('R$ 1,500.00')).toBeInTheDocument();
  });

  it('renders an exponent-0 currency with no decimal separator', async () => {
    mount(() => statementWith('due', { currency: JPY, outstandingMinor: 100000 }));
    expect(await screen.findByText('¥ 100,000')).toBeInTheDocument();
  });

  // Exactly the case `Intl.NumberFormat`'s currency style renders wrong.
  it('renders an exponent-8 currency at eight decimals', async () => {
    mount(() => statementWith('due', { currency: BTC, outstandingMinor: 100000 }));
    expect(await screen.findByText('₿ 0.00100000')).toBeInTheDocument();
  });
});

describe('Student statement — the back link', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns to settings', async () => {
    mount(() => statementWith('good'));
    const link = await screen.findByRole('link', { name: d.backLink });
    expect(link).toHaveAttribute('href', '/settings');
  });
});

describe('Student statement — invoice detail grouping', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps each invoice payments and adjustments inside that invoice', async () => {
    mount(() => statementWith('delinquent'));
    const period = await screen.findByText(d.invoices.periodValue('2026-07-01', '2026-07-31'));
    const row = period.closest('div')?.parentElement as HTMLElement;
    expect(within(row).getByText(d.invoices.paymentsHeading)).toBeInTheDocument();
    expect(within(row).getByText(d.invoices.adjustmentsHeading)).toBeInTheDocument();
  });
});
