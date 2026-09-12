import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createMeBillingApi } from '@web/lib/me-billing-api';
import type { MyBillingStatement } from '@web/lib/me-billing-api';
import type { Standing } from '@web/lib/admin-billing-api';
import { BTC, JPY, makeStatementTransport, statementWith } from './statement-fixture';

let http: ReturnType<typeof makeStatementTransport>;
// One stable client per test: `useApiClient` returns a stable instance in the
// app, and a fresh object here would re-fire the effect that depends on it.
let client: { meBilling: ReturnType<typeof createMeBillingApi> };

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

import { StandingBanner } from '../standing-banner';

const d = dictEn.layout.standingBanner;

function mount(next: () => MyBillingStatement | Error) {
  http = makeStatementTransport(next);
  client = { meBilling: createMeBillingApi(http) };
  return render(
    <DictProvider value={dictEn}>
      <StandingBanner />
    </DictProvider>,
  );
}

function mountAt(standing: Standing, overrides: Partial<MyBillingStatement> = {}) {
  return mount(() => statementWith(standing, overrides));
}

describe('StandingBanner — when it appears', () => {
  beforeEach(() => vi.clearAllMocks());

  it('announces the notice for a student who is due', async () => {
    mountAt('due');
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent(d.due('R$ 1,500.00'));
  });

  it('announces the notice for a student who is delinquent', async () => {
    mountAt('delinquent');
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent(d.delinquent('R$ 1,500.00'));
  });

  it('shows nothing for a student in good standing', async () => {
    mountAt('good');
    await waitFor(() => expect(http).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  // The point of reading `standing` instead of re-deriving it: a hold comes
  // back as `exempt` and the notice disappears with no client-side rule.
  it('shows nothing for a held student, whose standing the API reports as exempt', async () => {
    mountAt('exempt', { outstandingMinor: 900000, oldestOverdueDate: '2026-01-10' });
    await waitFor(() => expect(http).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stays silent when the statement cannot be read', async () => {
    mount(() => new Error('boom'));
    await waitFor(() => expect(http).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('StandingBanner — what it is allowed to do', () => {
  beforeEach(() => vi.clearAllMocks());

  it('links to the student own statement', async () => {
    mountAt('due');
    await screen.findByRole('status');
    expect(screen.getByRole('link', { name: d.link })).toHaveAttribute('href', '/settings/billing');
  });

  it('offers a keyboard-reachable dismiss control', async () => {
    mountAt('due');
    await screen.findByRole('status');
    const dismiss = screen.getByRole('button', { name: d.dismiss });
    expect(dismiss).toHaveAttribute('type', 'button');
    dismiss.focus();
    expect(dismiss).toHaveFocus();
  });

  // Dismissal is a courtesy, not a record: nothing is acknowledged anywhere.
  it('issues no request when dismissed, and leaves everything else standing', async () => {
    mountAt('due');
    await screen.findByRole('status');
    expect(http).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: d.dismiss }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(http).toHaveBeenCalledTimes(1);
    expect(http).toHaveBeenNthCalledWith(1, 'GET', '/me/billing');
  });

  it('asks the endpoint for the caller statement with no parameter at all', async () => {
    mountAt('due');
    await screen.findByRole('status');
    expect(http).toHaveBeenCalledWith('GET', '/me/billing');
  });
});

describe('StandingBanner — money', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders an exponent-0 currency with no decimal separator', async () => {
    mountAt('due', { currency: JPY, outstandingMinor: 100000 });
    expect(await screen.findByRole('status')).toHaveTextContent(d.due('¥ 100,000'));
  });

  it('renders an exponent-8 currency at eight decimals', async () => {
    mountAt('delinquent', { currency: BTC, outstandingMinor: 100000 });
    expect(await screen.findByRole('status')).toHaveTextContent(d.delinquent('₿ 0.00100000'));
  });
});
