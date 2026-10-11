'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from '@web/components/design-system';
import { useDict } from '@web/context/dict-context';
import type { DashboardMissionEntry } from '@web/lib/missions-api';
import { JoinMissionButton } from './JoinMissionButton';
import { MissionProgressBar } from './MissionProgressBar';
import { MissionStepList } from './MissionStepList';
import { MissionWindow } from './MissionWindow';
import type { MissionGroupId } from './mission-groups';

const CARD_CLASS = 'overflow-hidden rounded-2xl border p-4';
const CARD_STYLE = { background: 'var(--aq-bg2)', borderColor: 'var(--aq-border2)' } as const;
export const MISSION_TITLE_STYLE = { color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" } as const;

function XpChip({ xp }: { xp: number }) {
  const d = useDict().missions.card;
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: 'var(--aq-accent-glow)', color: 'var(--aq-accent)' }}
    >
      {d.xp(xp)}
    </span>
  );
}

/** An enrolled (or legacy) mission: link to its page, bar, window and compact step list. */
export function MyMissionCard({ entry }: { entry: DashboardMissionEntry }) {
  const d = useDict().missions;
  const { mission, progress, steps } = entry;
  const current = progress?.currentValue ?? 0;
  const target = progress?.targetValue ?? steps.length;

  return (
    <li data-testid="mission-card" data-group="mine" className={CARD_CLASS} style={CARD_STYLE}>
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/missions/${encodeURIComponent(mission.id)}`}
          className="min-w-0 truncate text-sm font-semibold underline-offset-2 hover:underline"
          style={MISSION_TITLE_STYLE}
        >
          {mission.title}
        </Link>
        <div className="flex shrink-0 items-center gap-1.5">
          {progress?.completed && (
            <Badge status="done" size="sm">
              {d.card.completed}
            </Badge>
          )}
          <XpChip xp={mission.xpReward} />
          {mission.badgeId && (
            <span
              className="text-[10px] font-semibold"
              style={{ color: 'var(--aq-text3)' }}
              title={d.card.badgeRewardLabel}
            >
              {d.card.badgeReward}
            </span>
          )}
        </div>
      </div>

      <div className="mt-2">
        <MissionProgressBar title={mission.title} current={current} target={target} />
      </div>
      <MissionWindow endAt={mission.endAt} className="mt-1 block text-[11px]" />

      {steps.length > 0 && (
        <div className="mt-3">
          <MissionStepList title={mission.title} mode={mission.mode} steps={steps} compact />
        </div>
      )}
    </li>
  );
}

/** A joinable `open` mission behind a confirmed *Join*. */
export function AvailableMissionCard({
  entry,
  onJoined,
}: {
  entry: DashboardMissionEntry;
  onJoined: (entry: DashboardMissionEntry) => void;
}) {
  const { mission } = entry;
  return (
    <li data-testid="mission-card" data-group="available" className={CARD_CLASS} style={CARD_STYLE}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold" style={MISSION_TITLE_STYLE}>
          {mission.title}
        </p>
        <XpChip xp={mission.xpReward} />
      </div>
      {mission.description && (
        <p className="mt-0.5 line-clamp-1 text-xs" style={{ color: 'var(--aq-text3)' }}>
          {mission.description}
        </p>
      )}
      <MissionWindow endAt={mission.endAt} className="mt-1 block text-[11px]" />
      <div className="mt-3">
        <JoinMissionButton missionId={mission.id} title={mission.title} onJoined={onJoined} />
      </div>
    </li>
  );
}

/** A teaser: title, lock and the group reason — nothing else, no link (RFC 0022 §8). */
export function LockedMissionCard({ entry }: { entry: DashboardMissionEntry }) {
  const d = useDict().missions;
  return (
    <li data-testid="mission-card" data-group="locked" className={CARD_CLASS} style={CARD_STYLE}>
      <div className="flex items-start gap-2">
        <span role="img" aria-label={d.card.lockedIcon} className="text-sm">
          🔒
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" style={{ color: 'var(--aq-text2)' }}>
            {entry.mission.title}
          </p>
          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--aq-text3)' }}>
            {d.locked.reason(entry.locked?.groups ?? [])}
          </p>
        </div>
      </div>
    </li>
  );
}

/** Renders one entry with the card of its group. */
export function MissionCard({
  group,
  entry,
  onJoined,
}: {
  group: MissionGroupId;
  entry: DashboardMissionEntry;
  onJoined: (entry: DashboardMissionEntry) => void;
}) {
  if (group === 'available') return <AvailableMissionCard entry={entry} onJoined={onJoined} />;
  if (group === 'locked') return <LockedMissionCard entry={entry} />;
  return <MyMissionCard entry={entry} />;
}

/** A titled group of mission cards, with its own empty state. */
export function MissionGroup({
  id,
  title,
  empty,
  headingLevel = 'h3',
  children,
}: {
  id: string;
  title: string;
  empty: string;
  /** `h3` under the dashboard panel's `h2`; `h2` under the missions page's `h1`. */
  headingLevel?: 'h2' | 'h3';
  children: ReactNode[];
}) {
  const headingId = `missions-group-${id}`;
  const Heading = headingLevel;
  return (
    <section aria-labelledby={headingId} data-testid={`missions-group-${id}`}>
      <Heading
        id={headingId}
        className="mb-2 text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--aq-text3)' }}
      >
        {title}
      </Heading>
      {children.length === 0 ? (
        <p
          className="rounded-xl border border-dashed px-4 py-3 text-xs"
          style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text3)' }}
        >
          {empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">{children}</ul>
      )}
    </section>
  );
}
