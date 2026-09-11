'use client';

import { useEffect, useState } from 'react';
import {
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
import { AdminBillingApiError } from '@web/lib/admin-billing-api';
import type { BillingAgingReport, BillingMovementReport } from '@web/lib/admin-billing-api';
import { Money } from './money';

/** `YYYY-MM` for the current month — the report's own default starting point. */
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function ReportsTab() {
  const dict = useDict();
  const d = dict.admin.billing.reports;
  const client = useApiClient();

  const [month, setMonth] = useState(currentMonth);
  const [asOf, setAsOf] = useState('');

  const [movement, setMovement] = useState<BillingMovementReport | null>(null);
  const [movementLoading, setMovementLoading] = useState(true);
  const [movementError, setMovementError] = useState<string | null>(null);

  const [aging, setAging] = useState<BillingAgingReport | null>(null);
  const [agingLoading, setAgingLoading] = useState(true);
  const [agingError, setAgingError] = useState<string | null>(null);

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    let cancelled = false;
    setMovementLoading(true);
    setMovementError(null);
    void (async () => {
      try {
        const data = await client.adminBilling.reports.movement(month);
        if (!cancelled) setMovement(data);
      } catch (error) {
        if (!cancelled) {
          setMovement(null);
          // A 409 is the two-currency refusal, not a failure to load: the API
          // will not convert between currencies, and neither will this screen.
          setMovementError(
            error instanceof AdminBillingApiError && error.status === 409
              ? d.conflictNote
              : d.movement.loadError,
          );
        }
      } finally {
        if (!cancelled) setMovementLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, month, d.conflictNote, d.movement.loadError]);

  useEffect(() => {
    let cancelled = false;
    setAgingLoading(true);
    setAgingError(null);
    void (async () => {
      try {
        const data = await client.adminBilling.reports.aging(asOf || undefined);
        if (!cancelled) setAging(data);
      } catch (error) {
        if (!cancelled) {
          setAging(null);
          setAgingError(
            error instanceof AdminBillingApiError && error.status === 409
              ? d.conflictNote
              : d.aging.loadError,
          );
        }
      } finally {
        if (!cancelled) setAgingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, asOf, d.conflictNote, d.aging.loadError]);

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{d.heading}</h2>
        <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{d.holdNote}</p>
      </div>

      <div className="space-y-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {d.movement.heading}
          </h3>
          <Input
            label={d.movement.monthLabel}
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </div>

        {movementLoading ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-6 w-6 text-zinc-400" />
          </div>
        ) : movementError ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {movementError}
          </p>
        ) : movement ? (
          <>
            <p className="text-xs text-zinc-500">
              {d.movement.period(movement.periodStart, movement.periodEnd)}
            </p>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(
                [
                  [d.movement.billed, movement.billedMinor],
                  [d.movement.received, movement.receivedMinor],
                  [d.movement.outstanding, movement.outstandingMinor],
                  [d.movement.invoiced, movement.invoicedMinor],
                  [d.movement.adjustments, movement.adjustmentsMinor],
                ] as const
              ).map(([label, amountMinor]) => (
                <div
                  key={label}
                  className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
                >
                  <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    {label}
                  </dt>
                  <dd className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                    <Money amountMinor={amountMinor} currency={movement.currency} />
                  </dd>
                </div>
              ))}
              <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  {d.movement.invoicesIssued}
                </dt>
                <dd className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                  {movement.invoicesIssued}
                </dd>
              </div>
              <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  {d.movement.activeStudents}
                </dt>
                <dd className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                  {movement.activeStudents}
                </dd>
              </div>
            </dl>
          </>
        ) : null}
      </div>

      <div className="space-y-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {d.aging.heading}
          </h3>
          <Input
            label={d.aging.asOfLabel}
            type="date"
            value={asOf}
            onChange={(event) => setAsOf(event.target.value)}
          />
        </div>

        {agingLoading ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-6 w-6 text-zinc-400" />
          </div>
        ) : agingError ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {agingError}
          </p>
        ) : aging ? (
          <Table>
            <TableHeader>
              <TableRow isHoverable={false}>
                <TableCell isHeader>{d.aging.columns.bucket}</TableCell>
                <TableCell isHeader>{d.aging.columns.invoices}</TableCell>
                <TableCell isHeader>{d.aging.columns.students}</TableCell>
                <TableCell isHeader>{d.aging.columns.total}</TableCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {aging.buckets.map((bucket) => (
                <TableRow key={bucket.bucket}>
                  <TableCell>{d.aging.buckets[bucket.bucket]}</TableCell>
                  <TableCell>{bucket.invoiceCount}</TableCell>
                  <TableCell>{bucket.studentCount}</TableCell>
                  <TableCell>
                    <Money amountMinor={bucket.totalMinor} currency={aging.currency} />
                  </TableCell>
                </TableRow>
              ))}
              <TableRow isHoverable={false}>
                <TableCell className="font-semibold">{d.aging.totalRow}</TableCell>
                <TableCell className="font-semibold">{aging.invoiceCount}</TableCell>
                <TableCell className="font-semibold">{aging.studentCount}</TableCell>
                <TableCell className="font-semibold">
                  <Money amountMinor={aging.totalMinor} currency={aging.currency} />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        ) : null}
      </div>
    </section>
  );
}
