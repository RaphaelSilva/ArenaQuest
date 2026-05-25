'use client';

import Link from 'next/link';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useHasRole } from '@web/hooks/use-auth';
import { Button } from '@web/components/design-system';

export default function AdminDashboard() {
  const isAdmin = useHasRole(ROLES.ADMIN);
  const isContentCreator = useHasRole(ROLES.CONTENT_CREATOR);

  return (
    <div className="p-6 md:p-8 lg:p-10">
      <div className="mb-8">
        <h1 className="text-[28px] font-bold text-zinc-900 dark:text-zinc-50" style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.5px' }}>
          Admin Dashboard
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Manage users, content, and platform settings
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {isAdmin && (
          <Link href="/admin/users">
            <div className="cursor-pointer rounded-lg border border-zinc-200 bg-white p-6 hover:shadow-md transition-shadow dark:border-zinc-800 dark:bg-zinc-900 hover:dark:border-zinc-700">
              <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                User Management
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                Create, edit, and manage user accounts and roles
              </p>
              <Button variant="secondary" size="sm">
                Go to Users
              </Button>
            </div>
          </Link>
        )}

        {(isAdmin || isContentCreator) && (
          <Link href="/admin/topics">
            <div className="cursor-pointer rounded-lg border border-zinc-200 bg-white p-6 hover:shadow-md transition-shadow dark:border-zinc-800 dark:bg-zinc-900 hover:dark:border-zinc-700">
              <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Topic Tree
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                Create and organize learning topics and content
              </p>
              <Button variant="secondary" size="sm">
                Go to Topics
              </Button>
            </div>
          </Link>
        )}

        {(isAdmin || isContentCreator) && (
          <Link href="/admin/tasks">
            <div className="cursor-pointer rounded-lg border border-zinc-200 bg-white p-6 hover:shadow-md transition-shadow dark:border-zinc-800 dark:bg-zinc-900 hover:dark:border-zinc-700">
              <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Tasks
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                Manage learning tasks and assessments
              </p>
              <Button variant="secondary" size="sm">
                Go to Tasks
              </Button>
            </div>
          </Link>
        )}

        {isAdmin && (
          <Link href="/admin/groups">
            <div className="cursor-pointer rounded-lg border border-zinc-200 bg-white p-6 hover:shadow-md transition-shadow dark:border-zinc-800 dark:bg-zinc-900 hover:dark:border-zinc-700">
              <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Groups
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                Create and manage user groups and enrollments
              </p>
              <Button variant="secondary" size="sm">
                Go to Groups
              </Button>
            </div>
          </Link>
        )}
      </div>
    </div>
  );
}
