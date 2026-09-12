'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import {
  Badge,
  Button,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@web/components/design-system';
import { Spinner } from '@web/components/spinner';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { AdminBillingApiError } from '@web/lib/admin-billing-api';
import type {
  BillingCycle,
  BillingPlan,
  BillingReportCurrency,
} from '@web/lib/admin-billing-api';
import { Money } from './money';
import { fromMinorUnits, toMinorUnits } from './minor-units';

/**
 * The three values the API accepts, and the whole of what this catalogue can
 * express. A plan is the **recurring** shelf: the daily run re-invoices every
 * contract signed against it, once per cycle, for as long as the contract is
 * active. There is deliberately no fourth option here — a one-off item sold as
 * a plan would be billed again every period forever, and selling non-recurring
 * extras is out of this milestone entirely.
 */
const CYCLES: readonly BillingCycle[] = ['monthly', 'quarterly', 'yearly'];

/** `all` omits the parameter; the other two send it. */
type StateFilter = 'active' | 'archived' | 'all';
const FILTERS: readonly StateFilter[] = ['active', 'archived', 'all'];

type Draft = { mode: 'create' } | { mode: 'edit'; plan: BillingPlan };

type FormValues = {
  name: string;
  description: string;
  amount: string;
  cycle: BillingCycle;
  graceDays: string;
};

const BLANK: FormValues = {
  name: '',
  description: '',
  amount: '',
  cycle: 'monthly',
  graceDays: '0',
};

/**
 * The catalogue tab of `/admin/billing` (RFC 0013 §7, the admin write surface).
 *
 * It creates, edits and archives plans through the three client methods that
 * already existed. Two things it never does, because the API has neither: it
 * offers no delete — archiving hides a plan from future signature and every
 * contract that references it stays exactly as it is — and it gates no
 * student's access. A plan is a price, not a permission.
 */
