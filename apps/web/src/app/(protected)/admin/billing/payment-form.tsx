'use client';

import { useId, useMemo, useState } from 'react';
import { PAYMENT_PROVIDER_NAMES } from '@arenaquest/shared/ports/i-payment-gateway';
import { Button, Input } from '@web/components/design-system';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { AdminBillingApiError } from '@web/lib/admin-billing-api';
import type {
  BillingRecordedEventChargePayment,
  BillingRecordedPayment,
  BillingReportCurrency,
  PaymentMethod,
  PayOption,
  PendingCheckout,
  RecordPaymentInput,
} from '@web/lib/admin-billing-api';
import type { LedgerTarget, LedgerTargetKind } from './ledger-target';
import { Money } from './money';
import { explain } from './explain-error';
import { fromMinorUnits, toMinorUnits } from './minor-units';
import { useExpiryFormatter, useProviderLabel } from './gateway-ui';

/** The six values `RecordPaymentBodySchema` accepts for `method`. */
const METHODS: readonly PaymentMethod[] = [
  'cash',
  'pix',
  'bank_transfer',
  'card',
  'gateway',
  'other',
];

type FieldErrors = { amount?: string; providerPaymentId?: string };

/**
 * What a caller may fill in before the form opens. The exceptions panel
 * (milestone decision 23, *match by hand*) opens this form with
 * `method: 'gateway'`, the provider and the provider's payment id taken from
 * the exception row, and the amount the provider captured.
 */
export type PaymentFormPrefill = {
  method?: PaymentMethod;
  /** A provider name (`mercadopago`, …); only read when the method is `gateway`. */
  provider?: string;
  /** The bare provider payment id — the part after `<provider>:`. */
  providerPaymentId?: string;
  /** Minor units; shown at the currency's exponent. */
  amountMinor?: number;
  /** `YYYY-MM-DD`. */
  paidAt?: string;
};

