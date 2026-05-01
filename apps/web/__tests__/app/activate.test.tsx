import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthApiError } from '@web/lib/auth-api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => mockSearchParams,
}));

const { mockActivate } = vi.hoisted(() => ({ mockActivate: vi.fn() }));
vi.mock('@web/lib/auth-api', async () => {
  const actual = await vi.importActual<typeof import('@web/lib/auth-api')>('@web/lib/auth-api');
  return {
    ...actual,
    authApi: {
      activate: mockActivate,
      register: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn(),
    },
  };
});

import ActivatePage from '@web/app/activate/page';

beforeEach(() => {
  vi.resetAllMocks();
  mockSearchParams = new URLSearchParams();
});

describe('ActivatePage', () => {
  it('no token in query → renders error state with "Voltar ao login"', async () => {
    render(<ActivatePage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Link inválido/i })).toBeInTheDocument();
    });

    expect(mockActivate).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Voltar ao login/i }));
    expect(mockPush).toHaveBeenCalledWith('/login');
  });

  it('valid token → calls activate, shows success, button routes to /login?activated=1', async () => {
    mockSearchParams = new URLSearchParams({ token: 'good-token' });
    mockActivate.mockResolvedValue({ status: 'activated' });

    render(<ActivatePage />);

    await waitFor(() => {
      expect(mockActivate).toHaveBeenCalledWith({ token: 'good-token' });
      expect(screen.getByText(/Conta ativada!/i)).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Ir para login/i }));
    expect(mockPush).toHaveBeenCalledWith('/login?activated=1');
  });

  it('replay (already_active) → success state with the same copy (idempotent)', async () => {
    mockSearchParams = new URLSearchParams({ token: 'old-token' });
    mockActivate.mockResolvedValue({ status: 'already_active' });

    render(<ActivatePage />);

    await waitFor(() => {
      expect(screen.getByText(/Conta ativada!/i)).toBeInTheDocument();
    });
  });

  it('invalid token → error state with the "Link inválido" copy', async () => {
    mockSearchParams = new URLSearchParams({ token: 'bad-token' });
    mockActivate.mockRejectedValue(new AuthApiError('InvalidToken', 400, 'invalid'));

    render(<ActivatePage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Link inválido/i })).toBeInTheDocument();
    });
    // No "Tentar novamente" — that's only for network errors.
    expect(screen.queryByRole('button', { name: /Tentar novamente/i })).toBeNull();
  });

  it('network error → error state with a "Tentar novamente" button that retries', async () => {
    mockSearchParams = new URLSearchParams({ token: 'good-token' });
    mockActivate
      .mockRejectedValueOnce(new AuthApiError('NetworkError', 0, 'offline'))
      .mockResolvedValueOnce({ status: 'activated' });

    render(<ActivatePage />);

    await waitFor(() => {
      expect(screen.getByText(/Não foi possível ativar/i)).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Tentar novamente/i }));

    await waitFor(() => {
      expect(mockActivate).toHaveBeenCalledTimes(2);
      expect(screen.getByText(/Conta ativada!/i)).toBeInTheDocument();
    });
  });
});
