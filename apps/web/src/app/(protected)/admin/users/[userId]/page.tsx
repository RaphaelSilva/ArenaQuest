'use client';

import { useEffect, useState, use, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useHasRole } from '@web/hooks/use-auth';
import { useApiClient } from '@web/context/auth-context';
import { ResetPasswordModal } from '@web/components/admin/ResetPasswordModal';
import { Spinner } from '@web/components/spinner';
import { useDict } from '@web/context/dict-context';
import type { Entities } from '@arenaquest/shared/types/entities';

export const runtime = 'edge';

type Props = { params: Promise<{ userId: string }> };

export default function AdminUserDetailPage({ params }: Props) {
  const { userId } = use(params);
  const router = useRouter();
  const isAdmin = useHasRole(ROLES.ADMIN);
  const client = useApiClient();
  const [user, setUser] = useState<Entities.Identity.User | null>(null);
  const [userError, setUserError] = useState('');
  const [showResetModal, setShowResetModal] = useState(false);
  const dict = useDict();
  const d = dict.admin.users.detail;

  const loadUser = useCallback(async () => {
    try {
      const res = await client.adminUsers.list();
      const found = res.data.find((u) => u.id === userId);
      if (!found) setUserError(d.errorNotFound);
      else {
        setUser(found);
        setUserError('');
      }
    } catch {
      setUserError(d.errorLoading);
    }
  }, [client, userId, d]);

  useEffect(() => {
    if (!isAdmin) router.replace('/dashboard');
  }, [isAdmin, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadUser();
  }, [loadUser]);

  if (!isAdmin) return null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/admin/users" className="text-sm transition-colors" style={{ color: 'var(--text2)' }}>
        {d.backToUsers}
      </Link>

      {userError ? (
        <p role="alert" className="mt-4 rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--error-bg)', color: 'var(--error)' }}>
          {userError}
        </p>
      ) : user ? (
        <header className="mt-4 mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>{user.name}</h1>
            <p className="text-sm" style={{ color: 'var(--text2)' }}>{user.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/admin/access?type=user&id=${userId}`}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
              style={{ background: 'var(--accent)' }}
            >
              {dict.admin.access.manageLink}
            </Link>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowResetModal(true)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
                style={{ background: 'var(--error)' }}
              >
                {d.resetPasswordButton}
              </button>
            )}
          </div>
        </header>
      ) : (
        <div className="mt-8 flex justify-center">
          <Spinner className="h-6 w-6 text-zinc-400" />
        </div>
      )}

      {user && (
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="font-medium" style={{ color: 'var(--text3)' }}>{d.rolesLabel}</dt>
            <dd style={{ color: 'var(--text)' }}>{user.roles.map((r) => r.name).join(', ') || '—'}</dd>
          </div>
          <div>
            <dt className="font-medium" style={{ color: 'var(--text3)' }}>{d.statusLabel}</dt>
            <dd style={{ color: 'var(--text)' }}>{user.status}</dd>
          </div>
          <div>
            <dt className="font-medium" style={{ color: 'var(--text3)' }}>{d.memberSinceLabel}</dt>
            <dd style={{ color: 'var(--text)' }}>{new Date(user.createdAt).toLocaleDateString('pt-BR')}</dd>
          </div>
        </dl>
      )}

      {showResetModal && user && (
        <ResetPasswordModal
          user={user}
          onClose={() => setShowResetModal(false)}
          onSuccess={() => void loadUser()}
        />
      )}
    </main>
  );
}
