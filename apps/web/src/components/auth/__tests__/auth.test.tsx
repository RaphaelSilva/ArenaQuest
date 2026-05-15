import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before the component imports
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => ({
    isLoading: false,
    login: vi.fn().mockRejectedValue(new Error('invalid')),
  }),
}));

const { mockRegister } = vi.hoisted(() => ({ mockRegister: vi.fn() }));
vi.mock('@web/lib/auth-api', async () => {
  const actual = await vi.importActual<typeof import('@web/lib/auth-api')>('@web/lib/auth-api');
  return {
    ...actual,
    authApi: {
      register: mockRegister,
      login: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn(),
    },
  };
});

import { PasswordStrength } from '../password-strength';
import LoginPage from '@web/app/(auth)/login/page';

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
});

describe('PasswordStrength', () => {
  it('renders nothing when password is empty', () => {
    const { container } = render(<PasswordStrength password="" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows "Fraca" for a 1-criteria password', () => {
    render(<PasswordStrength password="abcdefgh" />);
    expect(screen.getByText(/Fraca/)).toBeInTheDocument();
  });

  it('shows "Forte" for a password meeting all 4 criteria', () => {
    render(<PasswordStrength password="Abcdef1!" />);
    expect(screen.getByText(/Forte/)).toBeInTheDocument();
  });
});

describe('Register step navigation', () => {
  it('advances from step 1 to step 2 when required fields are valid', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    // Click the "Criar conta" tab (exact match avoids "Criar conta grátis" button)
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    await user.type(screen.getByPlaceholderText('João'), 'Maria');
    await user.type(screen.getByPlaceholderText('seu@email.com'), 'maria@example.com');

    const passwordInputs = screen.getAllByPlaceholderText(/Mínimo 8 caracteres|Repita a senha/);
    await user.type(passwordInputs[0], 'Abcdef1!');
    await user.type(passwordInputs[1], 'Abcdef1!');

    await user.click(screen.getByRole('button', { name: /Continuar/i }));

    expect(screen.getAllByText('Tipo de conta').length).toBeGreaterThan(0);
    expect(screen.getByText(/Como você vai usar/i)).toBeInTheDocument();
  });

  it('stays on step 1 when required fields are empty', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByRole('button', { name: 'Criar conta' }));
    await user.click(screen.getByRole('button', { name: /Continuar/i }));

    expect(screen.getAllByText('Campo obrigatório').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Como você vai usar/i)).not.toBeInTheDocument();
  });

  it('goes back to step 1 when ← Voltar is clicked', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByRole('button', { name: 'Criar conta' }));
    await user.type(screen.getByPlaceholderText('João'), 'Maria');
    await user.type(screen.getByPlaceholderText('seu@email.com'), 'maria@example.com');
    const passwordInputs = screen.getAllByPlaceholderText(/Mínimo 8 caracteres|Repita a senha/);
    await user.type(passwordInputs[0], 'Abcdef1!');
    await user.type(passwordInputs[1], 'Abcdef1!');
    await user.click(screen.getByRole('button', { name: /Continuar/i }));

    await user.click(screen.getByRole('button', { name: /Voltar/i }));

    expect(screen.getByText(/Criar sua conta/i)).toBeInTheDocument();
  });
});
