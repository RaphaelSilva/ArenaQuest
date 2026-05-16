'use client';

import Link from 'next/link';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { Logo } from '@web/components/design-system';

export function Nav() {
  const { logout } = useAuth();
  const canAccessAdmin = useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR);

  return (
    <nav className="flex items-center gap-6 border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <Logo size="sm" />

      <div className="flex flex-1 items-center gap-4 text-sm">
        <Link
          href="/dashboard"
          className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          Dashboard
        </Link>

        {canAccessAdmin && (
          <Link
            href="/admin"
            className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Admin
          </Link>
        )}

        <Link
          href="/tasks"
          className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          Tasks
        </Link>

        <Link
          href="/settings"
          className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          Settings
        </Link>
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
