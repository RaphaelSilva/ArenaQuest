'use client';

import { use } from 'react';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { Spinner } from '@web/components/spinner';
import { useDict } from '@web/context/dict-context';

export const runtime = 'edge';

type Props = { params: Promise<{ groupId: string }> };

/**
 * Group detail page — placeholder pending backend group CRUD endpoints.
 * The enrollment grant/revoke API at /admin/groups/:id/enrollments is ready;
 * this page will be wired once group listing and member management exist server-side.
 */
export default function AdminGroupDetailPage({ params }: Props) {
  const { groupId } = use(params);
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
    <main className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/admin/groups" className="text-sm transition-colors" style={{ color: 'var(--text2)' }}>
        {d.backToGroups}
      </Link>
      <h1 className="mt-4 mb-2 text-2xl font-bold" style={{ color: 'var(--text)' }}>
        {d.detailTitle(groupId)}
      </h1>
      <p className="mb-6 text-sm" style={{ color: 'var(--text2)' }}>
        {d.detailSubtitle}
      </p>
      <div
        className="rounded-xl border border-dashed py-12 text-center"
        style={{ borderColor: 'var(--border)' }}
      >
        <p className="text-sm font-medium" style={{ color: 'var(--text3)' }}>
          {d.detailComingSoon}
        </p>
      </div>
    </main>
  );
}
