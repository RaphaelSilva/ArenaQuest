'use client';

import { useId, useMemo, useState } from 'react';
import { Button, Input } from '@web/components/design-system';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type {
  AdjustmentKind,
  ApplyAdjustmentInput,
  BillingInvoiceWithBalance,
  BillingReportCurrency,
} from '@web/lib/admin-billing-api';
import { useMoneyFormatter } from './money';
import { explain } from './explain-error';
import { toMinorUnits } from './minor-units';

/** The four values `ApplyAdjustmentBodySchema` accepts for `kind`. */
const KINDS: readonly AdjustmentKind[] = ['discount', 'credit', 'waiver', 'surcharge'];

/**
 * The sign the kind implies, and the whole reason this form takes a magnitude.
 *
 * `apps/api/src/routes/admin/billing.ts` documents an adjustment's
 * `amountMinor` as "signed and never zero; negative reduces what is owed", and
 * `accounting-service.ts` adds it straight into the balance. **The API does not
 * validate the sign against the kind** — `kind` is a label, the sign is what
 * moves the money. A positive amount on a `discount` would therefore *increase*
 * the student's debt under a row reading "Discount", with no error anywhere.
 *
 * So the sign is derived here and never typed: `surcharge` is the only kind
 * that adds to what is owed, and a mislabelled row becomes structurally
 * impossible rather than a matter of administrator care.
 */
function signFor(kind: AdjustmentKind): 1 | -1 {
  return kind === 'surcharge' ? 1 : -1;
}

type FieldErrors = { amount?: string; reason?: string };

/**
 * Apply an adjustment to an invoice — RFC 0013 §7.
 *
 * Each kind's effect on the balance is stated in the administrator's language
 * rather than assumed to be known, and the signed value that will be written is
 * shown before submission.
 *
 * **A surcharge is hand-applied only.** There is no percentage control and no
 * recurring-charge control here or anywhere else on the tab: nothing accrues,
 * schedules, suggests or computes a late fee, and the scheduled run writes no
 * adjustment of any kind.
 */
export function AdjustmentForm({
  invoice,
  currency,
  onClose,
  onApplied,
}: {
  invoice: BillingInvoiceWithBalance;
  currency: BillingReportCurrency | null;
  onClose: () => void;
  /** Called after the server accepted the adjustment. */
  onApplied: () => void;
}) {
  const dict = useDict();
  const d = dict.admin.billing.ledger.adjustment;
  const kindLabels = dict.admin.billing.ledger.adjustmentKind;
  const planValidation = dict.admin.billing.plans.validation;
  const client = useApiClient();
  const formatMoneyValue = useMoneyFormatter(currency);

  const kindLabelId = useId();
  const reasonId = useId();
  const reasonErrorId = useId();

  const [kind, setKind] = useState<AdjustmentKind>('discount');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const exponent = currency?.exponent ?? null;

  /**
   * The signed value exactly as it will be posted, so the direction is read on
   * screen and not inferred. `null` while the typed magnitude is not yet a
   * usable amount — nothing is guessed into the preview.
   */
  const signed = useMemo(() => {
    if (exponent === null) return null;
    const converted = toMinorUnits(amount, exponent);
    if (!converted.ok || converted.amountMinor === 0) return null;
    return signFor(kind) * converted.amountMinor;
  }, [amount, exponent, kind]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    const errors: FieldErrors = {};

    if (exponent === null) {
      errors.amount = dict.admin.billing.money.resolveError;
    } else {
      const converted = toMinorUnits(amount, exponent);
      if (!converted.ok) {
        const messages: Record<typeof converted.reason, string> = {
          empty: planValidation.amountEmpty,
          'not-a-number': planValidation.amountNotANumber,
          negative: planValidation.amountNegative,
          'too-precise': planValidation.amountTooPrecise(exponent),
        };
        errors.amount = messages[converted.reason];
      } else if (converted.amountMinor === 0) {
        // `billing-service.ts` refuses a zero adjustment: it would be a row
        // that moves nothing while claiming to.
        errors.amount = d.validation.amountZero;
      }
    }

    // The reason is what a future administrator reads to answer why the balance
    // is not the contract's amount, so the form issues no request without it.
    if (!reason.trim()) errors.reason = d.reasonRequired;

    setFieldErrors(errors);
    setSubmitError(null);
    if (Object.keys(errors).length > 0 || exponent === null) return;

    const magnitude = toMinorUnits(amount, exponent);
    if (!magnitude.ok) return;

    const payload: ApplyAdjustmentInput = {
      kind,
      amountMinor: signFor(kind) * magnitude.amountMinor,
      reason: reason.trim(),
    };

    setBusy(true);
    try {
      await client.adminBilling.invoices.addAdjustment(invoice.id, payload);
      onApplied();
    } catch (thrown) {
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
        className="my-8 w-full max-w-lg space-y-4 rounded-lg border border-zinc-200 bg-white p-5 md:p-6 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {d.dialogTitle}
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.explainer}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{d.manualOnlyNote}</p>
        </div>

        {/* ---------------------------------------------------------------
            Kind, with what each one does to the balance spelled out.
            --------------------------------------------------------------- */}
        <section className="space-y-2">
          <h3
            id={kindLabelId}
            className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]"
          >
            {d.kindLabel}
          </h3>
          <div role="radiogroup" aria-labelledby={kindLabelId} className="space-y-1">
            {KINDS.map((value) => (
              <label
                key={value}
                className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-sm text-zinc-900 dark:text-zinc-100"
              >
                <input
                  type="radio"
                  name="billing-adjustment-kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                  className="mt-1"
                />
                <span className="min-w-0">
                  <span className="block font-medium">{kindLabels[value]}</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                    {d.kindEffect[value]}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------
            A magnitude, always positive. The sign belongs to the kind.
            --------------------------------------------------------------- */}
        <Input
          label={d.amountLabel(invoice.currency)}
          value={amount}
          inputMode="decimal"
          onChange={(event) => setAmount(event.target.value)}
          error={fieldErrors.amount}
          helperText={exponent === null ? d.magnitudeHelp : d.amountHelp(exponent)}
        />

        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          {signed === null
            ? d.directionPending(
                signFor(kind) === 1 ? d.directionIncreases : d.directionReduces,
              )
            : d.signedPreview(formatMoneyValue(signed, invoice.currency))}
        </p>

        <label className="block" htmlFor={reasonId}>
          <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]">
            {d.reasonLabel}
          </span>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder={d.reasonPlaceholder}
            aria-describedby={fieldErrors.reason ? reasonErrorId : undefined}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        {fieldErrors.reason && (
          <p id={reasonErrorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
            {fieldErrors.reason}
          </p>
        )}

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
