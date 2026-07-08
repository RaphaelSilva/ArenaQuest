import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import type { Badge, PlayerProgression } from '@web/lib/admin-gamification-api';

const replace = vi.fn();

const usersList = vi.fn();
const badgesList = vi.fn();
const progressionGet = vi.fn();
const awardBadge = vi.fn();
const revokeBadge = vi.fn();
const adjustXp = vi.fn();
const recomputeXp = vi.fn();

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
      adminUsers: {
        list: (...a: unknown[]) => usersList(...a),
      },
      adminGamification: {
        badges: { list: (...a: unknown[]) => badgesList(...a) },
        progression: {
          get: (...a: unknown[]) => progressionGet(...a),
          awardBadge: (...a: unknown[]) => awardBadge(...a),
          revokeBadge: (...a: unknown[]) => revokeBadge(...a),
          adjustXp: (...a: unknown[]) => adjustXp(...a),
          recomputeXp: (...a: unknown[]) => recomputeXp(...a),
        },
      },
    }),
  };
});

import AdminPlayersPage from '../page';

const sampleUser = {
  id: 'u1',
  name: 'Alice Doe',
  email: 'alice@example.com',
  status: 'active',
  roles: [],
  groups: [],
  createdAt: new Date('2023-01-01T00:00:00Z'),
  timezone: 'UTC',
};

const sampleBadge: Badge = {
  id: 'b1',
  slug: 'streak',
  name: 'Streak Master',
  iconEmoji: '🔥',
  description: null,
  xpReward: 100,
  ruleKind: 'streak_days',
  ruleParams: null,
  active: true,
  createdAt: '2023-01-01T00:00:00Z',
  updatedAt: '2023-01-01T00:00:00Z',
};

const sampleProgression: PlayerProgression = {
  userId: 'u1',
  xp: { totalXp: 250, level: 3, rankTitle: 'Adept' },
  badges: [{ badgeId: 'b1', slug: 'streak', name: 'Streak Master', earnedAt: '2023-02-01T00:00:00Z' }],
  recentXpEvents: [{ id: 'e1', sourceKind: 'task_complete', points: 50, earnedAt: '2023-02-02T00:00:00Z' }],
};

function renderPage() {
  return render(
    <DictProvider value={dictEn}>
      <AdminPlayersPage />
    </DictProvider>,
  );
}

describe('AdminPlayersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAdmin = true;
    usersList.mockResolvedValue({ data: [sampleUser], total: 1 });
    badgesList.mockResolvedValue([sampleBadge]);
    progressionGet.mockResolvedValue(sampleProgression);
    awardBadge.mockResolvedValue(undefined);
    revokeBadge.mockResolvedValue(undefined);
    adjustXp.mockResolvedValue({ previousTotal: 250, newTotal: 200 });
    recomputeXp.mockResolvedValue({ previousTotal: 250, newTotal: 250 });
  });

  it('renders the search and lists users', async () => {
    renderPage();
    expect(await screen.findByText('Alice Doe')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('selecting a user renders the progression panel', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: dictEn.admin.players.search.selectAriaLabel('Alice Doe') }));
    await waitFor(() => expect(progressionGet).toHaveBeenCalledWith('u1'));
    expect(await screen.findByText('250')).toBeInTheDocument();
    expect(screen.getByText('Adept')).toBeInTheDocument();
    expect(screen.getByText('Streak Master')).toBeInTheDocument();
  });

  it('revoke triggers confirmation then calls revokeBadge with the right ids', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: dictEn.admin.players.search.selectAriaLabel('Alice Doe') }));
    await screen.findByText('250');

    fireEvent.click(screen.getByRole('button', { name: dictEn.admin.players.badges.revokeAriaLabel('Streak Master') }));
    // Confirmation appears
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: dictEn.admin.players.confirm.confirmButton }));

    await waitFor(() => expect(revokeBadge).toHaveBeenCalledWith('u1', 'b1'));
  });

  it('blocks an XP adjustment with empty reason and submits a valid one', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: dictEn.admin.players.search.selectAriaLabel('Alice Doe') }));
    await screen.findByText('250');

    const pointsInput = screen.getByLabelText(dictEn.admin.players.adjust.pointsLabel);

    // Empty reason → blocked
    fireEvent.change(pointsInput, { target: { value: '-50' } });
    fireEvent.click(screen.getByRole('button', { name: dictEn.admin.players.adjust.submitButton }));
    expect(await screen.findByText(dictEn.admin.players.adjust.reasonRequired)).toBeInTheDocument();
    expect(adjustXp).not.toHaveBeenCalled();

    // Valid → confirm → calls adjustXp
    fireEvent.change(screen.getByPlaceholderText(dictEn.admin.players.adjust.reasonPlaceholder), {
      target: { value: 'manual correction' },
    });
    fireEvent.click(screen.getByRole('button', { name: dictEn.admin.players.adjust.submitButton }));
    fireEvent.click(await screen.findByRole('button', { name: dictEn.admin.players.confirm.confirmButton }));

    await waitFor(() =>
      expect(adjustXp).toHaveBeenCalledWith('u1', { points: -50, reason: 'manual correction' }),
    );
  });

  it('redirects non-admins to the dashboard', async () => {
    isAdmin = false;
    renderPage();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
  });
});