/** The row the API answered with, on either rail. */
export type RecordedPayment = BillingRecordedPayment | BillingRecordedEventChargePayment;

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
  kind = 'invoice',
  currency,
  payOptions,
  pendingCheckout = null,
  prefill,
  onClose,
  onRecorded,
  onReferenceExists,
}: {
  /** The invoice — or, with `kind="charge"`, the event charge — being paid. */
  invoice: LedgerTarget;
  kind?: LedgerTargetKind;
  currency: BillingReportCurrency | null;
  /**
   * The label's bound providers (`statement.payOptions`), offered when the
   * method is *Online*. Omitted or empty, every known provider is offered —
   * the API accepts any known provider name in a gateway reference, which is
   * what lets a payment of a since-retired provider be matched by hand.
   */
  payOptions?: readonly PayOption[];
  /**
   * The receivable's live hosted checkout, when it has one. The form warns and
   * still records: the student may well have paid at the door.
   */
  pendingCheckout?: PendingCheckout | null;
  /** Initial values; read once, when the form mounts. */
  prefill?: PaymentFormPrefill;
  onClose: () => void;
  /**
   * Called after the server accepted the payment, with the recorded row —
   * whose `pendingCheckout` says whether a hosted checkout is still open.
   */
  onRecorded: (recorded: RecordedPayment) => void;
  /**
   * Called when the provider reference is already on the ledger
   * (`409 PAYMENT_REFERENCE_EXISTS`), with the payment that carries it. The
   * form shows the message itself and stays open.
   */
  onReferenceExists?: (paymentId: string) => void;
}) {
  const dict = useDict();
  const d = dict.admin.billing.ledger.payment;
  const extras = dict.admin.billing.extras;
  const isCharge = kind === 'charge';
  const planValidation = dict.admin.billing.plans.validation;
  const methodLabels = dict.admin.billing.ledger.method;
  const g = dict.admin.billing.gateway.form;
  const client = useApiClient();
  const providerLabel = useProviderLabel();
  const formatWhen = useExpiryFormatter();

  const methodId = useId();
  const providerId = useId();
  const amountErrorId = useId();

  /**
   * Without a resolved currency there is no recorded exponent, so a typed
   * amount cannot become minor units without assuming two decimal places —
   * the exact failure `money.tsx` exists to prevent.
   */
  const exponent = currency?.exponent ?? null;

  /** Bound providers first, in the API's order; a prefilled one is always offered. */
  const providers = useMemo(() => {
    const bound = (payOptions ?? []).map((option) => option.provider as string);
    const base = bound.length > 0 ? bound : [...PAYMENT_PROVIDER_NAMES];
    return prefill?.provider && !base.includes(prefill.provider)
      ? [prefill.provider, ...base]
      : base;
  }, [payOptions, prefill?.provider]);

  const [amount, setAmount] = useState(() =>
    prefill?.amountMinor !== undefined && exponent !== null
      ? fromMinorUnits(prefill.amountMinor, exponent)
      : '',
  );
  const [method, setMethod] = useState<PaymentMethod>(prefill?.method ?? 'cash');
  const [paidAt, setPaidAt] = useState(prefill?.paidAt ?? '');
  const [externalReference, setExternalReference] = useState('');
  const [provider, setProvider] = useState(prefill?.provider ?? '');
  const [providerPaymentId, setProviderPaymentId] = useState(prefill?.providerPaymentId ?? '');

  const isGateway = method === 'gateway';
  /** The chosen provider, or the first offered while none was picked. */
  const chosenProvider = providers.includes(provider) ? provider : (providers[0] ?? '');

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

    // A gateway row is keyed on `<provider>:<id>` (RFC 0026 R9): the server
    // refuses anything else, and the form says so before spending a request.
    const trimmedPaymentId = providerPaymentId.trim();
    if (isGateway) {
      if (!trimmedPaymentId) {
        setFieldErrors({ providerPaymentId: g.paymentIdRequired });
        return;
      }
      if (/\s/.test(trimmedPaymentId)) {
        setFieldErrors({ providerPaymentId: g.paymentIdInvalid });
        return;
      }
    }

    setFieldErrors({});
    setSubmitError(null);

    const trimmedReference = isGateway
      ? `${chosenProvider}:${trimmedPaymentId}`
      : externalReference.trim();
    const payload: RecordPaymentInput = {
      amountMinor: converted.amountMinor,
      method,
      ...(paidAt.trim() ? { paidAt: paidAt.trim() } : {}),
      ...(trimmedReference ? { externalReference: trimmedReference } : {}),
    };

    setBusy(true);
    try {
      const recorded = isCharge
        ? await client.adminBilling.extras.addPayment(invoice.id, payload)
        : await client.adminBilling.invoices.addPayment(invoice.id, payload);
      onRecorded(recorded);
    } catch (thrown) {
      const existing = thrown instanceof AdminBillingApiError ? thrown.existingPaymentId : null;
      if (existing !== null) {
        // Nothing was written: the provider payment is already on the ledger.
        setSubmitError(g.duplicate(existing.slice(0, 8)));
        onReferenceExists?.(existing);
      } else {
        setSubmitError(explain(thrown, d.error));
      }
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
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {isCharge ? extras.paymentExplainer : d.explainer}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{d.noGateNote}</p>
        </div>

        {/* The invoice being paid, and the balance the server currently reports. */}
        <dl className="grid grid-cols-1 gap-3 rounded-md border border-zinc-200 p-3 sm:grid-cols-2 dark:border-zinc-800">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {isCharge ? extras.chargeLabel : d.invoiceLabel}
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

        {pendingCheckout && (
          <p
            role="note"
            data-testid="open-checkout-warning"
            className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
          >
            {g.openCheckoutWarning(formatWhen(pendingCheckout.expiresAt))}
          </p>
        )}

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
          A free-form bank identifier, omitted from the request when empty. The
          *Online* method replaces it with the provider and its payment id,
          which together are the row's reference (`<provider>:<id>`).
        */}
        {isGateway ? (
          <div className="space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-xs text-zinc-600 dark:text-zinc-400">{g.explainer}</p>
            <div className="flex flex-col gap-1">
              <label
                htmlFor={providerId}
                className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]"
              >
                {g.providerLabel}
              </label>
              <select
                id={providerId}
                value={chosenProvider}
                onChange={(event) => setProvider(event.target.value)}
                className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                {providers.map((name) => (
                  <option key={name} value={name}>
                    {providerLabel(name)}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label={g.paymentIdLabel}
              value={providerPaymentId}
              onChange={(event) => setProviderPaymentId(event.target.value)}
              error={fieldErrors.providerPaymentId}
              helperText={g.paymentIdHelp(chosenProvider)}
              autoComplete="off"
            />
          </div>
        ) : (
          <Input
            label={d.referenceLabel}
            value={externalReference}
            onChange={(event) => setExternalReference(event.target.value)}
            helperText={d.referenceHelp}
          />
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
