'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { adminUsersApi } from '@web/lib/admin-users-api';
import { EnrollmentsTab } from '@web/components/enrollment/enrollments-tab';
import { Spinner } from '@web/components/spinner';
import type { Entities } from '@arenaquest/shared/types/entities';

export const runtime = 'edge';

type Tab = 'profile' | 'enrollments';

type Props = { params: Promise<{ userId: string }> };

export default function AdminUserDetailPage({ params }: Props) {
  const { userId } = use(params);
  const router = useRouter();
  const isAdmin = useHasRole(ROLES.ADMIN);
  const { accessToken, isLoading: authLoading, refreshSession, setAccessToken, onSessionExpired } = useAuth();
  const [tab, setTab] = useState<Tab>('enrollments');
  const [user, setUser] = useState<Entities.Identity.User | null>(null);
  const [userError, setUserError] = useState('');

  useEffect(() => {
    if (!authLoading && !isAdmin) router.replace('/dashboard');
  }, [authLoading, isAdmin, router]);

  useEffect(() => {
    if (!accessToken) return;
    adminUsersApi.list(accessToken, refreshSession, setAccessToken, onSessionExpired, 1, 100)
      .then((res) => {
        const found = res.data.find((u) => u.id === userId);
        if (!found) setUserError('User not found.');
        else setUser(found);
      })
      .catch(() => setUserError('Failed to load user.'));
  }, [accessToken, userId, refreshSession, setAccessToken, onSessionExpired]);

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
      <Link href="/admin/users" className="text-sm transition-colors" style={{ color: 'var(--text2)' }}>
        ← Back to users
      </Link>

      {userError ? (
        <p role="alert" className="mt-4 rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--error-bg)', color: 'var(--error)' }}>
          {userError}
        </p>
      ) : user ? (
        <header className="mt-4 mb-6">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>{user.name}</h1>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>{user.email}</p>
        </header>
      ) : (
        <div className="mt-8 flex justify-center">
          <Spinner className="h-6 w-6 text-zinc-400" />
        </div>
      )}

      <nav className="mb-6 flex gap-1 border-b" style={{ borderColor: 'var(--border)' }} aria-label="User detail tabs">
        {(['enrollments', 'profile'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className="px-4 py-2 text-sm font-medium capitalize transition-colors"
            style={{
              color: tab === t ? 'var(--accent)' : 'var(--text2)',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
            }}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'enrollments' && accessToken && (
        <EnrollmentsTab userId={userId} token={accessToken} refreshSession={refreshSession} setAccessToken={setAccessToken} onSessionExpired={onSessionExpired} />
      )}

      {tab === 'profile' && user && (
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="font-medium" style={{ color: 'var(--text3)' }}>Roles</dt>
            <dd style={{ color: 'var(--text)' }}>{user.roles.map((r) => r.name).join(', ') || '—'}</dd>
          </div>
          <div>
            <dt className="font-medium" style={{ color: 'var(--text3)' }}>Status</dt>
            <dd style={{ color: 'var(--text)' }}>{user.status}</dd>
          </div>
          <div>
            <dt className="font-medium" style={{ color: 'var(--text3)' }}>Member since</dt>
            <dd style={{ color: 'var(--text)' }}>{new Date(user.createdAt).toLocaleDateString('pt-BR')}</dd>
          </div>
        </dl>
      )}
    </main>
  );
}
