import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLES, type RoleName } from '@arenaquest/shared/constants/roles';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';

let roles: RoleName[] = [];

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/topics',
}));

vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => ({ logout: vi.fn() }),
  useHasRole: (...required: RoleName[]) => required.some((role) => roles.includes(role)),
}));

vi.mock('@web/hooks/use-delinquency-count', () => ({
  useDelinquencyCount: () => null,
}));

vi.mock('@web/context/sidebar-context', () => ({
  useSidebar: () => ({ isOpen: true, close: vi.fn(), toggle: vi.fn() }),
}));

vi.mock('../theme-toggle', () => ({
  ThemeToggle: () => null,
}));

import { AdminSidebar } from '../admin-sidebar';
import { Nav } from '../nav';

function renderWithDict(component: React.ReactNode) {
  return render(<DictProvider value={dictEn}>{component}</DictProvider>);
}

function adminDestinations(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>('aside a[href^="/admin/"]'))
    .map((link) => link.getAttribute('href'))
    .filter((href): href is string => href !== null)
    .sort();
}

function destinationsFor(component: React.ReactNode): string[] {
  const { container, unmount } = renderWithDict(component);
  const destinations = adminDestinations(container);
  unmount();
  return destinations;
}

beforeEach(() => {
  roles = [];
});

afterEach(cleanup);

describe('admin navigation parity', () => {
  it.each([
    {
      role: ROLES.ADMIN,
      expected: [
        '/admin/access',
        '/admin/badges',
        '/admin/billing',
        '/admin/events',
        '/admin/groups',
        '/admin/levels',
        '/admin/missions',
        '/admin/players',
        '/admin/quests',
        '/admin/tasks',
        '/admin/topics',
        '/admin/users',
      ],
    },
    {
      role: ROLES.CONTENT_CREATOR,
      expected: [
        '/admin/badges',
        '/admin/events',
        '/admin/missions',
        '/admin/quests',
        '/admin/tasks',
        '/admin/topics',
      ],
    },
    { role: ROLES.STUDENT, expected: [] },
  ])('renders the same destinations for $role', ({ role, expected }) => {
    roles = [role];

    const desktop = destinationsFor(<AdminSidebar />);
    const mobile = destinationsFor(<Nav />);

    expect(desktop).toEqual(expected);
    expect(mobile).toEqual(expected);
    expect(mobile).toEqual(desktop);
  });
});
