'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { useApiClient } from '@web/context/auth-context';
import { Spinner } from '@web/components/spinner';
import { useDict } from '@web/context/dict-context';
import type { GroupMember } from '@web/lib/admin-groups-api';
import type { Entities } from '@arenaquest/shared/types/entities';

export const runtime = 'edge';

type Props = { params: Promise<{ groupId: string }> };

export default function AdminGroupDetailPage({ params }: Props) {
  const { groupId } = use(params);
  const router = useRouter();
  const isAdmin = useHasRole(ROLES.ADMIN);
  const { isLoading: authLoading } = useAuth();
  const client = useApiClient();
  const dict = useDict();
  const d = dict.admin.groups;

  const [groupName, setGroupName] = useState('');
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [allUsers, setAllUsers] = useState<Entities.Identity.User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [studentsOnly, setStudentsOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAdmin) router.replace('/dashboard');
  }, [authLoading, isAdmin, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [groups, mem, usersResp] = await Promise.all([
        client.adminGroups.list(),
        client.adminGroups.listMembers(groupId),
        client.adminUsers.list(1, 200),
      ]);
      setGroupName(groups.find((g) => g.id === groupId)?.name ?? groupId);
      setMembers(mem);
      setAllUsers(usersResp.data);
    } catch {
      setError(d.errorLoading);
    } finally {
      setLoading(false);
    }
  }, [client, groupId, d]);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const memberIds = useMemo(() => new Set(members.map((m) => m.userId)), [members]);

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allUsers
      .filter((u) => !memberIds.has(u.id))
      .filter((u) => (studentsOnly ? u.roles.some((r) => r.name === ROLES.STUDENT) : true))
      .filter((u) =>
        q ? u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) : true,
      );
  }, [search, studentsOnly, allUsers, memberIds]);

  const handleAdd = async (userId: string) => {
    setBusy(true);
    setError('');
    try {
      const member = await client.adminGroups.addMember(groupId, userId);
      setMembers((prev) =>
        prev.some((m) => m.userId === member.userId) ? prev : [...prev, member],
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : d.errorMembers);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (userId: string) => {
    setBusy(true);
    setError('');
    try {
      await client.adminGroups.removeMember(groupId, userId);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
    } catch {
      setError(d.errorMembers);
    } finally {
      setBusy(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-zinc-400" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/admin/groups" className="text-sm transition-colors" style={{ color: 'var(--text2)' }}>
        {d.backToGroups}
      </Link>
      <h1 className="mt-4 mb-1 text-2xl font-bold" style={{ color: 'var(--text)' }}>
        {d.membersTitle(groupName)}
      </h1>
      <Link
        href={`/admin/access?type=group&id=${groupId}`}
        className="mb-6 mt-2 inline-block text-sm font-medium"
        style={{ color: 'var(--accent)' }}
      >
        {d.manageAccessLink}
      </Link>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg px-4 py-3 text-sm"
          style={{ background: 'var(--error-bg)', color: 'var(--error)' }}
        >
          {error}
        </p>
      )}

      {/* Add member */}
      <div
        className="mb-8 rounded-xl border p-4"
        style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}
      >
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>
          {d.addMember}
        </h2>
        <div className="mb-3 flex items-center gap-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={d.addMemberPlaceholder}
            disabled={busy}
            className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
          />
          <label
            className="flex flex-shrink-0 cursor-pointer items-center gap-2 text-sm"
            style={{ color: 'var(--text2)' }}
          >
            <input
              type="checkbox"
              checked={studentsOnly}
              onChange={(e) => setStudentsOnly(e.target.checked)}
            />
            {d.studentsOnly}
          </label>
        </div>

        {candidates.length === 0 ? (
          <p className="py-4 text-center text-sm" style={{ color: 'var(--text2)' }}>
            {d.noUsersToAdd}
          </p>
        ) : (
          <ul
            className="max-h-72 overflow-y-auto rounded-lg border"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
          >
            {candidates.map((u) => (
              <li
                key={u.id}
                className="flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0"
                style={{ borderColor: 'var(--border)' }}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" style={{ color: 'var(--text)' }}>
                    {u.name}
                  </p>
                  <p className="truncate text-xs" style={{ color: 'var(--text3)' }}>
                    {u.email}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleAdd(u.id)}
                  className="flex-shrink-0 rounded-lg px-3 py-1 text-xs font-semibold transition-all disabled:opacity-50"
                  style={{ background: 'var(--accent)', color: '#0B0E17' }}
                >
                  {d.add}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Member list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-zinc-400" />
        </div>
      ) : members.length === 0 ? (
        <p
          className="rounded-xl border border-dashed py-8 text-center text-sm"
          style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
        >
          {d.noMembers}
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Group members">
          {members.map((m) => (
            <li
              key={m.userId}
              className="flex items-center justify-between rounded-xl border px-4 py-3"
              style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" style={{ color: 'var(--text)' }}>
                  {m.name}
                </p>
                <p className="truncate text-xs" style={{ color: 'var(--text3)' }}>
                  {m.email}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRemove(m.userId)}
                className="flex-shrink-0 rounded-lg px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50"
                style={{ color: 'var(--error)', background: 'var(--error-bg)' }}
              >
                {d.removeMember}
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
