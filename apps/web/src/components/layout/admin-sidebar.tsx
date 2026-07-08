'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useHasRole } from '@web/hooks/use-auth';
import { useDict } from '@web/context/dict-context';

type NavItem = {
  label: string;
  href: string;
  requiredRoles?: typeof ROLES[keyof typeof ROLES][];
};

function NavItem({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const hasRequiredRole = useHasRole(...(item.requiredRoles || []));
  if (item.requiredRoles && !hasRequiredRole) return null;

  return (
    <li>
      <Link
        href={item.href}
        className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-white text-indigo-600 shadow-sm dark:bg-zinc-800 dark:text-indigo-400'
            : 'text-zinc-700 hover:bg-white/50 dark:text-zinc-300 dark:hover:bg-zinc-800/50'
        }`}
      >
        {item.label}
      </Link>
    </li>
  );
}

export function AdminSidebar() {
  const pathname = usePathname();
  const dict = useDict();

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
