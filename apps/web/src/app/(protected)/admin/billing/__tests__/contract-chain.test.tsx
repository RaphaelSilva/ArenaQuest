import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import type {
  BillingReportCurrency,
  BillingStatementContractGroup,
  BillingSubscription,
} from '@web/lib/admin-billing-api';
import { ContractChain } from '../contract-chain';

const BRL: BillingReportCurrency = { code: 'BRL', exponent: 2, symbol: 'R$' };
const JPY: BillingReportCurrency = { code: 'JPY', exponent: 0, symbol: '¥' };
const BTC: BillingReportCurrency = { code: 'BTC', exponent: 8, symbol: '₿' };

function version(overrides: Partial<BillingSubscription> = {}): BillingSubscription {
  return {
    id: 'v1',
    userId: 'u1',
    planId: 'p1',
    contractGroupId: 'cg1',
    supersedesId: null,
    termsSource: 'standard',
    amountMinor: 150000,
    currency: 'BRL',
    cycle: 'monthly',
    graceDays: 5,
    dueDay: 10,
    status: 'active',
    startDate: '2026-01-01',
    endDate: null,
    termsNote: '',
    signedBy: 'admin-1',
    signedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function group(versions: BillingSubscription[]): BillingStatementContractGroup {
  return {
    contractGroupId: 'cg1',
    startDate: versions[0]?.startDate ?? '2026-01-01',
    endDate: null,
    status: 'active',
    versions,
  };
}

/** Two amendments: the original terms, a renegotiation, and a second one. */
const CHAIN: BillingSubscription[] = [
  version({
    id: 'v1',
    status: 'superseded',
    startDate: '2026-01-01',
    endDate: '2026-03-01',
    amountMinor: 150000,
    termsNote: 'Original standard terms.',
  }),
  version({
    id: 'v2',
    supersedesId: 'v1',
    status: 'superseded',
    termsSource: 'negotiated',
    startDate: '2026-03-01',
    endDate: '2026-06-01',
    amountMinor: 120050,
    cycle: 'quarterly',
    graceDays: 12,
    termsNote: 'Renegotiated in March.',
  }),
  version({
    id: 'v3',
    supersedesId: 'v2',
    status: 'active',
    termsSource: 'negotiated',
    startDate: '2026-06-01',
    endDate: null,
    amountMinor: 99900,
    dueDay: 5,
    termsNote: 'Second renegotiation in June.',
  }),
];

const d = dictEn.admin.billing.contract;
const statementDict = dictEn.admin.billing.statement;
const planDict = dictEn.admin.billing.plans;

function renderChain(
  versions: BillingSubscription[],
  currentVersionId: string | null,
  currency: BillingReportCurrency | null = BRL,
) {
  return render(
    <DictProvider value={dictEn}>
      <ContractChain
        group={group(versions)}
        currency={currency}
        currentVersionId={currentVersionId}
      />
    </DictProvider>,
  );
}

describe('ContractChain', () => {
  /**
   * The acceptance criterion: after two amendments the panel shows three
   * versions with exactly one marked current, and the order is the order the
   * statement delivered. The fixture's dates run *descending* here precisely so
   * that a client-side sort would show up as a failure.
   */
  it('renders the versions in the order the response delivered them, marking exactly one', () => {
    const reversed = [
      { ...CHAIN[2], startDate: '2026-06-01' },
      { ...CHAIN[1], startDate: '2026-03-01' },
      { ...CHAIN[0], startDate: '2026-01-01' },
    ];

    renderChain(reversed, 'v3');

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(d.versionLabel(1));
    expect(items[0]).toHaveTextContent('Second renegotiation in June.');
    expect(items[2]).toHaveTextContent(d.versionLabel(3));
    expect(items[2]).toHaveTextContent('Original standard terms.');

    // Exactly one version is in force, and it is the one the caller resolved
    // from `supersedesId` — not the last row, which is the oldest here.
    expect(screen.getAllByText(d.currentVersion)).toHaveLength(1);
    expect(items[0]).toHaveTextContent(d.currentVersion);
  });

  /**
   * Renegotiation supersedes rather than edits, so the terms an invoice was
   * issued under stay readable. This is what makes an administrator trust that
   * history was *added* and not overwritten.
   */
  it('keeps every superseded version fully readable with its original terms', () => {
    renderChain(CHAIN, 'v3');

    expect(screen.getByText('R$ 1,500.00')).toBeInTheDocument();
    expect(screen.getByText('R$ 1,200.50')).toBeInTheDocument();
    expect(screen.getByText('R$ 999.00')).toBeInTheDocument();

    expect(
      screen.getByText(`${statementDict.termsNoteLabel}: Original standard terms.`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`${statementDict.termsNoteLabel}: Renegotiated in March.`),
    ).toBeInTheDocument();

    // The superseded rows keep the cycle and grace period they carried.
    expect(screen.getByText(planDict.cycle.quarterly)).toBeInTheDocument();
    expect(screen.getByText(planDict.graceDaysValue(12))).toBeInTheDocument();

    expect(screen.getAllByText(d.status.superseded)).toHaveLength(2);
    expect(screen.getByText(d.status.active)).toBeInTheDocument();
  });

  /**
   * Money renders only through the shared formatter, at the currency's recorded
   * exponent. An exponent-0 currency emits no separator and an exponent-8 one
   * keeps all eight digits — the two cases a currency-style number formatter
   * renders as a wrong number with no error anywhere.
   */
  it('renders amounts at the currency exponent, for 2, 0 and 8', () => {
    const brl = renderChain([version({ amountMinor: 150000 })], 'v1', BRL);
    expect(screen.getByText('R$ 1,500.00')).toBeInTheDocument();
    brl.unmount();

    const jpy = renderChain([version({ currency: 'JPY', amountMinor: 15000 })], 'v1', JPY);
    expect(screen.getByText('¥ 15,000')).toBeInTheDocument();
    jpy.unmount();

    renderChain([version({ currency: 'BTC', amountMinor: 150000000 })], 'v1', BTC);
    expect(screen.getByText('₿ 1.50000000')).toBeInTheDocument();
  });

  /**
   * Amendment is the only way signed terms change, and it lives in
   * `contract-actions.tsx`. The chain is a record: it offers no control at all,
   * so no screen can edit a signed contract's terms in place.
   */
  it('offers no in-place terms edit', () => {
    renderChain(CHAIN, 'v3');

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
  });

  it('renders nothing for a group that carries no version', () => {
    const { container } = renderChain([], null);
    expect(container).toBeEmptyDOMElement();
  });
});
