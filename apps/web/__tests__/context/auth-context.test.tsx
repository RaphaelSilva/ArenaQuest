import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { AuthProvider } from '@web/context/auth-context';
import { useAuth, useCurrentUser, useHasRole } from '@web/hooks/use-auth';

// ---------------------------------------------------------------------------
// Mock authApi — no real HTTP in unit tests
// ---------------------------------------------------------------------------

vi.mock('@web/lib/auth-api', () => ({
  authApi: {
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  },
}));

// Import AFTER mock so we get the mocked version.
import { authApi } from '@web/lib/auth-api';

const mockAuthApi = vi.mocked(authApi);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_USER = {
  id: 'user-1',
  name: 'Alice',
  email: 'alice@example.com',
  roles: [{ id: 'role-1', name: 'student', description: 'Student', createdAt: new Date() }],
};

// A minimal base64url-encoded JWT payload for session-restore tests.
// Payload: { sub: 'user-1', email: 'alice@example.com', roles: ['student'], iat: 0, exp: 9999999999 }
const JWT_PAYLOAD_B64 = btoa(
  JSON.stringify({ sub: 'user-1', email: 'alice@example.com', roles: ['student'], iat: 0, exp: 9999999999 }),
).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const FAKE_TOKEN = `header.${JWT_PAYLOAD_B64}.sig`;

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderAuth() {
  return renderHook(() => useAuth(), { wrapper });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
  // Default: no active session
  mockAuthApi.refresh.mockResolvedValue(null);
});

// ── Initial loading state ────────────────────────────────────────────────────

describe('initial state', () => {
  it('starts with isLoading true and user null', () => {
    mockAuthApi.refresh.mockReturnValue(new Promise(() => {})); // pending forever

    const { result } = renderAuth();

    expect(result.current.isLoading).toBe(true);
    expect(result.current.user).toBeNull();
    expect(result.current.accessToken).toBeNull();
  });

  it('sets isLoading to false after refresh resolves', async () => {
    mockAuthApi.refresh.mockResolvedValue(null);

    const { result } = renderAuth();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });
});

// ── Session restore on mount ─────────────────────────────────────────────────

describe('session restore (authApi.refresh on mount)', () => {
  it('calls authApi.refresh exactly once on mount', async () => {
    mockAuthApi.refresh.mockResolvedValue(null);

    renderAuth();

    await waitFor(() => expect(mockAuthApi.refresh).toHaveBeenCalledTimes(1));
  });

  it('restores user from JWT claims when refresh succeeds', async () => {
    mockAuthApi.refresh.mockResolvedValue({ accessToken: FAKE_TOKEN });

    const { result } = renderAuth();

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user).not.toBeNull();
    expect(result.current.user?.id).toBe('user-1');
    expect(result.current.user?.email).toBe('alice@example.com');
    expect(result.current.accessToken).toBe(FAKE_TOKEN);
  });

  it('leaves user null when refresh returns null (no session)', async () => {
    mockAuthApi.refresh.mockResolvedValue(null);

    const { result } = renderAuth();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.accessToken).toBeNull();
  });
});

// ── login ────────────────────────────────────────────────────────────────────

describe('login', () => {
  it('sets user and accessToken after successful login', async () => {
    mockAuthApi.refresh.mockResolvedValue(null);
    mockAuthApi.login.mockResolvedValue({
      accessToken: 'access-token-abc',
      user: MOCK_USER,
    });

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.login('alice@example.com', 'password');
    });

    expect(result.current.user?.id).toBe('user-1');
    expect(result.current.user?.name).toBe('Alice');
    expect(result.current.user?.email).toBe('alice@example.com');
    expect(result.current.accessToken).toBe('access-token-abc');
  });

  it('leaves user null and re-throws when login returns 401', async () => {
    mockAuthApi.refresh.mockResolvedValue(null);
    mockAuthApi.login.mockRejectedValue(new Error('InvalidCredentials'));

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      act(async () => {
        await result.current.login('bad@example.com', 'wrong');
      }),
    ).rejects.toThrow('InvalidCredentials');

    expect(result.current.user).toBeNull();
    expect(result.current.accessToken).toBeNull();
  });

  it('calls authApi.login with the correct credentials', async () => {
    mockAuthApi.refresh.mockResolvedValue(null);
    mockAuthApi.login.mockResolvedValue({ accessToken: 'token', user: MOCK_USER });

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.login('alice@example.com', 'secret');
    });

    expect(mockAuthApi.login).toHaveBeenCalledWith('alice@example.com', 'secret');
  });
});

