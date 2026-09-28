import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createAdminBillingApi } from '@web/lib/admin-billing-api';
import type {
  BillingStatementCharge,
  BillingStatementExtras,
  BillingStudentStatement,
  BillingSubscription,
  Standing,
} from '@web/lib/admin-billing-api';
import type { HttpTransport } from '@web/lib/api-client';
import { makeTransport } from './test-transport';
import { StudentStatementPanel } from '../student-statement-panel';

const BRL = { code: 'BRL', exponent: 2, symbol: 'R$' };

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

function statement(versions: BillingSubscription[]): BillingStudentStatement {
  return {
    userId: 'u1',
    currency: BRL,
    studentSince: '2026-01-01',
    currentMembershipSince: '2026-01-01',
    outstandingMinor: 0,
    contractGroups: [
      {
        contractGroupId: 'cg1',
        startDate: '2026-01-01',
        endDate: null,
        status: 'active',
        versions,
      },
    ],
    invoices: [],
    extras: { standing: 'good', oldestOverdueDate: null, outstandingMinor: 0, charges: [] },
  };
}

function charge(overrides: Partial<BillingStatementCharge> = {}): BillingStatementCharge {
  return {
    id: 'ch1',
    eventId: 'e1',
    userId: 'u1',
    description: 'Winter Seminar',
    amountMinor: 30000,
    currency: 'BRL',
    termsSource: 'standard',
    termsNote: '',
    dueDate: '2026-08-01',
    graceDays: 5,
    status: 'open',
    issuedBy: 'admin-1',
    issuedAt: '2026-07-01T00:00:00Z',
    voidedAt: null,
    voidReason: null,
    balanceMinor: 25000,
    adjustments: [],
    payments: [],
    eventTitle: 'Winter Seminar',
    eventStartsAt: '2026-07-18T13:00:00.000Z',
    ...overrides,
  };
}

function withExtras(extras: BillingStatementExtras): BillingStudentStatement {
  return { ...statement([version()]), extras };
}

let payload: BillingStudentStatement;
let http: ReturnType<typeof makeTransport>;
let client: { adminBilling: ReturnType<typeof createAdminBillingApi> };

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

const onClose = vi.fn();

function renderPanel(
  onSignContract?: (userId: string) => void,
  contractStanding?: Standing | null,
) {
  return render(
    <DictProvider value={dictEn}>
      <StudentStatementPanel
        userId="u1"
        studentName="Alice Doe"
        onClose={onClose}
        onSignContract={onSignContract}
        contractStanding={contractStanding}
      />
    </DictProvider>,
  );
}

const d = dictEn.admin.billing.statement;
const planDict = dictEn.admin.billing.plans;
const contractDict = dictEn.admin.billing.contract;

