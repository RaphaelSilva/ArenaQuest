'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  Button,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@web/components/design-system';
import { Spinner } from '@web/components/spinner';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type {
  BillingAdjustment,
  BillingInvoiceWithBalance,
  BillingPayment,
  BillingReportCurrency,
  InvoiceQuery,
  InvoiceStatus,
} from '@web/lib/admin-billing-api';
import { Money, useMoneyFormatter } from './money';
import { downloadCsv, toCsv } from './ledger-csv';
import { PaymentForm } from './payment-form';
import { AdjustmentForm } from './adjustment-form';
import { VoidInvoiceForm } from './void-invoice-form';
import { IssueInvoiceForm } from './issue-invoice-form';
import { RunCyclePanel } from './run-cycle-panel';

const STATUSES: readonly InvoiceStatus[] = ['open', 'paid', 'void'];

type Entries = { adjustments: BillingAdjustment[]; payments: BillingPayment[] };

type ReverseDraft = { payment: BillingPayment; invoiceId: string };

/** Which write dialog is open, and on which invoice. */
type WriteDraft = {
  action: 'payment' | 'adjustment' | 'void';
  invoice: BillingInvoiceWithBalance;
};

/** A short, stable handle for an id in the UI and in an aria-label. */
function shortRef(id: string): string {
  return id.slice(0, 8);
}

