'use client';

import { Badge } from '@web/components/design-system';
import { useDict } from '@web/context/dict-context';
import type { EventAudience } from '@web/lib/events-api';

/**
 * The chip that marks an event as narrower than `public`.
 *
 * It renders nothing for a `public` event: the board is mostly public, and a
 * chip on every card would say nothing. The chip is a *label on content the
 * reader is already entitled to see* — it is not an access control, and the
 * server decided long before this component ran whether the event is in the
 * list at all.
 */
export function EventAudienceChip({ audience }: { audience: EventAudience }) {
  const dict = useDict();

  if (audience === 'public') return null;

  const label =
    audience === 'members' ? dict.events.audience.members : dict.events.audience.restricted;

  return (
    <Badge status={audience === 'members' ? 'inprog' : 'locked'} size="sm">
      {label}
    </Badge>
  );
}
