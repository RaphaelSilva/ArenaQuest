import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import type { Badge } from '@web/lib/admin-gamification-api';

const replace = vi.fn();
const list = vi.fn();
const create = vi.fn();
const update = vi.fn();

let isAdmin = true;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => ({ isLoading: false }),
  useHasRole: (...roles: string[]) => {
    if (roles.includes('admin') && roles.length === 1) return isAdmin;
    return true;
  },
}));

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return {
    ...actual,
    useApiClient: () => ({
      adminGamification: {
        badges: {
          list: (...a: unknown[]) => list(...a),
          create: (...a: unknown[]) => create(...a),
          update: (...a: unknown[]) => update(...a),
        },
      },
    }),
  };
});

import AdminBadgesPage from '../page';

const sampleBadge: Badge = {
  id: 'b1',
  slug: 'perfect-streak',
  name: 'Perfect Streak',
  iconEmoji: '🔥',
  description: 'Complete a streak.',
  xpReward: 100,
  ruleKind: 'streak_days',
  ruleParams: '7',
  active: true,
  createdAt: '2023-01-01T00:00:00Z',
  updatedAt: '2023-01-01T00:00:00Z',
};

function renderPage() {
  return render(
    <DictProvider value={dictEn}>
      <AdminBadgesPage />
    </DictProvider>,
  );
}

describe('AdminBadgesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAdmin = true;
    list.mockResolvedValue([sampleBadge]);
    create.mockResolvedValue(sampleBadge);
    update.mockResolvedValue(sampleBadge);
  });

  it('renders and lists badges for an authorized role', async () => {
    renderPage();
    expect(await screen.findByText('Perfect Streak')).toBeInTheDocument();
    expect(screen.getByText('perfect-streak')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('submits a create request with the expected payload', async () => {
    renderPage();
    await screen.findByText('Perfect Streak');

    fireEvent.click(screen.getByRole('button', { name: dictEn.admin.badges.newButton }));

    fireEvent.change(screen.getByLabelText(dictEn.admin.badges.fields.name), { target: { value: 'New Badge' } });
    fireEvent.change(screen.getByLabelText(dictEn.admin.badges.fields.slug), { target: { value: 'new-badge' } });
    fireEvent.change(screen.getByLabelText(dictEn.admin.badges.fields.iconEmoji), { target: { value: '⭐' } });
    fireEvent.change(screen.getByLabelText(dictEn.admin.badges.fields.ruleKind), { target: { value: 'topics_done' } });
    fireEvent.change(screen.getByLabelText(dictEn.admin.badges.fields.xpReward), { target: { value: '50' } });

    fireEvent.click(screen.getByRole('button', { name: dictEn.admin.badges.saveButton }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({
      slug: 'new-badge',
      name: 'New Badge',
      iconEmoji: '⭐',
      ruleKind: 'topics_done',
      description: undefined,
      ruleParams: undefined,
      xpReward: 50,
    });
  });

  it('disables xpReward for non-admin authors', async () => {
    isAdmin = false;
    renderPage();
    await screen.findByText('Perfect Streak');
    fireEvent.click(screen.getByRole('button', { name: dictEn.admin.badges.newButton }));
    expect(screen.getByLabelText(dictEn.admin.badges.fields.xpReward)).toBeDisabled();
  });
});