// ── logout ───────────────────────────────────────────────────────────────────

describe('logout', () => {
  it('clears user and accessToken after logout', async () => {
    mockAuthApi.refresh.mockResolvedValue(null);
    mockAuthApi.login.mockResolvedValue({ accessToken: 'token', user: MOCK_USER });
    mockAuthApi.logout.mockResolvedValue(undefined);

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Login first
    await act(async () => {
      await result.current.login('alice@example.com', 'password');
    });
    expect(result.current.user).not.toBeNull();

    // Then logout
    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.user).toBeNull();
    expect(result.current.accessToken).toBeNull();
  });

  it('calls authApi.logout once', async () => {
    mockAuthApi.refresh.mockResolvedValue(null);
    mockAuthApi.login.mockResolvedValue({ accessToken: 'token', user: MOCK_USER });
    mockAuthApi.logout.mockResolvedValue(undefined);

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => { await result.current.login('alice@example.com', 'pw'); });
    await act(async () => { await result.current.logout(); });

    expect(mockAuthApi.logout).toHaveBeenCalledTimes(1);
  });
});

// ── useCurrentUser ────────────────────────────────────────────────────────────

describe('useCurrentUser', () => {
  it('returns null when not logged in', async () => {
    mockAuthApi.refresh.mockResolvedValue(null);
    const { result } = renderHook(() => useCurrentUser(), { wrapper });
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('returns the user after login', async () => {
    mockAuthApi.refresh.mockResolvedValue(null);
    mockAuthApi.login.mockResolvedValue({ accessToken: 'token', user: MOCK_USER });

    const { result } = renderHook(() => ({
      auth: useAuth(),
      user: useCurrentUser(),
    }), { wrapper });

    await waitFor(() => expect(result.current.auth.isLoading).toBe(false));
    await act(async () => { await result.current.auth.login('alice@example.com', 'pw'); });

    expect(result.current.user?.email).toBe('alice@example.com');
  });
});

// ── useHasRole ────────────────────────────────────────────────────────────────

describe('useHasRole', () => {
  it('returns false when user is not logged in', async () => {
    mockAuthApi.refresh.mockResolvedValue(null);
    const { result } = renderHook(() => useHasRole('admin'), { wrapper });
    await waitFor(() => result.current === false);
    expect(result.current).toBe(false);
  });

  it('returns true when user has the required role', async () => {
    mockAuthApi.refresh.mockResolvedValue(null);
    mockAuthApi.login.mockResolvedValue({ accessToken: 'token', user: MOCK_USER });

    const { result } = renderHook(() => ({
      auth: useAuth(),
      hasStudent: useHasRole('student'),
      hasAdmin: useHasRole('admin'),
    }), { wrapper });

    await waitFor(() => expect(result.current.auth.isLoading).toBe(false));
    await act(async () => { await result.current.auth.login('alice@example.com', 'pw'); });

    expect(result.current.hasStudent).toBe(true);
    expect(result.current.hasAdmin).toBe(false);
  });

  it('returns true when user has any of the provided roles', async () => {
    mockAuthApi.refresh.mockResolvedValue(null);
    mockAuthApi.login.mockResolvedValue({ accessToken: 'token', user: MOCK_USER });

    const { result } = renderHook(() => ({
      auth: useAuth(),
      check: useHasRole('admin', 'student'),
    }), { wrapper });

    await waitFor(() => expect(result.current.auth.isLoading).toBe(false));
    await act(async () => { await result.current.auth.login('alice@example.com', 'pw'); });

    expect(result.current.check).toBe(true);
  });
});
