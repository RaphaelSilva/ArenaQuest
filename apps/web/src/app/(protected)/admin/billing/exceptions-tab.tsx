'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { providerDashboardUrl } from '@arenaquest/shared/domain/billing/gateway-money';
import { Button } from '@web/components/design-system';
import { Spinner } from '@web/components/spinner';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { AdminBillingApiError } from '@web/lib/admin-billing-api';
import type {
  BillingReportCurrency,
  PaymentException,
  PaymentExceptionKind,
  ReconcilePaymentsRun,
  ReconcilePaymentsSummary,
} from '@web/lib/admin-billing-api';
import {
  DismissExceptionDialog,
  MatchExceptionDialog,
  RefundExceptionDialog,
  hasLedgerRow,
  shortRef,
  type LedgerDestination,
  type MatchableStudent,
} from './exception-dialogs';
import {
  GatewayReference,
  useExpiryFormatter,
  useIsBillingAdmin,
  useProviderLabel,
} from './gateway-ui';
import { useMoneyFormatter } from './money';

/**
 * The payment exceptions tab (RFC 0026 §7, R14): everything the gateway could
 * not settle by itself — orphan payments, mismatches, notifications that keep
 * failing or never finished, and disputes — oldest first, each with what is
 * known about it and its three ways out.
 *
 * This is the whole "admin alert" of v1 (milestone decision 26): a row here
 * and a count in the reconcile summary; nothing is e-mailed or pushed.
 *
 * Two things it never does: it never shows an amount for an orphan (the API
 * knows none, and a figure invented here would be read as money), and it
 * never calls a refund endpoint (decision 23).
 */

