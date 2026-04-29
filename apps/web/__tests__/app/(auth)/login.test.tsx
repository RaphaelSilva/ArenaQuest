import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

// ---------------------------------------------------------------------------
// Mock useAuth hook
// ---------------------------------------------------------------------------

const mockLogin = vi.fn();
vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => ({
    login: mockLogin,
    isLoading: false,
    user: null,
    accessToken: null,
    logout: vi.fn(),
  }),
}));

import LoginPage from '@web/app/(auth)/login/page';

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
});

describe('LoginPage', () => {
  it('renders email and password fields', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/e-mail/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^senha$/i)).toBeInTheDocument();
  });

  it('renders a submit button', () => {
    render(<LoginPage />);
    expect(screen.getByRole('button', { name: /entrar na arena/i })).toBeInTheDocument();
  });

  it('shows a validation error when fields are empty', async () => {
    render(<LoginPage />);
    fireEvent.submit(screen.getByRole('button', { name: /entrar na arena/i }).closest('form')!);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Informe seu e-mail.');
    });
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('calls login with the correct credentials on submit', async () => {
    mockLogin.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/e-mail/i), 'alice@example.com');
    await user.type(screen.getByLabelText(/^senha$/i), 'secret');
    await user.click(screen.getByRole('button', { name: /entrar na arena/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('alice@example.com', 'secret');
    });
  });

  it('redirects to /dashboard after successful login', async () => {
    mockLogin.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/e-mail/i), 'alice@example.com');
    await user.type(screen.getByLabelText(/^senha$/i), 'secret');
    await user.click(screen.getByRole('button', { name: /entrar na arena/i }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('displays an error message when login fails', async () => {
    mockLogin.mockRejectedValue(new Error('InvalidCredentials'));
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/e-mail/i), 'bad@example.com');
    await user.type(screen.getByLabelText(/^senha$/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /entrar na arena/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('E-mail ou senha inválidos.');
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
