import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Entities } from '@arenaquest/shared/types/entities';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createAdminBillingApi } from '@web/lib/admin-billing-api';
import type {
  BillingPlan,
  BillingReportCurrency,
  BillingSubscription,
} from '@web/lib/admin-billing-api';
import type { HttpTransport } from '@web/lib/api-client';
import { makeTransport } from './test-transport';
import { SignContractDialog } from '../sign-contract-dialog';
import type { SignableStudent } from '../sign-contract-dialog';

const BRL: BillingReportCurrency = { code: 'BRL', exponent: 2, symbol: 'R$' };
const JPY: BillingReportCurrency = { code: 'JPY', exponent: 0, symbol: '¥' };
const BTC: BillingReportCurrency = { code: 'BTC', exponent: 8, symbol: '₿' };

function plan(overrides: Partial<BillingPlan> = {}): BillingPlan {
  return {
    id: 'p1',
    name: 'Monthly membership',
    description: 'Unlimited classes.',
    amountMinor: 150000,
    currency: 'BRL',
    cycle: 'monthly',
    graceDays: 5,
    scopeTopicId: null,
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/**
 * `u1` holds **no** contract and therefore appears on no roster line — the
 * student a roster-built picker could never reach, which is the defect this
 * screen exists to fix. `u2` already holds one. `u3` is a banned account.
 */
const STUDENTS: SignableStudent[] = [
  {
    id: 'u1',
    name: 'Alice Doe',
    email: 'alice@dojo.test',
    status: Entities.Config.UserStatus.ACTIVE,
  },
  {
    id: 'u2',
    name: 'Bruno Lima',
    email: 'bruno@dojo.test',
    status: Entities.Config.UserStatus.ACTIVE,
  },
  {
    id: 'u3',
    name: 'Carla Souza',
    email: 'carla@example.org',
    status: Entities.Config.UserStatus.BANNED,
  },
];

/** The only active contract in the fake: Bruno's. */
const BRUNO_CONTRACT = { userId: 'u2' } as BillingSubscription;

let plans: BillingPlan[];
let active: BillingSubscription[];
let http: ReturnType<typeof makeTransport>;
// One stable client per test, as `useApiClient` returns in the app: a fresh
// object here would re-fire every effect that depends on it.
let client: { adminBilling: ReturnType<typeof createAdminBillingApi> };

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

const onClose = vi.fn();
const onSigned = vi.fn();

function renderDialog({
  currency = BRL as BillingReportCurrency | null,
  initialUserId = null as string | null,
  students = STUDENTS as readonly SignableStudent[],
} = {}) {
  return render(
    <DictProvider value={dictEn}>
      <SignContractDialog
        students={students}
        currency={currency}
        initialUserId={initialUserId}
        onClose={onClose}
        onSigned={onSigned}
      />
    </DictProvider>,
  );
}

const d = dictEn.admin.billing.sign;
const planDict = dictEn.admin.billing.plans;

/** Fills everything a standard signature needs, for the student given. */
async function fillStandard(studentName: RegExp, planName = 'Monthly membership') {
  fireEvent.click(await screen.findByRole('radio', { name: studentName }));
  fireEvent.change(screen.getByLabelText(d.planLabel), {
    target: { value: plans.find((row) => row.name === planName)?.id },
  });
  fireEvent.change(screen.getByLabelText(d.dueDayLabel), { target: { value: '10' } });
  fireEvent.change(screen.getByLabelText(d.startDateLabel), {
    target: { value: '2026-10-01' },
  });
}

describe('SignContractDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plans = [plan()];
    active = [BRUNO_CONTRACT];
    http = makeTransport((method, path, options) => {
      if (method === 'GET' && path.includes('/plans')) return plans;
      if (method === 'GET' && path.includes('/subscriptions')) return active;
      if (method === 'POST' && path.includes('/subscriptions')) {
        return { id: 's1', ...(options?.body ? JSON.parse(options.body) : {}) };
      }
      return [];
    });
    client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };
  });

  it('asks the catalogue for active plans only — an archived plan is not signable', async () => {
    renderDialog();
    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('GET', '/admin/billing/plans?archived=false'),
    );
  });

  /**
   * The defect this task exists to fix: the picker reads the admin user list,
   * so a student with no contract — and therefore no roster line — is reachable
   * and signable end to end.
   */
  it('signs a student who holds no contract and appears on no roster line', async () => {
    renderDialog();
    expect(await screen.findByRole('radio', { name: /Alice Doe/ })).toBeInTheDocument();

    await fillStandard(/Alice Doe/);
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    await waitFor(() => expect(onSigned).toHaveBeenCalledWith('Alice Doe'));
  });

  it('filters the picker by name and by email', async () => {
    renderDialog();
    await screen.findByRole('radio', { name: /Alice Doe/ });

    // By name.
    fireEvent.change(screen.getByLabelText(d.searchLabel), { target: { value: 'bruno' } });
    expect(screen.getByRole('radio', { name: /Bruno Lima/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Alice Doe/ })).not.toBeInTheDocument();

    // By email, on a domain that appears in no name.
    fireEvent.change(screen.getByLabelText(d.searchLabel), { target: { value: 'example.org' } });
    expect(screen.getByRole('radio', { name: /Carla Souza/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Bruno Lima/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(d.searchLabel), { target: { value: 'nobody' } });
    expect(screen.getByText(d.studentEmpty)).toBeInTheDocument();
  });

  /**
   * A courtesy marker, and the copy says the database is the authority. The
   * already-contracted student is still selectable — the refusal is the
   * server's to give.
   */
  it('marks a student who already holds an active contract without hiding them', async () => {
    renderDialog();
    const bruno = await screen.findByRole('radio', { name: /Bruno Lima/ });
    expect(bruno.closest('label')).toHaveTextContent(d.alreadyContracted);
    expect(bruno).not.toBeDisabled();

    const alice = screen.getByRole('radio', { name: /Alice Doe/ });
    expect(alice.closest('label')).not.toHaveTextContent(d.alreadyContracted);
    expect(screen.getByText(d.alreadyContractedNote)).toBeInTheDocument();
  });

  it('states that the picker lists the first page of user accounts', async () => {
    renderDialog();
    expect(await screen.findByText(d.firstPageNotice)).toBeInTheDocument();
  });

  /** §4.3 — marked, never filtered out: the API forbids signing for no status. */
  it('marks an account that is not active, and still lists it', async () => {
    renderDialog();
    const carla = await screen.findByRole('radio', { name: /Carla Souza/ });
    expect(carla.closest('label')).toHaveTextContent(d.notActive);
    expect(carla).not.toBeDisabled();

    expect(screen.getByRole('radio', { name: /Alice Doe/ }).closest('label')).not.toHaveTextContent(
      d.notActive,
    );
  });

  it('pre-selects the student the statement panel came in with', async () => {
    renderDialog({ initialUserId: 'u2' });
    expect(await screen.findByRole('radio', { name: /Bruno Lima/ })).toBeChecked();
    // And the picker stays changeable.
    fireEvent.click(screen.getByRole('radio', { name: /Alice Doe/ }));
    expect(screen.getByRole('radio', { name: /Alice Doe/ })).toBeChecked();
  });

  /**
   * The whole reason the standard mode is a separate payload:
   * `billing-service.ts` refuses a non-negotiated request carrying an
   * `amountMinor`, `cycle` or `graceDays` that differs from the plan, and then
   * snapshots the plan's own values. Sending none of the three makes "the
   * plan's terms, unchanged" true by construction.
   */
  it('posts a standard signature carrying no amount, cycle or grace period', async () => {
    renderDialog();
    await fillStandard(/Alice Doe/);
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/subscriptions', {
        body: JSON.stringify({
          userId: 'u1',
          planId: 'p1',
          dueDay: 10,
          startDate: '2026-10-01',
          termsSource: 'standard',
        }),
      }),
    );
  });

  it('posts a negotiated signature with the overrides, the source and the note', async () => {
    renderDialog();
    await fillStandard(/Alice Doe/);

    fireEvent.click(screen.getByRole('radio', { name: d.modeNegotiated }));
    // Pre-filled from the plan, then overridden.
    expect(screen.getByLabelText(d.amountLabel('BRL'))).toHaveValue('1500.00');
    fireEvent.change(screen.getByLabelText(d.amountLabel('BRL')), { target: { value: '1200.50' } });
    fireEvent.change(screen.getByLabelText(d.cycleLabel), { target: { value: 'quarterly' } });
    fireEvent.change(screen.getByLabelText(d.graceDaysLabel), { target: { value: '12' } });
    fireEvent.change(screen.getByPlaceholderText(d.termsNotePlaceholder), {
      target: { value: '  Renegotiated in March; long-standing student.  ' },
    });

    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/subscriptions', {
        body: JSON.stringify({
          userId: 'u1',
          planId: 'p1',
          dueDay: 10,
          startDate: '2026-10-01',
          termsSource: 'negotiated',
          amountMinor: 120050,
          cycle: 'quarterly',
          graceDays: 12,
          termsNote: 'Renegotiated in March; long-standing student.',
        }),
      }),
    );
  });

  it('shows every negotiated override against the plan own value', async () => {
    renderDialog();
    await fillStandard(/Alice Doe/);
    fireEvent.click(screen.getByRole('radio', { name: d.modeNegotiated }));

    expect(screen.getByText(d.planValue('R$ 1,500.00'))).toBeInTheDocument();
    expect(screen.getByText(d.planValue(planDict.cycle.monthly))).toBeInTheDocument();
    expect(screen.getByText(d.planValue(planDict.graceDaysValue(5)))).toBeInTheDocument();
  });

  /** `billing-service.ts:584` requires it, and the form never spends a request finding out. */
  it('refuses a negotiated signature with a blank reason and issues no request', async () => {
    renderDialog();
    await fillStandard(/Alice Doe/);
    fireEvent.click(screen.getByRole('radio', { name: d.modeNegotiated }));
    http.mockClear();

    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    expect(await screen.findByText(d.validation.termsNoteRequired)).toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
    expect(onSigned).not.toHaveBeenCalled();
  });

  it('refuses a billing day outside 1 to 28 and issues no request', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('radio', { name: /Alice Doe/ }));
    fireEvent.change(screen.getByLabelText(d.planLabel), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText(d.dueDayLabel), { target: { value: '31' } });
    fireEvent.change(screen.getByLabelText(d.startDateLabel), {
      target: { value: '2026-10-01' },
    });
    http.mockClear();

    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    expect(await screen.findByText(d.validation.dueDayInvalid)).toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
  });

  it('refuses a signature with no student chosen and issues no request', async () => {
    renderDialog();
    await screen.findByRole('radio', { name: /Alice Doe/ });
    http.mockClear();

    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    expect(await screen.findByText(d.validation.studentRequired)).toBeInTheDocument();
    expect(screen.getByText(d.validation.planRequired)).toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
  });

  /**
   * A duplicate is `idx_subscriptions_one_active`'s call, reported by the
   * server. It reaches the screen as the server's own sentence, never as a
   * client-side assertion dressed up as authority.
   */
  it('surfaces the server refusal of a duplicate active contract', async () => {
    const rejecting = vi.fn(async (method: string, path: string) => {
      if (method === 'GET') {
        const data = path.includes('/plans') ? plans : active;
        return { ok: true, status: 200, json: async () => data } as unknown as Response;
      }
      return {
        ok: false,
        status: 409,
        json: async () => ({
          error: 'Conflict',
          message: 'the student already has an active contract',
        }),
      } as unknown as Response;
    });
    client = { adminBilling: createAdminBillingApi(rejecting as unknown as HttpTransport) };

    renderDialog();
    await fillStandard(/Bruno Lima/);
    fireEvent.click(screen.getByRole('button', { name: d.submit }));

    expect(
      await screen.findByText('the student already has an active contract'),
    ).toBeInTheDocument();
    expect(onSigned).not.toHaveBeenCalled();
  });

  it('renders the terms to be recorded at exponent 2', async () => {
    renderDialog({ currency: BRL });
    await fillStandard(/Alice Doe/);
    expect(screen.getByText('R$ 1,500.00')).toBeInTheDocument();
    expect(screen.getByText(planDict.graceDaysValue(5))).toBeInTheDocument();
  });

  it('renders the terms to be recorded at exponent 0', async () => {
    plans = [plan({ amountMinor: 100000, currency: 'JPY' })];
    renderDialog({ currency: JPY });
    await fillStandard(/Alice Doe/);
    expect(screen.getByText('¥ 100,000')).toBeInTheDocument();
  });

  /**
   * The reason money renders only through the shared formatter: a
   * currency-style number formatter accepts `BTC` and renders this amount to
   * two decimals, with no error anywhere.
   */
  it('renders the terms to be recorded at exponent 8', async () => {
    plans = [plan({ amountMinor: 100000, currency: 'BTC' })];
    renderDialog({ currency: BTC });
    await fillStandard(/Alice Doe/);
    expect(screen.getByText('₿ 0.00100000')).toBeInTheDocument();
  });

  /**
   * With no recorded exponent a typed amount cannot become minor units without
   * assuming two decimals, so negotiating is disabled rather than guessed — and
   * a standard signature still works, because it submits no amount.
   */
  it('disables negotiating when no currency could be resolved, and says why', async () => {
    renderDialog({ currency: null });
    await screen.findByRole('radio', { name: /Alice Doe/ });

    expect(screen.getByRole('radio', { name: d.modeNegotiated })).toBeDisabled();
    expect(screen.getByText(dictEn.admin.billing.money.resolveError)).toBeInTheDocument();

    await fillStandard(/Alice Doe/);
    fireEvent.click(screen.getByRole('button', { name: d.submit }));
    await waitFor(() => expect(onSigned).toHaveBeenCalledWith('Alice Doe'));
  });

  /** Currency is never negotiable: re-denominating is a different contract. */
  it('offers no currency control in negotiated mode, and says why', async () => {
    renderDialog();
    await fillStandard(/Alice Doe/);
    fireEvent.click(screen.getByRole('radio', { name: d.modeNegotiated }));

    expect(screen.getByText(d.currencyNotNegotiableNote)).toBeInTheDocument();
    expect(screen.queryByLabelText(planDict.form.currencyLabel)).not.toBeInTheDocument();
  });

  it('tells a fresh tenant that a plan is the prerequisite for signing', async () => {
    plans = [];
    renderDialog();
    expect(await screen.findByText(d.planEmpty)).toBeInTheDocument();
  });

  /**
   * Standing, a due date's consequence and a grace outcome are the server's,
   * where a hold can reach them. The plan's recorded grace days are shown as
   * the datum being written and nothing is derived from them.
   */
  it('predicts no standing, due-date consequence or grace outcome', async () => {
    const { container } = renderDialog();
    await fillStandard(/Alice Doe/);
    fireEvent.click(screen.getByRole('radio', { name: d.modeNegotiated }));

    const text = container.textContent ?? '';
    for (const standing of Object.values(dictEn.admin.billing.standing)) {
      expect(text).not.toContain(standing);
    }
    expect(text).not.toMatch(/overdue|delinquen|next due|will be due|first invoice/i);
  });

  /** Signing grants nothing and restricts nothing: it records what was agreed. */
  it('suggests nowhere that access is granted or withheld', async () => {
    const { container } = renderDialog();
    await screen.findByRole('radio', { name: /Alice Doe/ });

    const names = within(container)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '');

    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).not.toMatch(
        /suspend|block|lock|revoke|restrict|disable|downgrade|paywall|grant|unlock/i,
      );
    }
    expect(screen.getByText(d.noAccessNote)).toBeInTheDocument();
  });
});
