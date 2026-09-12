'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { Entities } from '@arenaquest/shared/types/entities';
import { Button, Input } from '@web/components/design-system';
import { Spinner } from '@web/components/spinner';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type {
  BillingCycle,
  BillingPlan,
  BillingReportCurrency,
  SignContractInput,
} from '@web/lib/admin-billing-api';
import { Money, useMoneyFormatter } from './money';
import { explain } from './explain-error';
import { fromMinorUnits, toMinorUnits } from './minor-units';

/**
 * A candidate for the picker, taken from the **admin user list**.
 *
 * It cannot come from the roster: `billing-service.ts` defines a roster line as
 * a student *with* a contract, so a student who holds none has no line at all
 * and a roster-built picker could never sign anyone's first contract. That is
 * the whole defect this screen exists to fix.
 */
export type SignableStudent = {
  id: string;
  name: string;
  email: string;
  status: Entities.Config.UserStatus;
};

/** The three values `SignContractBodySchema` accepts for `cycle`. */
const CYCLES: readonly BillingCycle[] = ['monthly', 'quarterly', 'yearly'];

type Mode = 'standard' | 'negotiated';

type FieldKey =
  | 'student'
  | 'plan'
  | 'dueDay'
  | 'startDate'
  | 'amount'
  | 'graceDays'
  | 'termsNote';

type FieldErrors = Partial<Record<FieldKey, string>>;

/**
 * Sign a contract — RFC 0013 §7, the admin write surface.
 *
 * Two modes of one form. **Standard** submits `{ userId, planId, dueDay,
 * startDate, termsSource: 'standard' }` and nothing else: `billing-service.ts`
 * refuses a non-negotiated request that carries an `amountMinor`, a `cycle` or
 * a `graceDays` differing from the plan, and then snapshots the plan's own
 * values itself. So "the plan's terms, unchanged" holds by construction rather
 * than by client discipline. **Negotiated** adds those three plus a `termsNote`
 * the server requires, and the form issues no request without it.
 *
 * The currency is deliberately not a control — re-denominating is a different
 * contract, not a negotiation — and nothing here computes a standing, a due
 * date's consequence or a grace outcome. The plan's grace days are shown as
 * the datum being recorded, and no more than that.
 */
