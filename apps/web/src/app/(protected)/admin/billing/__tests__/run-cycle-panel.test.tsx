import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createAdminBillingApi } from '@web/lib/admin-billing-api';
import type { BillingReportCurrency, BillingRunReport } from '@web/lib/admin-billing-api';
import type { HttpTransport } from '@web/lib/api-client';
import { makeTransport } from './test-transport';
import { RunCyclePanel } from '../run-cycle-panel';

const BRL: BillingReportCurrency = { code: 'BRL', exponent: 2, symbol: 'R$' };
const JPY: BillingReportCurrency = { code: 'JPY', exponent: 0, symbol: '¥' };
const BTC: BillingReportCurrency = { code: 'BTC', exponent: 8, symbol: '₿' };

const NAMES: Record<string, string> = {
  u1: 'Ana Lima',
  u2: 'Bruno Sato',
  u3: 'Carla Reis',
};

const nameOf = (userId: string) => NAMES[userId] ?? userId;

/** An empty report — every counter zero and every list empty. */
function emptyReport(overrides: Partial<BillingRunReport> = {}): BillingRunReport {
  return {
    asOf: '2026-09-01',
    since: '2026-08-31',
    eligibleContracts: 0,
    issued: [],
    absorbed: 0,
    reminders: [],
    crossings: [],
    suppressedByHold: [],
    divergences: [],
    mailsSent: 0,
    adminsNotified: 0,
    ...overrides,
  };
}

/** A run with something in every section of the report. */
const fullReport: BillingRunReport = emptyReport({
  eligibleContracts: 4,
  issued: [
    {
      invoiceId: 'inv-11111111-aaaa',
      subscriptionId: 'sub-1',
      userId: 'u1',
      periodStart: '2026-09-01',
      dueDate: '2026-09-10',
      amountMinor: 150000,
      currency: 'BRL',
      status: 'open',
    },
  ],
  absorbed: 1,
  reminders: [
    {
      invoiceId: 'inv-22222222-bbbb',
      userId: 'u2',
      kind: 'due_date',
      dueDate: '2026-09-05',
      triggerOn: '2026-09-02',
      balanceMinor: 50000,
      currency: 'BRL',
      sent: true,
      suppressedByHold: false,
    },
    {
      invoiceId: 'inv-33333333-cccc',
      userId: 'u3',
      kind: 'grace_lapsed',
      dueDate: '2026-08-05',
      triggerOn: '2026-08-10',
      balanceMinor: 30000,
      currency: 'BRL',
      sent: false,
      suppressedByHold: true,
    },
  ],
  crossings: [
    {
      userId: 'u2',
      from: 'good',
      to: 'due',
      oldestOverdueDate: '2026-08-05',
      outstandingMinor: 50000,
      currency: 'BRL',
    },
  ],
  suppressedByHold: [{ userId: 'u3', outstandingMinor: 30000 }],
  divergences: [
    {
      invoiceId: 'inv-44444444-dddd',
      userId: 'u1',
      cachedStatus: 'open',
      expectedStatus: 'paid',
      balanceMinor: 0,
    },
  ],
  mailsSent: 2,
  adminsNotified: 1,
});

let http: ReturnType<typeof makeTransport>;
let client: { adminBilling: ReturnType<typeof createAdminBillingApi> };

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

const d = dictEn.admin.billing.run;
const status = dictEn.admin.billing.ledger.invoiceStatus;

const onIssued = vi.fn();

function renderPanel(currency: BillingReportCurrency | null = BRL) {
  return render(
    <DictProvider value={dictEn}>
      <RunCyclePanel currency={currency} nameOf={nameOf} onIssued={onIssued} />
    </DictProvider>,
  );
}

/** Opens the confirmation and confirms the run. */
function openAndConfirm() {
  fireEvent.click(screen.getByRole('button', { name: d.buttonAriaLabel }));
  fireEvent.click(screen.getByRole('button', { name: d.confirm.submit }));
}

function transportReturning(report: BillingRunReport) {
  http = makeTransport(() => report);
  client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };
}

