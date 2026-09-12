import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createAdminBillingApi } from '@web/lib/admin-billing-api';
import type {
  BillingStudentStatement,
  BillingSubscription,
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
  };
}

let payload: BillingStudentStatement;
let http: ReturnType<typeof makeTransport>;
let client: { adminBilling: ReturnType<typeof createAdminBillingApi> };

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

const onClose = vi.fn();

function renderPanel(onSignContract?: (userId: string) => void) {
  return render(
    <DictProvider value={dictEn}>
      <StudentStatementPanel
        userId="u1"
        studentName="Alice Doe"
        onClose={onClose}
        onSignContract={onSignContract}
      />
    </DictProvider>,
  );
}

const d = dictEn.admin.billing.statement;
const planDict = dictEn.admin.billing.plans;

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
   * The current version is the one no sibling supersedes. Rendering the chain
   * so an administrator can see that history was *added* and not overwritten is
   * Task 11's job, so the superseded terms are deliberately absent here.
   */
  it('shows the current version terms only, never the superseded ones', async () => {
    payload = statement([
      version({ id: 'v1', amountMinor: 150000, termsNote: 'Original standard terms.' }),
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

    expect(screen.queryByText('R$ 1,500.00')).not.toBeInTheDocument();
    expect(
      screen.queryByText(`${d.termsNoteLabel}: Original standard terms.`),
    ).not.toBeInTheDocument();
  });

  /**
   * `supersedesId` is order-independent, so the current version is found even
   * when the newest row arrives first.
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

    expect(await screen.findByText('R$ 1,200.50')).toBeInTheDocument();
    expect(screen.queryByText('R$ 1,500.00')).not.toBeInTheDocument();
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
   * Pause, resume, cancel and amend are Task 11's, and no control here may
   * imply a capability this panel does not have. Nor may anything gate access.
   */
  it('offers no lifecycle or access control', async () => {
    const { container } = renderPanel();
    await screen.findByText(d.currentTermsHeading);

    const names = within(container)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '');

    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).not.toMatch(/pause|resume|cancel|amend|delete|remove/i);
      expect(name).not.toMatch(/suspend|block|lock|revoke|restrict|disable|paywall/i);
    }
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
});
