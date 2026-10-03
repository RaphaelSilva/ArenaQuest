'use client';

import { useDict } from '@web/context/dict-context';
import { localInputToIso } from './mission-draft';

/** A window at least this long suggests a badge (RFC 0022 §7). */
export const BADGE_HINT_MIN_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

type Props = {
  startAt: string;
  endAt: string;
  badgeId: string;
};

/** True when the window spans 14 days or more and no badge is picked. */
export function shouldSuggestBadge({ startAt, endAt, badgeId }: Props): boolean {
  if (badgeId) return false;
  const start = localInputToIso(startAt);
  const end = localInputToIso(endAt);
  if (!start || !end) return false;
  return Date.parse(end) - Date.parse(start) >= BADGE_HINT_MIN_DAYS * DAY_MS;
}

/** Non-blocking suggestion next to the badge picker; saving without a badge stays allowed. */
export function BadgeHint(props: Props) {
  const dict = useDict();
  if (!shouldSuggestBadge(props)) return null;
  return (
    <p
      role="note"
      data-testid="badge-hint"
      className="mt-1 rounded-lg px-3 py-2 text-xs"
      style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
    >
      {dict.admin.missions.badgeHint}
    </p>
  );
}
