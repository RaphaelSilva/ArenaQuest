import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import type { Badge, MissionListItem } from '@web/lib/admin-gamification-api';

const d = dictEn.admin.missions;

const replace = vi.fn();
const push = vi.fn();
const missionsList = vi.fn();
const badgesList = vi.fn();
const remove = vi.fn();
let role = 'admin';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
}));

vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => ({ isLoading: false }),
  useHasRole: (...roles: string[]) => roles.includes(role),
}));

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return {
    ...actual,
    useApiClient: () => ({
      adminGamification: {
        missions: {
          list: (...a: unknown[]) => missionsList(...a),
          delete: (...a: unknown[]) => remove(...a),
        },
        badges: {
          list: (...a: unknown[]) => badgesList(...a),
        },
      },
    }),
  };
});

import AdminMissionsPage from '../page';

const sampleBadge: Badge = {
  id: 'badge-1',
  slug: 'streak',
  name: 'Streak Master',
  iconEmoji: '🔥',
  description: null,
  xpReward: 10,
  ruleKind: 'streak',
  ruleParams: null,
  active: true,
  createdAt: '2023-01-01T00:00:00Z',
  updatedAt: '2023-01-01T00:00:00Z',
};

const sampleMission: MissionListItem = {
  id: 'm1',
  title: 'Weekly Sprint',
  description: 'Two demonstrations and a self-check.',
  startAt: '2023-01-01T12:00:00.000Z',
  endAt: '2023-01-08T12:00:00.000Z',
  mode: 'sequential',
  enrollmentMode: 'open',
  xpReward: 500,
  badgeId: 'badge-1',
  active: true,
  createdAt: '2023-01-01T12:00:00Z',
  updatedAt: '2023-01-01T12:00:00Z',
  requirementCount: 3,
  enrolledCount: 12,
  completedCount: 4,
};

function renderPage() {
  return render(
    <DictProvider value={dictEn}>
      <AdminMissionsPage />
    </DictProvider>,
  );
}

describe('AdminMissionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    role = 'admin';
    missionsList.mockResolvedValue([sampleMission]);
    badgesList.mockResolvedValue([sampleBadge]);
    remove.mockResolvedValue(undefined);
  });

  it('lists missions with window, mode, enrollment, steps, participants and badge', async () => {
    renderPage();
    const row = (await screen.findByText('Weekly Sprint')).closest('tr')!;
    expect(screen.getByRole('columnheader', { name: d.columns.mode })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: d.columns.enrollment })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: d.columns.steps })).toBeInTheDocument();
    expect(within(row).getByText(d.modeOptions.sequential)).toBeInTheDocument();
    expect(within(row).getByText(d.enrollmentOptions.open)).toBeInTheDocument();
    expect(within(row).getByText('3')).toBeInTheDocument();
    expect(within(row).getByText(d.enrolledCompleted(12, 4))).toBeInTheDocument();
    expect(within(row).getByText('Streak Master')).toBeInTheDocument();
    expect(within(row).getByText(d.windowRange('2023-01-01 12:00', '2023-01-08 12:00'))).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows a legacy mission (no steps) as legacy', async () => {
    missionsList.mockResolvedValue([{ ...sampleMission, requirementCount: 0 }]);
    renderPage();
    const row = (await screen.findByText('Weekly Sprint')).closest('tr')!;
    expect(within(row).getByText(d.legacyLabel)).toBeInTheDocument();
  });

  it('sends an admin to the editor for a new mission and for a row', async () => {
    renderPage();
    await screen.findByText('Weekly Sprint');
    fireEvent.click(screen.getByRole('button', { name: d.newButton }));
    expect(push).toHaveBeenCalledWith('/admin/missions/new');
    fireEvent.click(screen.getByRole('button', { name: d.editButton }));
    expect(push).toHaveBeenCalledWith('/admin/missions/m1');
  });

  it('deletes a mission after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await screen.findByText('Weekly Sprint');
    fireEvent.click(screen.getByRole('button', { name: d.deleteButton }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('m1'));
  });

  it('renders read-only for a content creator: no create, edit or delete', async () => {
    role = 'content_creator';
    renderPage();
    await screen.findByText('Weekly Sprint');
    expect(screen.queryByRole('button', { name: d.newButton })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: d.deleteButton })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: d.editButton })).not.toBeInTheDocument();
    expect(screen.getByText(d.readOnlyNotice)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: d.viewButton }));
    expect(push).toHaveBeenCalledWith('/admin/missions/m1');
  });

  it('redirects a user without staff role to the dashboard', async () => {
    role = 'student';
    renderPage();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    expect(missionsList).not.toHaveBeenCalled();
  });
});
