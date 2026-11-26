'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { providerDashboardUrl } from '@arenaquest/shared/domain/billing/gateway-money';
import { Button, Input } from '@web/components/design-system';
import { Spinner } from '@web/components/spinner';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { AdminBillingApiError } from '@web/lib/admin-billing-api';
import type {
  BillingStudentStatement,
  PaymentException,
  PendingCheckout,
} from '@web/lib/admin-billing-api';
import { GatewayReference, useProviderLabel } from './gateway-ui';
import type { LedgerTarget, LedgerTargetKind } from './ledger-target';
import { useMoneyFormatter } from './money';
import { PaymentForm, type RecordedPayment } from './payment-form';

/**
 * The three ways out of a payment exception (RFC 0026 §7, milestone decision
 * 23): dismiss with a note, refund, match by hand.
 *
 * None of them calls a refund endpoint. *Refund* only points — at the
 * provider's dashboard when nothing landed, at the ledger entry when
 * something did — and *match by hand* records through the ordinary payment
 * form, so the partial unique index on a gateway reference protects this path
 * exactly as it protects the webhook.
 */

/** The API's bound on a dismissal note (decision 20). */
export const DISMISS_NOTE_MAX = 500;

/** A short, stable handle for an id in the UI and in a generated note. */
export function shortRef(id: string): string {
  return id.slice(0, 8);
}

const OVERLAY =
  'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4';
const PANEL =
  'my-8 w-full max-w-lg space-y-4 rounded-lg border border-zinc-200 bg-white p-5 md:p-6 dark:border-zinc-800 dark:bg-zinc-900';
const TITLE = 'text-lg font-semibold text-zinc-900 dark:text-zinc-50';
const BODY = 'text-sm text-zinc-600 dark:text-zinc-400';
const FINE = 'text-xs text-zinc-500 dark:text-zinc-400';
const ERROR = 'text-sm text-red-600 dark:text-red-400';

/**
 * Sends one dismissal. `gone` — the API's `404` — is a success for the
 * caller's purpose: the row is not on the list any more.
 */
function useDismissException() {
  const client = useApiClient();
  return async (ref: string, note: string): Promise<'dismissed' | 'gone'> => {
    try {
      await client.adminBilling.gateway.dismissException({ ref, note });
      return 'dismissed';
    } catch (thrown) {
      if (thrown instanceof AdminBillingApiError && thrown.dismissKind === 'gone') return 'gone';
      throw thrown;
    }
  };
}

// ---------------------------------------------------------------------------
// Dismiss
// ---------------------------------------------------------------------------

