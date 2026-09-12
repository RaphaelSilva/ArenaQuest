import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import { createAdminBillingApi } from '@web/lib/admin-billing-api';
import type { BillingReportCurrency, BillingSubscription } from '@web/lib/admin-billing-api';
import type { HttpTransport } from '@web/lib/api-client';
import { makeTransport } from './test-transport';
import { ContractActions } from '../contract-actions';

const BRL: BillingReportCurrency = { code: 'BRL', exponent: 2, symbol: 'R$' };
const BTC: BillingReportCurrency = { code: 'BTC', exponent: 8, symbol: '₿' };

function version(overrides: Partial<BillingSubscription> = {}): BillingSubscription {
  return {
    id: 'sub-1',
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

let http: ReturnType<typeof makeTransport>;
let client: { adminBilling: ReturnType<typeof createAdminBillingApi> };

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return { ...actual, useApiClient: () => client };
});

const onChanged = vi.fn();
const d = dictEn.admin.billing.contract;
const planDict = dictEn.admin.billing.plans;

function renderActions(
  overrides: Partial<BillingSubscription> = {},
  currency: BillingReportCurrency | null = BRL,
) {
  return render(
    <DictProvider value={dictEn}>
      <ContractActions version={version(overrides)} currency={currency} onChanged={onChanged} />
    </DictProvider>,
  );
}

