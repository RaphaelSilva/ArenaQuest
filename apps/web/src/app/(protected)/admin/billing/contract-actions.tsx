'use client';

import { useId, useState } from 'react';
import { Button, Input } from '@web/components/design-system';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type {
  AmendContractInput,
  BillingCycle,
  BillingReportCurrency,
  BillingSubscription,
  ChangeLifecycleInput,
} from '@web/lib/admin-billing-api';
import { explain } from './explain-error';
import { fromMinorUnits, toMinorUnits } from './minor-units';

/** The three values the amendment schema accepts for `cycle`. */
const CYCLES: readonly BillingCycle[] = ['monthly', 'quarterly', 'yearly'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Panel = 'pause' | 'resume' | 'cancel' | 'amend';

type FieldKey = 'endDate' | 'startDate' | 'amount' | 'dueDay' | 'graceDays' | 'termsNote';

type FieldErrors = Partial<Record<FieldKey, string>>;

/**
 * Pause, resume, cancel and amend — RFC 0013 §7, "Contract lifecycle".
 *
 * **Only the transition the current status allows is offered.**
 * `billing-service.ts` gates them (pause from `active` only, resume from
 * `paused` only, cancel from either, amend on the `active` version only), so a
 * button for a transition the server would refuse is not rendered. A refusal
 * that still arrives — a stale view, a concurrent change — is shown as the
 * server's own sentence through `explain()`, never as a client-side assertion
 * presented as authority.
 *
 * **Amendment supersedes; nothing edits in place.** The form is presented as
 * creating a new version, its reason is mandatory and it issues no request
 * without one. There is no other terms control on this screen.
 *
 * Nothing here previews what an action will do to a standing, a due date or an
 * aging bucket: the server resolves standing on every read. And none of the
 * four actions touches access — a paused or cancelled student keeps every
 * screen they had, which the copy states rather than leaving to be discovered.
 */
export function ContractActions({
  version,
  currency,
  onChanged,
}: {
  /** The version in force for this contract group. */
  version: BillingSubscription;
  /** The statement's own currency, so amounts convert at its recorded exponent. */
  currency: BillingReportCurrency | null;
  /** Called with the message to show once the server accepted the change. */
  onChanged: (successMessage: string) => void;
}) {
  const dict = useDict();
  const d = dict.admin.billing.contract;
  const planDict = dict.admin.billing.plans;
  const client = useApiClient();

  const cycleId = useId();
  const termsNoteId = useId();
  const noteErrorId = useId();

  const [panel, setPanel] = useState<Panel | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [endDate, setEndDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [amount, setAmount] = useState('');
  const [cycle, setCycle] = useState<BillingCycle>(version.cycle);
  const [graceDays, setGraceDays] = useState(String(version.graceDays));
  const [dueDay, setDueDay] = useState(String(version.dueDay));
  const [termsNote, setTermsNote] = useState('');

  const canPause = version.status === 'active';
  const canResume = version.status === 'paused';
  const canCancel = version.status === 'active' || version.status === 'paused';
  const canAmend = version.status === 'active';

  const open = (next: Panel) => {
    setSubmitError(null);
    setFieldErrors({});
    if (next === 'amend') {
      // The form opens on the terms in force, so what is being changed — and
      // what is being carried over — is visible rather than remembered.
      setStartDate('');
      setCycle(version.cycle);
      setGraceDays(String(version.graceDays));
      setDueDay(String(version.dueDay));
      setAmount(currency ? fromMinorUnits(version.amountMinor, currency.exponent) : '');
      setTermsNote('');
    }
    if (next === 'cancel') setEndDate('');
    setPanel(next);
  };

  const close = () => {
    setPanel(null);
    setSubmitError(null);
    setFieldErrors({});
  };

  const changeLifecycle = async (
    action: ChangeLifecycleInput['action'],
    success: string,
    fallback: string,
  ) => {
    const payload: ChangeLifecycleInput = { action };

    if (action === 'cancel' && endDate.trim() !== '') {
      if (!ISO_DATE.test(endDate.trim())) {
        setFieldErrors({ endDate: d.validation.endDateInvalid });
        return;
      }
      payload.endDate = endDate.trim();
    }

    setFieldErrors({});
    setSubmitError(null);
    setBusy(true);
    try {
      await client.adminBilling.subscriptions.update(version.id, payload);
      close();
      onChanged(success);
    } catch (thrown) {
      // A transition the server refuses arrives here as its own sentence:
      // "only an active contract can be paused" is the server's call.
      setSubmitError(explain(thrown, fallback));
    } finally {
      setBusy(false);
    }
  };

  const submitAmendment = async (event: React.FormEvent) => {
    event.preventDefault();

    const errors: FieldErrors = {};

    if (!ISO_DATE.test(startDate.trim())) {
      errors.startDate = d.validation.startDateInvalid;
    }

    // The server requires the note (`billing-service.ts`), and the note is the
    // point of an amendment: it is what a future administrator reads to answer
    // why the terms changed. A blank one issues no request at all.
    if (!termsNote.trim()) errors.termsNote = d.validation.termsNoteRequired;

    const day = Number(dueDay.trim());
    if (!/^\d+$/.test(dueDay.trim()) || !Number.isInteger(day) || day < 1 || day > 28) {
      errors.dueDay = d.validation.dueDayInvalid;
    }

    if (!/^\d+$/.test(graceDays.trim())) {
      errors.graceDays = d.validation.graceDaysInvalid;
    }

    /**
     * With no resolved currency there is no recorded exponent, so a typed
     * amount cannot become minor units without assuming two decimal places —
     * the exact failure `money.tsx` exists to prevent. The amount is then left
     * out of the payload entirely and the server carries the current one over,
     * rather than being sent a guess.
     */
    let amountMinor: number | undefined;
    if (currency) {
      const converted = toMinorUnits(amount, currency.exponent);
      if (converted.ok) {
        amountMinor = converted.amountMinor;
      } else {
        const messages: Record<typeof converted.reason, string> = {
          empty: planDict.validation.amountEmpty,
          'not-a-number': planDict.validation.amountNotANumber,
          negative: planDict.validation.amountNegative,
          'too-precise': planDict.validation.amountTooPrecise(currency.exponent),
        };
        errors.amount = messages[converted.reason];
      }
    }

    setFieldErrors(errors);
    setSubmitError(null);
    if (Object.keys(errors).length > 0) return;

    const payload: AmendContractInput = {
      startDate: startDate.trim(),
      termsNote: termsNote.trim(),
      cycle,
      graceDays: Number(graceDays.trim()),
      dueDay: day,
      ...(amountMinor === undefined ? {} : { amountMinor }),
    };

    setBusy(true);
    try {
      await client.adminBilling.subscriptions.amend(version.id, payload);
      close();
      onChanged(d.amendSuccess);
    } catch (thrown) {
      // "only the active version of a contract can be amended" is the server's
      // sentence, and it names the status it found.
      setSubmitError(explain(thrown, d.amendError));
    } finally {
      setBusy(false);
    }
  };

  const confirmation = (
    title: string,
    body: string,
    confirmLabel: string,
    onConfirm: () => void,
    destructive: boolean,
    extra?: React.ReactNode,
  ) => (
    <div
      role="group"
      aria-label={title}
      className="mt-3 space-y-2 rounded-md border border-zinc-300 p-3 dark:border-zinc-700"
    >
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</p>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">{body}</p>
      {extra}
      {submitError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {submitError}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={close}>
          {d.keepButton}
        </Button>
        <Button
          type="button"
          variant={destructive ? 'danger' : 'primary'}
          size="sm"
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );

  return (
    <section className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {d.actionsHeading}
      </h4>

      {canCancel ? (
        <>
          <div className="mt-2 flex flex-wrap gap-2">
            {canPause && (
              <Button type="button" variant="secondary" size="sm" onClick={() => open('pause')}>
                {d.pauseButton}
              </Button>
            )}
            {canResume && (
              <Button type="button" variant="secondary" size="sm" onClick={() => open('resume')}>
                {d.resumeButton}
              </Button>
            )}
            {canAmend && (
              <Button type="button" variant="secondary" size="sm" onClick={() => open('amend')}>
                {d.amendButton}
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={() => open('cancel')}>
              {d.cancelButton}
            </Button>
          </div>

          {/*
            The two tools an administrator reaches for this section by mistake.
            Forgiving a debt is a waiver adjustment on the Ledger tab; stopping
            the reminders is a hold on the Students tab. Neither is pause and
            neither is cancel, so both are named here rather than left in a wiki.
          */}
          <div className="mt-2 space-y-1">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{d.holdPointer}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{d.waiverPointer}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{d.noAccessNote}</p>
          </div>
        </>
      ) : (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{d.closedNote}</p>
      )}

      {panel === 'pause' &&
        confirmation(
          d.pauseTitle,
          d.pauseBody,
          d.pauseConfirm,
          () => void changeLifecycle('pause', d.pauseSuccess, d.pauseError),
          false,
        )}

      {panel === 'resume' &&
        confirmation(
          d.resumeTitle,
          d.resumeBody,
          d.resumeConfirm,
          () => void changeLifecycle('resume', d.resumeSuccess, d.resumeError),
          false,
        )}

      {panel === 'cancel' &&
        confirmation(
          d.cancelTitle,
          d.cancelBody,
          d.cancelConfirm,
          () => void changeLifecycle('cancel', d.cancelSuccess, d.cancelError),
          true,
          <Input
            label={d.cancelEndDateLabel}
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            error={fieldErrors.endDate}
            helperText={d.cancelEndDateHelp}
          />,
        )}

      {panel === 'amend' && (
        <form
          onSubmit={submitAmendment}
          aria-label={d.amendTitle}
          className="mt-3 space-y-3 rounded-md border border-zinc-300 p-3 dark:border-zinc-700"
        >
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{d.amendTitle}</p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">{d.amendBody}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{d.amendPeriodNote}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{d.amendCurrencyNote}</p>

          <Input
            label={d.amendStartDateLabel}
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            error={fieldErrors.startDate}
            helperText={d.amendStartDateHelp}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label={d.amendAmountLabel(version.currency)}
              value={amount}
              inputMode="decimal"
              disabled={!currency}
              onChange={(event) => setAmount(event.target.value)}
              error={fieldErrors.amount}
              // Every field opens on the term in force, so the departure from it
              // is visible rather than implied.
              helperText={
                currency
                  ? d.currentValue(fromMinorUnits(version.amountMinor, currency.exponent))
                  : dict.admin.billing.money.resolveError
              }
            />

            <div className="flex flex-col gap-1">
              <label
                htmlFor={cycleId}
                className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]"
              >
                {d.amendCycleLabel}
              </label>
              <select
                id={cycleId}
                value={cycle}
                onChange={(event) => setCycle(event.target.value as BillingCycle)}
                className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                {CYCLES.map((value) => (
                  <option key={value} value={value}>
                    {planDict.cycle[value]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-[color:var(--text3)]">
                {d.currentValue(planDict.cycle[version.cycle])}
              </p>
            </div>

            <Input
              label={d.amendDueDayLabel}
              value={dueDay}
              inputMode="numeric"
              onChange={(event) => setDueDay(event.target.value)}
              error={fieldErrors.dueDay}
              helperText={d.amendDueDayHelp}
            />

            <Input
              label={d.amendGraceDaysLabel}
              value={graceDays}
              inputMode="numeric"
              onChange={(event) => setGraceDays(event.target.value)}
              error={fieldErrors.graceDays}
              helperText={d.currentValue(planDict.graceDaysValue(version.graceDays))}
            />
          </div>

          <label className="block" htmlFor={termsNoteId}>
            <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]">
              {d.amendNoteLabel}
            </span>
            <textarea
              id={termsNoteId}
              value={termsNote}
              onChange={(event) => setTermsNote(event.target.value)}
              rows={3}
              placeholder={d.amendNotePlaceholder}
              aria-describedby={fieldErrors.termsNote ? noteErrorId : undefined}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          {fieldErrors.termsNote && (
            <p id={noteErrorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
              {fieldErrors.termsNote}
            </p>
          )}

          {submitError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {submitError}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={close}>
              {d.keepButton}
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {d.amendSubmit}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
