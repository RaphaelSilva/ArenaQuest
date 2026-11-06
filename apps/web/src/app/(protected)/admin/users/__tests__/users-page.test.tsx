import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import type { Entities } from '@arenaquest/shared/types/entities';

const list = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => ({ isLoading: false }),
  useHasRole: () => true,
}));

const stableClient = {
  adminUsers: {
    list: (...a: unknown[]) => list(...a),
    create: vi.fn(),
    update: vi.fn(),
    deactivate: vi.fn(),
  },
};

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return {
    ...actual,
    useApiClient: () => stableClient,
  };
});

import AdminUsersPage from '../page';

function user(i: number): Entities.Identity.User {
  return {
    id: `user-${i}`,
    name: `User ${i}`,
    email: `user${i}@example.com`,
    status: 'active',
    roles: [{ id: 'r1', name: 'student' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Entities.Identity.User;
}

function renderPage() {
  return render(
    <DictProvider value={dictEn}>
      <AdminUsersPage />
    </DictProvider>,
  );
}

describe('AdminUsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue({ data: [user(1), user(2)], total: 45 });
  });

  it('owns its scroll container (the admin layout clips at the viewport)', async () => {
    renderPage();
    await screen.findByText('User 1');
    expect(screen.getByRole('main')).toHaveClass('overflow-y-auto');
  });

  it('asks the API for the first page with the default page size', async () => {
    renderPage();
    await screen.findByText('User 1');
    expect(list).toHaveBeenCalledWith(1, 20);
  });

  it('refetches the next page when the pagination advances', async () => {
    renderPage();
    await screen.findByText('User 1');

    fireEvent.click(screen.getByRole('button', { name: dictEn.admin.users.pagination.next }));

    await waitFor(() => expect(list).toHaveBeenLastCalledWith(2, 20));
    expect(screen.getByText(dictEn.admin.users.pagination.pageInfo(2, 3, 45))).toBeInTheDocument();
  });

  it('resets to page 1 with the new size when the page size changes', async () => {
    renderPage();
    await screen.findByText('User 1');

    fireEvent.click(screen.getByRole('button', { name: dictEn.admin.users.pagination.next }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(2, 20));

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '50' } });

    await waitFor(() => expect(list).toHaveBeenLastCalledWith(1, 50));
  });
});
