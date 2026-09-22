'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { useDict } from '@web/context/dict-context';
import { Spinner } from '@web/components/spinner';
import { EventForm } from '@web/components/admin/events/EventForm';

export const runtime = 'edge';

/**
 * Creating an event.
 *
 * Every event is born a draft — the create route accepts no `status` at all —
 * so there is no publish control here. Publishing is a transition on the saved
 * event, and an `admin`-only one at that.
 */
export default function NewAdminEventPage() {
  const router = useRouter();
  const { isLoading: authLoading } = useAuth();
  const canAccess = useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR);
  const canPublish = useHasRole(ROLES.ADMIN);
  const dict = useDict();
  const d = dict.admin.events;

  useEffect(() => {
    if (!authLoading && !canAccess) router.replace('/dashboard');
  }, [authLoading, canAccess, router]);

  if (authLoading) {
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
        {d.form.createTitle}
      </h1>

      <EventForm
        event={null}
        canPublish={canPublish}
        onCreated={(created) => router.push(`/admin/events/${created.id}`)}
        onReload={() => {}}
      />
    </main>
  );
}
