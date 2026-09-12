'use client';

import { useId, useRef, useState } from 'react';
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
  BillingRunReport,
  RunInvoiceCycleInput,
} from '@web/lib/admin-billing-api';
import { Money } from './money';
import { StandingBadge } from './standing-badge';
import { explain } from './explain-error';

/**
 * Run the billing cycle by hand — RFC 0013 §6/§7.
 *
 * The manual twin of the 06:00 cron, which exists so a missed firing is
 * recoverable without a deploy. The endpoint runs the *identical* routine, so
 * this panel is not a preview: confirming it issues invoices and sends mail,
 * and the confirmation says so before the request goes out.
 *
 * **The report is the point.** A run that returns success tells an
 * administrator nothing about whether the month was billed, so every field of
 * `BillingRunReport` is rendered rather than collapsed into a headline —
 * including the sections that are empty, because "no crossing" is itself the
 * answer to "did anyone fall behind?".
 *
 * **Nothing here is derived.** Standing crossings come from the report's own
 * `from`/`to` through `StandingBadge`; no due-date, grace-day or aging rule is
 * recomputed in the client. The three outcomes below read `absorbed` and
 * `eligibleContracts` and nothing else.
 *
 * **The run repairs nothing.** The route "writes no adjustment of any kind and
 * repairs no status", so a cached-status divergence is listed as a finding and
 * no control on this panel offers to fix one.
 */

/**
 * Which of the run's results this was, read straight off the report.
 *
 * `issued` is unambiguous. With nothing issued, `absorbed > 0` is the
 * idempotency path — the expected result of a second run — and
 * `eligibleContracts === 0` means nothing was in scope at all. The remaining
 * case (contracts in scope, none with a period to bill, nothing absorbed) is
 * named too, so a successful run is never rendered as an ambiguous blank.
 */
type Outcome = 'issued' | 'already-billed' | 'nothing-to-issue' | 'none-due';

function outcomeOf(report: BillingRunReport): Outcome {
  if (report.issued.length > 0) return 'issued';
  if (report.absorbed > 0) return 'already-billed';
  if (report.eligibleContracts === 0) return 'nothing-to-issue';
  return 'none-due';
}

/** A short, stable handle for an id in the UI and in an aria-label. */
function shortRef(id: string): string {
  return id.slice(0, 8);
}

