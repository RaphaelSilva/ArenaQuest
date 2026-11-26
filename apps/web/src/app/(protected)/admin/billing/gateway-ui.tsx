'use client';

import { useCallback } from 'react';
import { ROLES } from '@arenaquest/shared/constants/roles';
import {
  isPaymentProviderName,
  providerDashboardUrl,
  splitGatewayReference,
} from '@arenaquest/shared/domain/billing/gateway-money';
import { formatExpiry } from '@web/components/billing/pay-action';
import { useDict } from '@web/context/dict-context';
import { useHasRole } from '@web/hooks/use-auth';
import type { PayOption, PendingCheckout } from '@web/lib/admin-billing-api';

/**
 * The pieces every online-payment surface of the billing console shares
 * (RFC 0026 §7): who may act, how a provider is named, how a gateway row's
 * reference is shown, and how a pending checkout reads.
 */

/**
 * Online payments are the dojo's money: only `admin` sees a gateway *action*
 * (create a link, refund). The API is the authority — every one of those
 * routes is `requireRole(ADMIN)` — and this only keeps a control that could
 * never succeed off the screen of anyone else who reaches these components.
 */
export function useIsBillingAdmin(): boolean {
  return useHasRole(ROLES.ADMIN);
}

/** A provider's display name; an id the dictionary does not know is shown as is. */
export function useProviderLabel(): (provider: string) => string {
  const dict = useDict();
  const names = dict.admin.billing.gateway.provider;
  return useCallback(
    (provider: string) => (isPaymentProviderName(provider) ? names[provider] : provider),
    [names],
  );
}

/** A pay option's methods, in the API's order ("Pix, Card"). */
export function useMethodsLabel(): (option: PayOption) => string {
  const dict = useDict();
  const g = dict.admin.billing.gateway;
  return useCallback(
    (option: PayOption) => option.methods.map((method) => g.method[method]).join(g.methodSeparator),
    [g],
  );
}

/** An instant in the build language's format and the viewer's own time zone. */
export function useExpiryFormatter(): (iso: string) => string {
  const dict = useDict();
  const locale = dict.admin.billing.money.locale;
  return useCallback((iso: string) => formatExpiry(iso, locale), [locale]);
}

/**
 * The provider id of a gateway ledger row, with the deep link into the
 * provider's dashboard when the shared capability table has a URL template
 * (milestone decision 25: the link is built here, from `<provider>:<id>`; no
 * API field carries a provider URL). No template → the id is plain text.
 *
 * The template addresses a **payment**, so a refund id is never linked.
 */
export function GatewayReference({
  reference,
  kind,
}: {
  reference: string | null;
  kind: 'payment' | 'refund';
}) {
  const dict = useDict();
  const g = dict.admin.billing.gateway.ledger;
  const providerLabel = useProviderLabel();

  if (!reference) return null;
  const split = splitGatewayReference(reference);
  if (split === null) {
    return (
      <span className="block break-all text-xs text-zinc-500">{g.unknownReference(reference)}</span>
    );
  }

  const provider = providerLabel(split.provider);
  const url = kind === 'payment' ? providerDashboardUrl(split.provider, split.id) : null;
  return (
    <span className="block break-all text-xs text-zinc-500">
      {kind === 'payment' ? g.paymentId(provider, split.id) : g.refundId(provider, split.id)}
      {url !== null && (
        <>
          {' · '}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={g.dashboardAriaLabel(provider, split.id)}
            className="font-medium text-indigo-600 underline underline-offset-2 dark:text-indigo-400"
          >
            {g.dashboardLink}
          </a>
        </>
      )}
    </span>
  );
}

/**
 * "Pending online payment · expires …" under a receivable. `ownerId` and
 * `nameOf`, when given, add who opened the link — the student, or the admin
 * who created it on their behalf.
 */
export function PendingCheckoutLine({
  pending,
  ownerId,
  nameOf,
  className = 'block text-xs font-medium text-amber-700 dark:text-amber-300',
}: {
  pending: PendingCheckout | null | undefined;
  ownerId?: string;
  nameOf?: (userId: string) => string;
  className?: string;
}) {
  const dict = useDict();
  const g = dict.admin.billing.gateway.pending;
  const formatWhen = useExpiryFormatter();

  if (!pending) return null;
  const opener =
    ownerId === undefined
      ? null
      : pending.createdBy === ownerId
        ? g.openedByStudent
        : nameOf
          ? g.openedOnBehalf(nameOf(pending.createdBy))
          : null;
  return (
    <span className={className} data-testid="pending-online-payment">
      {g.line(formatWhen(pending.expiresAt))}
      {opener ? ` · ${opener}` : ''}
    </span>
  );
}
