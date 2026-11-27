'use client';

import { useId, useState } from 'react';
import { splitGatewayReference } from '@arenaquest/shared/domain/billing/gateway-money';
import { Button } from '@web/components/design-system';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { AdminBillingApiError, refundOutcomeOf } from '@web/lib/admin-billing-api';
import type { BillingReportCurrency, PaymentMethod } from '@web/lib/admin-billing-api';
import type { LedgerTargetKind } from './ledger-target';
import { useMoneyFormatter } from './money';
import { useProviderLabel } from './gateway-ui';

/** What the form needs to know about the row to tell a refund from a reversal. */
export type ReversiblePayment = {
  method: PaymentMethod;
  amountMinor: number;
  currency: string;
  externalReference: string | null;
};

/**
 * Reverse a payment — RFC 0013 §7, reused for event charges (RFC 0015 §8).
 *
 * Nothing is deleted: the server appends the mirror-image row under the
 * original, with the author and the reason typed here. The reason is mandatory
 * on the server and the form refuses to submit without one.
 *
 * `kind` only picks the endpoint: an invoice payment reverses through
 * `/payments/{id}/reverse`, an event-charge payment through
 * `/charge-payments/{id}/reverse`. The two ledgers are never mixed.
 *
 * **A gateway row is a refund (RFC 0026 §5, §7).** The same request asks the
 * provider to return the money first and writes the reversal only when the
 * provider accepts, so the dialog says so in words — which provider, how much
 * — and takes an explicit confirmation the plain reversal does not have.
 * Every answer has its own message; the one that matters most is *accepted
 * but not recorded*: the money did move, and *Try again* repeats the very
 * same request, which records it and cannot refund twice. *The provider is
 * busy* (a rate limit or a timeout: nothing was written) gets the same
 * *Try again*, for the same reason — the repeat is the identical request.
 */
export function ReversePaymentForm({
  paymentId,
  payment,
  currency = null,
  kind = 'invoice',
  onClose,
  onReversed,
}: {
  paymentId: string;
  /** The row being reversed. Omitted, the form is the plain reversal. */
  payment?: ReversiblePayment;
  /** The console's display currency, to state the refunded amount. */
  currency?: BillingReportCurrency | null;
  kind?: LedgerTargetKind;
  onClose: () => void;
  /**
   * Called after the server accepted the reversal. For a gateway refund it
   * carries the sentence to show (accepted, or already refunded).
   */
  onReversed: (message?: string) => void | Promise<void>;
}) {
  const dict = useDict();
  const d = dict.admin.billing.ledger;
  const g = dict.admin.billing.gateway.refund;
  const client = useApiClient();
  const formatMoney = useMoneyFormatter(currency);
  const providerLabel = useProviderLabel();
  const confirmId = useId();

  const isGateway = payment?.method === 'gateway';
  const split = isGateway ? splitGatewayReference(payment.externalReference) : null;
  // A gateway row whose reference cannot be split still names *a* provider.
  const provider = split ? providerLabel(split.provider) : d.method.gateway;
  const amount = payment ? formatMoney(payment.amountMinor, payment.currency) : '';

  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The answer asks for the very same request again: the provider returned the
   * money and the ledger does not say so yet, or the provider was busy.
   */
  const [retryable, setRetryable] = useState(false);
  const [busy, setBusy] = useState(false);

  const explainRefusal = (thrown: unknown): string => {
    if (!(thrown instanceof AdminBillingApiError)) return g.outcomes.unknown;
    switch (thrown.refundKind) {
      case 'refused':
        return thrown.detailMessage
          ? g.outcomes.refusedDetail(provider, thrown.detailMessage)
          : g.outcomes.refused(provider);
      case 'provider_not_enabled':
        return g.outcomes.providerNotEnabled(provider);
      case 'unrecorded':
        return g.outcomes.unrecorded(provider, thrown.refundId ?? '');
      case 'provider_busy':
        return g.outcomes.providerBusy(provider);
      case 'configuration':
        return g.outcomes.configuration;
      case 'provider_unavailable':
        return g.outcomes.providerUnavailable(provider);
      case 'conflict':
        return thrown.detailMessage ?? g.outcomes.conflict;
      default:
        return thrown.detailMessage ?? g.outcomes.unknown;
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = reason.trim();
    // The mirror entry carries the reason forever, and an unexplained one is
    // worse than none.
    if (!trimmed) {
      setError(d.reverseReasonRequired);
      return;
    }
    if (isGateway && !confirmed) {
      setError(g.confirmRequired);
      return;
    }
    setBusy(true);
    try {
      const reversal =
        kind === 'charge'
          ? await client.adminBilling.extras.reversePayment(paymentId, { reason: trimmed })
          : await client.adminBilling.payments.reverse(paymentId, { reason: trimmed });
      setError(null);
      setRetryable(false);
      if (isGateway) {
        const outcome = refundOutcomeOf(reversal);
        await onReversed(
          outcome === 'already_refunded'
            ? g.outcomes.alreadyRefunded(provider)
            : g.outcomes.accepted(provider),
        );
      } else {
        await onReversed();
      }
    } catch (thrown) {
      if (isGateway) {
        setRetryable(
          thrown instanceof AdminBillingApiError &&
            (thrown.refundKind === 'unrecorded' || thrown.refundKind === 'provider_busy'),
        );
        setError(explainRefusal(thrown));
      } else {
        setError(d.reverseError);
      }
    } finally {
      setBusy(false);
    }
  };

  const title = isGateway ? g.dialogTitle : d.reverseDialogTitle;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-lg border border-zinc-200 bg-white p-5 md:p-6 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        {isGateway ? (
          <>
            <p
              data-testid="refund-confirmation"
              className="rounded-md bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
            >
              {g.explainer(provider, amount)}
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{g.fullOnly}</p>
          </>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.reverseExplainer}</p>
        )}
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]">
            {d.reverseReasonLabel}
          </span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder={d.reverseReasonPlaceholder}
            // The retry must be the same request.
            readOnly={retryable}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        {isGateway && (
          <label
            htmlFor={confirmId}
            className="flex min-h-11 items-start gap-3 text-sm text-zinc-900 dark:text-zinc-100"
          >
            <input
              id={confirmId}
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-1 h-4 w-4"
            />
            {g.confirmLabel(provider, amount)}
          </label>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            {d.reverseCancel}
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={busy}>
            {isGateway ? (retryable ? g.retry : g.submit) : d.reverseSubmit}
          </Button>
        </div>
      </form>
    </div>
  );
}
