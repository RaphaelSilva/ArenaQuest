'use client';

import { useEffect, useState } from 'react';
import { Button, Table, TableBody, TableCell, TableHeader, TableRow } from '@web/components/design-system';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { Spinner } from '@web/components/spinner';
import type {
  BillingStatementContractGroup,
  BillingStudentStatement,
  BillingSubscription,
} from '@web/lib/admin-billing-api';
import { Money } from './money';

/**
 * The version of a contract group that is in force now.
 *
 * `supersedesId` is the reliable signal: an amendment points at the version it
 * replaces, so the current version is the one no sibling supersedes. That is
 * order-independent and survives any change to how the list is serialised.
 *
 * When no sibling supersedes anything — a group of one, the ordinary case — the
 * last element is taken instead. That is not a guess: `groupContracts` in
 * `apps/api/src/core/billing/accounting-service.ts` sorts `versions` ascending
 * by `startDate` then `signedAt` and derives the group's own `status` and
 * `endDate` from exactly that element, so the terms shown here agree with the
 * status rendered beside them.
 */
function currentVersion(group: BillingStatementContractGroup): BillingSubscription | null {
  if (group.versions.length === 0) return null;
  const superseded = new Set(
    group.versions
      .map((version) => version.supersedesId)
      .filter((id): id is string => id !== null),
  );
  const live = group.versions.filter((version) => !superseded.has(version.id));
  return live.length === 1 ? live[0] : group.versions[group.versions.length - 1];
}

/**
 * The per-student drill-down from the Students tab.
 *
 * The statement carries its own `currency`, exponent and symbol, so amounts
 * here are formatted against the student's own currency rather than the
 * console-wide one.
 */
export function StudentStatementPanel({
  userId,
  studentName,
  onClose,
  onSignContract,
}: {
  userId: string;
  studentName: string;
  onClose: () => void;
  /**
   * The second entry point into signing (RFC 0013 §7). Optional: the panel is
   * readable on its own, and a caller that offers no signing surface simply
   * omits it.
   */
  onSignContract?: (userId: string) => void;
}) {
  const dict = useDict();
  const d = dict.admin.billing.statement;
  const ledgerDict = dict.admin.billing.ledger;
  // The cycle and grace-day spellings already in the dictionary — this panel
  // adds no second wording for either.
  const planDict = dict.admin.billing.plans;
  const client = useApiClient();

  const [statement, setStatement] = useState<BillingStudentStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const data = await client.adminBilling.students.statement(userId);
        if (!cancelled) setStatement(data);
      } catch {
        if (!cancelled) {
          setStatement(null);
          setError(d.loadError);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, userId, d.loadError]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={d.heading(studentName)}
    >
      <div className="my-8 w-full max-w-3xl space-y-5 rounded-lg border border-zinc-200 bg-white p-5 md:p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {d.heading(studentName)}
          </h2>
          <div className="flex flex-wrap gap-2">
            {onSignContract && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onSignContract(userId)}
                aria-label={dict.admin.billing.sign.statementAriaLabel(studentName)}
              >
                {dict.admin.billing.sign.statementButton}
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              {d.close}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner className="h-6 w-6 text-zinc-400" />
          </div>
        ) : error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : statement ? (
          <div className="space-y-5">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  {d.outstanding}
                </dt>
                <dd className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                  <Money amountMinor={statement.outstandingMinor} currency={statement.currency} />
                </dd>
              </div>
              <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  {d.studentSince}
                </dt>
                <dd className="text-sm text-zinc-900 dark:text-zinc-50">
                  {statement.studentSince ?? d.none}
                </dd>
              </div>
              <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  {d.currentMembershipSince}
                </dt>
                <dd className="text-sm text-zinc-900 dark:text-zinc-50">
                  {statement.currentMembershipSince ?? d.none}
                </dd>
              </div>
            </dl>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {d.contractsHeading}
              </h3>
              {statement.contractGroups.length === 0 ? (
                <p className="text-sm text-zinc-500">{d.contractsEmpty}</p>
              ) : (
                <ul className="space-y-2">
                  {statement.contractGroups.map((group) => {
                    const version = currentVersion(group);
                    return (
                      <li
                        key={group.contractGroupId}
                        className="rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
                      >
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {group.startDate}
                        </span>
                        <span className="text-zinc-500">
                          {` · ${group.endDate ?? d.none} · ${d.contractVersions(group.versions.length)}`}
                        </span>

                        {/*
                          The terms the contract records now — this is what makes
                          "why does this student pay a different amount?"
                          answerable from the product rather than from a database
                          query. The version chain and the amendment history are
                          deliberately not rendered here; that is Task 11's.

                          `dueDay` and `graceDays` are shown as the data they are.
                          Nothing is derived from either: a due date's consequence
                          and a grace outcome are resolved on the server, where a
                          hold can reach them.
                        */}
                        {version && (
                          <div className="mt-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
                            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                              {d.currentTermsHeading}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                              {d.currentTermsNote}
                            </p>
                            <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                  {d.termsAmount}
                                </dt>
                                <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                                  <Money
                                    amountMinor={version.amountMinor}
                                    currency={statement.currency}
                                    code={version.currency}
                                  />
                                </dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                  {d.termsCycle}
                                </dt>
                                <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                                  {planDict.cycle[version.cycle]}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                  {d.termsDueDay}
                                </dt>
                                <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                                  {version.dueDay}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                  {d.termsGraceDays}
                                </dt>
                                <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                                  {planDict.graceDaysValue(version.graceDays)}
                                </dd>
                              </div>
                            </dl>
                            {version.termsSource === 'negotiated' && (
                              <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                                {d.termsNegotiated}
                              </p>
                            )}
                            {version.termsNote !== '' && (
                              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                                {`${d.termsNoteLabel}: ${version.termsNote}`}
                              </p>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {d.invoicesHeading}
              </h3>
              {statement.invoices.length === 0 ? (
                <p className="text-sm text-zinc-500">{d.invoicesEmpty}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow isHoverable={false}>
                      <TableCell isHeader>{d.columns.period}</TableCell>
                      <TableCell isHeader>{d.columns.due}</TableCell>
                      <TableCell isHeader>{d.columns.status}</TableCell>
                      <TableCell isHeader>{d.columns.amount}</TableCell>
                      <TableCell isHeader>{d.columns.balance}</TableCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statement.invoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell>{`${invoice.periodStart} — ${invoice.periodEnd}`}</TableCell>
                        <TableCell>{invoice.dueDate}</TableCell>
                        <TableCell>{ledgerDict.invoiceStatus[invoice.status]}</TableCell>
                        <TableCell>
                          <Money amountMinor={invoice.amountMinor} currency={statement.currency} />
                        </TableCell>
                        <TableCell>
                          <Money amountMinor={invoice.balanceMinor} currency={statement.currency} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
