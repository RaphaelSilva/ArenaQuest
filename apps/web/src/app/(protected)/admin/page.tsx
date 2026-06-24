'use client';

import Link from 'next/link';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useHasRole } from '@web/hooks/use-auth';
import { Button } from '@web/components/design-system';
import { useDict } from '@web/context/dict-context';

export default function AdminDashboard() {
  const isAdmin = useHasRole(ROLES.ADMIN);
  const isContentCreator = useHasRole(ROLES.CONTENT_CREATOR);
  const dict = useDict();
  const d = dict.admin.dashboard;

  return (
    <div className="p-6 md:p-8 lg:p-10">
      <div className="mb-8">
        <h1 className="text-[28px] font-bold text-zinc-900 dark:text-zinc-50" style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.5px' }}>
          {d.title}
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          {d.subtitle}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {isAdmin && (
          <Link href="/admin/users">
            <div className="cursor-pointer rounded-lg border border-zinc-200 bg-white p-6 hover:shadow-md transition-shadow dark:border-zinc-800 dark:bg-zinc-900 hover:dark:border-zinc-700">
              <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {d.userManagementTitle}
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                {d.userManagementDesc}
              </p>
              <Button variant="secondary" size="sm">
                {d.userManagementButton}
              </Button>
            </div>
          </Link>
        )}

        {(isAdmin || isContentCreator) && (
          <Link href="/admin/topics">
            <div className="cursor-pointer rounded-lg border border-zinc-200 bg-white p-6 hover:shadow-md transition-shadow dark:border-zinc-800 dark:bg-zinc-900 hover:dark:border-zinc-700">
              <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {d.topicTreeTitle}
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                {d.topicTreeDesc}
              </p>
              <Button variant="secondary" size="sm">
                {d.topicTreeButton}
              </Button>
            </div>
          </Link>
        )}

        {(isAdmin || isContentCreator) && (
          <Link href="/admin/tasks">
            <div className="cursor-pointer rounded-lg border border-zinc-200 bg-white p-6 hover:shadow-md transition-shadow dark:border-zinc-800 dark:bg-zinc-900 hover:dark:border-zinc-700">
              <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {d.tasksTitle}
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                {d.tasksDesc}
              </p>
              <Button variant="secondary" size="sm">
                {d.tasksButton}
              </Button>
            </div>
          </Link>
        )}

        {isAdmin && (
          <Link href="/admin/groups">
            <div className="cursor-pointer rounded-lg border border-zinc-200 bg-white p-6 hover:shadow-md transition-shadow dark:border-zinc-800 dark:bg-zinc-900 hover:dark:border-zinc-700">
              <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {d.groupsTitle}
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                {d.groupsDesc}
              </p>
              <Button variant="secondary" size="sm">
                {d.groupsButton}
              </Button>
            </div>
          </Link>
        )}
      </div>

      {(isAdmin || isContentCreator) && (
        <div className="mt-12">
          <h2 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-50" style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.5px' }}>
            {d.gamificationHeading}
          </h2>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Link href="/admin/badges">
              <div className="cursor-pointer rounded-lg border border-zinc-200 bg-white p-6 hover:shadow-md transition-shadow dark:border-zinc-800 dark:bg-zinc-900 hover:dark:border-zinc-700">
                <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  {d.badgesTitle}
                </h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                  {d.badgesDesc}
                </p>
                <Button variant="secondary" size="sm">
                  {d.badgesButton}
                </Button>
              </div>
            </Link>

            <Link href="/admin/quests">
              <div className="cursor-pointer rounded-lg border border-zinc-200 bg-white p-6 hover:shadow-md transition-shadow dark:border-zinc-800 dark:bg-zinc-900 hover:dark:border-zinc-700">
                <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  {d.questsTitle}
                </h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                  {d.questsDesc}
                </p>
                <Button variant="secondary" size="sm">
                  {d.questsButton}
                </Button>
              </div>
            </Link>

            <Link href="/admin/missions">
              <div className="cursor-pointer rounded-lg border border-zinc-200 bg-white p-6 hover:shadow-md transition-shadow dark:border-zinc-800 dark:bg-zinc-900 hover:dark:border-zinc-700">
                <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  {d.missionsTitle}
                </h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                  {d.missionsDesc}
                </p>
                <Button variant="secondary" size="sm">
                  {d.missionsButton}
                </Button>
              </div>
            </Link>

            {isAdmin && (
              <Link href="/admin/levels">
                <div className="cursor-pointer rounded-lg border border-zinc-200 bg-white p-6 hover:shadow-md transition-shadow dark:border-zinc-800 dark:bg-zinc-900 hover:dark:border-zinc-700">
                  <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    {d.levelsTitle}
                  </h2>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                    {d.levelsDesc}
                  </p>
                  <Button variant="secondary" size="sm">
                    {d.levelsButton}
                  </Button>
                </div>
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
