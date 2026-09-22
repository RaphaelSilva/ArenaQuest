'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Entities } from '@arenaquest/shared/types/entities';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type { AdminEventAudience, AdminEventAudienceGrants } from '@web/lib/admin-events-api';
import type { AdminGroup } from '@web/lib/admin-groups-api';

type AudienceSelectorProps = {
  audience: AdminEventAudience;
  onAudienceChange: (audience: AdminEventAudience) => void;
  grants: AdminEventAudienceGrants;
  onGrantsChange: (grants: AdminEventAudienceGrants) => void;
};

/** The three levels, in widening-to-narrowing order, as the radio group renders them. */
const AUDIENCES: AdminEventAudience[] = ['public', 'members', 'restricted'];

/** One page of accounts for the picker. The API caps a page at 100. */
const USER_PAGE_SIZE = 100;

/**
 * Who may see the event.
 *
 * The pickers appear **only** for `restricted`: at the other two levels a grant
 * list would be inert, and showing an inert list that quietly keeps its ticks is
 * how an admin comes to believe an event is narrower than it is.
 *
 * `public` carries a warning rather than a hint, because it is the one choice
 * that reaches past the account system entirely — and it takes the event's
 * WhatsApp number onto the open internet with it.
 */
export function AudienceSelector({
  audience,
  onAudienceChange,
  grants,
  onGrantsChange,
}: AudienceSelectorProps) {
  const dict = useDict();
  const d = dict.admin.events.audience;
  const client = useApiClient();

  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [users, setUsers] = useState<Entities.Identity.User[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const loadTargets = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [groupList, userPage] = await Promise.all([
        client.adminGroups.list(),
        client.adminUsers.list(1, USER_PAGE_SIZE),
      ]);
      setGroups(groupList);
      setUsers(userPage.data);
      setLoaded(true);
    } catch {
      setLoadError(d.errorTargets);
    } finally {
      setLoading(false);
    }
  }, [client, d]);

  // Fetched lazily: an event that is `public` or `members` never needs the
  // lists, and most are.
  useEffect(() => {
    if (audience === 'restricted' && !loaded && !loading && !loadError) {
      void loadTargets();
    }
  }, [audience, loaded, loading, loadError, loadTargets]);

  const toggle = (kind: 'groupIds' | 'userIds', id: string) => {
    const current = grants[kind];
    const next = current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id];
    onGrantsChange({ ...grants, [kind]: next });
  };

  const optionLabel: Record<AdminEventAudience, string> = {
    public: d.optionPublic,
    members: d.optionMembers,
    restricted: d.optionRestricted,
  };
  const optionHint: Record<AdminEventAudience, string> = {
    public: d.optionPublicHint,
    members: d.optionMembersHint,
    restricted: d.optionRestrictedHint,
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>
        {d.sectionTitle}
      </h2>

      <fieldset className="space-y-2">
        <legend className="sr-only">{d.sectionTitle}</legend>
        {AUDIENCES.map((level) => (
          <label
            key={level}
            className="flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3"
            style={{
              borderColor: audience === level ? 'var(--accent)' : 'var(--border)',
              background: 'var(--bg2)',
            }}
          >
            <input
              type="radio"
              name="event-audience"
              value={level}
              checked={audience === level}
              onChange={() => onAudienceChange(level)}
              className="mt-1"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium" style={{ color: 'var(--text)' }}>
                {optionLabel[level]}
              </span>
              <span className="block text-xs" style={{ color: 'var(--text3)' }}>
                {optionHint[level]}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {audience === 'public' && (
        <p
          role="alert"
          className="rounded-lg px-4 py-3 text-sm"
          style={{ background: 'var(--error-bg)', color: 'var(--error)' }}
        >
          {d.publicWarning}
        </p>
      )}

      {audience === 'restricted' && (
        <div className="space-y-4">
          {loading && (
            <p className="text-sm" style={{ color: 'var(--text2)' }}>
              {d.loadingTargets}
            </p>
          )}
          {loadError && (
            <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
              {loadError}
            </p>
          )}

          {loaded && (
            <>
              <p className="text-xs" style={{ color: 'var(--text3)' }}>
                {d.selectedCount(grants.groupIds.length, grants.userIds.length)}
              </p>

              <fieldset>
                <legend className="mb-2 text-xs font-semibold" style={{ color: 'var(--text2)' }}>
                  {d.groupsLabel}
                </legend>
                {groups.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--text3)' }}>
                    {d.groupsEmpty}
                  </p>
                ) : (
                  <ul className="max-h-48 space-y-1 overflow-y-auto">
                    {groups.map((group) => (
                      <li key={group.id}>
                        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
                          <input
                            type="checkbox"
                            checked={grants.groupIds.includes(group.id)}
                            onChange={() => toggle('groupIds', group.id)}
                          />
                          {group.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>

              <fieldset>
                <legend className="mb-2 text-xs font-semibold" style={{ color: 'var(--text2)' }}>
                  {d.usersLabel}
                </legend>
                {users.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--text3)' }}>
                    {d.usersEmpty}
                  </p>
                ) : (
                  <ul className="max-h-48 space-y-1 overflow-y-auto">
                    {users.map((user) => (
                      <li key={user.id}>
                        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
                          <input
                            type="checkbox"
                            checked={grants.userIds.includes(user.id)}
                            onChange={() => toggle('userIds', user.id)}
                          />
                          {user.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>
            </>
          )}
        </div>
      )}
    </section>
  );
}