describe('RunCyclePanel — the confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transportReturning(emptyReport());
  });

  it('issues no request until the run is confirmed', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: d.buttonAriaLabel }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
  });

  it('names the mails the run sends, before it is confirmed', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: d.buttonAriaLabel }));

    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(d.confirm.lead)).toBeInTheDocument();
    expect(dialog.getByText(d.confirm.effects.issue)).toBeInTheDocument();
    expect(dialog.getByText(d.confirm.effects.notices)).toBeInTheDocument();
    expect(dialog.getByText(d.confirm.effects.digest)).toBeInTheDocument();
    expect(dialog.getByText(d.confirm.effects.assert)).toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
  });

  it('states that a second run is safe, and why, before it is confirmed', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: d.buttonAriaLabel }));

    expect(within(screen.getByRole('dialog')).getByText(d.confirm.safeAgain)).toBeInTheDocument();
    expect(screen.getByText(d.idempotentNote)).toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
  });

  it('repeats that the run applies no fee and that a hold stops the chasing, not the debt', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: d.buttonAriaLabel }));

    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(d.noFeeNote)).toBeInTheDocument();
    expect(dialog.getByText(d.holdNote)).toBeInTheDocument();
  });

  it('cancels without issuing a request', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: d.buttonAriaLabel }));
    fireEvent.click(screen.getByRole('button', { name: d.confirm.cancel }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
  });
});

describe('RunCyclePanel — the request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transportReturning(emptyReport());
  });

  it('posts to the run endpoint with no body when no window was given', async () => {
    renderPanel();
    openAndConfirm();

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/invoices/run', undefined),
    );
  });

  it('posts the optional window the administrator filled in', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: d.buttonAriaLabel }));
    fireEvent.change(screen.getByLabelText(d.confirm.sinceLabel), {
      target: { value: '2026-08-25' },
    });
    fireEvent.change(screen.getByLabelText(d.confirm.asOfLabel), {
      target: { value: '2026-09-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: d.confirm.submit }));

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/invoices/run', {
        body: JSON.stringify({ asOf: '2026-09-01', since: '2026-08-25' }),
      }),
    );
  });

  it('announces the pending state accessibly and refuses a concurrent second run', async () => {
    // A transport that never settles on its own, so the run is still in flight
    // when the second click lands — a double click on a real, slow run.
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    http = vi.fn(async () => {
      await pending;
      return {
        ok: true,
        status: 200,
        json: async () => emptyReport(),
      } as unknown as Response;
    }) as unknown as ReturnType<typeof makeTransport>;
    client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: d.buttonAriaLabel }));
    const submit = screen.getByRole('button', { name: d.confirm.submit });
    fireEvent.click(submit);

    // The pending state is announced, not signalled by colour alone.
    const announced = await screen.findByRole('status');
    expect(announced).toHaveTextContent(d.pending);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');

    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(http).toHaveBeenCalledTimes(1);

    release?.();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(http).toHaveBeenCalledTimes(1);
  });
});