describe('StudentStatementPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    payload = statement([version()]);
    http = makeTransport(() => payload);
    client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };
  });

  it('renders the terms a standard contract recorded', async () => {
    renderPanel();
    expect(await screen.findByText(d.currentTermsHeading)).toBeInTheDocument();
    expect(screen.getByText('R$ 1,500.00')).toBeInTheDocument();
    expect(screen.getByText(planDict.cycle.monthly)).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText(planDict.graceDaysValue(5))).toBeInTheDocument();
    // A standard contract carries no note and claims no negotiation.
    expect(screen.queryByText(d.termsNegotiated)).not.toBeInTheDocument();
  });

  /**
   * The acceptance criterion, and RFC 0013's Motivation case: after signing a
   * negotiated contract, its amount **and** its reason are readable back from
   * the product. "This student negotiated a different fee in March" is
   * answerable here, without a database query.
   */
  it('reads back a negotiated contract amount and its reason', async () => {
    payload = statement([
      version({
        termsSource: 'negotiated',
        amountMinor: 120050,
        cycle: 'quarterly',
        graceDays: 12,
        termsNote: 'Renegotiated in March; long-standing student.',
      }),
    ]);

    renderPanel();

    expect(await screen.findByText('R$ 1,200.50')).toBeInTheDocument();
    expect(
      screen.getByText(`${d.termsNoteLabel}: Renegotiated in March; long-standing student.`),
    ).toBeInTheDocument();
    expect(screen.getByText(d.termsNegotiated)).toBeInTheDocument();
    expect(screen.getByText(planDict.cycle.quarterly)).toBeInTheDocument();
    expect(screen.getByText(planDict.graceDaysValue(12))).toBeInTheDocument();
  });

  /**
   * The current version is the one no sibling supersedes, and an amendment adds
   * a version rather than overwriting one — so the superseded terms stay on
   * screen, fully readable, beside the version in force.
   */
  it('renders the whole version chain, marking exactly one version as current', async () => {
    payload = statement([
      version({
        id: 'v1',
        status: 'superseded',
        amountMinor: 150000,
        termsNote: 'Original standard terms.',
      }),
      version({
        id: 'v2',
        supersedesId: 'v1',
        status: 'active',
        termsSource: 'negotiated',
        amountMinor: 120050,
        termsNote: 'Renegotiated in March.',
      }),
    ]);

    renderPanel();

    expect(await screen.findByText('R$ 1,200.50')).toBeInTheDocument();
    expect(screen.getByText(`${d.termsNoteLabel}: Renegotiated in March.`)).toBeInTheDocument();

    // The superseded version keeps its original terms.
    expect(screen.getByText('R$ 1,500.00')).toBeInTheDocument();
    expect(
      screen.getByText(`${d.termsNoteLabel}: Original standard terms.`),
    ).toBeInTheDocument();

    expect(screen.getAllByText(contractDict.currentVersion)).toHaveLength(1);
  });

  /**
   * `supersedesId` is order-independent, so the version in force is found even
   * when the newest row arrives first — and it is the one that carries both the
   * current marker and the actions.
   */
  it('finds the current version regardless of the order the versions arrive in', async () => {
    payload = statement([
      version({
        id: 'v2',
        supersedesId: 'v1',
        termsSource: 'negotiated',
        amountMinor: 120050,
        termsNote: 'Renegotiated in March.',
      }),
      version({ id: 'v1', amountMinor: 150000, status: 'superseded' }),
    ]);

    renderPanel();

    // The chain is the ordered list inside the group's card.
    const chain = (await screen.findAllByRole('list')).find((list) => list.tagName === 'OL');
    expect(chain).toBeDefined();

    const cards = within(chain as HTMLElement).getAllByRole('listitem');
    const current = cards.find((card) => card.textContent?.includes(contractDict.currentVersion));
    expect(current).toBeDefined();
    expect(current).toHaveTextContent('R$ 1,200.50');
    expect(current).not.toHaveTextContent('R$ 1,500.00');
  });

  /**
   * The chain and its actions come out of this one statement read: pausing
   * re-reads it rather than editing what is on screen, and the panel never
   * reloads the page.
   */
  it('applies a lifecycle change by re-reading the statement', async () => {
    renderPanel();
    await screen.findByText(d.currentTermsHeading);

    fireEvent.click(screen.getByRole('button', { name: contractDict.pauseButton }));
    fireEvent.click(screen.getByRole('button', { name: contractDict.pauseConfirm }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('PATCH', '/admin/billing/subscriptions/v1', {
        body: JSON.stringify({ action: 'pause' }),
      }),
    );

    expect(await screen.findByText(contractDict.pauseSuccess)).toBeInTheDocument();
    const reads = http.mock.calls.filter(([method]) => method === 'GET');
    expect(reads.length).toBeGreaterThan(1);
  });

  it('offers the second signing entry point when the caller supplies one', async () => {
    const onSignContract = vi.fn();
    renderPanel(onSignContract);

    fireEvent.click(
      await screen.findByRole('button', {
        name: dictEn.admin.billing.sign.statementAriaLabel('Alice Doe'),
      }),
    );
    expect(onSignContract).toHaveBeenCalledWith('u1');
  });

  it('offers no signing entry point when the caller supplies none', async () => {
    renderPanel();
    await screen.findByText(d.currentTermsHeading);
    expect(
      screen.queryByRole('button', { name: dictEn.admin.billing.sign.statementButton }),
    ).not.toBeInTheDocument();
  });

  /**
   * The lifecycle is offered, and nothing beside it gates access: pausing or
   * cancelling a contract is a financial record, and the student keeps every
   * screen they had. No control deletes anything either — the corrections this
   * console offers are a supersession, a void and a reversal.
   */
  it('offers the lifecycle without offering any access control', async () => {
    const { container } = renderPanel();
    await screen.findByText(d.currentTermsHeading);

    const names = within(container)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '');

    expect(names).toContain(contractDict.pauseButton);
    expect(names).toContain(contractDict.amendButton);
    for (const name of names) {
      expect(name).not.toMatch(/delete|remove/i);
      expect(name).not.toMatch(/suspend|block|lock|revoke|restrict|disable|paywall/i);
    }
    expect(screen.getByText(contractDict.noAccessNote)).toBeInTheDocument();
  });

  it('reports a failed statement read rather than an empty contract', async () => {
    const failing = vi.fn(
      async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response,
    );
    client = { adminBilling: createAdminBillingApi(failing as unknown as HttpTransport) };

    renderPanel();

    expect(await screen.findByText(d.loadError)).toBeInTheDocument();
    expect(screen.queryByText(d.currentTermsHeading)).not.toBeInTheDocument();
  });

  describe('two rails', () => {
    const rails = dictEn.admin.billing.rails;
    const standingDict = dictEn.admin.billing.standing;

    it('shows the contract and the extras apart, each with its own badge', async () => {
      payload = withExtras({
        standing: 'delinquent',
        oldestOverdueDate: '2026-08-01',
        outstandingMinor: 25000,
        charges: [charge()],
      });
      renderPanel(undefined, 'good');

      const extras = within(await screen.findByRole('region', { name: rails.extras }));
      expect(extras.getByText(standingDict.delinquent)).toBeInTheDocument();
      expect(extras.getByText('Winter Seminar')).toBeInTheDocument();
      expect(extras.getByText('2026-07-18')).toBeInTheDocument();
      expect(extras.getByText('2026-08-01', { selector: 'td' })).toBeInTheDocument();
      expect(extras.getByText(dictEn.admin.billing.extras.charges.status.open)).toBeInTheDocument();
      expect(extras.getByText(d.extrasOutstanding).nextSibling).toHaveTextContent('R$ 250.00');

      // The contract badge sits outside the extras region, and names its rail.
      const contractBadge = screen.getByText(standingDict.good);
      expect(contractBadge.closest('section[aria-label]')).toBeNull();
      expect(contractBadge).toHaveTextContent(`${rails.contract}: ${standingDict.good}`);
    });

    it('says "no contract" for an extras-only buyer and still renders the extras', async () => {
      payload = {
        ...statement([]),
        contractGroups: [],
        extras: {
          standing: 'due',
          oldestOverdueDate: null,
          outstandingMinor: 30000,
          charges: [charge({ balanceMinor: 30000 })],
        },
      };
      renderPanel(undefined, null);

      expect(await screen.findByText(d.noContract)).toBeInTheDocument();
      const extras = within(screen.getByRole('region', { name: rails.extras }));
      // "Due" is also a column header; the badge is the one naming its rail.
      const badges = extras
        .getAllByText(standingDict.due)
        .filter((el) => el.textContent === `${rails.extras}: ${standingDict.due}`);
      expect(badges).toHaveLength(1);
    });

    it('reads a statement with no extras block as never charged', async () => {
      renderPanel();
      const extras = within(await screen.findByRole('region', { name: rails.extras }));
      expect(extras.getByText(d.extrasEmpty)).toBeInTheDocument();
      expect(extras.getByText(standingDict.good)).toBeInTheDocument();
    });
  });
});
