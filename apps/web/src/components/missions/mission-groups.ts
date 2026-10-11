import type { DashboardMissionEntry } from '@web/lib/missions-api';

export type MissionGroupId = 'mine' | 'available' | 'locked';

export type MissionGroups = Record<MissionGroupId, DashboardMissionEntry[]>;

/** Which group an entry belongs to, from the flags the server set (RFC 0022 §6). */
export function missionGroupOf(entry: DashboardMissionEntry): MissionGroupId {
  if (entry.locked !== null) return 'locked';
  if (entry.enrollment === null && entry.joinable) return 'available';
  return 'mine';
}

/**
 * Splits the entries by the flags the server set (RFC 0022 §6): a teaser
 * (`locked`) is *Locked*, an enrolment is *My missions*, a `joinable` entry is
 * *Available*. A legacy mission (no enrolment, not joinable, not locked) stays in
 * *My missions* with its single bar. Order inside a group is the API's.
 */
export function groupMissions(entries: readonly DashboardMissionEntry[]): MissionGroups {
  const groups: MissionGroups = { mine: [], available: [], locked: [] };
  for (const entry of entries) groups[missionGroupOf(entry)].push(entry);
  return groups;
}

/** The missions page's filter bar. */
export type MissionFilter = 'all' | 'inProgress' | 'completed' | 'available' | 'locked';

export const MISSION_FILTERS: readonly MissionFilter[] = ['all', 'inProgress', 'completed', 'available', 'locked'];

/**
 * Whether an entry passes a filter. *In progress* and *Completed* split *My
 * missions* on `progress.completed` (a legacy mission included); *Available*
 * and *Locked* are their groups.
 */
export function matchesMissionFilter(entry: DashboardMissionEntry, filter: MissionFilter): boolean {
  const group = missionGroupOf(entry);
  switch (filter) {
    case 'all':
      return true;
    case 'inProgress':
      return group === 'mine' && entry.progress?.completed !== true;
    case 'completed':
      return group === 'mine' && entry.progress?.completed === true;
    case 'available':
      return group === 'available';
    case 'locked':
      return group === 'locked';
  }
}

/** The group a filter narrows the page to; `null` for *All* (every group shows). */
export function groupForFilter(filter: MissionFilter): MissionGroupId | null {
  switch (filter) {
    case 'all':
      return null;
    case 'inProgress':
    case 'completed':
      return 'mine';
    case 'available':
      return 'available';
    case 'locked':
      return 'locked';
  }
}

/** Replaces the joined entry in place with the one the API returned. */
export function replaceMission(
  entries: readonly DashboardMissionEntry[],
  updated: DashboardMissionEntry,
): DashboardMissionEntry[] {
  return entries.map((e) => (e.mission.id === updated.mission.id ? updated : e));
}