const KIND_TONE: Record<PaymentExceptionKind, string> = {
  orphan: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200',
  mismatch: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  received: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  dispute: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

/** The seven figures an admin reads first; the rest sit behind "All counts". */
function headline(summary: ReconcilePaymentsSummary) {
  return {
    confirmed: summary.checkoutsAsked,
    landed: summary.landed,
    expired: summary.expired,
    deferred: summary.checkoutsDeferred + summary.eventsDeferred,
    retried: summary.eventsRetried,
    stale: summary.staleOrphans + summary.staleMismatches,
    unreachable: summary.unreachable,
  };
}

const HEADLINE_KEYS = [
  'confirmed',
  'landed',
  'expired',
  'deferred',
  'retried',
  'stale',
  'unreachable',
] as const;

const COUNT_KEYS = [
  'checkoutsDue',
  'checkoutsAsked',
  'landed',
  'expired',
  'stillOpen',
  'abandoned',
  'unreachable',
  'mismatched',
  'checkoutErrors',
  'checkoutsDeferred',
  'eventsDue',
  'eventsRetried',
  'eventsSettled',
  'eventsFailed',
  'eventsDeferred',
  'staleOrphans',
  'staleMismatches',
] as const satisfies readonly (keyof ReconcilePaymentsSummary)[];

type ReconcileResult =
  | { state: 'done'; run: ReconcilePaymentsRun }
  | { state: 'note'; message: string }
  | { state: 'error'; message: string };

type Draft = { action: 'match' | 'refund' | 'dismiss'; exception: PaymentException };

export function ExceptionsTab({
  currency,
  nameOf,
  students,
  onCountChange,
  onOpenLedger,
}: {
  currency: BillingReportCurrency | null;
  nameOf: (userId: string) => string;
  students: readonly MatchableStudent[];
  /** The tab badge follows the list this tab last read. */
  onCountChange?: (count: number) => void;
  /** *Refund* on a landed payment: go to the entry whose reversal is the refund. */
  onOpenLedger: (destination: LedgerDestination) => void;
}) {
  const dict = useDict();
  const x = dict.admin.billing.gateway.exceptions;
  const client = useApiClient();
  const isAdmin = useIsBillingAdmin();
  const providerLabel = useProviderLabel();
  const formatWhen = useExpiryFormatter();
  const formatMoney = useMoneyFormatter(currency);

  const [rows, setRows] = useState<PaymentException[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; message: string } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<ReconcileResult | null>(null);
  // State alone cannot stop a second click that lands before the re-render.
  const reconcileInFlight = useRef(false);

  // Read once per load, so every row's age is measured against one instant.
  const [now, setNow] = useState(() => Date.now());

  const onCountChangeRef = useRef(onCountChange);
  onCountChangeRef.current = onCountChange;

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const data = await client.adminBilling.gateway.listExceptions();
        if (cancelled) return;
        setRows(data);
        setForbidden(false);
        setNow(Date.now());
        onCountChangeRef.current?.(data.length);
      } catch (thrown) {
        if (cancelled) return;
        setRows([]);
        // A `403` is not a failure to report: there is simply nothing here for
        // this caller. Anything else is.
        if (thrown instanceof AdminBillingApiError && thrown.exceptionsKind === 'forbidden') {
          setForbidden(true);
          onCountChangeRef.current?.(0);
        } else {
          setError(x.loadError);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, isAdmin, refreshToken, x.loadError]);

  const reload = useCallback(() => setRefreshToken((token) => token + 1), []);

  /** A checkout that two rows speak about (a webhook mismatch is its event and its checkout). */
  const sharedCheckouts = useMemo(() => {
    const seen = new Map<string, number>();
    for (const row of rows) {
      if (row.checkoutId) seen.set(row.checkoutId, (seen.get(row.checkoutId) ?? 0) + 1);
    }
    return new Set([...seen].filter(([, count]) => count > 1).map(([id]) => id));
  }, [rows]);

  const age = (iso: string): string => {
    const at = Date.parse(iso);
    if (Number.isNaN(at)) return iso;
    const minutes = Math.max(0, Math.floor((now - at) / 60_000));
    const elapsed =
      minutes < 1
        ? x.age.justNow
        : minutes < 60
          ? x.age.minutes(minutes)
          : minutes < 60 * 24
            ? x.age.hours(Math.floor(minutes / 60))
            : x.age.days(Math.floor(minutes / (60 * 24)));
    return x.ageLine(elapsed, formatWhen(iso));
  };

  const runReconcile = async () => {
    if (reconcileInFlight.current) return;
    reconcileInFlight.current = true;
    setReconciling(true);
    setReconcileResult(null);
    try {
      const run = await client.adminBilling.gateway.reconcile();
      setReconcileResult({ state: 'done', run });
    } catch (thrown) {
      const kind = thrown instanceof AdminBillingApiError ? thrown.reconcileKind : 'unknown';
      if (kind === 'off') setReconcileResult({ state: 'note', message: x.reconcile.off });
      else if (kind === 'forbidden') setReconcileResult({ state: 'note', message: dict.errors.forbidden });
      else {
        setReconcileResult({
          state: 'error',
          message: kind === 'configuration' ? x.reconcile.configuration : x.reconcile.unknown,
        });
      }
    } finally {
      reconcileInFlight.current = false;
      setReconciling(false);
      // Whatever the run did, the list is the server's to state.
      reload();
    }
  };

  const afterAction = (message: string, tone: 'ok' | 'warn' = 'ok') => {
    setDraft(null);
    setNotice({ tone, message });
    reload();
  };

  // The console redirects anyone else; this keeps the panel from rendering,
  // or asking the API anything, should it ever be mounted for another role.
  if (!isAdmin) return null;

  if (forbidden) {
    return (
      <p role="note" className="text-sm text-zinc-600 dark:text-zinc-400">
        {dict.errors.forbidden}
      </p>
    );
  }

  const run = reconcileResult?.state === 'done' ? reconcileResult.run : null;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{x.heading}</h2>
        <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{x.intro}</p>
        <p className="max-w-3xl text-xs text-zinc-500 dark:text-zinc-400">{x.noGateNote}</p>
      </div>

      <section
        aria-label={x.reconcile.heading}
        className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-64">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {x.reconcile.heading}
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{x.reconcile.explainer}</p>
          </div>
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={reconciling}
            aria-busy={reconciling}
            onClick={() => void runReconcile()}
          >
            {reconciling ? x.reconcile.running : x.reconcile.button}
          </Button>
        </div>

        {reconcileResult?.state === 'note' && (
          <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
            {reconcileResult.message}
          </p>
        )}
        {reconcileResult?.state === 'error' && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {reconcileResult.message}
          </p>
        )}
        {run && (
          <div className="space-y-3" data-testid="reconcile-result">
            {run.status === 'failed' ? (
              <p role="alert" className="break-words text-sm text-red-600 dark:text-red-400">
                {run.error ? x.reconcile.failed(run.error) : x.reconcile.failedNoReason}
              </p>
            ) : (
              <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">
                {x.reconcile.ok}
              </p>
            )}
            {/* A declaration the integrator owns — nothing verifies the key itself. */}
            {(run.keyMode === 'test' || run.keyMode === 'live') && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400" data-testid="reconcile-key-mode">
                {x.reconcile.keyMode[run.keyMode]}
              </p>
            )}
            <dl
              aria-label={x.reconcile.summaryLabel}
              className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7"
            >
              {HEADLINE_KEYS.map((key) => (
                <div key={key} className="rounded-md bg-zinc-50 p-2 dark:bg-zinc-800/60">
                  <dt className="text-xs text-zinc-500 dark:text-zinc-400">
                    {x.reconcile.headline[key]}
                  </dt>
                  <dd
                    className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50"
                    data-testid={`reconcile-${key}`}
                  >
                    {headline(run.summary)[key]}
                  </dd>
                </div>
              ))}
            </dl>
            <details className="text-sm">
              <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">
                {x.reconcile.allCounts}
              </summary>
              <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                {COUNT_KEYS.map((key) => (
                  <div key={key} className="flex justify-between gap-3">
                    <dt className="text-zinc-600 dark:text-zinc-400">{x.reconcile.counts[key]}</dt>
                    <dd className="tabular-nums text-zinc-900 dark:text-zinc-50">
                      {run.summary[key]}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          </div>
        )}
      </section>

      {notice && (
        <p
          role="status"
          className={`rounded-md px-4 py-2 text-sm ${
            notice.tone === 'ok'
              ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200'
              : 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
          }`}
        >
          {notice.message}
        </p>
      )}

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-600 dark:text-red-400">
          <span>{error}</span>
          <Button type="button" variant="secondary" size="sm" onClick={reload}>
            {x.reload}
          </Button>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <p role="status" className="flex items-center gap-2 text-sm text-zinc-500">
          <Spinner className="h-4 w-4" />
          {x.loading}
        </p>
      ) : !error && rows.length === 0 ? (
        <div
          className="rounded-lg border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700"
          data-testid="exceptions-empty"
        >
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{x.empty.title}</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{x.empty.body}</p>
        </div>
      ) : (
        <ul aria-label={x.listLabel} className="space-y-3">
          {rows.map((row) => {
            const provider = providerLabel(row.provider);
            const kindLabel = x.kind[row.kind];
            const receivable = row.receivable;
            const hasLink =
              row.providerPaymentId !== null &&
              providerDashboardUrl(row.provider, row.providerPaymentId) !== null;
            return (
              <li
                key={row.ref}
                data-testid="payment-exception"
                data-kind={row.kind}
                className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${KIND_TONE[row.kind]}`}
                  >
                    {kindLabel}
                  </span>
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {provider}
                  </span>
                  <span className="text-xs text-zinc-500">{age(row.occurredAt)}</span>
                </div>

                <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
                  {x.explanation[row.kind]}
                </p>

                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  <Field label={x.fields.payment}>
                    {row.providerPaymentId !== null ? (
                      <>
                        <GatewayReference
                          reference={`${row.provider}:${row.providerPaymentId}`}
                          kind="payment"
                        />
                        {!hasLink && (
                          <span className="block text-xs text-zinc-500">
                            {x.noDashboardLink(provider)}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-zinc-500">{x.paymentIdUnknown}</span>
                    )}
                  </Field>
                  {row.eventId !== null && (
                    <Field label={x.fields.event}>
                      <span className="break-all font-mono text-xs">{row.eventId}</span>
                    </Field>
                  )}
                  {row.eventType !== null && (
                    <Field label={x.fields.eventType}>
                      <span className="break-all font-mono text-xs">{row.eventType}</span>
                    </Field>
                  )}
                  {row.checkoutId !== null && (
                    <Field label={x.fields.checkout}>
                      <span className="break-all font-mono text-xs" title={row.checkoutId}>
                        {shortRef(row.checkoutId)}
                      </span>
                    </Field>
                  )}
                  {row.attempts !== null && (
                    <Field label={x.fields.attempts}>{x.attempts(row.attempts)}</Field>
                  )}
                  <Field label={x.fields.student}>
                    {receivable
                      ? (receivable.studentName ?? nameOf(receivable.userId))
                      : x.studentUnknown}
                  </Field>
                  {receivable && (
                    <Field label={x.fields.receivable}>
                      {x.receivableKind[receivable.kind](shortRef(receivable.id))}
                    </Field>
                  )}
                  <Field label={x.fields.amount}>
                    {receivable ? (
                      <span data-testid="exception-amount">
                        {x.amountAsked(formatMoney(receivable.amountMinor, receivable.currency))}
                      </span>
                    ) : (
                      // No receivable, no figure: the API does not know what was paid.
                      <span className="text-xs text-zinc-500">{x.amountUnknown}</span>
                    )}
                  </Field>
                  {row.detail !== null && (
                    <Field label={x.fields.detail}>
                      <span className="break-words">{row.detail}</span>
                    </Field>
                  )}
                </dl>

                {row.checkoutId !== null && sharedCheckouts.has(row.checkoutId) && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400" data-testid="same-checkout">
                    {x.sameCheckout}
                  </p>
                )}

                <div
                  role="group"
                  aria-label={x.actionsLabel(kindLabel)}
                  className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
                >
                  {/* A dispute's payment is already on the ledger: nothing to match. */}
                  {!hasLedgerRow(row) && (
                    <Button
                      type="button"
                      variant="primary"
                      size="md"
                      onClick={() => setDraft({ action: 'match', exception: row })}
                    >
                      {x.actions.match}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    onClick={() => setDraft({ action: 'refund', exception: row })}
                  >
                    {x.actions.refund}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    onClick={() => setDraft({ action: 'dismiss', exception: row })}
                  >
                    {x.actions.dismiss}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {draft?.action === 'dismiss' && (
        <DismissExceptionDialog
          exception={draft.exception}
          onClose={() => setDraft(null)}
          onDone={(message) => afterAction(message)}
        />
      )}
      {draft?.action === 'refund' && (
        <RefundExceptionDialog
          exception={draft.exception}
          nameOf={nameOf}
          onClose={() => setDraft(null)}
          onDismiss={() => setDraft({ action: 'dismiss', exception: draft.exception })}
          onOpenLedger={(destination) => {
            setDraft(null);
            onOpenLedger(destination);
          }}
        />
      )}
      {draft?.action === 'match' && (
        <MatchExceptionDialog
          exception={draft.exception}
          students={students}
          onClose={() => setDraft(null)}
          onDone={(message, settled) => afterAction(message, settled ? 'ok' : 'warn')}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</dt>
      <dd className="break-words text-zinc-900 dark:text-zinc-50">{children}</dd>
    </div>
  );
}
