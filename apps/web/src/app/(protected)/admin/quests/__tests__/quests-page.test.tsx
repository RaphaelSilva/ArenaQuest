import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import type { Quest } from '@web/lib/admin-gamification-api';

const replace = vi.fn();
const list = vi.fn();
const create = vi.fn();
const update = vi.fn();
const remove = vi.fn();

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

const stableClient = {
  adminGamification: {
    quests: {
      list: (...a: unknown[]) => list(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
      delete: (...a: unknown[]) => remove(...a),
    },
  },
};

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return {
    ...actual,
    useApiClient: () => stableClient,
  };
});

import AdminQuestsPage from '../page';

const dailyQuest: Quest = {
  id: 'q1',
  kind: 'daily',
  title: 'Daily Login',
  description: 'Log in today.',
  predicateKind: 'logins',
  predicateParams: '1',
  xpReward: 10,
  active: true,
  createdAt: '2023-01-01T00:00:00Z',
  updatedAt: '2023-01-01T00:00:00Z',
};

const weeklyQuest: Quest = {
  id: 'q2',
  kind: 'weekly',
  title: 'Weekly Grind',
  description: 'Complete 5 topics.',
  predicateKind: 'topics_completed',
  predicateParams: '5',
  xpReward: 100,
  active: true,
  createdAt: '2023-01-01T00:00:00Z',
  updatedAt: '2023-01-01T00:00:00Z',
};

function renderPage() {
  return render(
    <DictProvider value={dictEn}>
      <AdminQuestsPage />
    </DictProvider>,
  );
}

describe('AdminQuestsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAdmin = true;
    list.mockResolvedValue([dailyQuest, weeklyQuest]);
    create.mockResolvedValue(dailyQuest);
    update.mockResolvedValue(dailyQuest);
    remove.mockResolvedValue(undefined);
  });

  it('renders quests grouped by kind', async () => {
    renderPage();
    expect(await screen.findByText('Daily Login')).toBeInTheDocument();
    expect(screen.getByText('Weekly Grind')).toBeInTheDocument();
    expect(screen.getByText(dictEn.admin.quests.dailyHeading)).toBeInTheDocument();
    expect(screen.getByText(dictEn.admin.quests.weeklyHeading)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('submits a create request with the expected payload', async () => {
    renderPage();
    await screen.findByText('Daily Login');

    fireEvent.click(screen.getByRole('button', { name: dictEn.admin.quests.newButton }));

    fireEvent.change(screen.getByLabelText(dictEn.admin.quests.fields.kind), { target: { value: 'weekly' } });
    fireEvent.change(screen.getByLabelText(dictEn.admin.quests.fields.title), { target: { value: 'New Quest' } });
    fireEvent.change(screen.getByLabelText(dictEn.admin.quests.fields.predicateKind), { target: { value: 'logins' } });
    fireEvent.change(screen.getByLabelText(dictEn.admin.quests.fields.xpReward), { target: { value: '42' } });
    fireEvent.change(screen.getByLabelText(dictEn.admin.quests.fields.description), { target: { value: 'Do it' } });
    fireEvent.change(screen.getByLabelText(dictEn.admin.quests.fields.predicateParams), { target: { value: '3' } });

    fireEvent.click(screen.getByRole('button', { name: dictEn.admin.quests.saveButton }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({
      kind: 'weekly',
      title: 'New Quest',
      description: 'Do it',
      predicateKind: 'logins',
      predicateParams: '3',
      xpReward: 42,
      active: true,
    });
  });

  it('disables xpReward for non-admin authors', async () => {
    isAdmin = false;
    renderPage();
    await screen.findByText('Daily Login');
    fireEvent.click(screen.getByRole('button', { name: dictEn.admin.quests.newButton }));
    expect(screen.getByLabelText(dictEn.admin.quests.fields.xpReward)).toBeDisabled();
  });
});
