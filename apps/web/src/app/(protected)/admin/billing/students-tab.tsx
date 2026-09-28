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
import { SignContractDialog } from './sign-contract-dialog';
import type { SignableStudent } from './sign-contract-dialog';

/**
 * `contractStanding=exempt` is the held filter — a hold is the only way a
 * student reaches it, and a hold applies to the monthly fee only.
 */
const CONTRACT_STANDINGS: readonly Standing[] = ['good', 'due', 'delinquent', 'exempt'];

/** The extras rail has no hold (RFC 0015 Resolved #9), so `exempt` is unreachable there. */
const EXTRAS_STANDINGS: readonly Standing[] = ['good', 'due', 'delinquent'];

type RailRows = readonly BillingRosterEntry[];

/**
 * The code a rail's total is stated in. Two codes on screen mean there is no
 * single total to state, so the joined code is handed to `Money`, which
 * withholds the amount rather than adding two currencies together.
 */
function totalCode(rows: RailRows, fallback: string | undefined): string | undefined {
  const codes = [...new Set(rows.map((row) => row.currency))];
  if (codes.length === 0) return fallback;
  return codes.length === 1 ? codes[0] : codes.sort().join('/');
}

type HoldDraft = { entry: BillingRosterEntry; name: string };

/**
 * The signing dialog's open state. `fromStatement` records the entry point:
 * on success the statement panel is closed as well, so the administrator lands
 * on the refreshed roster — which is where the newly signed student is now
 * visible, and where they had no row before.
 */
type SignDraft = { userId: string | null; fromStatement: boolean };

