import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';

const roster = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/users',
}));

vi.mock('@web/hooks/use-auth', () => ({
  useHasRole: () => true,
}));

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return {
    ...actual,
    useApiClient: () => ({ adminBilling: { students: { roster: (...a: unknown[]) => roster(...a) } } }),
  };
});

import { AdminSidebar } from '../admin-sidebar';

const nav = dictEn.layout.adminSidebar;

function renderSidebar() {
  return render(
    <DictProvider value={dictEn}>
      <AdminSidebar />
    </DictProvider>,
  );
}

describe('AdminSidebar — the billing entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roster.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }]);
  });

  it('links to the billing console', async () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: new RegExp(nav.billing) })).toHaveAttribute(
      'href',
      '/admin/billing',
    );
  });

  it('asks the API only for the delinquent standing', async () => {
    renderSidebar();
    await waitFor(() => expect(roster).toHaveBeenCalledWith({ standing: 'delinquent' }));
  });

  it('renders the delinquency count as a badge', async () => {
    renderSidebar();
    expect(await screen.findByLabelText(nav.billingBadgeLabel(3))).toHaveTextContent('3');
  });

  /**
   * The sidebar renders on every admin screen, so a badge that cannot load must
   * be invisible rather than an error that breaks navigation everywhere else.
   */
  it('renders no badge, and no error, when the count cannot load', async () => {
    roster.mockRejectedValue(new Error('boom'));
    renderSidebar();

    await waitFor(() => expect(roster).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: new RegExp(nav.billing) })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: nav.users })).toBeInTheDocument();
  });

  it('hides the badge when nobody is delinquent', async () => {
    roster.mockResolvedValue([]);
    renderSidebar();

    await waitFor(() => expect(roster).toHaveBeenCalled());
    expect(screen.queryByLabelText(nav.billingBadgeLabel(0))).not.toBeInTheDocument();
  });
});
