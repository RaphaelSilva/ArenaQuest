import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';
import { dictEn } from '@web/i18n/dict-en';
import type { LevelDefinition } from '@web/lib/admin-gamification-api';

const list = vi.fn();
const replaceAll = vi.fn();

let isAdmin = true;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
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
    levels: {
      list: (...a: unknown[]) => list(...a),
      replaceAll: (...a: unknown[]) => replaceAll(...a),
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

import AdminLevelsPage from '../page';

const curve: LevelDefinition[] = [
  { level: 1, rankTitle: 'Bronze', minXp: 0, maxXp: 100 },
  { level: 2, rankTitle: 'Silver', minXp: 100, maxXp: null },
];

function renderPage() {
  return render(
    <DictProvider value={dictEn}>
      <AdminLevelsPage />
    </DictProvider>,
  );
}

describe('AdminLevelsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAdmin = true;
    list.mockResolvedValue(curve);
    replaceAll.mockResolvedValue(curve);
  });

  it('renders the editable curve grid for an admin', async () => {
    renderPage();
    expect(await screen.findByDisplayValue('Bronze')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Silver')).toBeInTheDocument();
  });

  it('enables Save on a valid curve and issues replaceAll with the rows', async () => {
    renderPage();
    await screen.findByDisplayValue('Bronze');

    const saveButton = screen.getByRole('button', { name: dictEn.admin.levels.saveButton });
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(saveButton);

    await waitFor(() => expect(replaceAll).toHaveBeenCalledTimes(1));
    expect(replaceAll).toHaveBeenCalledWith([
      { level: 1, rankTitle: 'Bronze', minXp: 0, maxXp: 100 },
      { level: 2, rankTitle: 'Silver', minXp: 100, maxXp: null },
    ]);
  });

  it('blocks Save on an invalid (gapped) curve', async () => {
    renderPage();
    await screen.findByDisplayValue('Bronze');

    // Break the gap invariant: level 1 maxXp no longer equals level 2 minXp.
    const maxXpInput = screen.getByLabelText(`${dictEn.admin.levels.columns.maxXp} 1`);
    fireEvent.change(maxXpInput, { target: { value: '50' } });
    expect(maxXpInput).toHaveValue(50);

    const saveButton = screen.getByRole('button', { name: dictEn.admin.levels.saveButton });
    expect(saveButton).toBeDisabled();
    expect(await screen.findByText(dictEn.admin.levels.validation.maxXpGap)).toBeInTheDocument();
    expect(replaceAll).not.toHaveBeenCalled();
  });

  it('denies a non-admin user', async () => {
    isAdmin = false;
    renderPage();
    expect(await screen.findByText(dictEn.admin.levels.accessDenied)).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });
});
