'use client';

import { useState } from 'react';
import { Button } from '@web/components/design-system';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type { LedgerTargetKind } from './ledger-target';

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
 */
export function ReversePaymentForm({
  paymentId,
  kind = 'invoice',
  onClose,
  onReversed,
}: {
  paymentId: string;
  kind?: LedgerTargetKind;
  onClose: () => void;
  /** Called after the server accepted the reversal. */
  onReversed: () => void | Promise<void>;
}) {
  const dict = useDict();
  const d = dict.admin.billing.ledger;
  const client = useApiClient();

  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = reason.trim();
    // The mirror entry carries the reason forever, and an unexplained one is
    // worse than none.
    if (!trimmed) {
      setError(d.reverseReasonRequired);
      return;
    }
    setBusy(true);
    try {
      if (kind === 'charge') {
        await client.adminBilling.extras.reversePayment(paymentId, { reason: trimmed });
      } else {
        await client.adminBilling.payments.reverse(paymentId, { reason: trimmed });
      }
      setError(null);
      await onReversed();
    } catch {
      setError(d.reverseError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={d.reverseDialogTitle}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {d.reverseDialogTitle}
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.reverseExplainer}</p>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]">
            {d.reverseReasonLabel}
          </span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder={d.reverseReasonPlaceholder}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            {d.reverseCancel}
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={busy}>
            {d.reverseSubmit}
          </Button>
        </div>
      </form>
    </div>
  );
}
