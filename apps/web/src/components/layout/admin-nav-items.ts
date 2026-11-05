import { ROLES, type RoleName } from '@arenaquest/shared/constants/roles';
import type { Dictionary } from '@web/i18n/types';

type AdminNavLabel = Exclude<
  keyof Dictionary['layout']['adminSidebar'],
  'title' | 'billingBadgeLabel'
>;

type AdminNavItem = {
  labelKey: AdminNavLabel;
  href: `/admin/${string}`;
  requiredRoles: readonly RoleName[];
};

export const ADMIN_NAV_ITEMS = [
  { labelKey: 'users', href: '/admin/users', requiredRoles: [ROLES.ADMIN] },
  {
    labelKey: 'topics',
    href: '/admin/topics',
    requiredRoles: [ROLES.ADMIN, ROLES.CONTENT_CREATOR],
  },
  {
    labelKey: 'tasks',
    href: '/admin/tasks',
    requiredRoles: [ROLES.ADMIN, ROLES.CONTENT_CREATOR],
  },
  // A content creator authors event drafts; only an admin may publish one.
  {
    labelKey: 'events',
    href: '/admin/events',
    requiredRoles: [ROLES.ADMIN, ROLES.CONTENT_CREATOR],
  },
  {
    labelKey: 'badges',
    href: '/admin/badges',
    requiredRoles: [ROLES.ADMIN, ROLES.CONTENT_CREATOR],
  },
  {
    labelKey: 'quests',
    href: '/admin/quests',
    requiredRoles: [ROLES.ADMIN, ROLES.CONTENT_CREATOR],
  },
  {
    labelKey: 'missions',
    href: '/admin/missions',
    requiredRoles: [ROLES.ADMIN, ROLES.CONTENT_CREATOR],
  },
  { labelKey: 'levels', href: '/admin/levels', requiredRoles: [ROLES.ADMIN] },
  { labelKey: 'players', href: '/admin/players', requiredRoles: [ROLES.ADMIN] },
  { labelKey: 'groups', href: '/admin/groups', requiredRoles: [ROLES.ADMIN] },
  { labelKey: 'access', href: '/admin/access', requiredRoles: [ROLES.ADMIN] },
  // Billing mirrors the API's admin-only guard.
  { labelKey: 'billing', href: '/admin/billing', requiredRoles: [ROLES.ADMIN] },
] as const satisfies readonly AdminNavItem[];