describe('RunCyclePanel — the report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transportReturning(fullReport);
  });

  it('states the window the run covered', async () => {
    renderPanel();
    openAndConfirm();

    expect(await screen.findByText(d.report.window('2026-08-31', '2026-09-01'))).toBeInTheDocument();
  });

  it('renders every counter the report carries', async () => {
    renderPanel();
    openAndConfirm();

    await screen.findByText(d.report.heading);
    for (const [label, value] of [
      [d.report.counters.eligibleContracts, '4'],
      [d.report.counters.issued, '1'],
      [d.report.counters.absorbed, '1'],
      [d.report.counters.mailsSent, '2'],
      [d.report.counters.adminsNotified, '1'],
    ] as const) {
      const term = screen.getByText(label);
      expect(term.parentElement).toHaveTextContent(value);
    }
  });

  it('lists each issued invoice with its student, period, due date and amount', async () => {
    renderPanel();
    openAndConfirm();

    expect(await screen.findByText(d.report.issuedHeading)).toBeInTheDocument();
    expect(screen.getByText('Ana Lima')).toBeInTheDocument();
    expect(screen.getByText('2026-09-01')).toBeInTheDocument();
    expect(screen.getByText('2026-09-10')).toBeInTheDocument();
    expect(screen.getByText('R$ 1,500.00')).toBeInTheDocument();
    expect(screen.getByText(status.open)).toBeInTheDocument();
  });

  it('lists the two kinds of student notice and what happened to each', async () => {
    renderPanel();
    openAndConfirm();

    expect(await screen.findByText(d.report.remindersHeading)).toBeInTheDocument();
    expect(screen.getByText(`Bruno Sato · ${d.report.reminderKind.due_date}`)).toBeInTheDocument();
    expect(
      screen.getByText(`Carla Reis · ${d.report.reminderKind.grace_lapsed}`),
    ).toBeInTheDocument();
    expect(screen.getByText(d.report.reminderSent)).toBeInTheDocument();
    expect(screen.getByText(d.report.reminderSuppressed)).toBeInTheDocument();
    expect(screen.getByText(d.report.reminderDates('2026-09-05', '2026-09-02'))).toBeInTheDocument();
  });

  it('keeps the hold distinction wherever a suppressed notice appears', async () => {
    renderPanel();
    openAndConfirm();

    expect(await screen.findByText(d.report.reminderHoldLine)).toBeInTheDocument();
    // The panel-level and the two section-level copies all say the same thing:
    // a hold stops the chasing and never the debt.
    expect(screen.getAllByText(d.holdNote).length).toBeGreaterThan(0);
    expect(screen.getByText(d.report.heldHeading)).toBeInTheDocument();
    expect(screen.getByText(d.report.heldOutstanding)).toBeInTheDocument();
  });

  it('renders a standing crossing from the report, through the shared badge', async () => {
    renderPanel();
    openAndConfirm();

    expect(await screen.findByText(d.report.crossingsHeading)).toBeInTheDocument();
    expect(screen.getByText(dictEn.admin.billing.standing.good)).toBeInTheDocument();
    expect(screen.getByText(dictEn.admin.billing.standing.due)).toBeInTheDocument();
    expect(screen.getByText(d.report.oldestOverdue('2026-08-05'))).toBeInTheDocument();
    expect(screen.getByText(d.report.crossingsNote)).toBeInTheDocument();
  });

  it('reports a cached-status divergence as a finding, with no control to repair it', async () => {
    const { container } = renderPanel();
    openAndConfirm();

    expect(await screen.findByText(d.report.divergencesHeading)).toBeInTheDocument();
    expect(
      screen.getByText(d.report.divergenceLine(status.open, status.paid)),
    ).toBeInTheDocument();
    expect(screen.getByText(d.report.divergencesNote)).toBeInTheDocument();

    for (const button of within(container).getAllByRole('button')) {
      const name = `${button.getAttribute('aria-label') ?? ''} ${button.textContent ?? ''}`;
      expect(name).not.toMatch(/repair|fix|reconcile|correct|corrigir|reparar|conciliar/i);
    }
  });

  it('re-reads the ledger only when the run actually issued something', async () => {
    renderPanel();
    openAndConfirm();

    await screen.findByText(d.report.issuedHeading);
    expect(onIssued).toHaveBeenCalledTimes(1);
  });

  it('suggests no fee, interest, adjustment or correction, and gates no access', async () => {
    const { container } = renderPanel();
    openAndConfirm();

    await screen.findByText(d.report.heading);
    expect(screen.getByText(d.noFeeNote)).toBeInTheDocument();
    expect(screen.getByText(d.noGateNote)).toBeInTheDocument();

    for (const button of within(container).getAllByRole('button')) {
      const name = `${button.getAttribute('aria-label') ?? ''} ${button.textContent ?? ''}`;
      expect(name).not.toMatch(
        /fee|interest|surcharge|penalty|block|suspend|revoke|restrict|multa|juro|bloquear|suspender/i,
      );
    }
  });
});

