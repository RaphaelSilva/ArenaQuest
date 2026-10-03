'use client';

import { useDict } from '@web/context/dict-context';

export type MissionProgressBarProps = {
  /** Mission title, for the bar's accessible name. */
  title: string;
  current: number;
  target: number;
};

/** Aggregate bar of a mission: `current/target` as the server counted it. */
export function MissionProgressBar({ title, current, target }: MissionProgressBarProps) {
  const d = useDict().missions.card;
  const pct = target > 0 ? Math.max(0, Math.min(100, Math.round((current / target) * 100))) : 0;

  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full"
        style={{ background: 'var(--aq-bg4)' }}
        role="progressbar"
        aria-label={d.progressLabel(title, current, target)}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--aq-accent)' }} />
      </div>
      {target > 0 && (
        <span className="shrink-0 text-[11px]" style={{ color: 'var(--aq-text3)' }}>
          {d.progressCount(current, target)}
        </span>
      )}
    </div>
  );
}
