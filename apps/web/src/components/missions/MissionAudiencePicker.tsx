'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Entities } from '@arenaquest/shared/types/entities';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type { AdminGroup } from '@web/lib/admin-groups-api';
import type { MissionAudience } from '@web/lib/admin-gamification-api';
import { errorStyle, hintClass, hintStyle } from './form-styles';

/** One page of accounts for the picker. The API caps a page at 100. */
const USER_PAGE_SIZE = 100;

type Props = {
  value: MissionAudience;
  onChange: (audience: MissionAudience) => void;
  disabled?: boolean;
};

/**
 * Groups and users of an `assigned` mission, in the shape of the events
 * audience editor (`AudienceSelector`) and on the same two clients. That
 * component is not reused because it always renders the event's
 * public / members / restricted radio group, which has no meaning here.
 */
export function MissionAudiencePicker({ value, onChange, disabled = false }: Props) {
  const d = useDict().admin.missions.audience;
  const client = useApiClient();

  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [users, setUsers] = useState<Entities.Identity.User[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [groupList, userPage] = await Promise.all([
        client.adminGroups.list(),
        client.adminUsers.list(1, USER_PAGE_SIZE),
      ]);
      setGroups(groupList);
      setUsers(userPage.data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (kind: keyof MissionAudience, id: string) => {
    const current = value[kind];
    const next = current.includes(id) ? current.filter((v) => v !== id) : [...current, id];
    onChange({ ...value, [kind]: next });
  };

  if (loading) {
    return (
      <p className={hintClass} style={hintStyle}>
        {d.loading}
      </p>
    );
  }
  if (loadError) {
    return (
      <p role="alert" className="text-sm" style={errorStyle}>
        {d.loadError}
      </p>
    );
  }

  const list = (
    kind: keyof MissionAudience,
    legend: string,
    empty: string,
    items: { id: string; name: string }[],
  ) => (
    <fieldset disabled={disabled}>
      <legend className="mb-2 text-xs font-semibold" style={{ color: 'var(--text2)' }}>
        {legend}
      </legend>
      {items.length === 0 ? (
        <p className="text-xs" style={hintStyle}>
          {empty}
        </p>
      ) : (
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {items.map((item) => (
            <li key={item.id}>
              <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
                <input
                  type="checkbox"
                  checked={value[kind].includes(item.id)}
                  onChange={() => toggle(kind, item.id)}
                  className="accent-[color:var(--accent)]"
                />
                {item.name}
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );

  return (
    <div className="space-y-4">
      <p className="text-xs" style={hintStyle}>
        {d.selectedCount(value.groupIds.length, value.userIds.length)}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {list('groupIds', d.groupsLabel, d.groupsEmpty, groups)}
        {list('userIds', d.usersLabel, d.usersEmpty, users)}
      </div>
    </div>
  );
}
