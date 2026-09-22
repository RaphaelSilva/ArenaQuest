'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { Spinner } from '@web/components/spinner';
import { Badge } from '@web/components/design-system';
import { formatEventWhen } from '@web/components/events/event-format';
import type { AdminEvent, AdminEventStatus } from '@web/lib/admin-events-api';

export const runtime = 'edge';

/** The filter's own values; `all` is the absence of a `status` query parameter. */
const FILTERS: (AdminEventStatus | 'all')[] = ['all', 'draft', 'published', 'archived'];

/**
 * The events board's authoring list.
 *
 * It shows **drafts and archived events alongside published ones** — this is
 * the authoring surface, not the public board, and an event that has fallen off
 * `/events` still has to be findable here to be brought back.
 *
 * There is no delete control, here or anywhere else in this surface. No
 * `DELETE /{id}` exists: removal is the archive transition, which is reversible
 * and keeps the row and its flyer object together.
 */
export default function AdminEventsPage() {
  const router = useRouter();
  const { isLoading: authLoading } = useAuth();
  const canAccess = useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR);
  const client = useApiClient();
  const dict = useDict();
  const d = dict.admin.events;

  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<AdminEventStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authLoading && !canAccess) router.replace('/dashboard');
  }, [authLoading, canAccess, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const page = await client.adminEvents.list(filter === 'all' ? {} : { status: filter });
      setEvents(page.data);
      setTotal(page.total);
    } catch {
      setError(d.list.errorLoading);
    } finally {
      setLoading(false);
    }
  }, [client, d, filter]);

  useEffect(() => {
    if (canAccess) void load();
  }, [canAccess, load]);

  if (authLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="h-8 w-8 text-zinc-400" />
      </div>
    );
  }

  if (!canAccess) return null;

  const filterLabel: Record<AdminEventStatus | 'all', string> = {
    all: d.list.filterAll,
    draft: d.status.draft,
    published: d.status.published,
    archived: d.status.archived,
  };

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto px-6 py-12">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-2xl font-bold" style={{ color: 'var(--text)' }}>
            {d.title}
          </h1>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            {d.subtitle}
          </p>
        </div>
        <Link
          href="/admin/events/new"
          className="rounded-lg px-4 py-2 text-sm font-semibold"
          style={{ background: 'var(--accent)', color: '#0B0E17' }}
        >
          {d.list.newButton}
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--text3)' }}>
          {d.list.filterLabel}
        </span>
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            className="rounded-full border px-3 py-1 text-xs"
            style={{
              borderColor: filter === value ? 'var(--accent)' : 'var(--border2)',
              color: filter === value ? 'var(--accent)' : 'var(--text2)',
            }}
          >
            {filterLabel[value]}
          </button>
        ))}
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg px-4 py-3 text-sm"
          style={{ background: 'var(--error-bg)', color: 'var(--error)' }}
        >
          {error}
        </p>
      )}

      <p className="mb-3 text-xs" style={{ color: 'var(--text3)' }}>
        {d.list.countLabel(total)}
      </p>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-zinc-400" />
        </div>
      ) : events.length === 0 ? (
        <p
          className="rounded-xl border border-dashed py-8 text-center text-sm"
          style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
        >
          {d.list.empty}
        </p>
      ) : (
        <ul className="space-y-2">
          {events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </ul>
      )}
    </main>
  );
}

function EventRow({ event }: { event: AdminEvent }) {
  const dict = useDict();
  const d = dict.admin.events;
  const when = formatEventWhen(event, dict.events.locale);
  const isArchived = event.status === 'archived';

  const statusLabel: Record<AdminEventStatus, string> = {
    draft: d.status.draft,
    published: d.status.published,
    archived: d.status.archived,
  };
  const audienceLabel = {
    public: d.audienceName.public,
    members: d.audienceName.members,
    restricted: d.audienceName.restricted,
  }[event.audience];

  return (
    <li
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3"
      style={{
        // An archived event is visibly set apart: it is off the public board,
        // and a list that renders it like a live one invites editing the wrong
        // row.
        borderColor: isArchived ? 'var(--border2)' : 'var(--border)',
        background: 'var(--bg2)',
        opacity: isArchived ? 0.65 : 1,
      }}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium" style={{ color: 'var(--text)' }}>
          {event.title}
        </p>
        <p className="text-xs" style={{ color: 'var(--text3)' }}>
          {dict.events.when(when.date, when.time, when.zone)}
        </p>
        {isArchived && (
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            {d.list.archivedNote}
          </p>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center gap-3">
        <Badge status={event.status} size="sm">
          {statusLabel[event.status]}
        </Badge>
        <span className="text-xs" style={{ color: 'var(--text2)' }}>
          {audienceLabel}
        </span>
        <Link href={`/admin/events/${event.id}`} className="text-sm" style={{ color: 'var(--accent)' }}>
          {d.list.edit}
        </Link>
      </div>
    </li>
  );
}
