'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { Entities } from '@arenaquest/shared/types/entities';
import { computePeriod } from '@arenaquest/shared/domain/billing/billing-cycle';
import { Button, Input } from '@web/components/design-system';
import { Spinner } from '@web/components/spinner';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type {
  BillingCycle,
  BillingReportCurrency,
  BillingSubscription,
  IssueInvoiceInput,
} from '@web/lib/admin-billing-api';
import { Money } from './money';
import { explain } from './explain-error';

/**
 * The wire type is a plain string union; `computePeriod` takes the shared enum.
 * Mapping rather than casting keeps the two definitions provably aligned — a
 * new cycle on either side stops compiling here.
 */
const CYCLE_ENUM: Record<BillingCycle, Entities.Config.BillingCycle> = {
  monthly: Entities.Config.BillingCycle.MONTHLY,
  quarterly: Entities.Config.BillingCycle.QUARTERLY,
  yearly: Entities.Config.BillingCycle.YEARLY,
};

/**
 * Today as `YYYY-MM-DD` in the administrator's own timezone, used only as the
 * initial value of a field they can change. No `Intl` and no UTC shift: a
 * `toISOString()` slice would show yesterday's date west of Greenwich.
 */
function todayLocal(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

type ResolvedPeriod = { periodStart: string; periodEnd: string; dueDate: string };

/**
 * Issue an invoice for a contract's period — RFC 0013 §7.
 *
 * **This is not a sales path.** It bills one period of one existing contract,
 * because `invoices.subscription_id` is non-nullable and the request schema
 * requires it. `UNIQUE (subscription_id, period_start)` is what makes the daily
 * run idempotent, and it equally means a second invoice for the same contract
 * and period is refused — which this form reports as exactly that. A seminar, a
 * one-off class or any other non-recurring item is not expressible here.
 *
 * **The period is named with the server's own rule.** `billing-service.ts`
 * derives it with `computePeriod(cycle, startDate, dueDay, referenceDate)` from
 * `@arenaquest/shared/domain/billing/billing-cycle` — the single
 * implementation, not a client copy — and then accepts explicit `periodStart`,
 * `periodEnd` and `dueDate`. This form resolves the period, displays it, and
 * submits those three values explicitly, so the screen cannot show one period
 * while the server stores another by re-deriving against its own clock.
 *
 * A contract the server will refuse to bill — `cancelled` or `superseded` — is
 * listed with its status rather than hidden: the refusal is the server's to
 * state, and pre-empting it would teach an administrator a rule the client only
 * guesses at.
 */
export function IssueInvoiceForm({
  currency,
  nameOf,
  onClose,
  onIssued,
}: {
  currency: BillingReportCurrency | null;
  nameOf: (userId: string) => string;
  onClose: () => void;
  /** Called with the new invoice's short reference after the server accepted it. */
  onIssued: (reference: string) => void;
}) {
  const dict = useDict();
  const d = dict.admin.billing.ledger.issue;
  const planDict = dict.admin.billing.plans;
  const client = useApiClient();

  const searchId = useId();
  const pickerLabelId = useId();
  const contractErrorId = useId();

  const [contracts, setContracts] = useState<BillingSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [subscriptionId, setSubscriptionId] = useState('');
  const [referenceDate, setReferenceDate] = useState<string>(() => todayLocal());

  const [contractError, setContractError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const data = await client.adminBilling.subscriptions.list();
        if (!cancelled) {
          setContracts(data);
          setLoadError(null);
        }
      } catch {
        if (!cancelled) {
          setContracts([]);
          setLoadError(d.contractsLoadError);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, d.contractsLoadError]);

  const selected = useMemo(
    () => contracts.find((contract) => contract.id === subscriptionId) ?? null,
    [contracts, subscriptionId],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return contracts;
    return contracts.filter((contract) => nameOf(contract.userId).toLowerCase().includes(needle));
  }, [contracts, nameOf, search]);

  /**
   * The period the shared rule resolves for the chosen contract and reference
   * date. `computePeriod` throws a `RangeError` on a `due_day` outside 1..28 or
   * a malformed date, so the failure is reported rather than thrown at render.
   */
  const period = useMemo<ResolvedPeriod | null>(() => {
    if (!selected) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) return null;
    try {
      return computePeriod(
        CYCLE_ENUM[selected.cycle],
        selected.startDate,
        selected.dueDay,
        referenceDate,
      );
    } catch {
      return null;
    }
  }, [referenceDate, selected]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!selected) {
      setContractError(d.contractRequired);
      return;
    }
    setContractError(null);

    if (!period) {
      setSubmitError(d.periodError);
      return;
    }
    setSubmitError(null);

    const payload: IssueInvoiceInput = {
      subscriptionId: selected.id,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      dueDate: period.dueDate,
    };

    setBusy(true);
    try {
      const invoice = await client.adminBilling.invoices.create(payload);
      onIssued(invoice.id.slice(0, 8));
    } catch (thrown) {
      // "the contract already has an invoice for the period starting …" and
      // "a cancelled contract cannot be billed" both arrive here as the
      // server's own sentence, never as a generic failure.
      setSubmitError(explain(thrown, d.error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={d.dialogTitle}
    >
      <form
        onSubmit={submit}
        className="my-8 w-full max-w-2xl space-y-5 rounded-lg border border-zinc-200 bg-white p-5 md:p-6 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {d.dialogTitle}
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.explainer}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{d.notASaleNote}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{d.uniquenessNote}</p>
        </div>

        {/* ---------------------------------------------------------------
            The contract being billed. Named, never implied.
            --------------------------------------------------------------- */}
        <section className="space-y-2">
          <h3 id={pickerLabelId} className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {d.contractHeading}
          </h3>

          <Input
            id={searchId}
            type="search"
            label={d.searchLabel}
            placeholder={d.searchPlaceholder}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          {loading ? (
            <div className="flex justify-center py-4">
              <Spinner className="h-5 w-5 text-zinc-400" />
            </div>
          ) : loadError ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {loadError}
            </p>
          ) : visible.length === 0 ? (
            <p className="py-4 text-center text-sm text-zinc-500">{d.contractsEmpty}</p>
          ) : (
            <div
              role="radiogroup"
              aria-labelledby={pickerLabelId}
              aria-describedby={contractError ? contractErrorId : undefined}
              className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-zinc-200 p-2 dark:border-zinc-800"
            >
              {visible.map((contract) => (
                <label
                  key={contract.id}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <input
                    type="radio"
                    name="billing-issue-contract"
                    value={contract.id}
                    checked={subscriptionId === contract.id}
                    onChange={() => {
                      setSubscriptionId(contract.id);
                      setContractError(null);
                    }}
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-zinc-900 dark:text-zinc-100">
                      {nameOf(contract.userId)}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {d.contractMeta(
                        planDict.cycle[contract.cycle],
                        d.contractStatus[contract.status],
                        contract.startDate,
                      )}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {contractError && (
            <p id={contractErrorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
              {contractError}
            </p>
          )}
        </section>

        {/* ---------------------------------------------------------------
            The period, resolved by the shared rule and submitted explicitly.
            --------------------------------------------------------------- */}
        <section className="space-y-3">
          <Input
            label={d.referenceDateLabel}
            type="date"
            value={referenceDate}
            onChange={(event) => setReferenceDate(event.target.value)}
            helperText={d.referenceDateHelp}
          />

          <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {d.periodHeading}
            </h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{d.periodNote}</p>

            {!selected ? (
              <p className="mt-3 text-sm text-zinc-500">{d.periodPending}</p>
            ) : !period ? (
              <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
                {d.periodError}
              </p>
            ) : (
              <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    {d.periodLabel}
                  </dt>
                  <dd className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {d.periodValue(period.periodStart, period.periodEnd)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    {d.dueLabel}
                  </dt>
                  <dd className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {period.dueDate}
                  </dd>
                </div>
                <div>
                  {/*
                    The contract's own recorded amount — the terms it snapshotted
                    at signature, which is what the server bills. It is shown as
                    the datum being written; this form offers no override.
                  */}
                  <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    {d.amountLabel}
                  </dt>
                  <dd className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    <Money
                      amountMinor={selected.amountMinor}
                      currency={currency}
                      code={selected.currency}
                    />
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </section>

        {submitError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {submitError}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            {d.cancel}
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={busy}>
            {d.submit}
          </Button>
        </div>
      </form>
    </div>
  );
}
