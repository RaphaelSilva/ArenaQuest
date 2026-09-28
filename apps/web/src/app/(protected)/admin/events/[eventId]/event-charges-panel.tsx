'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { Spinner } from '@web/components/spinner';
import type {
  BillingEventChargeSummary,
  BillingReportCurrency,
} from '@web/lib/admin-billing-api';
import { Money } from '../../billing/money';
import { EXTRAS_TAB_HREF } from '../../billing/plans-tab';

/** The Extras tab of the billing console, opened on one event. */
export function extrasTabHrefFor(eventId: string): string {
  return `${EXTRAS_TAB_HREF}&eventId=${encodeURIComponent(eventId)}`;
}

const STATUSES = ['open', 'paid', 'void'] as const;

type Loaded = {
  summary: BillingEventChargeSummary;
  hasPrice: boolean;
  currency: BillingReportCurrency | null;
};

/**
 * The event page's **Charges** panel (RFC 0015 §8) — read-only by design.
 *
 * It issues `GET`s only: the event's price (to know whether it is for sale),
 * its charge summary, and the aging report for the display currency — the
 * summary carries a bare code, and the exponent `formatMoney` needs travels on
 * the reports, exactly as `/admin/billing` resolves it. No money is written
 * from the events backoffice: every write lives on the Extras tab, which the
 * panel links to with this event pre-selected.
 *
 * It renders nothing for an event with no price and no charge, so a free
 * event's page is left as it was.
 */
export function EventChargesPanel({ eventId }: { eventId: string }) {
  const dict = useDict();
  const d = dict.admin.events.charges;
  const client = useApiClient();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const [price, summary, currency] = await Promise.all([
          client.adminBilling.extras.getPrice(eventId),
          client.adminBilling.extras.summary(eventId),
          // The currency only formats the amounts: its failure withholds them
          // ("Not shown") rather than failing the panel.
          client.adminBilling.reports
            .aging()
            .then((aging) => aging.currency)
            .catch(() => null),
        ]);
        if (!cancelled) setLoaded({ summary, hasPrice: price !== null, currency });
      } catch {
        if (!cancelled) {
          setLoaded(null);
          setFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, eventId]);

  if (loading) {
    return (
      <div className="mt-8 flex justify-center">
        <Spinner className="h-5 w-5 text-zinc-400" />
      </div>
    );
  }

  if (failed || loaded === null) {
    return (
      <p
        role="alert"
        className="mt-8 rounded-lg px-4 py-3 text-sm"
        style={{ background: 'var(--error-bg)', color: 'var(--error)' }}
      >
        {d.loadError}
      </p>
    );
  }

  const { summary, hasPrice, currency } = loaded;
  if (!hasPrice && summary.chargeCount === 0) return null;

  const figures = [
    { label: d.chargedLabel, amount: summary.chargedMinor },
    { label: d.adjustmentsLabel, amount: summary.adjustmentsMinor },
    { label: d.receivedLabel, amount: summary.receivedMinor },
    { label: d.outstandingLabel, amount: summary.outstandingMinor },
  ];

  return (
    <section
      aria-labelledby="event-charges-heading"
      className="mt-8 space-y-4 rounded-xl border p-4 md:p-6"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="event-charges-heading" className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
          {d.heading}
        </h2>
        <span className="text-sm" style={{ color: 'var(--text3)' }}>
          {d.chargeCount(summary.chargeCount)}
        </span>
      </div>
      <p className="text-sm" style={{ color: 'var(--text3)' }}>
        {d.note}
      </p>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {figures.map((figure) => (
          <div key={figure.label} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
            <dt className="text-xs font-medium uppercase" style={{ color: 'var(--text3)' }}>
              {figure.label}
            </dt>
            <dd className="mt-1 text-base font-semibold" style={{ color: 'var(--text)' }}>
              <Money amountMinor={figure.amount} currency={currency} code={summary.currency} />
            </dd>
          </div>
        ))}
      </dl>

      <div>
        <h3 className="text-xs font-medium uppercase" style={{ color: 'var(--text3)' }}>
          {d.countsLabel}
        </h3>
        <ul className="mt-2 flex flex-wrap gap-4 text-sm" style={{ color: 'var(--text)' }}>
          {STATUSES.map((status) => (
            <li key={status}>
              <span style={{ color: 'var(--text3)' }}>{d.status[status]}</span>{' '}
              <span className="font-semibold">{summary.counts[status]}</span>
            </li>
          ))}
        </ul>
      </div>

      <Link href={extrasTabHrefFor(eventId)} className="inline-block text-sm font-medium" style={{ color: 'var(--accent)' }}>
        {d.link}
      </Link>
    </section>
  );
}