export function DismissExceptionDialog({
  exception,
  onClose,
  onDone,
}: {
  exception: PaymentException;
  onClose: () => void;
  /** The row left the list; `message` says how. */
  onDone: (message: string) => void;
}) {
  const dict = useDict();
  const x = dict.admin.billing.gateway.exceptions;
  const d = x.dismiss;
  const providerLabel = useProviderLabel();
  const dismiss = useDismissException();

  const noteId = useId();
  const noteErrorId = useId();
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmedLength = note.trim().length;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (trimmedLength === 0) {
      setNoteError(d.noteRequired);
      return;
    }
    if (trimmedLength > DISMISS_NOTE_MAX) {
      setNoteError(d.noteTooLong(DISMISS_NOTE_MAX));
      return;
    }
    setNoteError(null);
    setSubmitError(null);
    setBusy(true);
    try {
      const outcome = await dismiss(exception.ref, note.trim());
      onDone(outcome === 'gone' ? d.gone : d.success);
    } catch (thrown) {
      const kind = thrown instanceof AdminBillingApiError ? thrown.dismissKind : 'unknown';
      setSubmitError(
        kind === 'invalid' ? d.errors.invalid : kind === 'forbidden' ? d.errors.forbidden : d.errors.unknown,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={OVERLAY} role="dialog" aria-modal="true" aria-label={d.dialogTitle}>
      <form onSubmit={submit} className={PANEL}>
        <h2 className={TITLE}>{d.dialogTitle}</h2>
        <p className={BODY}>{d.explainer}</p>
        <p className={`${FINE} break-all`}>
          {d.target(x.kind[exception.kind], providerLabel(exception.provider))}
        </p>

        <label className="block" htmlFor={noteId}>
          <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]">
            {d.noteLabel}
          </span>
          <textarea
            id={noteId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={4}
            placeholder={d.notePlaceholder}
            aria-invalid={noteError ? true : undefined}
            aria-describedby={noteError ? noteErrorId : undefined}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        <p
          className={`text-right text-xs ${
            trimmedLength > DISMISS_NOTE_MAX ? 'text-red-600 dark:text-red-400' : 'text-zinc-500'
          }`}
        >
          {d.counter(trimmedLength, DISMISS_NOTE_MAX)}
        </p>
        {noteError && (
          <p id={noteErrorId} role="alert" className={ERROR}>
            {noteError}
          </p>
        )}
        {submitError && (
          <p role="alert" className={ERROR}>
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

// ---------------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------------

/** Where the ledger entry of a landed payment lives. */
export type LedgerDestination =
  | { tab: 'ledger'; userId: string }
  | { tab: 'extras'; eventId: string };

/**
 * A dispute is the one exception whose payment is on the ledger: its refund is
 * that entry's ordinary reversal. Everything else landed nothing.
 */
export function hasLedgerRow(exception: PaymentException): boolean {
  return exception.kind === 'dispute' && exception.receivable !== null;
}

export function RefundExceptionDialog({
  exception,
  nameOf,
  onClose,
  onDismiss,
  onOpenLedger,
}: {
  exception: PaymentException;
  nameOf: (userId: string) => string;
  onClose: () => void;
  /** "Dismiss this row" — hands over to the dismiss dialog. */
  onDismiss: () => void;
  onOpenLedger: (destination: LedgerDestination) => void;
}) {
  const dict = useDict();
  const x = dict.admin.billing.gateway.exceptions;
  const d = x.refund;
  const client = useApiClient();
  const providerLabel = useProviderLabel();

  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const provider = providerLabel(exception.provider);
  const receivable = exception.receivable;
  const onLedger = hasLedgerRow(exception) && receivable !== null;

  /**
   * An invoice is listed by its student on the ledger tab. A charge lives
   * under its event on the extras tab, so the event is read first — a plain
   * read of the charge, never a refund call.
   */
  const openEntry = async () => {
    if (!receivable || resolving) return;
    if (receivable.kind === 'invoice') {
      onOpenLedger({ tab: 'ledger', userId: receivable.userId });
      return;
    }
    setResolving(true);
    setResolveError(null);
    try {
      const charge = await client.adminBilling.extras.getCharge(receivable.id);
      onOpenLedger({ tab: 'extras', eventId: charge.eventId });
    } catch {
      setResolveError(d.onLedger.resolveError);
    } finally {
      setResolving(false);
    }
  };

  const paymentId = exception.providerPaymentId;
  const hasLink = paymentId !== null && providerDashboardUrl(exception.provider, paymentId) !== null;

  return (
    <div className={OVERLAY} role="dialog" aria-modal="true" aria-label={d.dialogTitle}>
      <div className={PANEL}>
        <h2 className={TITLE}>{d.dialogTitle}</h2>

        {onLedger && receivable ? (
          <>
            <p className={BODY}>{d.onLedger.explainer}</p>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {d.onLedger.target(
                receivable.studentName ?? nameOf(receivable.userId),
                x.receivableKind[receivable.kind](shortRef(receivable.id)),
              )}
            </p>
            {paymentId !== null && (
              <GatewayReference reference={`${exception.provider}:${paymentId}`} kind="payment" />
            )}
            {resolveError && (
              <p role="alert" className={ERROR}>
                {resolveError}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="secondary" size="md" onClick={onClose}>
                {d.close}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                disabled={resolving}
                onClick={() => void openEntry()}
              >
                {receivable.kind === 'invoice' ? d.onLedger.openLedger : d.onLedger.openExtras}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className={BODY}>{d.atProvider.explainer}</p>
            <div
              className="space-y-1 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
              data-testid="refund-provider-reference"
            >
              {paymentId !== null ? (
                <>
                  <GatewayReference
                    reference={`${exception.provider}:${paymentId}`}
                    kind="payment"
                  />
                  {!hasLink && <p className={FINE}>{x.noDashboardLink(provider)}</p>}
                </>
              ) : (
                <p className={FINE}>{d.atProvider.noPaymentId}</p>
              )}
            </div>
            <p className={BODY}>{d.atProvider.afterHint}</p>
            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="secondary" size="md" onClick={onClose}>
                {d.close}
              </Button>
              <Button type="button" variant="primary" size="md" onClick={onDismiss}>
                {d.atProvider.dismissNow}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Match by hand
// ---------------------------------------------------------------------------

export type MatchableStudent = { id: string; name: string; email?: string };

/** How many search results the picker lists before asking for a narrower search. */
const STUDENT_RESULTS_MAX = 8;

type MatchTarget = {
  kind: LedgerTargetKind;
  target: LedgerTarget;
  pendingCheckout: PendingCheckout | null;
};

type OpenReceivable = MatchTarget & { label: string; fromCheckout: boolean };

type MatchStep =
  | { name: 'pick' }
  | { name: 'form'; chosen: MatchTarget }
  | { name: 'finishing' }
  | { name: 'already'; paymentId: string };

/**
 * *Match by hand*: student → one of their open receivables → the ordinary
 * payment form with method *Online* and the exception's reference. Recording
 * it dismisses the exception with a generated note; a reference that already
 * landed says so and offers the dismissal instead.
 *
 * The amount is deliberately **not** prefilled: an orphan has none, and a
 * known receivable's figure is what the checkout asked for, not what the
 * provider captured.
 */
export function MatchExceptionDialog({
  exception,
  students,
  onClose,
  onDone,
}: {
  exception: PaymentException;
  students: readonly MatchableStudent[];
  onClose: () => void;
  /** Something was written; `settled` is false when the exception is still listed. */
  onDone: (message: string, settled: boolean) => void;
}) {
  const dict = useDict();
  const x = dict.admin.billing.gateway.exceptions;
  const d = x.match;
  const client = useApiClient();
  const dismiss = useDismissException();

  const searchId = useId();
  const knownUserId = exception.receivable?.userId ?? null;
  const [userId, setUserId] = useState<string | null>(knownUserId);
  const [search, setSearch] = useState('');
  const [statement, setStatement] = useState<BillingStudentStatement | null>(null);
  const [statementError, setStatementError] = useState<string | null>(null);
  const [step, setStep] = useState<MatchStep>({ name: 'pick' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formatMoney = useMoneyFormatter(statement?.currency ?? null);

  useEffect(() => {
    if (userId === null) return;
    let cancelled = false;
    setStatement(null);
    setStatementError(null);
    void (async () => {
      try {
        const data = await client.adminBilling.students.statement(userId);
        if (!cancelled) setStatement(data);
      } catch {
        if (!cancelled) setStatementError(d.statementError);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, userId, d.statementError]);

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return students;
    return students.filter(
      (student) =>
        student.name.toLowerCase().includes(needle) ||
        (student.email ?? '').toLowerCase().includes(needle),
    );
  }, [students, search]);

  const studentName = (id: string) =>
    students.find((student) => student.id === id)?.name ??
    (exception.receivable?.userId === id ? exception.receivable.studentName : null) ??
    id;

  /** Open with a balance, on both rails; the checkout's own receivable first. */
  const receivables = useMemo((): OpenReceivable[] => {
    if (!statement) return [];
    const known = exception.receivable;
    const invoices = statement.invoices
      .filter((invoice) => invoice.status === 'open' && invoice.balanceMinor > 0)
      .map(
        (invoice): OpenReceivable => ({
          kind: 'invoice',
          target: { id: invoice.id, currency: invoice.currency, balanceMinor: invoice.balanceMinor },
          pendingCheckout: invoice.pendingCheckout ?? null,
          label: d.invoiceOption(shortRef(invoice.id), invoice.dueDate),
          fromCheckout: known?.kind === 'invoice' && known.id === invoice.id,
        }),
      );
    const charges = (statement.extras?.charges ?? [])
      .filter((charge) => charge.status === 'open' && charge.balanceMinor > 0)
      .map(
        (charge): OpenReceivable => ({
          kind: 'charge',
          target: { id: charge.id, currency: charge.currency, balanceMinor: charge.balanceMinor },
          pendingCheckout: charge.pendingCheckout ?? null,
          label: d.chargeOption(charge.eventTitle || charge.description, charge.dueDate),
          fromCheckout: known?.kind === 'event_charge' && known.id === charge.id,
        }),
      );
    return [...invoices, ...charges].sort(
      (a, b) => Number(b.fromCheckout) - Number(a.fromCheckout),
    );
  }, [statement, exception.receivable, d]);

  const finish = async (note: string, done: string, notDismissed: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await dismiss(exception.ref, note);
      onDone(done, true);
    } catch {
      if (notDismissed !== null) onDone(notDismissed, false);
      else setError(x.dismiss.errors.unknown);
    } finally {
      setBusy(false);
    }
  };

  const onRecorded = (recorded: RecordedPayment) => {
    const payment = shortRef(recorded.id);
    setStep({ name: 'finishing' });
    void finish(
      d.note(payment, recorded.externalReference ?? payment),
      d.success(payment),
      d.successNotDismissed(payment),
    );
  };

  if (step.name === 'form' && statement) {
    return (
      <PaymentForm
        invoice={step.chosen.target}
        kind={step.chosen.kind}
        currency={statement.currency}
        payOptions={statement.payOptions}
        pendingCheckout={step.chosen.pendingCheckout}
        prefill={{
          method: 'gateway',
          provider: exception.provider,
          ...(exception.providerPaymentId !== null
            ? { providerPaymentId: exception.providerPaymentId }
            : {}),
        }}
        onClose={() => setStep({ name: 'pick' })}
        onRecorded={onRecorded}
        onReferenceExists={(paymentId) => setStep({ name: 'already', paymentId })}
      />
    );
  }

  if (step.name === 'finishing') {
    return (
      <div className={OVERLAY} role="dialog" aria-modal="true" aria-label={d.dialogTitle}>
        <div className={PANEL}>
          <p role="status" className={`${BODY} flex items-center gap-2`}>
            <Spinner className="h-4 w-4" />
            {d.finishing}
          </p>
        </div>
      </div>
    );
  }

  if (step.name === 'already') {
    const payment = shortRef(step.paymentId);
    return (
      <div className={OVERLAY} role="dialog" aria-modal="true" aria-label={d.already.title}>
        <div className={PANEL}>
          <h2 className={TITLE}>{d.already.title}</h2>
          <p className={BODY}>{d.already.body(payment)}</p>
          {error && (
            <p role="alert" className={ERROR}>
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" size="md" onClick={onClose}>
              {d.already.keep}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={busy}
              onClick={() => void finish(d.already.note(payment), d.already.success, null)}
            >
              {d.already.dismiss}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const shown = matches.slice(0, STUDENT_RESULTS_MAX);

  return (
    <div className={OVERLAY} role="dialog" aria-modal="true" aria-label={d.dialogTitle}>
      <div className={PANEL}>
        <h2 className={TITLE}>{d.dialogTitle}</h2>
        <p className={BODY}>{d.explainer}</p>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {d.studentHeading}
          </h3>
          {userId === null ? (
            <>
              <Input
                id={searchId}
                type="search"
                label={d.searchLabel}
                placeholder={d.searchPlaceholder}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                autoComplete="off"
              />
              {shown.length === 0 ? (
                <p className={FINE}>{d.studentEmpty}</p>
              ) : (
                <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                  {shown.map((student) => (
                    <li key={student.id}>
                      <button
                        type="button"
                        aria-label={d.pickStudent(student.name)}
                        onClick={() => setUserId(student.id)}
                        className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      >
                        <span className="font-medium text-zinc-900 dark:text-zinc-50">
                          {student.name}
                        </span>
                        {student.email && (
                          <span className="break-all text-xs text-zinc-500">{student.email}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {matches.length > shown.length && (
                <p className={FINE}>{d.studentMore(matches.length - shown.length)}</p>
              )}
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {studentName(userId)}
                </p>
                {userId === knownUserId && <p className={FINE}>{d.studentFromCheckout}</p>}
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setUserId(null);
                  setStatement(null);
                  setStatementError(null);
                }}
              >
                {d.changeStudent}
              </Button>
            </div>
          )}
        </section>

        {userId !== null && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {d.receivableHeading}
            </h3>
            {statementError ? (
              <p role="alert" className={ERROR}>
                {statementError}
              </p>
            ) : statement === null ? (
              <p role="status" className={`${FINE} flex items-center gap-2`}>
                <Spinner className="h-4 w-4" />
                {d.loadingStatement}
              </p>
            ) : receivables.length === 0 ? (
              <p className={BODY}>{d.noOpenReceivable}</p>
            ) : (
              <>
                <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                  {receivables.map((row) => (
                    <li key={`${row.kind}:${row.target.id}`}>
                      <button
                        type="button"
                        aria-label={d.pickReceivable(row.label)}
                        onClick={() => setStep({ name: 'form', chosen: row })}
                        className="flex min-h-11 w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      >
                        <span className="font-medium text-zinc-900 dark:text-zinc-50">
                          {row.label}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {d.balance(formatMoney(row.target.balanceMinor, row.target.currency))}
                          {row.fromCheckout ? ` · ${d.fromCheckout}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className={FINE}>{d.amountHint}</p>
              </>
            )}
          </section>
        )}

        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            {d.cancel}
          </Button>
        </div>
      </div>
    </div>
  );
}