export function PlansTab({ currency }: { currency: BillingReportCurrency | null }) {
  const dict = useDict();
  const d = dict.admin.billing.plans;
  const client = useApiClient();
  const filterId = useId();
  const cycleId = useId();

  const [filter, setFilter] = useState<StateFilter>('active');
  const [rows, setRows] = useState<BillingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [values, setValues] = useState<FormValues>(BLANK);
  const [formError, setFormError] = useState<string | null>(null);

  const filterLabels: Record<StateFilter, string> = {
    active: d.filterActive,
    archived: d.filterArchived,
    all: d.filterAll,
  };

  /**
   * The archived state is a **server** parameter, so archiving a plan removes
   * it from the default list on the next read. Filtering a cached array here
   * would put a second copy of a server rule in the client — the same reason
   * the Students tab round-trips its standing filter.
   */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await client.adminBilling.plans.list(
        filter === 'all' ? {} : { archived: filter === 'archived' },
      );
      setRows(data);
    } catch {
      setRows([]);
      setError(d.loadError);
    } finally {
      setLoading(false);
    }
  }, [client, filter, d.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * `CreatePlanBodySchema` requires a currency and there is no currency-list
   * endpoint, so the form submits the code this console already resolved and
   * shows it read-only. With no resolved currency there is no recorded
   * exponent, and turning a typed amount into minor units at an assumed two
   * decimals is exactly the failure `money.tsx` exists to prevent — so writing
   * is disabled rather than guessed, and `money.resolveError` says why.
   */
  const canWrite = currency !== null;

  /**
   * A plan priced in another currency has an exponent this console does not
   * know, so its amount is neither rendered (see `Money`) nor editable. Its
   * archived state still is: that field carries no amount.
   */
  const canEdit = useCallback(
    (plan: BillingPlan) => currency !== null && plan.currency === currency.code,
    [currency],
  );

  /** The server's own explanation when it sent one — never a generic failure. */
  const explain = (thrown: unknown, fallback: string): string =>
    thrown instanceof AdminBillingApiError ? (thrown.detailMessage ?? fallback) : fallback;

  const openCreate = () => {
    setDraft({ mode: 'create' });
    setValues(BLANK);
    setFormError(null);
    setNotice(null);
    setActionError(null);
  };

  const openEdit = (plan: BillingPlan) => {
    if (!currency) return;
    setDraft({ mode: 'edit', plan });
    setValues({
      name: plan.name,
      description: plan.description,
      amount: fromMinorUnits(plan.amountMinor, currency.exponent),
      cycle: plan.cycle,
      graceDays: String(plan.graceDays),
    });
    setFormError(null);
    setNotice(null);
    setActionError(null);
  };

  const closeDraft = () => {
    setDraft(null);
    setFormError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft || !currency) return;

    const name = values.name.trim();
    if (!name) {
      setFormError(d.validation.nameRequired);
      return;
    }

    // The amount is converted by string arithmetic at the currency's recorded
    // exponent. A fraction the currency cannot hold is refused here and no
    // request is issued: rounding it silently would post a number the
    // administrator never typed.
    const amount = toMinorUnits(values.amount, currency.exponent);
    if (!amount.ok) {
      const messages: Record<typeof amount.reason, string> = {
        empty: d.validation.amountEmpty,
        'not-a-number': d.validation.amountNotANumber,
        negative: d.validation.amountNegative,
        'too-precise': d.validation.amountTooPrecise(currency.exponent),
      };
      setFormError(messages[amount.reason]);
      return;
    }

    const graceDays = values.graceDays.trim();
    if (!/^\d+$/.test(graceDays)) {
      setFormError(d.validation.graceDaysInvalid);
      return;
    }

    const description = values.description.trim();
    setBusy(true);
    setFormError(null);
    try {
      if (draft.mode === 'create') {
        await client.adminBilling.plans.create({
          name,
          description,
          amountMinor: amount.amountMinor,
          currency: currency.code,
          cycle: values.cycle,
          graceDays: Number(graceDays),
        });
        setNotice(d.createSuccess(name));
      } else {
        // `currency` is absent from `UpdatePlanBodySchema` and is never sent.
        await client.adminBilling.plans.update(draft.plan.id, {
          name,
          description,
          amountMinor: amount.amountMinor,
          cycle: values.cycle,
          graceDays: Number(graceDays),
        });
        setNotice(d.updateSuccess(name));
      }
      setDraft(null);
      // The list is re-read from the API after a write, never updated
      // optimistically: a rejected create must leave no row on screen.
      await load();
    } catch (thrown) {
      setFormError(
        explain(thrown, draft.mode === 'create' ? d.createError : d.updateError),
      );
    } finally {
      setBusy(false);
    }
  };

  /** Archive and un-archive are the same `plans.update` call. There is no delete. */
  const setArchived = async (plan: BillingPlan, archived: boolean) => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await client.adminBilling.plans.update(plan.id, { archived });
      setNotice(archived ? d.archiveSuccess(plan.name) : d.unarchiveSuccess(plan.name));
      await load();
    } catch (thrown) {
      setActionError(explain(thrown, archived ? d.archiveError : d.unarchiveError));
    } finally {
      setBusy(false);
    }
  };

  const dialogTitle =
    draft?.mode === 'edit' ? d.editDialogTitle(draft.plan.name) : d.createDialogTitle;
  const draftCurrencyCode = draft?.mode === 'edit' ? draft.plan.currency : (currency?.code ?? '');

  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{d.heading}</h2>
        <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{d.recurringNote}</p>
        <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{d.editSafeNote}</p>
        <p className="max-w-3xl text-xs text-zinc-500 dark:text-zinc-400">{d.archiveNote}</p>
        <p className="max-w-3xl text-xs text-zinc-500 dark:text-zinc-400">{d.noGateNote}</p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label
            htmlFor={filterId}
            className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]"
          >
            {d.filterLabel}
          </label>
          <select
            id={filterId}
            value={filter}
            onChange={(event) => setFilter(event.target.value as StateFilter)}
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          >
            {FILTERS.map((value) => (
              <option key={value} value={value}>
                {filterLabels[value]}
              </option>
            ))}
          </select>
        </div>

        <Button
          type="button"
          variant="primary"
          size="md"
          disabled={!canWrite || busy}
          onClick={openCreate}
        >
          {d.createButton}
        </Button>

        <p className="text-xs text-zinc-500">{d.count(rows.length)}</p>
      </div>

      {!canWrite && (
        <p
          role="alert"
          className="max-w-3xl text-sm text-amber-700 dark:text-amber-300"
        >
          {dict.admin.billing.money.resolveError}
        </p>
      )}

      {notice && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </p>
      )}

      {actionError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {actionError}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-6 w-6 text-zinc-400" />
        </div>
      ) : error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">
          {filter === 'archived' ? d.emptyArchived : d.empty}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow isHoverable={false}>
              <TableCell isHeader>{d.columns.name}</TableCell>
              <TableCell isHeader>{d.columns.amount}</TableCell>
              <TableCell isHeader>{d.columns.cycle}</TableCell>
              <TableCell isHeader>{d.columns.graceDays}</TableCell>
              <TableCell isHeader>{d.columns.state}</TableCell>
              <TableCell isHeader>{d.columns.actions}</TableCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((plan) => (
              <TableRow key={plan.id}>
                <TableCell>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{plan.name}</span>
                  <span className="mt-1 block max-w-md text-xs text-zinc-500">
                    {plan.description || d.none}
                  </span>
                </TableCell>
                <TableCell>
                  <Money amountMinor={plan.amountMinor} currency={currency} code={plan.currency} />
                </TableCell>
                <TableCell>{d.cycle[plan.cycle]}</TableCell>
                <TableCell>{d.graceDaysValue(plan.graceDays)}</TableCell>
                <TableCell>
                  <Badge status={plan.archived ? 'archived' : 'active'} size="sm">
                    {plan.archived ? d.state.archived : d.state.active}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busy || !canEdit(plan)}
                      onClick={() => openEdit(plan)}
                      aria-label={d.editAriaLabel(plan.name)}
                      title={canEdit(plan) ? undefined : d.editUnavailable(plan.currency)}
                    >
                      {d.editButton}
                    </Button>
                    {/*
                      Archive, never delete: the API has no destructive call and
                      existing contracts reference the plan.
                    */}
                    {plan.archived ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => void setArchived(plan, false)}
                        aria-label={d.unarchiveAriaLabel(plan.name)}
                      >
                        {d.unarchiveButton}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => void setArchived(plan, true)}
                        aria-label={d.archiveAriaLabel(plan.name)}
                      >
                        {d.archiveButton}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {draft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={dialogTitle}
        >
          <form
            onSubmit={submit}
            className="max-h-full w-full max-w-md space-y-4 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {dialogTitle}
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.editSafeNote}</p>

            <Input
              label={d.form.nameLabel}
              value={values.name}
              placeholder={d.form.namePlaceholder}
              onChange={(event) =>
                setValues((current) => ({ ...current, name: event.target.value }))
              }
            />

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]">
                {d.form.descriptionLabel}
              </span>
              <textarea
                value={values.description}
                onChange={(event) =>
                  setValues((current) => ({ ...current, description: event.target.value }))
                }
                rows={3}
                placeholder={d.form.descriptionPlaceholder}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>

            {/*
              The currency is context, not a control: it is the code this console
              resolved, it is submitted only on create, and `UpdatePlanBodySchema`
              does not accept it at all.
            */}
            <Input
              label={d.form.currencyLabel}
              value={draftCurrencyCode}
              readOnly
              helperText={d.form.currencyHelp}
            />

            <Input
              label={d.form.amountLabel(draftCurrencyCode)}
              value={values.amount}
              inputMode="decimal"
              onChange={(event) =>
                setValues((current) => ({ ...current, amount: event.target.value }))
              }
              helperText={d.form.amountHelp(currency?.exponent ?? 0)}
            />

            <div className="flex flex-col gap-1">
              <label
                htmlFor={cycleId}
                className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]"
              >
                {d.form.cycleLabel}
              </label>
              <select
                id={cycleId}
                value={values.cycle}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    cycle: event.target.value as BillingCycle,
                  }))
                }
                className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                {CYCLES.map((value) => (
                  <option key={value} value={value}>
                    {d.cycle[value]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-[color:var(--text3)]">{d.form.cycleHelp}</p>
            </div>

            <Input
              label={d.form.graceDaysLabel}
              value={values.graceDays}
              inputMode="numeric"
              onChange={(event) =>
                setValues((current) => ({ ...current, graceDays: event.target.value }))
              }
              helperText={d.form.graceDaysHelp}
            />

            {formError && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {formError}
              </p>
            )}

            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" size="md" onClick={closeDraft}>
                {d.cancel}
              </Button>
              <Button type="submit" variant="primary" size="md" disabled={busy}>
                {draft.mode === 'create' ? d.submitCreate : d.submitEdit}
              </Button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
