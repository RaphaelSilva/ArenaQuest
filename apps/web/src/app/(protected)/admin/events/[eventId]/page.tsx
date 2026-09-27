'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { Spinner } from '@web/components/spinner';
import { EventForm } from '@web/components/admin/events/EventForm';
import type { AdminEvent } from '@web/lib/admin-events-api';

export const runtime = 'edge';

/**
 * Editing one event.
 *
 * The event is loaded through `findById`, which pages the admin list — the
 * router exposes no `GET /{id}`, and inventing one is a backend change.
 *
 * `key={event.id}` on the form is deliberate: a reload after a flyer upload or
 * a status change replaces the `AdminEvent` object, and the form must keep the
 * fields the admin is in the middle of typing rather than remount around them.
 */
export default function EditAdminEventPage() {
  const router = useRouter();
  const params = useParams<{ eventId: string }>();
  const eventId = params.eventId;
  const { isLoading: authLoading } = useAuth();
  const canAccess = useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR);
  const canPublish = useHasRole(ROLES.ADMIN);
  const client = useApiClient();
  const dict = useDict();
  const d = dict.admin.events;

  const [event, setEvent] = useState<AdminEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authLoading && !canAccess) router.replace('/dashboard');
  }, [authLoading, canAccess, router]);

  const load = useCallback(async () => {
    setError('');
    try {
      const found = await client.adminEvents.findById(eventId);
      if (!found) setError(d.form.notFound);
      setEvent(found);
    } catch {
      setError(d.list.errorLoading);
    } finally {
      setLoading(false);
    }
  }, [client, d, eventId]);

  useEffect(() => {
    if (canAccess) void load();
  }, [canAccess, load]);

  if (authLoading || loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="h-8 w-8 text-zinc-400" />
      </div>
    );
  }

  if (!canAccess) return null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-6 py-12">
      <Link href="/admin/events" className="text-sm" style={{ color: 'var(--accent)' }}>
        {d.form.backToList}
      </Link>
      <h1 className="mb-6 mt-2 text-2xl font-bold" style={{ color: 'var(--text)' }}>
        {d.form.editTitle}
      </h1>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg px-4 py-3 text-sm"
          style={{ background: 'var(--error-bg)', color: 'var(--error)' }}
        >
          {error}
        </p>
      )}

      {event && (
        <EventForm
          key={event.id}
          event={event}
          canPublish={canPublish}
          onCreated={() => {}}
          onReload={() => void load()}
        />
      )}
    </main>
  );
}
