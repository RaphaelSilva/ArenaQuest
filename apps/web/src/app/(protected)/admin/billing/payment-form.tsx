'use client';

import { useId, useState } from 'react';
import { Button, Input } from '@web/components/design-system';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type {
  BillingInvoiceWithBalance,
  BillingReportCurrency,
  PaymentMethod,
  RecordPaymentInput,
} from '@web/lib/admin-billing-api';
import { Money } from './money';
import { explain } from './explain-error';
import { toMinorUnits } from './minor-units';

/** The six values `RecordPaymentBodySchema` accepts for `method`. */
const METHODS: readonly PaymentMethod[] = [
  'cash',
  'pix',
  'bank_transfer',
  'card',
  'gateway',
  'other',
];

type FieldErrors = { amount?: string };

/**
 * Record a payment on an invoice — RFC 0013 §7, the admin write surface.
 *
 * The one the dojo needs most often: money arrives as cash, a transfer or a Pix
 * in the instructor's own bank, and the ledger only agrees with reality once an
 * administrator can enter it.
 *
 * Three things this form deliberately does not do:
 *
 * - **It never sends a currency.** `billing-service.ts` refuses a payment whose
 *   currency differs from the invoice's and records the invoice's own code, so
 *   omitting the field makes a mismatch unreachable rather than merely unlikely.
 * - **It never previews the resulting status or balance.** An invoice's status
 *   is the server's cache of "balance reached zero"; the caller refreshes the
 *   list after the write and renders what came back.
 * - **It gates nothing.** Recording a payment, or failing to, changes nothing
 *   about what the student can see.
 *
 * The amount is converted to an integer count of minor units at the currency's
 * recorded exponent through `./minor-units`, so no float ever touches it.
 */
export function PaymentForm({
  invoice,
  currency,
  onClose,
  onRecorded,
}: {
  invoice: BillingInvoiceWithBalance;
  currency: BillingReportCurrency | null;
  onClose: () => void;
  /** Called after the server accepted the payment. */
  onRecorded: () => void;
}) {
  const dict = useDict();
  const d = dict.admin.billing.ledger.payment;
  const planValidation = dict.admin.billing.plans.validation;
  const methodLabels = dict.admin.billing.ledger.method;
  const client = useApiClient();

  const methodId = useId();
  const amountErrorId = useId();

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [paidAt, setPaidAt] = useState('');
  const [externalReference, setExternalReference] = useState('');

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Without a resolved currency there is no recorded exponent, so a typed
   * amount cannot become minor units without assuming two decimal places —
   * the exact failure `money.tsx` exists to prevent.
   */
  const exponent = currency?.exponent ?? null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (exponent === null) {
      setFieldErrors({ amount: dict.admin.billing.money.resolveError });
      return;
    }

    const converted = toMinorUnits(amount, exponent);
    if (!converted.ok) {
      const messages: Record<typeof converted.reason, string> = {
        empty: planValidation.amountEmpty,
        'not-a-number': planValidation.amountNotANumber,
        negative: planValidation.amountNegative,
        'too-precise': planValidation.amountTooPrecise(exponent),
      };
      setFieldErrors({ amount: messages[converted.reason] });
      return;
    }

    // The server refuses a non-positive payment and says to undo one with a
    // reversal instead; the form says the same thing before spending a request.
    if (converted.amountMinor === 0) {
      setFieldErrors({ amount: d.validation.amountZero });
      return;
    }

    setFieldErrors({});
    setSubmitError(null);

    const trimmedReference = externalReference.trim();
    const payload: RecordPaymentInput = {
      amountMinor: converted.amountMinor,
      method,
      ...(paidAt.trim() ? { paidAt: paidAt.trim() } : {}),
      ...(trimmedReference ? { externalReference: trimmedReference } : {}),
    };

    setBusy(true);
    try {
      await client.adminBilling.invoices.addPayment(invoice.id, payload);
      onRecorded();
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
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{d.noGateNote}</p>
        </div>

        {/* The invoice being paid, and the balance the server currently reports. */}
        <dl className="grid grid-cols-1 gap-3 rounded-md border border-zinc-200 p-3 sm:grid-cols-2 dark:border-zinc-800">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {d.invoiceLabel}
            </dt>
            <dd className="font-mono text-sm text-zinc-900 dark:text-zinc-50">
              {invoice.id.slice(0, 8)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {d.balanceLabel}
            </dt>
            <dd className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              <Money
                amountMinor={invoice.balanceMinor}
                currency={currency}
                code={invoice.currency}
              />
            </dd>
          </div>
        </dl>

        <Input
          label={d.amountLabel(invoice.currency)}
          value={amount}
          inputMode="decimal"
          onChange={(event) => setAmount(event.target.value)}
          error={fieldErrors.amount}
          aria-describedby={fieldErrors.amount ? amountErrorId : undefined}
          helperText={exponent === null ? undefined : d.amountHelp(exponent)}
        />

        <div className="flex flex-col gap-1">
          <label
            htmlFor={methodId}
            className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]"
          >
            {d.methodLabel}
          </label>
          <select
            id={methodId}
            value={method}
            onChange={(event) => setMethod(event.target.value as PaymentMethod)}
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          >
            {METHODS.map((value) => (
              <option key={value} value={value}>
                {methodLabels[value]}
              </option>
            ))}
          </select>
        </div>

        <Input
          label={d.paidAtLabel}
          type="date"
          value={paidAt}
          onChange={(event) => setPaidAt(event.target.value)}
          helperText={d.paidAtHelp}
        />

        {/*
          Where a future provider's charge id will land. An administrator
          recording cash leaves it empty, and an empty field is omitted from the
          request rather than sent as an empty string.
        */}
        <Input
          label={d.referenceLabel}
          value={externalReference}
          onChange={(event) => setExternalReference(event.target.value)}
          helperText={d.referenceHelp}
        />

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