export function StudentsTab({
  currency,
  nameOf,
  onRosterChanged,
  students,
}: {
  currency: BillingReportCurrency | null;
  nameOf: (userId: string) => string;
  onRosterChanged: () => void;
  /**
   * Candidates for the signing picker, from the **admin user list**. A student
   * holding no contract has no roster line at all, so the roster below could
   * never supply them.
   */
  students: readonly SignableStudent[];
}) {
  const dict = useDict();
  const d = dict.admin.billing.students;
  const client = useApiClient();
  const contractFilterId = useId();
  const extrasFilterId = useId();

  const [contractStanding, setContractStanding] = useState<Standing | ''>('');
  const [extrasStanding, setExtrasStanding] = useState<Standing | ''>('');
  const [rows, setRows] = useState<BillingRosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [holdDraft, setHoldDraft] = useState<HoldDraft | null>(null);
  const [holdReason, setHoldReason] = useState('');
  const [holdExpiresAt, setHoldExpiresAt] = useState('');
  const [holdFormError, setHoldFormError] = useState<string | null>(null);

  const [statementFor, setStatementFor] = useState<{
    userId: string;
    name: string;
    contractStanding: Standing | null;
  } | null>(null);

  const [signDraft, setSignDraft] = useState<SignDraft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Both standing filters are **server** parameters, independent of each
   * other. Filtering a cached list locally would put a second copy of the
   * standing rule in the client, where a hold set on another screen could
   * never reach it.
   */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await client.adminBilling.students.roster({
        contractStanding: contractStanding || undefined,
        extrasStanding: extrasStanding || undefined,
      });
      setRows(data);
    } catch {
      setRows([]);
      setError(d.loadError);
    } finally {
      setLoading(false);
    }
  }, [client, contractStanding, extrasStanding, d.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * One total per rail — never one merged figure (RFC 0015 Resolved #5). Every
   * listed balance is summed, held rows included: a hold stops the chasing,
   * not the debt, so it never removes money from a total on screen.
   */
  const contractRows = useMemo(() => rows.filter((row) => row.contract !== null), [rows]);
  const extrasRows = useMemo(() => rows.filter((row) => row.extras !== null), [rows]);
  const contractTotal = useMemo(
    () => contractRows.reduce((sum, row) => sum + (row.contract?.outstandingMinor ?? 0), 0),
    [contractRows],
  );
  const extrasTotal = useMemo(
    () => extrasRows.reduce((sum, row) => sum + (row.extras?.outstandingMinor ?? 0), 0),
    [extrasRows],
  );
  const contractTotalCode = useMemo(
    () => totalCode(contractRows, currency?.code),
    [contractRows, currency],
  );
  const extrasTotalCode = useMemo(
    () => totalCode(extrasRows, currency?.code),
    [extrasRows, currency],
  );

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

  /**
   * A signature ends in a re-read roster: the whole point is that a student who
   * had no row now has one, and the delinquency badge is told so it can follow.
   */
  const onSigned = async (studentName: string) => {
    const fromStatement = signDraft?.fromStatement ?? false;
    setSignDraft(null);
    if (fromStatement) setStatementFor(null);
    setActionError(null);
    setNotice(dict.admin.billing.sign.success(studentName));
    await load();
    onRosterChanged();
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
            htmlFor={contractFilterId}
            className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]"
          >
            {d.contractFilterLabel}
          </label>
          <select
            id={contractFilterId}
            value={contractStanding}
            onChange={(event) => setContractStanding(event.target.value as Standing | '')}
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          >
            <option value="">{d.filterAll}</option>
            {CONTRACT_STANDINGS.map((value) => (
              <option key={value} value={value}>
                {dict.admin.billing.standing[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor={extrasFilterId}
            className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]"
          >
            {d.extrasFilterLabel}
          </label>
          <select
            id={extrasFilterId}
            value={extrasStanding}
            onChange={(event) => setExtrasStanding(event.target.value as Standing | '')}
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          >
            <option value="">{d.filterAll}</option>
            {EXTRAS_STANDINGS.map((value) => (
              <option key={value} value={value}>
                {dict.admin.billing.standing[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {d.contractTotalOutstanding}
          </p>
          <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
            <Money amountMinor={contractTotal} currency={currency} code={contractTotalCode} />
          </p>
        </div>

        <div className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {d.extrasTotalOutstanding}
          </p>
          <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
            <Money amountMinor={extrasTotal} currency={currency} code={extrasTotalCode} />
          </p>
        </div>

        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={() => {
            setNotice(null);
            setActionError(null);
            setSignDraft({ userId: null, fromStatement: false });
          }}
          aria-label={dict.admin.billing.sign.buttonAriaLabel}
        >
          {dict.admin.billing.sign.button}
        </Button>

        <p className="text-xs text-zinc-500">{d.count(rows.length)}</p>
      </div>

      {notice && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </p>
      )}

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
              <TableCell isHeader>{d.columns.contract}</TableCell>
              <TableCell isHeader>{d.columns.extras}</TableCell>
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
                    {row.contract ? (
                      <div className="space-y-1">
                        <StandingBadge
                          standing={row.contract.standing}
                          railLabel={dict.admin.billing.rails.contract}
                        />
                        <span className="block font-medium">
                          <Money
                            amountMinor={row.contract.outstandingMinor}
                            currency={currency}
                            code={row.currency}
                          />
                        </span>
                        {row.contract.oldestOverdueDate && (
                          <span className="block text-xs text-zinc-500">
                            {d.oldestOverdue(row.contract.oldestOverdueDate)}
                          </span>
                        )}
                        {row.contract.nextDueDate && (
                          <span className="block text-xs text-zinc-500">
                            {d.nextDue(row.contract.nextDueDate)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-zinc-500">{d.noContract}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.extras ? (
                      <div className="space-y-1">
                        <StandingBadge
                          standing={row.extras.standing}
                          railLabel={dict.admin.billing.rails.extras}
                        />
                        <span className="block font-medium">
                          <Money
                            amountMinor={row.extras.outstandingMinor}
                            currency={currency}
                            code={row.currency}
                          />
                        </span>
                        <span className="block text-xs text-zinc-500">
                          {d.extrasCounts(row.extras.overdueCharges, row.extras.openCharges)}
                        </span>
                        {row.extras.oldestOverdueDate && (
                          <span className="block text-xs text-zinc-500">
                            {d.oldestOverdue(row.extras.oldestOverdueDate)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-zinc-500">{d.none}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.contract
                      ? row.contract.negotiatedTerms
                        ? d.negotiated
                        : d.standardTerms
                      : d.none}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          setStatementFor({
                            userId: row.userId,
                            name,
                            contractStanding: row.contract?.standing ?? null,
                          })
                        }
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
                      ) : row.contract ? (
                        // A hold applies to the monthly fee only, so an
                        // extras-only buyer has nothing to hold.
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
                      ) : null}
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
          contractStanding={statementFor.contractStanding}
          onClose={() => setStatementFor(null)}
          onSignContract={(userId) => setSignDraft({ userId, fromStatement: true })}
        />
      )}

      {signDraft && (
        <SignContractDialog
          students={students}
          currency={currency}
          initialUserId={signDraft.userId}
          onClose={() => setSignDraft(null)}
          onSigned={(studentName) => void onSigned(studentName)}
        />
      )}
    </section>
  );
}
