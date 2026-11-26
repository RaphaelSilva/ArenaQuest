'use client';

import Link from 'next/link';
import { formatMoney } from '@arenaquest/shared/domain/billing/format-money';
import { useDict } from '@web/context/dict-context';
import { PayAction, isPayable } from '@web/components/billing/pay-action';
import { useMyStatement } from '@web/components/billing/my-statement';

/**
 * The dashboard's *payment due* card (RFC 0026 §7, R11).
 *
 * **A prompt, not a gate.** It is one more block on the dashboard: it hides,
 * disables, dims and blocks nothing around it, whatever the standing.
 *
 * **It issues no request of its own.** It reads the statement the application
 * shell already loaded for the standing notice (`useMyStatement`), and after a
 * pay action it asks that same source for a quiet re-read.
 *
 * **It is absent unless there is something to pay online**: no open contract
 * invoice with a balance, no provider offering a method, a statement still
 * loading or one that could not be read all render nothing — no skeleton, no
 * error. Event charges stay on the statement page.
 *
 * "Overdue" is the statement's own `asOf` compared with the invoice's due
 * date; the standing itself is never derived here.
 */
export function PaymentDueCard() {
  const dict = useDict();
  const d = dict.dashboard.paymentDue;
  const { statement, refresh } = useMyStatement();

  if (statement === null || statement.payOptions.length === 0) return null;

  const invoices = statement.invoices
    .filter(isPayable)
    // `YYYY-MM-DD` sorts lexicographically; the sort is stable, so invoices
    // due the same day keep the API's order.
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));

  if (invoices.length === 0) return null;

  const money = (minor: number) =>
    formatMoney(minor, {
      exponent: statement.currency.exponent,
      symbol: statement.currency.symbol,
      locale: d.locale,
    });

  return (
    <section
      // `shrink-0`: the dashboard column is a scrolling flex container, and an
      // `overflow-hidden` flex child would otherwise be squeezed to nothing.
      className="shrink-0 overflow-hidden rounded-2xl border"
      style={{ background: 'var(--aq-bg2)', borderColor: 'var(--aq-border2)' }}
      aria-label={d.title}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-5 py-4"
        style={{ borderColor: 'var(--aq-border)' }}
      >
        <h2
          className="text-[13px] font-semibold"
          style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" }}
        >
          {d.title}
        </h2>
        <Link
          href="/settings/billing"
          className="text-xs font-medium underline underline-offset-2"
          style={{ color: 'var(--aq-accent)' }}
        >
          {d.statementLink}
        </Link>
      </div>

      <ul className="px-5">
        {invoices.map((invoice, index) => {
          const overdue = statement.asOf > invoice.dueDate;
          return (
            <li
              key={invoice.id}
              className={index === 0 ? 'min-w-0 py-4' : 'min-w-0 border-t py-4'}
              style={{ borderColor: 'var(--aq-border)' }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span
                  className="text-lg font-bold"
                  style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" }}
                >
                  {money(invoice.balanceMinor)}
                </span>
                <span
                  className="text-xs"
                  style={{
                    color: overdue ? 'var(--aq-accent2)' : 'var(--aq-text2)',
                    fontWeight: overdue ? 700 : 400,
                  }}
                >
                  {overdue ? d.overdueSince(invoice.dueDate) : d.dueOn(invoice.dueDate)}
                </span>
              </div>
              <PayAction
                kind="invoice"
                id={invoice.id}
                payOptions={statement.payOptions}
                pendingCheckout={invoice.pendingCheckout}
                onChanged={refresh}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