export function RunCyclePanel({
  currency,
  nameOf,
  onIssued,
}: {
  currency: BillingReportCurrency | null;
  nameOf: (userId: string) => string;
  /** Called only when the run actually issued something, so the list re-reads. */
  onIssued: () => void;
}) {
  const dict = useDict();
  const d = dict.admin.billing.run;
  const client = useApiClient();

  const asOfId = useId();
  const sinceId = useId();

  const [confirming, setConfirming] = useState(false);
  const [asOf, setAsOf] = useState('');
  const [since, setSince] = useState('');

  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<BillingRunReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * A ref rather than the `busy` state: it flips before the first `await`, so a
   * second click landing in the same tick — a double click — is refused without
   * waiting for a re-render to disable the button.
   */
  const running = useRef(false);

  const run = async () => {
    if (running.current) return;
    running.current = true;

    const input: RunInvoiceCycleInput = {};
    if (asOf) input.asOf = asOf;
    if (since) input.since = since;

    setBusy(true);
    setError(null);
    setReport(null);
    try {
      // An empty window posts no body at all, so the server applies its own
      // defaults instead of being handed this browser's idea of today.
      const data = await client.adminBilling.invoices.run(
        Object.keys(input).length > 0 ? input : undefined,
      );
      setReport(data);
      if (data.issued.length > 0) onIssued();
    } catch (thrown) {
      // No report is rendered on a failure: a partial one would read as a
      // complete run that did less than it did.
      setReport(null);
      setError(explain(thrown, d.error));
    } finally {
      setBusy(false);
      setConfirming(false);
      running.current = false;
    }
  };

  const outcome = report ? outcomeOf(report) : null;

  return (
    <section className="space-y-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{d.heading}</h3>
          <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{d.purpose}</p>
          <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{d.idempotentNote}</p>
          {/* Spelled out because the run is often reached by someone chasing a
              late payment: it charges nothing extra and gates nothing. */}
          <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{d.noFeeNote}</p>
          <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{d.noGateNote}</p>
        </div>
        <Button
          type="button"
          variant="primary"
          size="md"
          disabled={busy}
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          aria-label={d.buttonAriaLabel}
        >
          {d.button}
        </Button>
      </div>

      {error && (
        <div role="alert" className="space-y-1 text-sm text-red-600 dark:text-red-400">
          <p>{error}</p>
          <p className="text-xs">{d.errorNoReport}</p>
        </div>
      )}

      {report && outcome && (
        <div className="space-y-5">
          {/* ---------------------------------------------------------------
              The outcome. Stated first and stated plainly, so success with an
              empty report is never mistaken for a failure — nor for a first
              run that found work to do.
              --------------------------------------------------------------- */}
          <div
            role="status"
            className="space-y-1 rounded-md bg-emerald-100 px-4 py-3 text-sm text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
          >
            <p className="font-semibold">
              {outcome === 'issued'
                ? d.outcome.issuedTitle(report.issued.length)
                : outcome === 'already-billed'
                  ? d.outcome.alreadyBilledTitle
                  : outcome === 'nothing-to-issue'
                    ? d.outcome.nothingToIssueTitle
                    : d.outcome.noneDueTitle}
            </p>
            <p>
              {outcome === 'issued'
                ? d.outcome.issuedBody
                : outcome === 'already-billed'
                  ? d.outcome.alreadyBilledBody(report.absorbed)
                  : outcome === 'nothing-to-issue'
                    ? d.outcome.nothingToIssueBody
                    : d.outcome.noneDueBody(report.eligibleContracts)}
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {d.report.heading}
            </h4>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {d.report.window(report.since, report.asOf)}
            </p>

            {/* Every counter the report carries, so `eligibleContracts` and
                `absorbed` are readable rather than only implied. */}
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {(
                [
                  [d.report.counters.eligibleContracts, report.eligibleContracts],
                  [d.report.counters.issued, report.issued.length],
                  [d.report.counters.absorbed, report.absorbed],
                  [d.report.counters.mailsSent, report.mailsSent],
                  [d.report.counters.adminsNotified, report.adminsNotified],
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                >
                  <dt className="text-xs text-zinc-500">{label}</dt>
                  <dd className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* ---------------------------------------------------------------
              Invoices issued.
              --------------------------------------------------------------- */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {d.report.issuedHeading}
            </h4>
            {report.issued.length === 0 ? (
              <p className="text-sm text-zinc-500">{d.report.issuedEmpty}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow isHoverable={false}>
                    <TableCell isHeader>{d.report.issuedColumns.invoice}</TableCell>
                    <TableCell isHeader>{d.report.issuedColumns.student}</TableCell>
                    <TableCell isHeader>{d.report.issuedColumns.period}</TableCell>
                    <TableCell isHeader>{d.report.issuedColumns.due}</TableCell>
                    <TableCell isHeader>{d.report.issuedColumns.amount}</TableCell>
                    <TableCell isHeader>{d.report.issuedColumns.status}</TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.issued.map((row) => (
                    <TableRow key={row.invoiceId}>
                      <TableCell className="font-mono text-xs">
                        {shortRef(row.invoiceId)}
                      </TableCell>
                      <TableCell>{nameOf(row.userId)}</TableCell>
                      <TableCell>{row.periodStart}</TableCell>
                      <TableCell>{row.dueDate}</TableCell>
                      <TableCell>
                        {/* The row's own currency code: an amount in a currency
                            this console did not resolve is withheld, never
                            rendered at the wrong scale. */}
                        <Money
                          amountMinor={row.amountMinor}
                          currency={currency}
                          code={row.currency}
                        />
                      </TableCell>
                      <TableCell>{dict.admin.billing.ledger.invoiceStatus[row.status]}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {/* ---------------------------------------------------------------
              The two student notices.
              --------------------------------------------------------------- */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {d.report.remindersHeading}
            </h4>
            <p className="max-w-3xl text-xs text-zinc-500">{d.holdNote}</p>
            {report.reminders.length === 0 ? (
              <p className="text-sm text-zinc-500">{d.report.remindersEmpty}</p>
            ) : (
              <ul className="space-y-2">
                {report.reminders.map((reminder) => (
                  <li
                    key={`${reminder.invoiceId}-${reminder.kind}`}
                    className="rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {`${nameOf(reminder.userId)} · ${d.report.reminderKind[reminder.kind]}`}
                      </span>
                      <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                        {reminder.suppressedByHold
                          ? d.report.reminderSuppressed
                          : reminder.sent
                            ? d.report.reminderSent
                            : d.report.reminderNotSent}
                      </span>
                    </div>
                    <span className="block text-xs text-zinc-500">
                      {d.report.reminderDates(reminder.dueDate, reminder.triggerOn)}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {d.report.reminderBalance}{' '}
                      <Money
                        amountMinor={reminder.balanceMinor}
                        currency={currency}
                        code={reminder.currency}
                      />
                    </span>
                    <span className="block font-mono text-xs text-zinc-400">
                      {shortRef(reminder.invoiceId)}
                    </span>
                    {reminder.suppressedByHold && (
                      <span className="block text-xs text-amber-700 dark:text-amber-300">
                        {d.report.reminderHoldLine}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ---------------------------------------------------------------
              Standing crossings, rendered from `from`/`to` as the server
              resolved them.
              --------------------------------------------------------------- */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {d.report.crossingsHeading}
            </h4>
            <p className="max-w-3xl text-xs text-zinc-500">{d.report.crossingsNote}</p>
            {report.crossings.length === 0 ? (
              <p className="text-sm text-zinc-500">{d.report.crossingsEmpty}</p>
            ) : (
              <ul className="space-y-2">
                {report.crossings.map((crossing) => (
                  <li
                    key={`${crossing.userId}-${crossing.from}-${crossing.to}`}
                    className="rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {nameOf(crossing.userId)}
                      </span>
                      <StandingBadge standing={crossing.from} />
                      <span aria-hidden="true" className="text-zinc-400">
                        {d.report.crossingArrow}
                      </span>
                      <span className="sr-only">{d.report.crossingBecame}</span>
                      <StandingBadge standing={crossing.to} />
                    </div>
                    <span className="block text-xs text-zinc-500">
                      {crossing.oldestOverdueDate === null
                        ? d.report.noOldestOverdue
                        : d.report.oldestOverdue(crossing.oldestOverdueDate)}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {d.report.outstanding}{' '}
                      <Money
                        amountMinor={crossing.outstandingMinor}
                        currency={currency}
                        code={crossing.currency}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ---------------------------------------------------------------
              Held students whose chasing was skipped. The debt stayed.
              --------------------------------------------------------------- */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {d.report.heldHeading}
            </h4>
            <p className="max-w-3xl text-xs text-zinc-500">{d.holdNote}</p>
            {report.suppressedByHold.length === 0 ? (
              <p className="text-sm text-zinc-500">{d.report.heldEmpty}</p>
            ) : (
              <ul className="space-y-2">
                {report.suppressedByHold.map((held) => (
                  <li
                    key={held.userId}
                    className="rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
                  >
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {nameOf(held.userId)}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {d.report.heldOutstanding}{' '}
                      {/* No per-row code: the report carries none here, so the
                          console's resolved currency is the only claim to make. */}
                      <Money amountMinor={held.outstandingMinor} currency={currency} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ---------------------------------------------------------------
              Cached-status divergences: a finding, never a repair. There is
              deliberately no control in this block.
              --------------------------------------------------------------- */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {d.report.divergencesHeading}
            </h4>
            <p className="max-w-3xl text-xs text-zinc-500">{d.report.divergencesNote}</p>
            {report.divergences.length === 0 ? (
              <p className="text-sm text-zinc-500">{d.report.divergencesEmpty}</p>
            ) : (
              <ul className="space-y-2">
                {report.divergences.map((divergence) => (
                  <li
                    key={divergence.invoiceId}
                    className="rounded-md border border-amber-300 px-3 py-2 text-sm dark:border-amber-700"
                  >
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {`${nameOf(divergence.userId)} · ${shortRef(divergence.invoiceId)}`}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {d.report.divergenceLine(
                        dict.admin.billing.ledger.invoiceStatus[divergence.cachedStatus],
                        dict.admin.billing.ledger.invoiceStatus[divergence.expectedStatus],
                      )}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {d.report.divergenceBalance}{' '}
                      <Money amountMinor={divergence.balanceMinor} currency={currency} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------
          The confirmation. It names the mails *before* the run, because the
          run sends them: an administrator must not discover by surprise that
          a button emailed their students.
          ------------------------------------------------------------------- */}
      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={d.confirm.dialogTitle}
          aria-busy={busy}
        >
          <div className="max-h-full w-full max-w-lg space-y-4 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-5 md:p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {d.confirm.dialogTitle}
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.confirm.lead}</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
              <li>{d.confirm.effects.issue}</li>
              <li>{d.confirm.effects.notices}</li>
              <li>{d.confirm.effects.digest}</li>
              <li>{d.confirm.effects.assert}</li>
            </ul>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.confirm.safeAgain}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.noFeeNote}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.holdNote}</p>

            <fieldset className="space-y-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]">
                {d.confirm.windowHeading}
              </legend>
              <p className="text-xs text-zinc-500">{d.confirm.windowHelp}</p>
              <div className="flex flex-wrap gap-3">
                <Input
                  id={sinceId}
                  label={d.confirm.sinceLabel}
                  type="date"
                  value={since}
                  onChange={(event) => setSince(event.target.value)}
                />
                <Input
                  id={asOfId}
                  label={d.confirm.asOfLabel}
                  type="date"
                  value={asOf}
                  onChange={(event) => setAsOf(event.target.value)}
                />
              </div>
            </fieldset>

            {/* The pending state is announced, not merely coloured: a run that
                takes a while must not read as a hung screen to anybody. */}
            {busy && (
              <div
                role="status"
                className="flex items-center gap-3 rounded-md bg-zinc-100 px-4 py-3 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                <Spinner className="h-4 w-4 text-zinc-400" />
                <span>
                  <span className="block font-medium">{d.pending}</span>
                  <span className="block text-xs text-zinc-500">{d.pendingHint}</span>
                </span>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                size="md"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                {d.confirm.cancel}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                disabled={busy}
                onClick={() => void run()}
              >
                {d.confirm.submit}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