export function LedgerTab({
  currency,
  nameOf,
  students,
}: {
  currency: BillingReportCurrency | null;
  nameOf: (userId: string) => string;
  students: readonly { id: string; name: string }[];
}) {
  const dict = useDict();
  const d = dict.admin.billing.ledger;
  const client = useApiClient();
  const formatMoneyValue = useMoneyFormatter(currency);

  const statusId = useId();
  const studentId = useId();

  // The draft the filter controls write to, and the committed query the fetch
  // effect depends on — so typing a date does not fire a request per keystroke.
  const [draft, setDraft] = useState<InvoiceQuery>({});
  const [query, setQuery] = useState<InvoiceQuery>({});

  const [rows, setRows] = useState<BillingInvoiceWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entries | null>(null);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);

  const [reverseDraft, setReverseDraft] = useState<ReverseDraft | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseError, setReverseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The four write actions and the confirmation they leave behind.
  const [writeDraft, setWriteDraft] = useState<WriteDraft | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Bumped after every write. The list is re-fetched rather than patched in
   * place, because an invoice's status is the server's cache of "balance
   * reached zero" and is never recomputed here. It is also the only request a
   * write adds — the CSV export keeps serialising the rows already in memory.
   */
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const data = await client.adminBilling.invoices.list(query);
        if (!cancelled) setRows(data);
      } catch {
        if (!cancelled) {
          setRows([]);
          setError(d.loadError);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, query, refreshToken, d.loadError]);

  /**
   * An invoice's adjustments and payments come from its student's statement —
   * the endpoint that returns them — so expanding a row needs no new contract.
   */
  const loadEntries = useCallback(
    async (invoice: BillingInvoiceWithBalance) => {
      setEntriesLoading(true);
      setEntriesError(null);
      try {
        const statement = await client.adminBilling.students.statement(invoice.userId);
        const match = statement.invoices.find((row) => row.id === invoice.id);
        setEntries({ adjustments: match?.adjustments ?? [], payments: match?.payments ?? [] });
      } catch {
        setEntries(null);
        setEntriesError(d.detailsError);
      } finally {
        setEntriesLoading(false);
      }
    },
    [client, d.detailsError],
  );

  const toggle = (invoice: BillingInvoiceWithBalance) => {
    if (expanded === invoice.id) {
      setExpanded(null);
      setEntries(null);
      return;
    }
    setExpanded(invoice.id);
    setEntries(null);
    void loadEntries(invoice);
  };

  /**
   * What every write does once the server accepted it: state what happened,
   * re-read the list so the invoice's status is the server's, and re-read the
   * open invoice's entries so the new row appears beneath it.
   */
  const afterWrite = useCallback(
    (invoice: BillingInvoiceWithBalance | null, message: string) => {
      setNotice(message);
      setWriteDraft(null);
      setIssueOpen(false);
      setRefreshToken((token) => token + 1);
      if (invoice && expanded === invoice.id) void loadEntries(invoice);
    },
    [expanded, loadEntries],
  );

  const submitReverse = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reverseDraft) return;
    const reason = reverseReason.trim();
    // The reversal refuses to submit without a reason: the mirror entry carries
    // it forever, and an unexplained one is worse than none.
    if (!reason) {
      setReverseError(d.reverseReasonRequired);
      return;
    }
    setBusy(true);
    try {
      await client.adminBilling.payments.reverse(reverseDraft.payment.id, { reason });
      const invoice = rows.find((row) => row.id === reverseDraft.invoiceId);
      setReverseDraft(null);
      setReverseReason('');
      setReverseError(null);
      // The mirror entry moves the balance, so the list is re-read for the
      // server's own status rather than adjusted here.
      setRefreshToken((token) => token + 1);
      if (invoice) await loadEntries(invoice);
    } catch {
      setReverseError(d.reverseError);
    } finally {
      setBusy(false);
    }
  };

  const exportRows = () => {
    const csv = toCsv(rows, [
      { header: d.csv.invoiceId, value: (row) => row.id },
      { header: d.csv.studentId, value: (row) => row.userId },
      { header: d.csv.student, value: (row) => nameOf(row.userId) },
      { header: d.csv.periodStart, value: (row) => row.periodStart },
      { header: d.csv.periodEnd, value: (row) => row.periodEnd },
      { header: d.csv.dueDate, value: (row) => row.dueDate },
      { header: d.csv.status, value: (row) => d.invoiceStatus[row.status] },
      { header: d.csv.currency, value: (row) => row.currency },
      { header: d.csv.amountMinor, value: (row) => String(row.amountMinor) },
      { header: d.csv.balanceMinor, value: (row) => String(row.balanceMinor) },
      { header: d.csv.issuedAt, value: (row) => row.issuedAt },
    ]);
    downloadCsv(`${d.exportFilename}.csv`, csv);
  };

  // Originals first, each with the reversal that mirrors it, so a reversal is
  // rendered under the entry it undoes rather than as a loose negative row.
  const paymentGroups = useMemo(() => {
    const payments = entries?.payments ?? [];
    const reversalOf = new Map<string, BillingPayment>();
    for (const payment of payments) {
      if (payment.reversesId) reversalOf.set(payment.reversesId, payment);
    }
    return payments
      .filter((payment) => payment.reversesId === null)
      .map((payment) => ({ payment, reversal: reversalOf.get(payment.id) ?? null }));
  }, [entries]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{d.heading}</h2>
          <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{d.appendOnlyNote}</p>
          {/*
            Spelled out for the administrator who is looking for a Delete: the
            three corrections are an *entry*, never an edit of what was written.
          */}
          <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{d.correctionNote}</p>
        </div>
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={() => {
            setNotice(null);
            setIssueOpen(true);
          }}
          aria-label={d.issue.buttonAriaLabel}
        >
          {d.issue.button}
        </Button>
      </div>

      {/*
        The manual twin of the daily cron. It lives on this tab because the
        invoices it issues land in the list below, which is re-read whenever the
        run actually issued something.
      */}
      <RunCyclePanel
        currency={currency}
        nameOf={nameOf}
        onIssued={() => setRefreshToken((token) => token + 1)}
      />

      {notice && (
        <p
          role="status"
          className="rounded-md bg-emerald-100 px-4 py-2 text-sm text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
        >
          {notice}
        </p>
      )}

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(draft);
          setExpanded(null);
          setEntries(null);
        }}
      >
        <div className="flex flex-col gap-1">
          <label
            htmlFor={statusId}
            className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]"
          >
            {d.filters.status}
          </label>
          <select
            id={statusId}
            value={draft.status ?? ''}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                status: (event.target.value || undefined) as InvoiceStatus | undefined,
              }))
            }
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          >
            <option value="">{d.filters.statusAll}</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {d.invoiceStatus[status]}
              </option>
            ))}
          </select>
        </div>

        <Input
          label={d.filters.from}
          type="date"
          value={draft.from ?? ''}
          onChange={(event) =>
            setDraft((current) => ({ ...current, from: event.target.value || undefined }))
          }
        />
        <Input
          label={d.filters.to}
          type="date"
          value={draft.to ?? ''}
          onChange={(event) =>
            setDraft((current) => ({ ...current, to: event.target.value || undefined }))
          }
        />

        <div className="flex flex-col gap-1">
          <label
            htmlFor={studentId}
            className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]"
          >
            {d.filters.student}
          </label>
          <select
            id={studentId}
            value={draft.userId ?? ''}
            onChange={(event) =>
              setDraft((current) => ({ ...current, userId: event.target.value || undefined }))
            }
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          >
            <option value="">{d.filters.studentAll}</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" variant="primary" size="md">
          {d.filters.apply}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={exportRows}
          disabled={rows.length === 0}
          aria-label={d.exportAriaLabel}
        >
          {d.exportButton}
        </Button>
        <p className="text-xs text-zinc-500">{d.count(rows.length)}</p>
      </form>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-6 w-6 text-zinc-400" />
        </div>
      ) : error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">{d.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow isHoverable={false}>
              <TableCell isHeader>{d.columns.invoice}</TableCell>
              <TableCell isHeader>{d.columns.student}</TableCell>
              <TableCell isHeader>{d.columns.period}</TableCell>
              <TableCell isHeader>{d.columns.due}</TableCell>
              <TableCell isHeader>{d.columns.status}</TableCell>
              <TableCell isHeader>{d.columns.amount}</TableCell>
              <TableCell isHeader>{d.columns.balance}</TableCell>
              <TableCell isHeader>{d.columns.details}</TableCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((invoice) => {
              const isOpen = expanded === invoice.id;
              const reference = shortRef(invoice.id);
              return [
                <TableRow key={invoice.id}>
                  <TableCell className="font-mono text-xs">{reference}</TableCell>
                  <TableCell>{nameOf(invoice.userId)}</TableCell>
                  <TableCell>{`${invoice.periodStart} — ${invoice.periodEnd}`}</TableCell>
                  <TableCell>{invoice.dueDate}</TableCell>
                  <TableCell>{d.invoiceStatus[invoice.status]}</TableCell>
                  <TableCell>
                    <Money
                      amountMinor={invoice.amountMinor}
                      currency={currency}
                      code={invoice.currency}
                    />
                  </TableCell>
                  <TableCell>
                    <Money
                      amountMinor={invoice.balanceMinor}
                      currency={currency}
                      code={invoice.currency}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => toggle(invoice)}
                      aria-expanded={isOpen}
                      aria-label={
                        isOpen ? d.collapseAriaLabel(reference) : d.expandAriaLabel(reference)
                      }
                    >
                      {d.expandButton}
                    </Button>
                  </TableCell>
                </TableRow>,
                isOpen ? (
                  <TableRow key={`${invoice.id}-entries`} isHoverable={false}>
                    {/* A raw cell: the design-system `TableCell` takes no colSpan. */}
                    <td className="bg-zinc-50 px-4 py-3 text-left dark:bg-zinc-900/60" colSpan={8}>
                      {entriesLoading ? (
                        <p className="text-sm text-zinc-500">{d.detailsLoading}</p>
                      ) : entriesError ? (
                        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                          {entriesError}
                        </p>
                      ) : (
                        <div className="space-y-5">
                          {/* -----------------------------------------------
                              The write actions for this invoice. No delete
                              control exists here or anywhere else on the tab.
                              ----------------------------------------------- */}
                          <div className="space-y-2">
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                              {d.actionsHeading}
                            </h3>
                            {invoice.status === 'void' ? (
                              <p className="text-sm text-zinc-500">{d.voidedNote}</p>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  variant="primary"
                                  size="sm"
                                  onClick={() => {
                                    setNotice(null);
                                    setWriteDraft({ action: 'payment', invoice });
                                  }}
                                  aria-label={d.payment.buttonAriaLabel(reference)}
                                >
                                  {d.payment.button}
                                </Button>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => {
                                    setNotice(null);
                                    setWriteDraft({ action: 'adjustment', invoice });
                                  }}
                                  aria-label={d.adjustment.buttonAriaLabel(reference)}
                                >
                                  {d.adjustment.button}
                                </Button>
                                <Button
                                  type="button"
                                  variant="danger"
                                  size="sm"
                                  onClick={() => {
                                    setNotice(null);
                                    setWriteDraft({ action: 'void', invoice });
                                  }}
                                  aria-label={d.voidInvoice.buttonAriaLabel(reference)}
                                >
                                  {d.voidInvoice.button}
                                </Button>
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                          <div>
                            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                              {d.adjustmentsHeading}
                            </h3>
                            {(entries?.adjustments.length ?? 0) === 0 ? (
                              <p className="text-sm text-zinc-500">{d.adjustmentsEmpty}</p>
                            ) : (
                              <ul className="space-y-2">
                                {entries?.adjustments.map((adjustment) => (
                                  <li
                                    key={adjustment.id}
                                    className="rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
                                  >
                                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                      {`${d.adjustmentKind[adjustment.kind]} · ${formatMoneyValue(
                                        adjustment.amountMinor,
                                        invoice.currency,
                                      )}`}
                                    </span>
                                    <span className="block text-xs text-zinc-500">
                                      {`${adjustment.appliedAt} · ${d.recordedBy(adjustment.appliedBy)}`}
                                    </span>
                                    <span className="block text-xs text-zinc-500">
                                      {d.reasonLine(adjustment.reason)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>

                          <div>
                            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                              {d.paymentsHeading}
                            </h3>
                            {paymentGroups.length === 0 ? (
                              <p className="text-sm text-zinc-500">{d.paymentsEmpty}</p>
                            ) : (
                              <ul className="space-y-2">
                                {paymentGroups.map(({ payment, reversal }) => (
                                  <li
                                    key={payment.id}
                                    className="rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                        {`${d.method[payment.method]} · ${formatMoneyValue(
                                          payment.amountMinor,
                                          payment.currency,
                                        )}`}
                                      </span>
                                      {reversal ? (
                                        <span className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                                          {d.alreadyReversed}
                                        </span>
                                      ) : (
                                        <Button
                                          type="button"
                                          variant="secondary"
                                          size="sm"
                                          onClick={() => {
                                            setReverseDraft({
                                              payment,
                                              invoiceId: invoice.id,
                                            });
                                            setReverseReason('');
                                            setReverseError(null);
                                          }}
                                          aria-label={d.reverseAriaLabel(shortRef(payment.id))}
                                        >
                                          {d.reverseButton}
                                        </Button>
                                      )}
                                    </div>
                                    <span className="block text-xs text-zinc-500">
                                      {`${payment.paidAt} · ${d.recordedBy(payment.recordedBy)}`}
                                    </span>

                                    {/* The reversal lives under its original, never in its place. */}
                                    {reversal && (
                                      <div className="mt-2 border-l-2 border-amber-400 pl-3">
                                        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                          {`${d.reversalOf(shortRef(payment.id))} · ${formatMoneyValue(
                                            reversal.amountMinor,
                                            reversal.currency,
                                          )}`}
                                        </span>
                                        <span className="block text-xs text-zinc-500">
                                          {d.reasonLine(reversal.note)}
                                        </span>
                                        <span className="block text-xs text-zinc-500">
                                          {`${reversal.paidAt} · ${d.recordedBy(reversal.recordedBy)}`}
                                        </span>
                                      </div>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          </div>
                        </div>
                      )}
                    </td>
                  </TableRow>
                ) : null,
              ];
            })}
          </TableBody>
        </Table>
      )}

      {reverseDraft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={d.reverseDialogTitle}
        >
          <form
            onSubmit={submitReverse}
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
                value={reverseReason}
                onChange={(event) => setReverseReason(event.target.value)}
                rows={3}
                placeholder={d.reverseReasonPlaceholder}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            {reverseError && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {reverseError}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => {
                  setReverseDraft(null);
                  setReverseError(null);
                }}
              >
                {d.reverseCancel}
              </Button>
              <Button type="submit" variant="primary" size="md" disabled={busy}>
                {d.reverseSubmit}
              </Button>
            </div>
          </form>
        </div>
      )}

      {writeDraft?.action === 'payment' && (
        <PaymentForm
          invoice={writeDraft.invoice}
          currency={currency}
          onClose={() => setWriteDraft(null)}
          onRecorded={() => afterWrite(writeDraft.invoice, d.payment.success)}
        />
      )}

      {writeDraft?.action === 'adjustment' && (
        <AdjustmentForm
          invoice={writeDraft.invoice}
          currency={currency}
          onClose={() => setWriteDraft(null)}
          onApplied={() => afterWrite(writeDraft.invoice, d.adjustment.success)}
        />
      )}

      {writeDraft?.action === 'void' && (
        <VoidInvoiceForm
          invoice={writeDraft.invoice}
          onClose={() => setWriteDraft(null)}
          onVoided={() => afterWrite(writeDraft.invoice, d.voidInvoice.success)}
        />
      )}

      {issueOpen && (
        <IssueInvoiceForm
          currency={currency}
          nameOf={nameOf}
          onClose={() => setIssueOpen(false)}
          onIssued={(reference) => afterWrite(null, d.issue.success(reference))}
        />
      )}
    </section>
  );
}
