import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthApiError } from '@web/lib/auth-api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();
const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

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

const { mockRegister, mockActivate } = vi.hoisted(() => ({
  mockRegister: vi.fn(),
  mockActivate: vi.fn(),
}));
vi.mock('@web/lib/auth-api', async () => {
  const actual = await vi.importActual<typeof import('@web/lib/auth-api')>('@web/lib/auth-api');
  return {
    ...actual,
    authApi: {
      register: mockRegister,
      activate: mockActivate,
      login: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn(),
    },
  };
});

import LoginPage from '@web/app/(auth)/login/page';

const PENDING_KEY = 'aq_pending_activation_email';

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
  mockSearchParams = new URLSearchParams();
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
// Login form (existing behavior)
// ---------------------------------------------------------------------------

describe('LoginPage — login flow', () => {
  it('renders email and password fields', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/e-mail/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^senha$/i)).toBeInTheDocument();
  });

  it('renders the submit button', () => {
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

  it('calls login with the correct credentials and redirects on success', async () => {
    mockLogin.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/e-mail/i), 'alice@example.com');
    await user.type(screen.getByLabelText(/^senha$/i), 'secret');
    await user.click(screen.getByRole('button', { name: /entrar na arena/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('alice@example.com', 'secret');
      expect(mockReplace).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('shows the generic invalid-credentials message when there is no activation hint', async () => {
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

  it('shows the activation reminder copy when the localStorage hint matches the email', async () => {
    window.localStorage.setItem(PENDING_KEY, 'pending@example.com');
    mockLogin.mockRejectedValue(new Error('InvalidCredentials'));
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/e-mail/i), 'pending@example.com');
    await user.type(screen.getByLabelText(/^senha$/i), 'whatever');
    await user.click(screen.getByRole('button', { name: /entrar na arena/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Confira seu e-mail para ativar sua conta antes de entrar.',
      );
    });
  });

  it('clears the activation hint after a successful login', async () => {
    window.localStorage.setItem(PENDING_KEY, 'alice@example.com');
    mockLogin.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/e-mail/i), 'alice@example.com');
    await user.type(screen.getByLabelText(/^senha$/i), 'secret');
    await user.click(screen.getByRole('button', { name: /entrar na arena/i }));

    await waitFor(() => {
      expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Register form
// ---------------------------------------------------------------------------

async function submitRegisterStep1(user: ReturnType<typeof userEvent.setup>, opts: {
  firstName: string;
  email: string;
  password: string;
}) {
  // The tab and the LoginForm's "Criar conta grátis" link both match — pick
  // the first (the tab) to switch into the register flow.
  const tabs = screen.getAllByRole('button', { name: /^criar conta$/i });
  await user.click(tabs[0]);
  // Wait until step 1 form is present (Nome label appears in registration only)
  await waitFor(() => screen.getByText(/Suas informações/i));

  const inputs = screen.getAllByRole('textbox');
  // First textbox is Nome, second Sobrenome, third E-mail, fourth Telefone
  await user.type(inputs[0], opts.firstName);
  await user.type(inputs[2], opts.email);

  // Password fields are not textboxes — query by placeholder.
  const pwInput = screen.getByPlaceholderText(/Mínimo 8 caracteres/i) as HTMLInputElement;
  const pwConfirmInput = screen.getByPlaceholderText(/Repita a senha/i) as HTMLInputElement;
  await user.type(pwInput, opts.password);
  await user.type(pwConfirmInput, opts.password);

  await user.click(screen.getByRole('button', { name: /Continuar/i }));
}

async function submitRegisterStep2(user: ReturnType<typeof userEvent.setup>) {
  // Check the terms label (clicking the label toggles the controlled checkbox)
  await waitFor(() => screen.getByText(/Concordo com os/i));
  await user.click(screen.getByText(/Concordo com os/i));
  // The tab and the form's submit both say "Criar conta" — pick the one
  // that lives inside a <form> element.
  const buttons = screen.getAllByRole('button', { name: /^Criar conta$/i });
  const submit = buttons.find((b) => b.closest('form') !== null);
  await user.click(submit!);
}

describe('LoginPage — register flow', () => {
  it('happy path: submits to register() and shows the "Confira seu e-mail" pending state', async () => {
    mockRegister.mockResolvedValue({ status: 'pending_activation' });
    const user = userEvent.setup();
    render(<LoginPage />);

    await submitRegisterStep1(user, {
      firstName: 'Joana',
      email: 'joana@example.com',
      password: 'hunter22a',
    });
    await submitRegisterStep2(user);

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith({
        name: 'Joana',
        email: 'joana@example.com',
        password: 'hunter22a',
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Confira seu e-mail/i)).toBeInTheDocument();
      expect(screen.getByText(/joana@example\.com/i)).toBeInTheDocument();
    });

    // Critically: there must be NO auto-redirect to the dashboard.
    expect(mockReplace).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(PENDING_KEY)).toBe('joana@example.com');
  });

  it('validation error: shows inline field copy and re-enables submit', async () => {
    mockRegister.mockRejectedValue(
      new AuthApiError('ValidationFailed', 400, 'invalid', [
        { field: 'password', code: 'TooShort' },
      ]),
    );
    const user = userEvent.setup();
    render(<LoginPage />);

    await submitRegisterStep1(user, {
      firstName: 'Joana',
      email: 'joana@example.com',
      password: 'hunter22a',
    });
    await submitRegisterStep2(user);

    // Form returns to step 1 to surface the field-level error.
    await waitFor(() => {
      expect(screen.getByText('Mínimo 8 caracteres')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Continuar/i })).not.toBeDisabled();
  });

  it('rate-limited: shows the rate-limit copy near the terms checkbox', async () => {
    mockRegister.mockRejectedValue(new AuthApiError('RateLimited', 429, 'limit'));
    const user = userEvent.setup();
    render(<LoginPage />);

    await submitRegisterStep1(user, {
      firstName: 'Joana',
      email: 'joana@example.com',
      password: 'hunter22a',
    });
    await submitRegisterStep2(user);

    await waitFor(() => {
      expect(screen.getByText(/Muitas tentativas/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Activated banner
// ---------------------------------------------------------------------------

describe('LoginPage — activated banner', () => {
  it('renders when ?activated=1 is present and dismisses on submit', async () => {
    mockSearchParams = new URLSearchParams({ activated: '1' });
    mockLogin.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Conta ativada!');
    });

    await user.type(screen.getByLabelText(/e-mail/i), 'alice@example.com');
    await user.type(screen.getByLabelText(/^senha$/i), 'secret');
    await user.click(screen.getByRole('button', { name: /entrar na arena/i }));

    // After submit, the page navigates to /dashboard — banner is gone with the unmount.
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('does not render when the query is absent', () => {
    render(<LoginPage />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
