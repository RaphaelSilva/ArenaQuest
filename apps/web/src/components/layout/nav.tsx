'use client';

import Link from 'next/link';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { CanView } from '@web/components/auth/can-view';
import { useAuth, useHasRole } from '@web/hooks/use-auth';

export function Nav() {
  const { logout } = useAuth();
  const canSeeTopics = useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR);

  return (
    <nav className="flex items-center gap-6 border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <span className="font-semibold text-zinc-900 dark:text-zinc-50">ArenaQuest</span>

      <div className="flex flex-1 items-center gap-4 text-sm">
        <Link
          href="/dashboard"
          className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          Dashboard
        </Link>

        <CanView role={ROLES.ADMIN}>
          <Link
            href="/admin/users"
            className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            User Management
          </Link>
        </CanView>

        {canSeeTopics && (
          <Link
            href="/admin/topics"
            className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Topic Tree
          </Link>
        )}
      </div>

      <button
        onClick={logout}
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
      >
        Sign out
      </button>
    </nav>
  );
}
