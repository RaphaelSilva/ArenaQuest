'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { Logo } from '@web/components/design-system';
import { useSidebar } from '@web/context/sidebar-context';
import { useDict } from '@web/context/dict-context';

function MobileDrawer({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const { logout } = useAuth();
  const isAdmin = useHasRole(ROLES.ADMIN);
  const canAccessAdmin = useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR);
  const dict = useDict();

  const navLinks = [
    { label: dict.layout.nav.dashboard, href: '/dashboard' },
    { label: dict.layout.nav.catalog, href: '/catalog' },
    { label: dict.layout.nav.tasks, href: '/tasks' },
    { label: dict.layout.nav.settings, href: '/settings' },
  ];

  const adminLinks = [
    { label: dict.layout.adminSidebar.users, href: '/admin/users', roles: [ROLES.ADMIN] },
    { label: dict.layout.adminSidebar.topics, href: '/admin/topics', roles: [ROLES.ADMIN, ROLES.CONTENT_CREATOR] },
    { label: dict.layout.adminSidebar.tasks, href: '/admin/tasks', roles: [ROLES.ADMIN, ROLES.CONTENT_CREATOR] },
    { label: dict.layout.adminSidebar.groups, href: '/admin/groups', roles: [ROLES.ADMIN] },
  ];

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 md:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-white shadow-xl dark:bg-zinc-900 md:hidden">
        <div className="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-800">
          <Logo size="sm" />
          <button
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label={dict.layout.nav.closeMenu}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="flex flex-1 flex-col overflow-y-auto p-4">
          <ul className="space-y-1">
            {navLinks.map((link) => {
              const isActive = pathname === link.href || (link.href === '/catalog' && pathname.startsWith('/catalog/'));
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={onClose}
                    className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                        : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>

          {canAccessAdmin && (
            <>
              <div className="my-4 border-t border-zinc-200 dark:border-zinc-800" />
              <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {dict.layout.adminSidebar.title}
              </p>
              <ul className="space-y-1">
                {adminLinks.map((link) => {
                  const canSee = link.roles.includes(ROLES.ADMIN) ? isAdmin : canAccessAdmin;
                  if (!canSee) return null;
                  const isActive = pathname === link.href || pathname.startsWith(link.href + '/');
                  return (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        onClick={onClose}
                        className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                          isActive
                            ? 'bg-zinc-100 text-indigo-600 dark:bg-zinc-800 dark:text-indigo-400'
                            : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/50'
                        }`}
                      >
                        {link.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </nav>

        <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
          <button
            onClick={() => { onClose(); logout(); }}
            className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            {dict.layout.nav.signOut}
          </button>
        </div>
      </aside>
    </>
  );
}

export function Nav() {
  const pathname = usePathname();
  const { logout } = useAuth();
  const canAccessAdmin = useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR);
  const { isOpen, toggle, close } = useSidebar();
  const dict = useDict();

  return (
    <>
      <nav className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3 md:px-6 dark:border-zinc-800 dark:bg-zinc-900">
        {/* Hamburger — mobile only */}
        <button
          onClick={toggle}
          className="flex-shrink-0 rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 md:hidden"
          aria-label={dict.layout.nav.openMenu}
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <Logo size="sm" />

        {/* Desktop links */}
        <div className="hidden flex-1 items-center gap-4 text-sm md:flex">
          <Link
            href="/dashboard"
            className={pathname === '/dashboard' ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50'}
          >
            {dict.layout.nav.dashboard}
          </Link>
          <Link
            href="/catalog"
            className={(pathname === '/catalog' || pathname.startsWith('/catalog/')) ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50'}
          >
            {dict.layout.nav.catalog}
          </Link>
          {canAccessAdmin && (
            <Link href="/admin" className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50">
              {dict.layout.nav.admin}
            </Link>
          )}
          <Link
            href="/tasks"
            className={pathname === '/tasks' ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50'}
          >
            {dict.layout.nav.tasks}
          </Link>
          <Link
            href="/settings"
            className={pathname === '/settings' ? 'text-zinc-900 dark:text-zinc-50' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50'}
          >
            {dict.layout.nav.settings}
          </Link>
        </div>

        {/* Desktop sign out */}
        <button
          onClick={logout}
          className="hidden text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50 md:block"
        >
          {dict.layout.nav.signOut}
        </button>
      </nav>

      {/* Mobile drawer */}
      {isOpen && <MobileDrawer onClose={close} />}
    </>
  );
}
