import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dictPt } from '@web/i18n';

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

const d = dictPt.auth;

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
});

describe('PasswordStrength', () => {
  it('renders nothing when password is empty', () => {
    const { container } = render(<PasswordStrength password="" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows password strength levels', () => {
    const { rerender } = render(<PasswordStrength password="abcdefgh" />);
    expect(screen.getByText(d.passwordStrength.weak)).toBeInTheDocument();

    rerender(<PasswordStrength password="Abcdef1!" />);
    expect(screen.getByText(d.passwordStrength.strong)).toBeInTheDocument();
  });
});

describe('Register step navigation', () => {
  it('advances from step 1 to step 2 when required fields are valid', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByRole('button', { name: d.tabs.register }));

    await user.type(screen.getByPlaceholderText(d.register.firstNamePlaceholder), 'Maria');
    await user.type(screen.getByPlaceholderText(d.login.emailPlaceholder), 'maria@example.com');

    const passwordInputs = screen.getAllByPlaceholderText(new RegExp(`${d.register.passwordPlaceholder}|${d.register.confirmPasswordPlaceholder}`));
    await user.type(passwordInputs[0], 'Abcdef1!');
    await user.type(passwordInputs[1], 'Abcdef1!');

    await user.click(screen.getByRole('button', { name: d.register.continueButton }));

    expect(screen.getAllByText(d.register.accountTypeTitle).length).toBeGreaterThan(0);
    expect(screen.getByText(d.register.accountTypeSubtitle)).toBeInTheDocument();
  });

  it('stays on step 1 when required fields are empty', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByRole('button', { name: d.tabs.register }));
    await user.click(screen.getByRole('button', { name: d.register.continueButton }));

    expect(screen.getAllByText(d.register.errorRequired).length).toBeGreaterThan(0);
    expect(screen.queryByText(d.register.accountTypeSubtitle)).not.toBeInTheDocument();
  });

  it('goes back to step 1 when ← Voltar is clicked', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByRole('button', { name: d.tabs.register }));
    await user.type(screen.getByPlaceholderText(d.register.firstNamePlaceholder), 'Maria');
    await user.type(screen.getByPlaceholderText(d.login.emailPlaceholder), 'maria@example.com');
    const passwordInputs = screen.getAllByPlaceholderText(new RegExp(`${d.register.passwordPlaceholder}|${d.register.confirmPasswordPlaceholder}`));
    await user.type(passwordInputs[0], 'Abcdef1!');
    await user.type(passwordInputs[1], 'Abcdef1!');
    await user.click(screen.getByRole('button', { name: d.register.continueButton }));

    await user.click(screen.getByRole('button', { name: d.register.backButton }));

    expect(screen.getByText(d.register.title)).toBeInTheDocument();
  });
});
