'use client';

import { Badge } from '@web/components/design-system';
import { useDict } from '@web/context/dict-context';
import type { Standing } from '@web/lib/admin-billing-api';

/**
 * Renders the standing the API resolved.
 *
 * There is no threshold, no grace-day arithmetic and no due-date comparison
 * here or anywhere else in this console: `resolveStanding` lives on the server,
 * where a hold can reach it, and a second copy in the client would be a rule
 * that drifts silently. The map below is presentation only.
 */
const TONE: Record<Standing, 'active' | 'archived' | 'inactive' | 'locked'> = {
  good: 'active',
  due: 'archived',
  delinquent: 'inactive',
  exempt: 'locked',
};

/**
 * `railLabel` names the rail the standing belongs to (RFC 0015: the monthly fee
 * and the extras are resolved apart). It is rendered as visually hidden text
 * inside the badge, so a screen reader announces "Extras: Delinquent" rather
 * than a bare label whose rail only a column header would give away.
 */
export function StandingBadge({
  standing,
  size = 'sm',
  railLabel,
}: {
  standing: Standing;
  size?: 'sm' | 'md';
  railLabel?: string;
}) {
  const dict = useDict();
  return (
    <Badge status={TONE[standing]} size={size}>
      {railLabel && <span className="sr-only">{dict.admin.billing.railPrefix(railLabel)}</span>}
      {dict.admin.billing.standing[standing]}
    </Badge>
  );
}
