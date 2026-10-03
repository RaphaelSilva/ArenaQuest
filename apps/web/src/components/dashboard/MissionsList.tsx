'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Badge } from '@web/components/design-system';
import { useDict } from '@web/context/dict-context';
import type { DashboardMission } from '@web/lib/dashboard-api';
import type { DashboardMissionEntry } from '@web/lib/missions-api';
import { JoinMissionButton } from '@web/components/missions/JoinMissionButton';
import { MissionProgressBar } from '@web/components/missions/MissionProgressBar';
import { MissionStepList } from '@web/components/missions/MissionStepList';
import { MissionWindow } from '@web/components/missions/MissionWindow';

type Props = { missions: DashboardMission[] };

export type MissionGroups = {
  mine: DashboardMission[];
  available: DashboardMission[];
  locked: DashboardMission[];
};

/**
 * Splits the entries by the flags the server set (RFC 0022 §6): a teaser
 * (`locked`) is *Locked*, an enrolment is *My missions*, a `joinable` entry is
 * *Available*. A legacy mission (no enrolment, not joinable, not locked) stays in
 * *My missions* with its single bar. Order inside a group is the API's.
 */
export function groupMissions(entries: DashboardMission[]): MissionGroups {
  const groups: MissionGroups = { mine: [], available: [], locked: [] };
  for (const entry of entries) {
    if (entry.locked !== null) groups.locked.push(entry);
    else if (entry.enrollment === null && entry.joinable) groups.available.push(entry);
    else groups.mine.push(entry);
  }
  return groups;
}

const CARD_CLASS = 'overflow-hidden rounded-2xl border p-4';
const CARD_STYLE = { background: 'var(--aq-bg2)', borderColor: 'var(--aq-border2)' } as const;
const TITLE_STYLE = { color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" } as const;

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

function MyMissionCard({ entry }: { entry: DashboardMissionEntry }) {
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
          style={TITLE_STYLE}
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

function AvailableMissionCard({
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
        <p className="min-w-0 truncate text-sm font-semibold" style={TITLE_STYLE}>
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
function LockedMissionCard({ entry }: { entry: DashboardMissionEntry }) {
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

function Group({ id, title, empty, children }: { id: string; title: string; empty: string; children: ReactNode[] }) {
  const headingId = `missions-group-${id}`;
  return (
    <section aria-labelledby={headingId} data-testid={`missions-group-${id}`}>
      <h3
        id={headingId}
        className="mb-2 text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--aq-text3)' }}
      >
        {title}
      </h3>
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

/**
 * The dashboard's missions panel (RFC 0022 §7): *My missions* with their step
 * list, *Available* missions behind a confirmed *Join*, and *Locked* teasers.
 */
export function MissionsList({ missions }: Props) {
  const dict = useDict();
  const d = dict.missions;
  const [entries, setEntries] = useState<DashboardMission[]>(missions);

  const onJoined = (joined: DashboardMissionEntry) =>
    setEntries((prev) => prev.map((e) => (e.mission.id === joined.mission.id ? joined : e)));

  if (entries.length === 0) {
    return (
      <section
        className="rounded-2xl border border-dashed p-8 text-center"
        style={{ borderColor: 'var(--aq-border2)', background: 'var(--aq-bg2)' }}
        aria-label={dict.dashboard.missions.title}
      >
        <p className="text-sm" style={{ color: 'var(--aq-text3)' }}>
          {dict.dashboard.missions.empty}
        </p>
      </section>
    );
  }

  const groups = groupMissions(entries);

  return (
    <section aria-label={dict.dashboard.missions.title} className="flex flex-col gap-4">
      <h2 className="text-[13px] font-semibold" style={TITLE_STYLE}>
        {dict.dashboard.missions.title}
      </h2>
      <Group id="mine" title={d.groups.mine} empty={d.empty.mine}>
        {groups.mine.map((entry) => (
          <MyMissionCard key={entry.mission.id} entry={entry} />
        ))}
      </Group>
      <Group id="available" title={d.groups.available} empty={d.empty.available}>
        {groups.available.map((entry) => (
          <AvailableMissionCard key={entry.mission.id} entry={entry} onJoined={onJoined} />
        ))}
      </Group>
      <Group id="locked" title={d.groups.locked} empty={d.empty.locked}>
        {groups.locked.map((entry) => (
          <LockedMissionCard key={entry.mission.id} entry={entry} />
        ))}
      </Group>
    </section>
  );
}
