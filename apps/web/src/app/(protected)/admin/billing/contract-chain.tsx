'use client';

import { useDict } from '@web/context/dict-context';
import type {
  BillingReportCurrency,
  BillingStatementContractGroup,
  BillingSubscription,
} from '@web/lib/admin-billing-api';
import { Money } from './money';

/**
 * The version chain of one contract group — RFC 0013 §7, "Amend a contract".
 *
 * Renegotiation **supersedes**: the live version closes and a new one opens
 * carrying `supersedesId`, so the terms an invoice was issued under stay on
 * file forever. An administrator who cannot see that history was *added* will
 * assume it was overwritten and will not use the feature at all, which is why
 * every version is rendered here with the terms it was signed with rather than
 * only the one in force.
 *
 * The chain is **read, never reconstructed**. The order is the order the
 * statement delivered (`accounting-service.ts` sorts `versions` ascending by
 * `startDate` then `signedAt`), and which version is in force arrives as
 * `currentVersionId`, resolved from `supersedesId` by the panel. Nothing here
 * sorts, no second query is issued, and no ordering is inferred from a date.
 *
 * Purely presentational: it offers no control at all. Amending is the only way
 * signed terms change, and it lives in `contract-actions.tsx`.
 */
export function ContractChain({
  group,
  currency,
  currentVersionId,
}: {
  group: BillingStatementContractGroup;
  /** The statement's own currency, so amounts render at its recorded exponent. */
  currency: BillingReportCurrency | null;
  /** The version in force, or `null` when the group carries none. */
  currentVersionId: string | null;
}) {
  const dict = useDict();
  const d = dict.admin.billing.contract;
  const statementDict = dict.admin.billing.statement;
  // The cycle and grace-day spellings already in the dictionary — this chain
  // adds no second wording for either.
  const planDict = dict.admin.billing.plans;

  if (group.versions.length === 0) return null;

  return (
    <div className="mt-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {statementDict.currentTermsHeading}
      </p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{d.chainNote}</p>

      <ol className="mt-2 space-y-2">
        {group.versions.map((version: BillingSubscription, index) => {
          const isCurrent = version.id === currentVersionId;
          return (
            <li
              key={version.id}
              className={`rounded-md border p-3 ${
                isCurrent
                  ? 'border-zinc-400 bg-zinc-50 dark:border-zinc-500 dark:bg-zinc-800/40'
                  : 'border-zinc-200 dark:border-zinc-800'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  {d.versionLabel(index + 1)}
                </span>
                <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                  {d.status[version.status]}
                </span>
                {isCurrent && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                    {d.currentVersion}
                  </span>
                )}
              </div>

              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {version.endDate
                  ? d.versionPeriod(version.startDate, version.endDate)
                  : d.versionPeriodOpen(version.startDate)}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {d.signedOn(version.signedAt)}
              </p>

              {isCurrent ? (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {statementDict.currentTermsNote}
                </p>
              ) : (
                version.status === 'superseded' && (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {d.supersededNote}
                  </p>
                )
              )}

              {/*
                Every version carries its own terms, superseded ones included.
                `dueDay` and `graceDays` are shown as the data they are: nothing
                is derived from either, because a due date's consequence and a
                grace outcome are resolved on the server, where a hold can reach
                them.
              */}
              <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    {statementDict.termsAmount}
                  </dt>
                  <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                    <Money
                      amountMinor={version.amountMinor}
                      currency={currency}
                      code={version.currency}
                    />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    {statementDict.termsCycle}
                  </dt>
                  <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                    {planDict.cycle[version.cycle]}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    {statementDict.termsDueDay}
                  </dt>
                  <dd className="font-medium text-zinc-900 dark:text-zinc-50">{version.dueDay}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    {statementDict.termsGraceDays}
                  </dt>
                  <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                    {planDict.graceDaysValue(version.graceDays)}
                  </dd>
                </div>
              </dl>

              {version.termsSource === 'negotiated' && (
                <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                  {statementDict.termsNegotiated}
                </p>
              )}
              {version.termsNote !== '' && (
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  {`${statementDict.termsNoteLabel}: ${version.termsNote}`}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
