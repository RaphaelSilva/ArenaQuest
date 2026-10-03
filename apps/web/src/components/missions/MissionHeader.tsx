'use client';

import type { ReactNode } from 'react';
import { Badge } from '@web/components/design-system';
import { useDict } from '@web/context/dict-context';
import type { DashboardMissionEntry, MissionEnrollmentView } from '@web/lib/missions-api';
import { formatMissionDate } from './mission-date';
import { MissionProgressBar } from './MissionProgressBar';
import { MissionWindow } from './MissionWindow';

export type MissionHeaderProps = {
  entry: DashboardMissionEntry;
  /** The page's actions (Leave, Join), decided by the caller. */
  actions?: ReactNode;
};

const TITLE_STYLE = { color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" } as const;

/** How the student takes part, in words; `null` when not enrolled. */
function useEnrollmentLabel(enrollment: MissionEnrollmentView): string | null {
  const d = useDict().missions;
  if (!enrollment) return null;
  if (enrollment.source === 'auto') return d.page.enrollment.auto;
  if (enrollment.source === 'admin') return d.page.enrollment.admin;
  const date = formatMissionDate(enrollment.joinedAt, d);
  return date ? d.page.enrollment.self(date) : d.page.enrollment.selfUndated;
}

/**
 * Title, window, mode in plain words, rewards, enrollment and the aggregate bar
 * of a mission — every value as the server returned it.
 */
export function MissionHeader({ entry, actions }: MissionHeaderProps) {
  const d = useDict().missions;
  const { mission, progress, steps, enrollment } = entry;
  const enrollmentLabel = useEnrollmentLabel(enrollment);
  const current = progress?.currentValue ?? 0;
  const target = progress?.targetValue ?? steps.length;

  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h1 className="min-w-0 text-2xl font-semibold" style={TITLE_STYLE}>
          {mission.title}
        </h1>
        {progress?.completed && (
          <Badge status="done" size="sm">
            {d.card.completed}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--aq-text3)' }}>
        <MissionWindow endAt={mission.endAt} className="text-xs" />
        <span data-testid="mission-mode">{d.page.modes[mission.mode]}</span>
        {enrollmentLabel && <span data-testid="mission-enrollment">{enrollmentLabel}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{ background: 'var(--aq-accent-glow)', color: 'var(--aq-accent)' }}
        >
          {d.page.missionXp(mission.xpReward)}
        </span>
        {mission.badgeId && (
          <span className="text-[11px] font-semibold" style={{ color: 'var(--aq-text3)' }} title={d.card.badgeRewardLabel}>
            {d.card.badgeReward}
          </span>
        )}
      </div>

      {target > 0 && <MissionProgressBar title={mission.title} current={current} target={target} />}

      {actions}
    </header>
  );
}
