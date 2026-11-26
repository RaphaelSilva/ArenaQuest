'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatMoney } from '@arenaquest/shared/domain/billing/format-money';
import { useDict } from '@web/context/dict-context';
import type { MyBillingStatement } from '@web/lib/me-billing-api';
import { useMyStatement } from './my-statement';

/**
 * The account standing notice.
 *
 * **It is a notice, not a paywall.** It renders a line of text, a link to the
 * student's own statement and a dismiss button, and it changes nothing else in
 * the application: it guards no route, hides no link, disables no control, dims
 * no section and blocks no navigation. A student who is behind on tuition sees
 * exactly the application they saw the day before, plus this line.
 *
 * **Its visibility follows `standing` and nothing else.** The value is resolved
 * by the API on every read; there is no grace-day arithmetic, no comparison
 * against today's date and no threshold constant here. That is also what makes
 * a hold work for free: a held student comes back as `exempt`, which is not in
 * the shown set, so the notice disappears with no client-side rule to keep in
 * sync with the server's.
 *
 * **Dismissal is free and local.** It is component state for the current view —
 * no request is issued, nothing is marked as read or acknowledged, and no
 * record of the dismissal exists anywhere the platform could act on.
 */

/** The standings that get a notice. Read straight off the API's own value. */
const NOTIFIED_STANDINGS = ['due', 'delinquent'] as const;

type NotifiedStanding = (typeof NOTIFIED_STANDINGS)[number];

function isNotified(standing: MyBillingStatement['standing']): standing is NotifiedStanding {
  return (NOTIFIED_STANDINGS as readonly string[]).includes(standing);
}

export function StandingBanner() {
  const dict = useDict();
  const d = dict.layout.standingBanner;
  // The shared read (`my-statement.ts`): the dashboard's payment due card
  // subscribes to the same one, so the shell issues a single request. A
  // statement that cannot be read comes back as `null` and is simply not
  // announced — a billing notice is never worth an error banner over the
  // whole application.
  const { statement } = useMyStatement();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || statement === null) return null;
  if (!isNotified(statement.standing)) return null;

  const amount = formatMoney(statement.outstandingMinor, {
    exponent: statement.currency.exponent,
    symbol: statement.currency.symbol,
    locale: d.locale,
  });

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={d.label}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 md:px-6 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <p className="min-w-0 flex-1">{d[statement.standing](amount)}</p>
      <Link href="/settings/billing" className="font-medium underline underline-offset-2">
        {d.link}
      </Link>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={d.dismiss}
        className="rounded-md px-2 py-1 text-amber-900/70 hover:bg-amber-100 hover:text-amber-900 dark:text-amber-100/70 dark:hover:bg-amber-900/40 dark:hover:text-amber-50"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
