'use client';

import { useEffect, useState } from 'react';
import { Button, Table, TableBody, TableCell, TableHeader, TableRow } from '@web/components/design-system';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { Spinner } from '@web/components/spinner';
import type { BillingStudentStatement } from '@web/lib/admin-billing-api';
import { Money } from './money';

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
                  {statement.contractGroups.map((group) => (
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
                    </li>
                  ))}
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
