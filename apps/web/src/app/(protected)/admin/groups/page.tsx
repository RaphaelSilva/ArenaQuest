'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { useApiClient } from '@web/context/auth-context';
import { Spinner } from '@web/components/spinner';
import { useDict } from '@web/context/dict-context';
import type { AdminGroup } from '@web/lib/admin-groups-api';

export const runtime = 'edge';

export default function AdminGroupsPage() {
  const router = useRouter();
  const isAdmin = useHasRole(ROLES.ADMIN);
  const { isLoading: authLoading } = useAuth();
  const client = useApiClient();
  const dict = useDict();
  const d = dict.admin.groups;

  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAdmin) router.replace('/dashboard');
  }, [authLoading, isAdmin, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setGroups(await client.adminGroups.list());
    } catch {
      setError(d.errorLoading);
    } finally {
      setLoading(false);
    }
  }, [client, d]);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError('');
    try {
      await client.adminGroups.create({ name: name.trim(), description: description.trim() });
      setName('');
      setDescription('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : d.errorCreate);
    } finally {
      setCreating(false);
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
    <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-6 py-12">
      <h1 className="mb-2 text-2xl font-bold" style={{ color: 'var(--text)' }}>
        {d.title}
      </h1>
      <p className="mb-6 text-sm" style={{ color: 'var(--text2)' }}>
        {d.subtitle}
      </p>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg px-4 py-3 text-sm"
          style={{ background: 'var(--error-bg)', color: 'var(--error)' }}
        >
          {error}
        </p>
      )}

      {/* Create form */}
      <form
        onSubmit={handleCreate}
        className="mb-8 rounded-xl border p-4"
        style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}
      >
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>
          {d.createTitle}
        </h2>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs" style={{ color: 'var(--text2)' }}>
              {d.nameLabel}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={d.namePlaceholder}
              maxLength={100}
              required
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs" style={{ color: 'var(--text2)' }}>
              {d.descriptionLabel}
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={d.descriptionPlaceholder}
              maxLength={500}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
            />
          </div>
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="rounded-lg px-4 py-2 text-sm font-semibold transition-all disabled:opacity-60"
            style={{ background: 'var(--accent)', color: '#0B0E17' }}
          >
            {creating ? d.creating : d.createButton}
          </button>
        </div>
      </form>

      {/* Group list */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>
        {d.listTitle(groups.length)}
      </h2>
      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-zinc-400" />
        </div>
      ) : groups.length === 0 ? (
        <p
          className="rounded-xl border border-dashed py-8 text-center text-sm"
          style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
        >
          {d.empty}
        </p>
      ) : (
        <ul className="space-y-2">
          {groups.map((g) => (
            <li
              key={g.id}
              className="flex items-center justify-between rounded-xl border px-4 py-3"
              style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" style={{ color: 'var(--text)' }}>
                  {g.name}
                </p>
                <p className="text-xs" style={{ color: 'var(--text3)' }}>
                  {d.membersCount(g.memberCount)}
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-3 text-sm">
                <Link href={`/admin/groups/${g.id}`} style={{ color: 'var(--accent)' }}>
                  {d.manageMembers}
                </Link>
                <Link href={`/admin/access?type=group&id=${g.id}`} style={{ color: 'var(--accent)' }}>
                  {d.manageAccessLink}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
