'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { Spinner } from '@web/components/spinner';
import { useDict } from '@web/context/dict-context';

export const runtime = 'edge';

/**
 * Group management is scoped as a follow-up (M5 task 10 carve-out).
 * The backend exposes /admin/groups/:id/enrollments for grant/revoke
 * but has no group CRUD endpoints (list, create, members) yet.
 * This page is a placeholder pending the group-entity backend work.
 */
export default function AdminGroupsPage() {
  const router = useRouter();
  const isAdmin = useHasRole(ROLES.ADMIN);
  const { isLoading: authLoading } = useAuth();
  const dict = useDict();
  const d = dict.admin.groups;

  useEffect(() => {
    if (!authLoading && !isAdmin) router.replace('/dashboard');
  }, [authLoading, isAdmin, router]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-zinc-400" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="mb-2 text-2xl font-bold" style={{ color: 'var(--text)' }}>
        {d.title}
      </h1>
      <p className="mb-6 text-sm" style={{ color: 'var(--text2)' }}>
        {d.subtitle}
      </p>
      <div
        className="rounded-xl border border-dashed py-12 text-center"
        style={{ borderColor: 'var(--border)' }}
      >
        <p className="text-sm font-medium" style={{ color: 'var(--text3)' }}>
          {d.comingSoon}
        </p>
      </div>
    </main>
  );
}
