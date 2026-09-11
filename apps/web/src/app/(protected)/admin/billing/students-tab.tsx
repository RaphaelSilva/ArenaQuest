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
  BillingReportCurrency,
  BillingRosterEntry,
  Standing,
} from '@web/lib/admin-billing-api';
import { Money } from './money';
import { StandingBadge } from './standing-badge';
import { StudentStatementPanel } from './student-statement-panel';

/**
 * `standing=exempt` is the held filter — Task 05 decided against a second
 * spelling, and a hold is the only way a student reaches it.
 */
const STANDINGS: readonly Standing[] = ['good', 'due', 'delinquent', 'exempt'];

type HoldDraft = { entry: BillingRosterEntry; name: string };

export function StudentsTab({
  currency,
  nameOf,
  onRosterChanged,
}: {
  currency: BillingReportCurrency | null;
  nameOf: (userId: string) => string;
  onRosterChanged: () => void;
}) {
  const dict = useDict();
  const d = dict.admin.billing.students;
  const client = useApiClient();
  const filterId = useId();

  const [standing, setStanding] = useState<Standing | ''>('');
  const [rows, setRows] = useState<BillingRosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [holdDraft, setHoldDraft] = useState<HoldDraft | null>(null);
  const [holdReason, setHoldReason] = useState('');
  const [holdExpiresAt, setHoldExpiresAt] = useState('');
  const [holdFormError, setHoldFormError] = useState<string | null>(null);

  const [statementFor, setStatementFor] = useState<{ userId: string; name: string } | null>(null);

  /**
   * The standing filter is a **server** parameter. Filtering a cached list
   * locally would put a second copy of the standing rule in the client, where a
   * hold set on another screen could never reach it.
   */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await client.adminBilling.students.roster(standing ? { standing } : {});
      setRows(data);
    } catch {
      setRows([]);
      setError(d.loadError);
    } finally {
      setLoading(false);
    }
  }, [client, standing, d.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Every listed balance is summed, held rows included: a hold stops the
   * chasing, not the debt, so it never removes money from a total on screen.
   */
  const outstandingTotal = useMemo(
    () => rows.reduce((sum, row) => sum + row.outstandingMinor, 0),
    [rows],
  );

  /**
   * The code the total is stated in. Two codes on screen mean there is no
   * single total to state, so the joined code is handed to `Money`, which
   * withholds the amount rather than adding two currencies together.
   */
  const totalCurrencyCode = useMemo(() => {
    const codes = [...new Set(rows.map((row) => row.currency))];
    if (codes.length === 0) return currency?.code;
    return codes.length === 1 ? codes[0] : codes.sort().join('/');
  }, [rows, currency]);

  const openHold = (entry: BillingRosterEntry) => {
    setHoldDraft({ entry, name: nameOf(entry.userId) });
    setHoldReason('');
    setHoldExpiresAt('');
    setHoldFormError(null);
  };

  const submitHold = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!holdDraft) return;
    const reason = holdReason.trim();
    if (!reason) {
      setHoldFormError(d.holdReasonRequired);
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await client.adminBilling.holds.set(holdDraft.entry.userId, {
        reason,
        expiresAt: holdExpiresAt ? holdExpiresAt : undefined,
      });
      setHoldDraft(null);
      await load();
      onRosterChanged();
    } catch {
      setHoldFormError(d.holdError);
    } finally {
      setBusy(false);
    }
  };

  const clearHold = async (entry: BillingRosterEntry) => {
    setBusy(true);
    setActionError(null);
    try {
      await client.adminBilling.holds.clear(entry.userId);
      await load();
      onRosterChanged();
    } catch {
      setActionError(d.clearHoldError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{d.heading}</h2>
        <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{d.holdExplainer}</p>
        <p className="max-w-3xl text-xs text-zinc-500 dark:text-zinc-400">{d.noGateNote}</p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label
            htmlFor={filterId}
            className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]"
          >
            {d.filterLabel}
          </label>
          <select
            id={filterId}
            value={standing}
            onChange={(event) => setStanding(event.target.value as Standing | '')}
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          >
            <option value="">{d.filterAll}</option>
            {STANDINGS.map((value) => (
              <option key={value} value={value}>
                {dict.admin.billing.standing[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {d.totalOutstanding}
          </p>
          <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
            <Money
              amountMinor={outstandingTotal}
              currency={currency}
              code={totalCurrencyCode}
            />
          </p>
        </div>

        <p className="text-xs text-zinc-500">{d.count(rows.length)}</p>
      </div>

      {actionError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {actionError}
        </p>
      )}

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
              <TableCell isHeader>{d.columns.student}</TableCell>
              <TableCell isHeader>{d.columns.standing}</TableCell>
              <TableCell isHeader>{d.columns.outstanding}</TableCell>
              <TableCell isHeader>{d.columns.nextDue}</TableCell>
              <TableCell isHeader>{d.columns.oldestOverdue}</TableCell>
              <TableCell isHeader>{d.columns.terms}</TableCell>
              <TableCell isHeader>{d.columns.actions}</TableCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const name = nameOf(row.userId);
              return (
                <TableRow key={row.userId}>
                  <TableCell>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{name}</span>
                    {row.hold && (
                      <span className="mt-1 block text-xs text-zinc-500">
                        {d.heldBy(row.hold.reason, row.hold.setBy)}
                        {row.hold.expiresAt ? ` · ${d.heldUntil(row.hold.expiresAt)}` : ''}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StandingBadge standing={row.standing} />
                  </TableCell>
                  <TableCell>
                    <Money amountMinor={row.outstandingMinor} currency={currency} code={row.currency} />
                  </TableCell>
                  <TableCell>{row.nextDueDate ?? d.none}</TableCell>
                  <TableCell>{row.oldestOverdueDate ?? d.none}</TableCell>
                  <TableCell>{row.negotiatedTerms ? d.negotiated : d.standardTerms}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setStatementFor({ userId: row.userId, name })}
                        aria-label={d.statementAriaLabel(name)}
                      >
                        {d.statementButton}
                      </Button>
                      {row.hold ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => void clearHold(row)}
                          aria-label={d.clearHoldAriaLabel(name)}
                        >
                          {d.clearHoldButton}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => openHold(row)}
                          aria-label={d.holdAriaLabel(name)}
                        >
                          {d.holdButton}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {holdDraft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={d.holdDialogTitle}
        >
          <form
            onSubmit={submitHold}
            className="w-full max-w-md space-y-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {d.holdDialogTitle}
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.holdDialogExplainer}</p>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]">
                {d.holdReasonLabel}
              </span>
              <textarea
                value={holdReason}
                onChange={(event) => setHoldReason(event.target.value)}
                rows={3}
                placeholder={d.holdReasonPlaceholder}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <Input
              label={d.holdExpiresLabel}
              type="date"
              value={holdExpiresAt}
              onChange={(event) => setHoldExpiresAt(event.target.value)}
              helperText={d.holdExpiresHelp}
            />
            {holdFormError && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {holdFormError}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => setHoldDraft(null)}
              >
                {d.holdCancel}
              </Button>
              <Button type="submit" variant="primary" size="md" disabled={busy}>
                {d.holdSubmit}
              </Button>
            </div>
          </form>
        </div>
      )}

      {statementFor && (
        <StudentStatementPanel
          userId={statementFor.userId}
          studentName={statementFor.name}
          onClose={() => setStatementFor(null)}
        />
      )}
    </section>
  );
}
