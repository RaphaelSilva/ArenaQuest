'use client';

import { useDict } from '@web/context/dict-context';
import { formatMissionDate } from './mission-date';

export type MissionWindowProps = {
  /** The mission's `endAt`, as the API returns it. */
  endAt: string;
  className?: string;
};

/** "Ends Oct 31" for a mission window; renders nothing for an unparsable date. */
export function MissionWindow({ endAt, className }: MissionWindowProps) {
  const d = useDict().missions;
  const date = formatMissionDate(endAt, d);
  if (!date) return null;
  return (
    <time dateTime={endAt} className={className ?? 'text-[11px]'} style={{ color: 'var(--aq-text3)' }}>
      {d.window.ends(date)}
    </time>
  );
}