describe('RunCyclePanel — the three outcomes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads a run that issued invoices as exactly that', async () => {
    transportReturning(fullReport);
    renderPanel();
    openAndConfirm();

    expect(await screen.findByText(d.outcome.issuedTitle(1))).toBeInTheDocument();
    expect(screen.queryByText(d.outcome.alreadyBilledTitle)).not.toBeInTheDocument();
    expect(screen.queryByText(d.outcome.nothingToIssueTitle)).not.toBeInTheDocument();
  });

  it('reads a second run as already billed, naming the absorbed count', async () => {
    transportReturning(emptyReport({ eligibleContracts: 3, absorbed: 3 }));
    renderPanel();
    openAndConfirm();

    expect(await screen.findByText(d.outcome.alreadyBilledTitle)).toBeInTheDocument();
    expect(screen.getByText(d.outcome.alreadyBilledBody(3))).toBeInTheDocument();
    // A second run issues nothing and names no crossing.
    expect(screen.getByText(d.report.issuedEmpty)).toBeInTheDocument();
    expect(screen.getByText(d.report.crossingsEmpty)).toBeInTheDocument();
    expect(onIssued).not.toHaveBeenCalled();
  });

  it('reads a run with no contract in scope as nothing to issue, not as a failure', async () => {
    transportReturning(emptyReport());
    renderPanel();
    openAndConfirm();

    expect(await screen.findByText(d.outcome.nothingToIssueTitle)).toBeInTheDocument();
    expect(screen.getByText(d.outcome.nothingToIssueBody)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(d.error)).not.toBeInTheDocument();
  });

  it('distinguishes contracts in scope with nothing due from nothing in scope', async () => {
    transportReturning(emptyReport({ eligibleContracts: 5 }));
    renderPanel();
    openAndConfirm();

    expect(await screen.findByText(d.outcome.noneDueTitle)).toBeInTheDocument();
    expect(screen.getByText(d.outcome.noneDueBody(5))).toBeInTheDocument();
    expect(screen.queryByText(d.outcome.nothingToIssueTitle)).not.toBeInTheDocument();
  });
});

describe('RunCyclePanel — failure', () => {
  beforeEach(() => vi.clearAllMocks());

  it("surfaces the server's own explanation and renders no report", async () => {
    http = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'CONFLICT', message: 'the billing run is already in progress' }),
    })) as unknown as ReturnType<typeof makeTransport>;
    client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };

    renderPanel();
    openAndConfirm();

    expect(await screen.findByText('the billing run is already in progress')).toBeInTheDocument();
    expect(screen.getByText(d.errorNoReport)).toBeInTheDocument();
    expect(screen.queryByText(d.report.heading)).not.toBeInTheDocument();
    expect(screen.queryByText(d.outcome.nothingToIssueTitle)).not.toBeInTheDocument();
    expect(onIssued).not.toHaveBeenCalled();
  });

  it('falls back to its own sentence when the server explained nothing', async () => {
    http = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as unknown as ReturnType<typeof makeTransport>;
    client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };

    renderPanel();
    openAndConfirm();

    expect(await screen.findByText(d.error)).toBeInTheDocument();
    expect(screen.queryByText(d.report.heading)).not.toBeInTheDocument();
  });
});

describe('RunCyclePanel — money', () => {
  beforeEach(() => vi.clearAllMocks());

  function reportAt(currencyCode: string, amountMinor: number): BillingRunReport {
    return emptyReport({
      eligibleContracts: 1,
      issued: [
        {
          invoiceId: 'inv-55555555-eeee',
          subscriptionId: 'sub-9',
          userId: 'u1',
          periodStart: '2026-09-01',
          dueDate: '2026-09-10',
          amountMinor,
          currency: currencyCode,
          status: 'open',
        },
      ],
    });
  }

  it('renders an exponent-2 amount at two decimals', async () => {
    transportReturning(reportAt('BRL', 150000));
    renderPanel(BRL);
    openAndConfirm();

    expect(await screen.findByText('R$ 1,500.00')).toBeInTheDocument();
  });

  it('renders an exponent-0 amount with no decimal separator', async () => {
    transportReturning(reportAt('JPY', 100000));
    renderPanel(JPY);
    openAndConfirm();

    expect(await screen.findByText('¥ 100,000')).toBeInTheDocument();
  });

  it('renders an exponent-8 amount at eight decimals', async () => {
    transportReturning(reportAt('BTC', 100000));
    renderPanel(BTC);
    openAndConfirm();

    expect(await screen.findByText('₿ 0.00100000')).toBeInTheDocument();
  });

  it("withholds a row whose currency is not the console's, rather than mis-scaling it", async () => {
    transportReturning(reportAt('JPY', 100000));
    renderPanel(BRL);
    openAndConfirm();

    expect(
      await screen.findByText(dictEn.admin.billing.money.unavailable('JPY')),
    ).toBeInTheDocument();
    expect(screen.queryByText('R$ 1,000.00')).not.toBeInTheDocument();
  });
});
