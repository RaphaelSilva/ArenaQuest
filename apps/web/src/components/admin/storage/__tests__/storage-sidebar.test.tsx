import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';

/**
 * The *Storage* sidebar entry is ADMIN only. `useHasRole` is resolved against a
 * fake session so the real `requiredRoles` of each item decide visibility.
 */
let sessionRoles: string[] = [];

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/topics',
}));

vi.mock('@web/hooks/use-auth', () => ({
  useHasRole: (...roles: string[]) => roles.some((role) => sessionRoles.includes(role)),
}));

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return {
    ...actual,
    useApiClient: () => ({ adminBilling: { students: { roster: async () => [] } } }),
  };
});

import { AdminSidebar } from '@web/components/layout/admin-sidebar';

const nav = dictEn.layout.adminSidebar;

function renderSidebar() {
  return render(
    <DictProvider value={dictEn}>
      <AdminSidebar />
    </DictProvider>,
  );
}

describe('AdminSidebar — the storage entry', () => {
  beforeEach(() => {
    sessionRoles = [];
  });

  it('links an admin to /admin/storage', () => {
    sessionRoles = [ROLES.ADMIN];
    renderSidebar();
    expect(screen.getByRole('link', { name: nav.storage })).toHaveAttribute('href', '/admin/storage');
  });

  it('is absent for a content_creator session', () => {
    sessionRoles = [ROLES.CONTENT_CREATOR];
    renderSidebar();
    expect(screen.queryByRole('link', { name: nav.storage })).not.toBeInTheDocument();
    // The creator still sees the areas it is admitted to.
    expect(screen.getByRole('link', { name: nav.topics })).toBeInTheDocument();
  });
});
