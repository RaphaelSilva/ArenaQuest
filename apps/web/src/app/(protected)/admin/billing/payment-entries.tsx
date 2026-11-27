'use client';

import { useMemo } from 'react';
import { Button } from '@web/components/design-system';
import { useDict } from '@web/context/dict-context';
import type { PaymentMethod } from '@web/lib/admin-billing-api';
import { GatewayReference, useGatewayMethodLabel, useIsBillingAdmin } from './gateway-ui';

/** The fields both rails' payment rows share — an invoice's or a charge's. */
export type LedgerPayment = {
  id: string;
  amountMinor: number;
  currency: string;
  method: PaymentMethod;
  paidAt: string;
  externalReference: string | null;
  note: string;
  reversesId: string | null;
  recordedBy: string;
  /** The provider's method label; only the admin statement / charge detail carry it. */
  gatewayMethodLabel?: string | null;
};

function shortRef(id: string): string {
  return id.slice(0, 8);
}

/**
 * The payments of one receivable, as the ledger shows them on both rails.
 *
 * Originals first, each with the reversal that mirrors it, so a reversal is
 * rendered under the entry it undoes rather than as a loose negative row.
 *
 * A **gateway** row (RFC 0026 §7) reads *Online*, with the provider's payment
 * id and a deep link into the provider's dashboard — *Online · <label>* when
 * the API knows how it was paid (`gatewayMethodLabel`); its reversal is a
 * *refund* and carries the refund id. A negative gateway row that mirrors
 * nothing (`reversesId: null`) is a refund or a lost dispute made on the
 * provider's side: it is labelled as such and offers no action — there is
 * nothing here to reverse.
 */
export function PaymentEntries<P extends LedgerPayment>({
  payments,
  formatMoney,
  emptyLabel,
  onReverse,
}: {
  payments: readonly P[];
  formatMoney: (amountMinor: number, code?: string) => string;
  emptyLabel: string;
  /** Opens the reversal — or, for a gateway row, the refund — of `payment`. */
  onReverse: (payment: P) => void;
}) {
  const dict = useDict();
  const d = dict.admin.billing.ledger;
  const g = dict.admin.billing.gateway.ledger;
  const isAdmin = useIsBillingAdmin();
  const methodLabel = useGatewayMethodLabel();

  const groups = useMemo(() => {
    const reversalOf = new Map<string, P>();
    for (const payment of payments) {
      if (payment.reversesId) reversalOf.set(payment.reversesId, payment);
    }
    return payments
      .filter((payment) => payment.reversesId === null)
      .map((payment) => ({ payment, reversal: reversalOf.get(payment.id) ?? null }));
  }, [payments]);

  if (groups.length === 0) return <p className="text-sm text-zinc-500">{emptyLabel}</p>;

  return (
    <ul className="space-y-2">
      {groups.map(({ payment, reversal }) => {
        const isGateway = payment.method === 'gateway';
        const reference = shortRef(payment.id);
        const paidWith = isGateway ? (payment.gatewayMethodLabel ?? null) : null;
        const methodText = paidWith
          ? g.methodWithLabel(d.method[payment.method], methodLabel(paidWith))
          : d.method[payment.method];

        if (isGateway && payment.amountMinor < 0) {
          return (
            <li
              key={payment.id}
              className="rounded-md border border-amber-300 px-3 py-2 text-sm dark:border-amber-800"
            >
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {`${g.providerRefund} · ${formatMoney(payment.amountMinor, payment.currency)}`}
              </span>
              <GatewayReference reference={payment.externalReference} kind="refund" />
              <span className="block text-xs text-zinc-500">{g.providerRefundNote}</span>
              <span className="block text-xs text-zinc-500">
                {`${payment.paidAt} · ${d.recordedBy(payment.recordedBy)}`}
              </span>
            </li>
          );
        }

        return (
          <li
            key={payment.id}
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {`${methodText} · ${formatMoney(payment.amountMinor, payment.currency)}`}
              </span>
              {reversal ? (
                <span className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                  {isGateway ? g.refunded : d.alreadyReversed}
                </span>
              ) : isGateway ? (
                // A refund moves real money through the provider: admin only.
                isAdmin && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => onReverse(payment)}
                    aria-label={g.refundAriaLabel(reference)}
                  >
                    {g.refundButton}
                  </Button>
                )
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => onReverse(payment)}
                  aria-label={d.reverseAriaLabel(reference)}
                >
                  {d.reverseButton}
                </Button>
              )}
            </div>
            {isGateway && <GatewayReference reference={payment.externalReference} kind="payment" />}
            <span className="block text-xs text-zinc-500">
              {`${payment.paidAt} · ${d.recordedBy(payment.recordedBy)}`}
            </span>

            {/* The reversal lives under its original, never in its place. */}
            {reversal && (
              <div className="mt-2 border-l-2 border-amber-400 pl-3">
                <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {`${isGateway ? g.refundOf(reference) : d.reversalOf(reference)} · ${formatMoney(
                    reversal.amountMinor,
                    reversal.currency,
                  )}`}
                </span>
                {isGateway && (
                  <GatewayReference reference={reversal.externalReference} kind="refund" />
                )}
                <span className="block text-xs text-zinc-500">{d.reasonLine(reversal.note)}</span>
                <span className="block text-xs text-zinc-500">
                  {`${reversal.paidAt} · ${d.recordedBy(reversal.recordedBy)}`}
                </span>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