function click(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('ContractActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    http = makeTransport(() => version());
    client = { adminBilling: createAdminBillingApi(http as unknown as HttpTransport) };
  });

  /* ---------------------------------------------------------------------
     Only the transition the current status allows is offered. The server
     gates all three, so a button it would refuse is not rendered at all.
     --------------------------------------------------------------------- */

  it('offers pause, amend and cancel on an active contract, and no resume', () => {
    renderActions({ status: 'active' });

    expect(screen.getByRole('button', { name: d.pauseButton })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: d.amendButton })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: d.cancelButton })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: d.resumeButton })).not.toBeInTheDocument();
  });

  it('offers resume and cancel on a paused contract, and neither pause nor amend', () => {
    renderActions({ status: 'paused' });

    expect(screen.getByRole('button', { name: d.resumeButton })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: d.cancelButton })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: d.pauseButton })).not.toBeInTheDocument();
    // Only the active version can be amended (`billing-service.ts`).
    expect(screen.queryByRole('button', { name: d.amendButton })).not.toBeInTheDocument();
  });

  it('offers nothing on a closed contract and says why', () => {
    renderActions({ status: 'cancelled', endDate: '2026-05-31' });

    expect(screen.getByText(d.closedNote)).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  /* ---------------------------------------------------------------------
     The lifecycle payloads.
     --------------------------------------------------------------------- */

  it('pauses behind a confirmation that states what pausing does not change', async () => {
    renderActions({ status: 'active' });

    click(d.pauseButton);
    expect(screen.getByText(d.pauseBody)).toBeInTheDocument();
    // The claim the confirmation makes, and the reason the copy exists.
    expect(d.pauseBody).toMatch(/due date/i);
    expect(d.pauseBody).toMatch(/outstanding total/i);
    expect(d.pauseBody).toMatch(/aging report/i);
    expect(http).not.toHaveBeenCalled();

    click(d.pauseConfirm);

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('PATCH', '/admin/billing/subscriptions/sub-1', {
        body: JSON.stringify({ action: 'pause' }),
      }),
    );
    expect(onChanged).toHaveBeenCalledWith(d.pauseSuccess);
  });

  it('resumes a paused contract', async () => {
    renderActions({ status: 'paused' });

    click(d.resumeButton);
    click(d.resumeConfirm);

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('PATCH', '/admin/billing/subscriptions/sub-1', {
        body: JSON.stringify({ action: 'resume' }),
      }),
    );
    expect(onChanged).toHaveBeenCalledWith(d.resumeSuccess);
  });

  it('cancels with the end date it was given, and forgives nothing in its copy', async () => {
    renderActions({ status: 'active' });

    click(d.cancelButton);
    expect(screen.getByText(d.cancelBody)).toBeInTheDocument();
    type(d.cancelEndDateLabel, '2026-07-31');
    click(d.cancelConfirm);

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('PATCH', '/admin/billing/subscriptions/sub-1', {
        body: JSON.stringify({ action: 'cancel', endDate: '2026-07-31' }),
      }),
    );
    expect(onChanged).toHaveBeenCalledWith(d.cancelSuccess);
  });

  it('cancels without an end date and lets the server record today', async () => {
    renderActions({ status: 'active' });

    click(d.cancelButton);
    click(d.cancelConfirm);

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('PATCH', '/admin/billing/subscriptions/sub-1', {
        body: JSON.stringify({ action: 'cancel' }),
      }),
    );
  });

  /* ---------------------------------------------------------------------
     Pause, cancel, hold and waiver are four different things, and the
     screen points at the right one.
     --------------------------------------------------------------------- */

  it('points a debt at a waiver and reminders at a hold', () => {
    renderActions({ status: 'active' });

    expect(screen.getByText(d.waiverPointer)).toBeInTheDocument();
    expect(screen.getByText(d.holdPointer)).toBeInTheDocument();
    expect(d.waiverPointer).toMatch(/waiver/i);
    expect(d.holdPointer).toMatch(/hold/i);
  });

  /**
   * No Non-Goal is crossed: nothing here gates, suspends or withholds a screen,
   * and the copy says so rather than leaving it to be discovered.
   */
  it('implies no loss of access anywhere in its copy', () => {
    const { container } = renderActions({ status: 'active' });

    click(d.cancelButton);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/suspend|paywall|revoke|restrict|lock|blocked/i);
    expect(screen.getByText(d.noAccessNote)).toBeInTheDocument();
  });

  /* ---------------------------------------------------------------------
     Amendment: a new version, never an edit.
     --------------------------------------------------------------------- */

  it('refuses a blank reason and issues no request', () => {
    renderActions({ status: 'active' });

    click(d.amendButton);
    type(d.amendStartDateLabel, '2026-07-01');
    http.mockClear();
    click(d.amendSubmit);

    expect(screen.getByText(d.validation.termsNoteRequired)).toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
  });

  it('records an amendment as a new version, with its overrides and its reason', async () => {
    renderActions({ status: 'active' });

    click(d.amendButton);
    // The form is presented as creating a version, not as editing the contract.
    expect(screen.getByText(d.amendBody)).toBeInTheDocument();

    type(d.amendStartDateLabel, '2026-07-01');
    type(d.amendAmountLabel('BRL'), '1200.50');
    fireEvent.change(screen.getByLabelText(d.amendCycleLabel), {
      target: { value: 'quarterly' },
    });
    type(d.amendDueDayLabel, '5');
    type(d.amendGraceDaysLabel, '12');
    type(d.amendNoteLabel, 'Renegotiated in July.');

    click(d.amendSubmit);

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith('POST', '/admin/billing/subscriptions/sub-1/amend', {
        body: JSON.stringify({
          startDate: '2026-07-01',
          termsNote: 'Renegotiated in July.',
          cycle: 'quarterly',
          graceDays: 12,
          dueDay: 5,
          amountMinor: 120050,
        }),
      }),
    );
    expect(onChanged).toHaveBeenCalledWith(d.amendSuccess);
  });

  it('submits an amended amount as integer minor units at the recorded exponent', async () => {
    renderActions({ status: 'active', currency: 'BTC', amountMinor: 150000000 }, BTC);

    click(d.amendButton);
    type(d.amendStartDateLabel, '2026-07-01');
    type(d.amendAmountLabel('BTC'), '0.001');
    type(d.amendNoteLabel, 'Priced in BTC.');
    click(d.amendSubmit);

    await waitFor(() => expect(http).toHaveBeenCalled());
    const body = JSON.parse(http.mock.calls[0][2]?.body ?? '{}') as { amountMinor: number };
    expect(body.amountMinor).toBe(100000);
    expect(Number.isInteger(body.amountMinor)).toBe(true);
  });

  it('opens the amendment form on the terms in force', () => {
    renderActions({ status: 'active', amountMinor: 150000, graceDays: 5, dueDay: 10 });

    click(d.amendButton);

    expect(screen.getByLabelText(d.amendAmountLabel('BRL'))).toHaveValue('1500.00');
    expect(screen.getByLabelText(d.amendDueDayLabel)).toHaveValue('10');
    expect(screen.getByLabelText(d.amendGraceDaysLabel)).toHaveValue('5');
    // The reason is never pre-filled: it is what this amendment is for.
    expect(screen.getByLabelText(d.amendNoteLabel)).toHaveValue('');
    expect(screen.getByText(d.currentValue(planDict.cycle.monthly))).toBeInTheDocument();
  });

  it('rejects a billing day the API would not accept, without issuing a request', () => {
    renderActions({ status: 'active' });

    click(d.amendButton);
    type(d.amendStartDateLabel, '2026-07-01');
    type(d.amendNoteLabel, 'Renegotiated.');
    type(d.amendDueDayLabel, '31');
    http.mockClear();
    click(d.amendSubmit);

    expect(screen.getByText(d.validation.dueDayInvalid)).toBeInTheDocument();
    expect(http).not.toHaveBeenCalled();
  });

  /* ---------------------------------------------------------------------
     A refusal is the server's sentence, never a client-side assertion.
     --------------------------------------------------------------------- */

  it("surfaces a 409 with the server's own message", async () => {
    const conflicting = vi.fn(
      async () =>
        ({
          ok: false,
          status: 409,
          json: async () => ({
            error: 'Conflict',
            message: 'only an active contract can be paused',
          }),
        }) as unknown as Response,
    );
    client = { adminBilling: createAdminBillingApi(conflicting as unknown as HttpTransport) };

    renderActions({ status: 'active' });
    click(d.pauseButton);
    click(d.pauseConfirm);

    expect(await screen.findByText('only an active contract can be paused')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('surfaces the amendment refusal the server sends', async () => {
    const conflicting = vi.fn(
      async () =>
        ({
          ok: false,
          status: 409,
          json: async () => ({
            error: 'Conflict',
            message: 'only the active version of a contract can be amended; this one is "paused"',
          }),
        }) as unknown as Response,
    );
    client = { adminBilling: createAdminBillingApi(conflicting as unknown as HttpTransport) };

    renderActions({ status: 'active' });
    click(d.amendButton);
    type(d.amendStartDateLabel, '2026-07-01');
    type(d.amendNoteLabel, 'Renegotiated in July.');
    click(d.amendSubmit);

    expect(
      await screen.findByText(
        'only the active version of a contract can be amended; this one is "paused"',
      ),
    ).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('leaves the amount out of the payload when no currency is resolved', async () => {
    renderActions({ status: 'active' }, null);

    click(d.amendButton);
    // Without a recorded exponent a typed amount cannot become minor units, so
    // the field is disabled and the server carries the current amount over.
    expect(screen.getByLabelText(d.amendAmountLabel('BRL'))).toBeDisabled();
    type(d.amendStartDateLabel, '2026-07-01');
    type(d.amendNoteLabel, 'Renegotiated in July.');
    click(d.amendSubmit);

    await waitFor(() => expect(http).toHaveBeenCalled());
    const body = JSON.parse(http.mock.calls[0][2]?.body ?? '{}') as Record<string, unknown>;
    expect(body).not.toHaveProperty('amountMinor');
    expect(body.termsNote).toBe('Renegotiated in July.');
  });
});
