'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useDict } from '@web/context/dict-context';
import type { DashboardMission } from '@web/lib/dashboard-api';
import type { DashboardMissionEntry } from '@web/lib/missions-api';
import {
  MISSION_TITLE_STYLE,
  MissionCard,
  MissionGroup,
} from '@web/components/missions/MissionCards';
import { groupMissions, type MissionGroupId } from '@web/components/missions/mission-groups';

export { groupMissions, type MissionGroups } from '@web/components/missions/mission-groups';

type Props = { missions: DashboardMission[] };

/** The dashboard is a summary: each group shows at most this many cards; `/missions` lists them all. */
export const DASHBOARD_MISSIONS_PER_GROUP = 3;

const GROUP_IDS: readonly MissionGroupId[] = ['mine', 'available', 'locked'];

/**
 * The dashboard's missions panel (RFC 0022 §7): *My missions* with their step
 * list, *Available* missions behind a confirmed *Join*, and *Locked* teasers —
 * capped at {@link DASHBOARD_MISSIONS_PER_GROUP} per group, with a link to the
 * full missions page.
 */
export function MissionsList({ missions }: Props) {
  const dict = useDict();
  const d = dict.missions;
  const [entries, setEntries] = useState<DashboardMission[]>(missions);

  // A joined mission goes to the front so it stays visible under the cap.
  const onJoined = (joined: DashboardMissionEntry) =>
    setEntries((prev) => [joined, ...prev.filter((e) => e.mission.id !== joined.mission.id)]);

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
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold" style={MISSION_TITLE_STYLE}>
          {dict.dashboard.missions.title}
        </h2>
        <Link
          href="/missions"
          className="shrink-0 text-xs font-semibold underline-offset-2 hover:underline"
          style={{ color: 'var(--aq-accent)' }}
        >
          {dict.dashboard.missions.seeAll}
        </Link>
      </div>
      {GROUP_IDS.map((id) => (
        <MissionGroup key={id} id={id} title={d.groups[id]} empty={d.empty[id]}>
          {groups[id].slice(0, DASHBOARD_MISSIONS_PER_GROUP).map((entry) => (
            <MissionCard key={entry.mission.id} group={id} entry={entry} onJoined={onJoined} />
          ))}
        </MissionGroup>
      ))}
    </section>
  );
}
