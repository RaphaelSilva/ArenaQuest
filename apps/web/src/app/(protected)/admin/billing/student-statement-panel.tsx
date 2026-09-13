'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Table, TableBody, TableCell, TableHeader, TableRow } from '@web/components/design-system';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { Spinner } from '@web/components/spinner';
import type {
  BillingStatementContractGroup,
  BillingStudentStatement,
  BillingSubscription,
} from '@web/lib/admin-billing-api';
import { ContractActions } from './contract-actions';
import { ContractChain } from './contract-chain';
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
  const client = useApiClient();

  const [statement, setStatement] = useState<BillingStudentStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Bumped after a lifecycle change or an amendment so the statement is read
   * again. The chain, the status and the terms then come from the server's
   * answer rather than from a client-side edit of what was already on screen —
   * which is also why nothing here reloads the page.
   */
  const [reloadToken, setReloadToken] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * The student whose statement is currently rendered. A *reload* keeps the
   * panel on screen; only the first read of a student blanks it to a spinner.
   */
  const rendered = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (rendered.current !== userId) {
      setStatement(null);
      setLoading(true);
    }
    setError(null);
    void (async () => {
      try {
        const data = await client.adminBilling.students.statement(userId);
        if (!cancelled) {
          rendered.current = userId;
          setStatement(data);
        }
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
  }, [client, userId, d.loadError, reloadToken]);

  const applied = (successMessage: string) => {
    setNotice(successMessage);
    setReloadToken((token) => token + 1);
  };

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

        {notice && (
          <p
            role="status"
            className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
          >
            {notice}
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
                          The version chain, and the actions the version in
                          force allows. Both are read from this statement: the
                          order is the order the API delivered and the current
                          version comes from `supersedesId`, so no second query
                          and no date arithmetic reconstructs the history.

                          Nothing here derives a standing, a due date's
                          consequence or an aging bucket. That resolution lives
                          on the server, where a hold can reach it, and this
                          panel shows what it resolved.
                        */}
                        <ContractChain
                          group={group}
                          currency={statement.currency}
                          currentVersionId={version?.id ?? null}
                        />

                        {version && (
                          <ContractActions
                            version={version}
                            currency={statement.currency}
                            onChanged={applied}
                          />
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
