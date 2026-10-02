'use client';

import { Badge } from '@web/components/design-system';
import { useDict } from '@web/context/dict-context';
import type { StorageStatus } from '@web/lib/admin-storage-api';
import { STATUS_KEY } from './storage-format';

type Tone = 'active' | 'inprog' | 'archived' | 'locked' | 'draft' | 'inactive';

/**
 * Presentation only — the status and `stale` flag are resolved by the API.
 * A stale `pending` gets its own tone and label so it reads apart from an
 * upload that is merely in flight.
 */
const TONE: Record<StorageStatus, Tone> = {
  linked: 'active',
  pending: 'inprog',
  displaced: 'locked',
  'deleted-row': 'draft',
  orphan: 'inactive',
};

export function StorageStatusBadge({
  status,
  stale,
  size = 'sm',
}: {
  status: StorageStatus;
  stale: boolean;
  size?: 'sm' | 'md';
}) {
  const d = useDict().adminStorage;
  const isStale = status === 'pending' && stale;

  return (
    <Badge
      status={isStale ? 'archived' : TONE[status]}
      size={size}
      className={isStale ? 'ring-1 ring-current' : undefined}
    >
      <span data-status={status} data-stale={isStale ? 'true' : undefined} title={isStale ? d.staleHint : undefined}>
        {isStale ? d.status.stalePending : d.status[STATUS_KEY[status]]}
      </span>
    </Badge>
  );
}
