'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@web/components/design-system';
import { Spinner } from '@web/components/spinner';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type { DashboardMissionEntry } from '@web/lib/missions-api';
import { MissionCard, MissionGroup } from './MissionCards';
import {
  MISSION_FILTERS,
  groupForFilter,
  groupMissions,
  matchesMissionFilter,
  replaceMission,
  type MissionFilter,
  type MissionGroupId,
} from './mission-groups';
import { missionErrorMessage } from './student-mission-errors';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; entries: DashboardMissionEntry[] }
  | { kind: 'error'; message: string };

const GROUP_IDS: readonly MissionGroupId[] = ['mine', 'available', 'locked'];

function FilterBar({ value, onChange }: { value: MissionFilter; onChange: (filter: MissionFilter) => void }) {
  const d = useDict().missions.index;
  return (
    <div role="group" aria-label={d.filterLabel} className="flex flex-wrap items-center gap-2">
      {MISSION_FILTERS.map((filter) => {
        const active = filter === value;
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(filter)}
            className="cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{
              borderColor: active ? 'var(--aq-accent)' : 'var(--aq-border2)',
              color: active ? 'var(--aq-accent)' : 'var(--aq-text2)',
              background: active ? 'var(--aq-accent-glow)' : 'transparent',
              outlineColor: 'var(--aq-accent)',
            }}
          >
            {d.filters[filter]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The student missions page: loads `GET /v1/me/missions` and renders every
 * entry in the dashboard's three groups, with a filter bar. The server decides
 * which missions appear and in which state — the page only sorts them into
 * groups. *Join* behaves as on the dashboard.
 */
export function MissionsIndex() {
  const dict = useDict();
  const d = dict.missions;
  const client = useApiClient();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [filter, setFilter] = useState<MissionFilter>('all');

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const entries = await client.missions.list();
      setState({ kind: 'ready', entries: entries ?? [] });
    } catch (err: unknown) {
      setState({ kind: 'error', message: missionErrorMessage(err, d) });
    }
  }, [client, d]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch is the canonical use case
    void load();
  }, [load]);

  const onJoined = (joined: DashboardMissionEntry) =>
    setState((prev) => (prev.kind === 'ready' ? { kind: 'ready', entries: replaceMission(prev.entries, joined) } : prev));

  if (state.kind === 'loading') {
    return (
      <div role="status" className="flex items-center justify-center gap-2 py-16" style={{ color: 'var(--aq-text3)' }}>
        <Spinner />
        <span className="text-sm">{d.index.loading}</span>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <section className="flex flex-col items-start gap-3 py-8">
        <div role="alert" className="flex flex-col gap-1 text-sm" style={{ color: 'var(--aq-error)' }}>
          <p>{d.index.loadError}</p>
          <p>{state.message}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void load()}>
          {d.index.retry}
        </Button>
      </section>
    );
  }

  if (state.entries.length === 0) {
    return (
      <section
        data-testid="missions-empty"
        className="rounded-2xl border border-dashed p-8 text-center"
        style={{ borderColor: 'var(--aq-border2)', background: 'var(--aq-bg2)' }}
      >
        <p className="text-sm" style={{ color: 'var(--aq-text3)' }}>
          {d.index.empty}
        </p>
      </section>
    );
  }

  const groups = groupMissions(state.entries.filter((entry) => matchesMissionFilter(entry, filter)));
  const only = groupForFilter(filter);
  const visible = only === null ? GROUP_IDS : [only];

  return (
    <div className="flex flex-col gap-6">
      <FilterBar value={filter} onChange={setFilter} />
      {visible.map((id) => (
        <MissionGroup
          key={id}
          id={id}
          headingLevel="h2"
          title={d.groups[id]}
          empty={filter === 'all' ? d.empty[id] : d.index.filterEmpty[filter]}
        >
          {groups[id].map((entry) => (
            <MissionCard key={entry.mission.id} group={id} entry={entry} onJoined={onJoined} />
          ))}
        </MissionGroup>
      ))}
    </div>
  );
}
