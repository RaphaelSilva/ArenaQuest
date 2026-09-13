'use client';

import { useId, useState } from 'react';
import { Button } from '@web/components/design-system';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type { BillingInvoiceWithBalance } from '@web/lib/admin-billing-api';
import { explain } from './explain-error';

/**
 * Void an invoice — RFC 0013 §7.
 *
 * Voiding is one of the three corrections the append-only ledger offers, beside
 * a payment reversal and a further signed adjustment. It does not delete the
 * invoice: `billing-service.ts` stamps `voided_at` and keeps `void_reason`, so
 * the row stays in the history with the sentence that explains it.
 *
 * The reason is mandatory on the server (`voiding an invoice requires a
 * reason`), and this form refuses to submit without one rather than spending a
 * request to be told so.
 */
export function VoidInvoiceForm({
  invoice,
  onClose,
  onVoided,
}: {
  invoice: BillingInvoiceWithBalance;
  onClose: () => void;
  /** Called after the server accepted the void. */
  onVoided: () => void;
}) {
  const dict = useDict();
  const d = dict.admin.billing.ledger.voidInvoice;
  const client = useApiClient();

  const reasonId = useId();
  const reasonErrorId = useId();

  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setReasonError(d.reasonRequired);
      return;
    }

    setReasonError(null);
    setSubmitError(null);
    setBusy(true);
    try {
      await client.adminBilling.invoices.void(invoice.id, trimmed);
      onVoided();
    } catch (thrown) {
      setSubmitError(explain(thrown, d.error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={d.dialogTitle}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-lg border border-zinc-200 bg-white p-5 md:p-6 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{d.dialogTitle}</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.explainer}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {d.invoiceLine(invoice.id.slice(0, 8))}
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
            aria-describedby={reasonError ? reasonErrorId : undefined}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        {reasonError && (
          <p id={reasonErrorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
            {reasonError}
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
          <Button type="submit" variant="danger" size="md" disabled={busy}>
            {d.submit}
          </Button>
        </div>
      </form>
    </div>
  );
}
