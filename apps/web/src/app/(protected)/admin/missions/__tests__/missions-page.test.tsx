import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import type { Badge, Mission } from '@web/lib/admin-gamification-api';

const replace = vi.fn();
const missionsList = vi.fn();
const badgesList = vi.fn();
const create = vi.fn();
const update = vi.fn();
const remove = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => ({ isLoading: false }),
  useHasRole: () => true,
}));

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return {
    ...actual,
    useApiClient: () => ({
      adminGamification: {
        missions: {
          list: (...a: unknown[]) => missionsList(...a),
          create: (...a: unknown[]) => create(...a),
          update: (...a: unknown[]) => update(...a),
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

const sampleMission: Mission = {
  id: 'm1',
  title: 'Weekly Sprint',
  description: 'Complete 3 topics.',
  startAt: '2023-01-01T12:00:00Z',
  endAt: '2023-01-08T12:00:00Z',
  predicateKind: 'topics_completed',
  predicateParams: '3',
  xpReward: 500,
  badgeId: 'badge-1',
  active: true,
  createdAt: '2023-01-01T12:00:00Z',
  updatedAt: '2023-01-01T12:00:00Z',
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
    missionsList.mockResolvedValue([sampleMission]);
    badgesList.mockResolvedValue([sampleBadge]);
    create.mockResolvedValue(sampleMission);
    update.mockResolvedValue(sampleMission);
    remove.mockResolvedValue(undefined);
  });

  it('renders and lists missions with window and badge', async () => {
    renderPage();
    expect(await screen.findByText('Weekly Sprint')).toBeInTheDocument();
    expect(screen.getByText('Streak Master')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('submits a create request with the expected payload', async () => {
    renderPage();
    await screen.findByText('Weekly Sprint');

    fireEvent.click(screen.getByRole('button', { name: dictEn.admin.missions.newButton }));

    fireEvent.change(screen.getByLabelText(dictEn.admin.missions.fields.title), { target: { value: 'New Mission' } });
    fireEvent.change(screen.getByLabelText(dictEn.admin.missions.fields.predicateKind), { target: { value: 'logins' } });
    fireEvent.change(screen.getByLabelText(dictEn.admin.missions.fields.startAt), { target: { value: '2024-02-01T00:00' } });
    fireEvent.change(screen.getByLabelText(dictEn.admin.missions.fields.endAt), { target: { value: '2024-02-08T00:00' } });
    fireEvent.change(screen.getByLabelText(dictEn.admin.missions.fields.xpReward), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText(dictEn.admin.missions.fields.description), { target: { value: 'Do it' } });
    fireEvent.change(screen.getByLabelText(dictEn.admin.missions.fields.predicateParams), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(dictEn.admin.missions.fields.badge), { target: { value: 'badge-1' } });

    fireEvent.click(screen.getByRole('button', { name: dictEn.admin.missions.saveButton }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const payload = create.mock.calls[0][0];
    expect(payload).toMatchObject({
      title: 'New Mission',
      description: 'Do it',
      predicateKind: 'logins',
      predicateParams: '5',
      xpReward: 300,
      badgeId: 'badge-1',
      active: true,
    });
    expect(payload.startAt).toBe(new Date('2024-02-01T00:00').toISOString());
    expect(payload.endAt).toBe(new Date('2024-02-08T00:00').toISOString());
  });

  it('deletes a mission after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await screen.findByText('Weekly Sprint');
    fireEvent.click(screen.getByRole('button', { name: dictEn.admin.missions.deleteButton }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('m1'));
  });
});
