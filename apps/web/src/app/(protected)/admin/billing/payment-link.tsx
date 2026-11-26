'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@web/components/design-system';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { AdminBillingApiError } from '@web/lib/admin-billing-api';
import type {
  BillingReportCurrency,
  CheckoutSession,
  OnBehalfCheckoutErrorKind,
  PayOption,
  PendingCheckout,
} from '@web/lib/admin-billing-api';
import type { LedgerTargetKind } from './ledger-target';
import { Money } from './money';
import {
  useExpiryFormatter,
  useIsBillingAdmin,
  useMethodsLabel,
  useProviderLabel,
} from './gateway-ui';

/** The receivable a payment link is created for. */
export type PaymentLinkTarget = {
  id: string;
  /** The receivable's own student — only used to read the label's pay options. */
  userId: string;
  status: string;
  currency: string;
  balanceMinor: number;
};

type LinkProps = {
  kind: LedgerTargetKind;
  target: PaymentLinkTarget;
  currency: BillingReportCurrency | null;
  /**
   * `statement.payOptions` when the caller already holds a statement. Omitted,
   * the dialog reads them itself from the student's statement when it opens.
   */
  payOptions?: readonly PayOption[];
  pendingCheckout: PendingCheckout | null;
  /**
   * Called when the dialog closes after a link was created or handed back, so
   * the owner can re-read its pending flags. It is deliberately not called
   * while the dialog is open: a re-read that swaps the owner to a spinner
   * would unmount the dialog and lose the link the admin is about to copy.
   */
  onChanged?: () => void;
};

/**
 * *Payment link* on an open invoice or event charge (RFC 0026 §3, §7).
 *
 * Renders nothing for anyone but an `admin`, nothing for a receivable that is
 * not open with a balance — the API would answer `403` and
 * `409 RECEIVABLE_NOT_PAYABLE` respectively — and nothing on a label known to
 * offer no online method.
 */
