'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useHasRole } from '@web/hooks/use-auth';
import { useDelinquencyCount } from '@web/hooks/use-delinquency-count';
import { useDict } from '@web/context/dict-context';

type NavItem = {
  label: string;
  href: string;
  requiredRoles?: typeof ROLES[keyof typeof ROLES][];
  /** An optional count rendered beside the label; `null` renders nothing. */
  badge?: { count: number | null; label: (total: number) => string };
};

function NavItem({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const hasRequiredRole = useHasRole(...(item.requiredRoles || []));
  if (item.requiredRoles && !hasRequiredRole) return null;

  const badgeCount = item.badge?.count ?? null;
  const showBadge = badgeCount !== null && badgeCount > 0;

  return (
    <li>
      <Link
        href={item.href}
        className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-white text-indigo-600 shadow-sm dark:bg-zinc-800 dark:text-indigo-400'
            : 'text-zinc-700 hover:bg-white/50 dark:text-zinc-300 dark:hover:bg-zinc-800/50'
        }`}
      >
        <span>{item.label}</span>
        {showBadge && (
          <span
            aria-label={item.badge?.label(badgeCount)}
            className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300"
          >
            {badgeCount}
          </span>
        )}
      </Link>
    </li>
  );
}

export function AdminSidebar() {
  const pathname = usePathname();
  const dict = useDict();
  const isAdmin = useHasRole(ROLES.ADMIN);
  // Failure-silent: `null` when it cannot load, which renders as no badge.
  const delinquencyCount = useDelinquencyCount(isAdmin);

  const navItems: NavItem[] = [
    { label: dict.layout.adminSidebar.users, href: '/admin/users', requiredRoles: [ROLES.ADMIN] },
    { label: dict.layout.adminSidebar.topics, href: '/admin/topics', requiredRoles: [ROLES.ADMIN, ROLES.CONTENT_CREATOR] },
    { label: dict.layout.adminSidebar.tasks, href: '/admin/tasks', requiredRoles: [ROLES.ADMIN, ROLES.CONTENT_CREATOR] },
    { label: dict.layout.adminSidebar.badges, href: '/admin/badges', requiredRoles: [ROLES.ADMIN, ROLES.CONTENT_CREATOR] },
    { label: dict.layout.adminSidebar.quests, href: '/admin/quests', requiredRoles: [ROLES.ADMIN, ROLES.CONTENT_CREATOR] },
    { label: dict.layout.adminSidebar.missions, href: '/admin/missions', requiredRoles: [ROLES.ADMIN, ROLES.CONTENT_CREATOR] },
    { label: dict.layout.adminSidebar.levels, href: '/admin/levels', requiredRoles: [ROLES.ADMIN] },
    { label: dict.layout.adminSidebar.players, href: '/admin/players', requiredRoles: [ROLES.ADMIN] },
    { label: dict.layout.adminSidebar.groups, href: '/admin/groups', requiredRoles: [ROLES.ADMIN] },
    { label: dict.layout.adminSidebar.access, href: '/admin/access', requiredRoles: [ROLES.ADMIN] },
    {
      // ADMIN only — never CONTENT_CREATOR — matching the API's own guard on
      // `/v1/admin/billing/*`.
      label: dict.layout.adminSidebar.billing,
      href: '/admin/billing',
      requiredRoles: [ROLES.ADMIN],
      badge: {
        count: delinquencyCount,
        label: dict.layout.adminSidebar.billingBadgeLabel,
      },
    },
  ];

  return (
    <aside className="hidden md:block w-48 border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <nav className="flex flex-col p-4">
        <h2 className="mb-4 px-3 text-sm font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
          {dict.layout.adminSidebar.title}
        </h2>
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return <NavItem key={item.href} item={item} isActive={isActive} />;
          })}
        </ul>
      </nav>
    </aside>
  );
}
