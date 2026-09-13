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

export function StandingBadge({ standing, size = 'sm' }: { standing: Standing; size?: 'sm' | 'md' }) {
  const dict = useDict();
  return (
    <Badge status={TONE[standing]} size={size}>
      {dict.admin.billing.standing[standing]}
    </Badge>
  );
}