export function PaymentLinkAction(props: LinkProps) {
  const dict = useDict();
  const g = dict.admin.billing.gateway.link;
  const isAdmin = useIsBillingAdmin();
  const [open, setOpen] = useState(false);

  const { kind, target, payOptions } = props;
  if (!isAdmin || target.status !== 'open' || target.balanceMinor <= 0) return null;
  // A label that offers nothing online (`PAYMENTS_PROVIDERS = none`, previews)
  // shows no link action at all — when the caller knows. A caller that holds
  // no statement leaves the question to the dialog, which then says so.
  if (payOptions !== undefined && payOptions.length === 0) return null;

  const reference = target.id.slice(0, 8);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={kind === 'charge' ? g.chargeAriaLabel(reference) : g.invoiceAriaLabel(reference)}
      >
        {g.button}
      </Button>
      {open && <PaymentLinkDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Only an http(s) URL is ever shown as a link to send. */
function hostedUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

type Created = { session: CheckoutSession; url: string; reused: boolean };

function PaymentLinkDialog({
  kind,
  target,
  currency,
  payOptions,
  pendingCheckout,
  onChanged,
  onClose,
}: LinkProps & { onClose: () => void }) {
  const dict = useDict();
  const g = dict.admin.billing.gateway.link;
  const client = useApiClient();
  const providerLabel = useProviderLabel();
  const methodsLabel = useMethodsLabel();
  const formatWhen = useExpiryFormatter();

  const urlId = useId();
  const urlRef = useRef<HTMLInputElement | null>(null);

  const [options, setOptions] = useState<readonly PayOption[] | null>(payOptions ?? null);
  const [provider, setProvider] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<OnBehalfCheckoutErrorKind | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copyState, setCopyState] = useState<'copied' | 'failed' | null>(null);

  // The pay options are the label's, and only a statement carries them.
  useEffect(() => {
    if (payOptions !== undefined) {
      setOptions(payOptions);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const statement = await client.adminBilling.students.statement(target.userId);
        if (!cancelled) setOptions(statement.payOptions ?? []);
      } catch {
        if (!cancelled) setOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, payOptions, target.userId]);

  // With several providers one must be named: start on the live checkout's
  // (asking again hands that same link back), else on the first offered.
  useEffect(() => {
    if (options === null || options.length === 0) return;
    setProvider((current) => {
      if (options.some((option) => option.provider === current)) return current;
      const live = options.find((option) => option.provider === pendingCheckout?.provider);
      return (live ?? options[0]).provider;
    });
  }, [options, pendingCheckout]);

  const close = () => {
    if (created !== null) onChanged?.();
    onClose();
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (options === null || options.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    setCopyState(null);
    try {
      // One offering provider: the API picks it, so none is named.
      const input = options.length === 1 ? {} : { provider };
      const result =
        kind === 'charge'
          ? await client.adminBilling.extras.createCheckout(target.id, input)
          : await client.adminBilling.invoices.createCheckout(target.id, input);
      const url = hostedUrl(result.session.url);
      if (url === null) {
        setError('unknown');
        return;
      }
      setCreated({ session: result.session, url, reused: result.reused });
    } catch (thrown) {
      setError(thrown instanceof AdminBillingApiError ? thrown.checkoutKind : 'unknown');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (created === null) return;
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(created.url);
      setCopyState('copied');
    } catch {
      // No clipboard (an insecure origin, a refused permission): leave the
      // link selected so one keystroke copies it.
      urlRef.current?.focus();
      urlRef.current?.select();
      setCopyState('failed');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={g.dialogTitle}
    >
      <form
        onSubmit={create}
        className="my-8 w-full max-w-lg space-y-4 rounded-lg border border-zinc-200 bg-white p-5 text-left md:p-6 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{g.dialogTitle}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{g.explainer}</p>
        </div>

        <dl className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {g.balanceLabel}
          </dt>
          <dd className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            <Money amountMinor={target.balanceMinor} currency={currency} code={target.currency} />
          </dd>
        </dl>

        {pendingCheckout && created === null && (
          <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
            {g.liveNote(formatWhen(pendingCheckout.expiresAt))}
          </p>
        )}

        {options === null ? (
          <p role="status" className="text-sm text-zinc-500">
            {g.loadingOptions}
          </p>
        ) : options.length === 0 ? (
          <p role="alert" className="text-sm text-zinc-700 dark:text-zinc-300">
            {g.noProvider}
          </p>
        ) : (
          created === null &&
          options.length > 1 && (
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]">
                {g.providerLegend}
              </legend>
              {options.map((option) => (
                <label
                  key={option.provider}
                  className="flex min-h-11 items-center gap-3 rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-800 dark:text-zinc-100"
                >
                  <input
                    type="radio"
                    name={`${urlId}-provider`}
                    value={option.provider}
                    checked={provider === option.provider}
                    onChange={() => setProvider(option.provider)}
                  />
                  {g.providerOption(providerLabel(option.provider), methodsLabel(option))}
                </label>
              ))}
            </fieldset>
          )
        )}

        {created !== null && (
          <div className="space-y-2">
            <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
              {created.reused ? g.reused : g.created}
            </p>
            <label
              htmlFor={urlId}
              className="block text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]"
            >
              {g.urlLabel}
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id={urlId}
                ref={urlRef}
                readOnly
                value={created.url}
                onFocus={(event) => event.currentTarget.select()}
                className="h-11 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-zinc-50 px-3 font-mono text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
              <Button type="button" variant="primary" size="md" onClick={() => void copy()}>
                {g.copy}
              </Button>
            </div>
            <p className="text-xs text-zinc-500">
              {g.expires(formatWhen(created.session.expiresAt))}
            </p>
            {copyState !== null && (
              <p
                role="status"
                className={
                  copyState === 'copied'
                    ? 'text-sm text-emerald-700 dark:text-emerald-400'
                    : 'text-sm text-amber-700 dark:text-amber-300'
                }
              >
                {copyState === 'copied' ? g.copied : g.copyFailed}
              </p>
            )}
          </div>
        )}

        {busy && (
          <p role="status" className="text-sm text-zinc-500">
            {g.creating}
          </p>
        )}

        {error !== null && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {g.errors[error]}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" size="md" onClick={close}>
            {g.close}
          </Button>
          {created === null && options !== null && options.length > 0 && (
            <Button type="submit" variant="primary" size="md" disabled={busy}>
              {g.create}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
