/**
 * The events board's navigation entry points.
 *
 * Milestone 20 shipped `/events` and `/admin/events` without a single link to
 * either, so the board was reachable only by typing the URL. These tests pin
 * the two in-product entries: the signed-in nav and the admin group of the
 * mobile drawer, including who is allowed to see the admin one.
 *
 * Lookups go by `href`, not by accessible name: `layout.nav.events` and
 * `layout.adminSidebar.events` read the same in both languages — as `tasks`
 * already does — and only the target tells the two entries apart.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ROLES, type RoleName } from '@arenaquest/shared/constants/roles';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';

let pathname = '/dashboard';
let roles: RoleName[] = [];
let drawerOpen = false;

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => ({ logout: vi.fn() }),
  useHasRole: (...required: RoleName[]) => required.some((role) => roles.includes(role)),
}));

vi.mock('@web/context/sidebar-context', () => ({
  useSidebar: () => ({ isOpen: drawerOpen, open: vi.fn(), close: vi.fn(), toggle: vi.fn() }),
}));

// The toggle reads the theme store through `matchMedia`, which jsdom does not
// implement, and it has its own suite. Nothing here is about the theme.
vi.mock('../theme-toggle', () => ({
  ThemeToggle: () => null,
}));

import { Nav } from '../nav';

const navCopy = dictEn.layout.nav;
const adminCopy = dictEn.layout.adminSidebar;

function renderNav() {
  return render(
    <DictProvider value={dictEn}>
      <Nav />
    </DictProvider>,
  );
}

/** The mobile drawer — the only `<aside>` the nav renders. */
function drawer(): HTMLElement {
  const aside = document.querySelector('aside');
  if (!aside) throw new Error('the mobile drawer is not rendered');
  return aside as HTMLElement;
}

/** Every anchor pointing at `href`, within `scope`. */
function linksTo(scope: ParentNode, href: string): HTMLAnchorElement[] {
  return Array.from(scope.querySelectorAll<HTMLAnchorElement>(`a[href="${href}"]`));
}

function soleLinkTo(scope: ParentNode, href: string): HTMLAnchorElement {
  const found = linksTo(scope, href);
  expect(found).toHaveLength(1);
  return found[0];
}

beforeEach(() => {
  pathname = '/dashboard';
  roles = [];
  drawerOpen = false;
});

describe('Nav — the signed-in events entry', () => {
  it('links to the public events board from the desktop bar', () => {
    renderNav();
    expect(soleLinkTo(document.body, '/events')).toHaveTextContent(navCopy.events);
  });

  it('links to the public events board from the mobile drawer', () => {
    drawerOpen = true;
    renderNav();
    expect(soleLinkTo(drawer(), '/events')).toHaveTextContent(navCopy.events);
  });

  it('reads its label from the dictionary, not a hardcoded string', () => {
    renderNav();
    expect(screen.getByRole('link', { name: navCopy.events })).toBeInTheDocument();
  });

  it('highlights the entry on the board itself', () => {
    pathname = '/events';
    drawerOpen = true;
    renderNav();
    expect(soleLinkTo(drawer(), '/events').className).toContain('bg-zinc-100');
  });

  /**
   * An event's detail page lives under the board's own path, exactly like a
   * topic under `/catalog`, so the section must stay highlighted there.
   */
  it('keeps the entry highlighted on an event detail page', () => {
    pathname = '/events/summer-open-2026';
    drawerOpen = true;
    renderNav();
    expect(soleLinkTo(drawer(), '/events').className).toContain('bg-zinc-100');
  });

  it('does not highlight a sibling section from an event detail page', () => {
    pathname = '/events/summer-open-2026';
    drawerOpen = true;
    renderNav();
    expect(soleLinkTo(drawer(), '/tasks').className).not.toContain('bg-zinc-100');
  });
});

describe('Nav — the admin events entry', () => {
  it('is offered to an admin', () => {
    roles = [ROLES.ADMIN];
    drawerOpen = true;
    renderNav();
    expect(soleLinkTo(drawer(), '/admin/events')).toHaveTextContent(adminCopy.events);
  });

  /** A content creator authors and edits drafts; only publishing is admin-only. */
  it('is offered to a content creator', () => {
    roles = [ROLES.CONTENT_CREATOR];
    drawerOpen = true;
    renderNav();
    expect(soleLinkTo(drawer(), '/admin/events')).toHaveTextContent(adminCopy.events);
  });

  it('sits with the other authoring entries, not among the admin-only ones', () => {
    roles = [ROLES.CONTENT_CREATOR];
    drawerOpen = true;
    renderNav();

    const aside = drawer();
    expect(linksTo(aside, '/admin/topics')).toHaveLength(1);
    expect(linksTo(aside, '/admin/tasks')).toHaveLength(1);
    expect(linksTo(aside, '/admin/users')).toHaveLength(0);
  });

  it('is absent for a student, along with the rest of the admin group', () => {
    roles = [ROLES.STUDENT];
    drawerOpen = true;
    renderNav();

    const aside = drawer();
    expect(linksTo(aside, '/admin/events')).toHaveLength(0);
    expect(aside).not.toHaveTextContent(adminCopy.title);
    // The public board stays available to them.
    expect(linksTo(aside, '/events')).toHaveLength(1);
  });
});
