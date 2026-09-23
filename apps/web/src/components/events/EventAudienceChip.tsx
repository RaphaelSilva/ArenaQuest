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
 *
 * **Colour is never the only difference between the two levels.** `Badge` gives
 * `members` the accent tint and `restricted` the muted one, which a reader with
 * a colour vision deficiency, a monochrome print or a high-contrast theme may
 * not separate at all. So each level also carries its own translated word *and*
 * its own glyph — two people for `members`, a padlock for `restricted` — and
 * the glyph is marked with `data-audience` so a test can pin the affordance
 * rather than trust a screenshot.
 */
export function EventAudienceChip({ audience }: { audience: EventAudience }) {
  const dict = useDict();

  if (audience === 'public') return null;

  const isMembers = audience === 'members';
  const label = isMembers ? dict.events.audience.members : dict.events.audience.restricted;

  return (
    <Badge status={isMembers ? 'inprog' : 'locked'} size="sm" className="gap-1.5">
      <AudienceGlyph audience={audience} />
      {label}
    </Badge>
  );
}

function AudienceGlyph({ audience }: { audience: 'members' | 'restricted' }) {
  return (
    <svg
      data-audience={audience}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {audience === 'members' ? (
        <>
          <path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 20v-2a4 4 0 0 0-3-3.87" />
        </>
      ) : (
        <>
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </>
      )}
    </svg>
  );
}