export function SignContractDialog({
  students,
  currency,
  initialUserId,
  onClose,
  onSigned,
}: {
  students: readonly SignableStudent[];
  currency: BillingReportCurrency | null;
  /** Pre-selection when the dialog is opened from a student's statement. */
  initialUserId?: string | null;
  onClose: () => void;
  /** Called with the student's name after the server accepted the contract. */
  onSigned: (studentName: string) => void;
}) {
  const dict = useDict();
  const d = dict.admin.billing.sign;
  const planDict = dict.admin.billing.plans;
  const client = useApiClient();
  const formatMoney = useMoneyFormatter(currency);

  const searchId = useId();
  const pickerLabelId = useId();
  const planId = useId();
  const cycleId = useId();
  const modeLabelId = useId();
  const termsNoteId = useId();
  const noteErrorId = useId();
  const studentErrorId = useId();
  const planErrorId = useId();

  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState<string>(initialUserId ?? '');

  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState('');

  /**
   * Who already holds an active contract. Read from `subscriptions.list`
   * rather than from the roster, because the roster read may be narrowed by a
   * standing filter and this is exactly what `idx_subscriptions_one_active`
   * enforces. It marks the picker; it never decides anything.
   */
  const [contracted, setContracted] = useState<ReadonlySet<string>>(new Set());

  const [mode, setMode] = useState<Mode>('standard');
  const [dueDay, setDueDay] = useState('');
  const [startDate, setStartDate] = useState('');
  const [amount, setAmount] = useState('');
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [graceDays, setGraceDays] = useState('');
  const [termsNote, setTermsNote] = useState('');

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * An archived plan is not signable — that is what Task 09's archive control
   * means — so the catalogue is asked for the active plans only.
   */
  useEffect(() => {
    let cancelled = false;
    setPlansLoading(true);
    void (async () => {
      try {
        const data = await client.adminBilling.plans.list({ archived: false });
        if (!cancelled) {
          setPlans(data);
          setPlansError(null);
        }
      } catch {
        if (!cancelled) {
          setPlans([]);
          setPlansError(d.planLoadError);
        }
      } finally {
        if (!cancelled) setPlansLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, d.planLoadError]);

  // A failure here costs the courtesy marker and nothing else, so it is not
  // surfaced as an error: the database remains the authority on duplicates.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const active = await client.adminBilling.subscriptions.list({ status: 'active' });
        if (!cancelled) setContracted(new Set(active.map((row) => row.userId)));
      } catch {
        if (!cancelled) setContracted(new Set());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? null,
    [plans, selectedPlanId],
  );

  const selectedStudent = useMemo(
    () => students.find((student) => student.id === userId) ?? null,
    [students, userId],
  );

  /** Name and email, the two fields the access screen filters on. */
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return students;
    return students.filter(
      (student) =>
        student.name.toLowerCase().includes(needle) ||
        student.email.toLowerCase().includes(needle),
    );
  }, [students, search]);

  /**
   * With no resolved currency there is no recorded exponent, so a typed amount
   * cannot become minor units without assuming two decimal places — the exact
   * failure `money.tsx` exists to prevent. Negotiating is therefore disabled
   * rather than guessed. A standard signature still works: it submits no
   * amount at all.
   */
  const canNegotiate = currency !== null;

  /** Negotiated mode opens pre-filled from the plan, so the departure is visible. */
  const choosePlan = (id: string) => {
    setSelectedPlanId(id);
    setFieldErrors((current) => ({ ...current, plan: undefined }));
    const plan = plans.find((row) => row.id === id);
    if (!plan) return;
    setCycle(plan.cycle);
    setGraceDays(String(plan.graceDays));
    setAmount(currency ? fromMinorUnits(plan.amountMinor, currency.exponent) : '');
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    const errors: FieldErrors = {};
    if (!userId) errors.student = d.validation.studentRequired;
    if (!selectedPlan) errors.plan = d.validation.planRequired;

    const day = Number(dueDay.trim());
    if (!/^\d+$/.test(dueDay.trim()) || !Number.isInteger(day) || day < 1 || day > 28) {
      errors.dueDay = d.validation.dueDayInvalid;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate.trim())) {
      errors.startDate = d.validation.startDateInvalid;
    }

    const negotiated = mode === 'negotiated';
    let amountMinor = 0;

    if (negotiated) {
      // The server requires the note (`billing-service.ts:584`), and the note
      // is the point of the mode: it is what a future administrator reads to
      // answer why this student pays a different amount.
      if (!termsNote.trim()) errors.termsNote = d.validation.termsNoteRequired;

      if (!currency) {
        errors.amount = dict.admin.billing.money.resolveError;
      } else {
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

      if (!/^\d+$/.test(graceDays.trim())) {
        errors.graceDays = d.validation.graceDaysInvalid;
      }
    }

    setFieldErrors(errors);
    setSubmitError(null);
    if (Object.keys(errors).length > 0 || !selectedPlan) return;

    /**
     * The standard payload carries none of the three negotiable fields. It is
     * not that they happen to equal the plan's — they are absent, so the
     * server's own snapshot is the only thing that can define them.
     */
    const payload: SignContractInput = negotiated
      ? {
          userId,
          planId: selectedPlan.id,
          dueDay: day,
          startDate: startDate.trim(),
          termsSource: 'negotiated',
          amountMinor,
          cycle,
          graceDays: Number(graceDays.trim()),
          termsNote: termsNote.trim(),
        }
      : {
          userId,
          planId: selectedPlan.id,
          dueDay: day,
          startDate: startDate.trim(),
          termsSource: 'standard',
        };

    setBusy(true);
    try {
      await client.adminBilling.subscriptions.create(payload);
      onSigned(selectedStudent?.name ?? userId);
    } catch (thrown) {
      // A duplicate active contract arrives here as the server's own sentence.
      setSubmitError(explain(thrown, d.error));
    } finally {
      setBusy(false);
    }
  };

  const planAmountLabel = (plan: BillingPlan) => formatMoney(plan.amountMinor, plan.currency);

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
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.dialogExplainer}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{d.noAccessNote}</p>
        </div>

        {/* ---------------------------------------------------------------
            Student — the admin user list, never the roster.
            --------------------------------------------------------------- */}
        <section className="space-y-2">
          <h3
            id={pickerLabelId}
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-50"
          >
            {d.studentHeading}
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{d.firstPageNotice}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{d.alreadyContractedNote}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{d.notActiveNote}</p>

          <Input
            id={searchId}
            type="search"
            label={d.searchLabel}
            placeholder={d.searchPlaceholder}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          {visible.length === 0 ? (
            <p className="py-4 text-center text-sm text-zinc-500">{d.studentEmpty}</p>
          ) : (
            <div
              role="radiogroup"
              aria-labelledby={pickerLabelId}
              aria-describedby={fieldErrors.student ? studentErrorId : undefined}
              className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-zinc-200 p-2 dark:border-zinc-800"
            >
              {visible.map((student) => (
                <label
                  key={student.id}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <input
                    type="radio"
                    name="sign-contract-student"
                    value={student.id}
                    checked={userId === student.id}
                    onChange={() => {
                      setUserId(student.id);
                      setFieldErrors((current) => ({ ...current, student: undefined }));
                    }}
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-zinc-900 dark:text-zinc-100">
                      {student.name}
                    </span>
                    <span className="block truncate text-xs text-zinc-500">{student.email}</span>
                    {contracted.has(student.id) && (
                      <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">
                        {d.alreadyContracted}
                      </span>
                    )}
                    {/*
                      §4.3 — a non-active account is marked, never filtered out:
                      the API forbids signing for none of the statuses, and one
                      translated hint avoids importing the status taxonomy into
                      this dictionary.
                    */}
                    {student.status !== Entities.Config.UserStatus.ACTIVE && (
                      <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                        {d.notActive}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}

          {fieldErrors.student && (
            <p id={studentErrorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
              {fieldErrors.student}
            </p>
          )}
        </section>

        {/* ---------------------------------------------------------------
            Plan, and the terms the contract will record.
            --------------------------------------------------------------- */}
        <section className="space-y-2">
          <div className="flex flex-col gap-1">
            <label
              htmlFor={planId}
              className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]"
            >
              {d.planLabel}
            </label>
            <select
              id={planId}
              value={selectedPlanId}
              disabled={plansLoading || plans.length === 0}
              aria-describedby={fieldErrors.plan ? planErrorId : undefined}
              onChange={(event) => choosePlan(event.target.value)}
              className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <option value="">{d.planPlaceholder}</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </div>

          {plansLoading ? (
            <div className="flex justify-center py-4">
              <Spinner className="h-5 w-5 text-zinc-400" />
            </div>
          ) : plansError ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {plansError}
            </p>
          ) : plans.length === 0 ? (
            <p className="text-sm text-zinc-500">{d.planEmpty}</p>
          ) : null}

          {fieldErrors.plan && (
            <p id={planErrorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
              {fieldErrors.plan}
            </p>
          )}

          {selectedPlan && (
            <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {d.termsHeading}
              </h3>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {d.termsSnapshotNote}
              </p>
              <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    {d.termsAmount}
                  </dt>
                  <dd className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    <Money
                      amountMinor={selectedPlan.amountMinor}
                      currency={currency}
                      code={selectedPlan.currency}
                    />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    {d.termsCycle}
                  </dt>
                  <dd className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {planDict.cycle[selectedPlan.cycle]}
                  </dd>
                </div>
                <div>
                  {/*
                    The recorded grace days, shown as the datum being written.
                    Nothing on this screen derives a due date, a standing or a
                    grace outcome from it — that resolution lives on the server,
                    where a hold can reach it.
                  */}
                  <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    {d.termsGraceDays}
                  </dt>
                  <dd className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {planDict.graceDaysValue(selectedPlan.graceDays)}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </section>

        {/* ---------------------------------------------------------------
            Billing day and start date — submitted in both modes.
            --------------------------------------------------------------- */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label={d.dueDayLabel}
            value={dueDay}
            inputMode="numeric"
            onChange={(event) => setDueDay(event.target.value)}
            error={fieldErrors.dueDay}
            helperText={d.dueDayHelp}
          />
          <Input
            label={d.startDateLabel}
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            error={fieldErrors.startDate}
            helperText={d.startDateHelp}
          />
        </div>

        {/* ---------------------------------------------------------------
            Mode. Negotiated is a deliberate second mode, never the default.
            --------------------------------------------------------------- */}
        <section className="space-y-2">
          <h3
            id={modeLabelId}
            className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]"
          >
            {d.modeLabel}
          </h3>
          <div role="radiogroup" aria-labelledby={modeLabelId} className="space-y-1">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-900 dark:text-zinc-100">
              <input
                type="radio"
                name="sign-contract-mode"
                value="standard"
                checked={mode === 'standard'}
                onChange={() => setMode('standard')}
              />
              {d.modeStandard}
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-900 dark:text-zinc-100">
              <input
                type="radio"
                name="sign-contract-mode"
                value="negotiated"
                checked={mode === 'negotiated'}
                disabled={!canNegotiate}
                onChange={() => setMode('negotiated')}
              />
              {d.modeNegotiated}
            </label>
          </div>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {mode === 'negotiated' ? d.negotiatedNote : d.standardNote}
          </p>

          {!canNegotiate && (
            <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">
              {dict.admin.billing.money.resolveError}
            </p>
          )}
        </section>

        {mode === 'negotiated' && (
          <section className="space-y-4 rounded-md border border-amber-300 p-3 dark:border-amber-800">
            {/*
              No currency control exists here on purpose: `billing-service.ts`
              snapshots the plan's currency and says why — re-denominating is
              not a negotiation, it is a different contract.
            */}
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              {d.currencyNotNegotiableNote}
            </p>

            <Input
              label={d.amountLabel(selectedPlan?.currency ?? currency?.code ?? '')}
              value={amount}
              inputMode="decimal"
              onChange={(event) => setAmount(event.target.value)}
              error={fieldErrors.amount}
              // Every override is shown against the plan's own value, so the
              // departure is visible rather than implied.
              helperText={
                selectedPlan
                  ? d.planValue(planAmountLabel(selectedPlan))
                  : planDict.form.amountHelp(currency?.exponent ?? 0)
              }
            />

            <div className="flex flex-col gap-1">
              <label
                htmlFor={cycleId}
                className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]"
              >
                {d.cycleLabel}
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
              {selectedPlan && (
                <p className="text-xs text-[color:var(--text3)]">
                  {d.planValue(planDict.cycle[selectedPlan.cycle])}
                </p>
              )}
            </div>

            <Input
              label={d.graceDaysLabel}
              value={graceDays}
              inputMode="numeric"
              onChange={(event) => setGraceDays(event.target.value)}
              error={fieldErrors.graceDays}
              helperText={
                selectedPlan
                  ? d.planValue(planDict.graceDaysValue(selectedPlan.graceDays))
                  : undefined
              }
            />

            <label className="block" htmlFor={termsNoteId}>
              <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]">
                {d.termsNoteLabel}
              </span>
              <textarea
                id={termsNoteId}
                value={termsNote}
                onChange={(event) => setTermsNote(event.target.value)}
                rows={3}
                placeholder={d.termsNotePlaceholder}
                aria-describedby={fieldErrors.termsNote ? noteErrorId : undefined}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            {fieldErrors.termsNote && (
              <p id={noteErrorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
                {fieldErrors.termsNote}
              </p>
            )}
          </section>
        )}

        {submitError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {submitError}
          </p>
        )}

        <div className="flex justify-end gap-3">
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
