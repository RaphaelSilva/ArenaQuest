import { useEffect } from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const refresh = vi.fn();
const login = vi.fn();
const logout = vi.fn();

vi.mock('@web/lib/auth-api', () => ({
  authApi: {
    refresh: (...args: unknown[]) => refresh(...args),
    login: (...args: unknown[]) => login(...args),
    logout: (...args: unknown[]) => logout(...args),
  },
}));

import { AuthProvider, useAuthContext, type AuthContextValue } from '../auth-context';

/** In-process BroadcastChannel: delivers to every OTHER instance with the same name. */
class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this);
  }
  postMessage(data: unknown) {
    for (const other of FakeBroadcastChannel.instances) {
      if (other !== this && other.name === this.name) other.onmessage?.({ data } as MessageEvent);
    }
  }
  close() {
    FakeBroadcastChannel.instances = FakeBroadcastChannel.instances.filter((c) => c !== this);
  }
}

function jwt(sub: string): string {
  const payload = btoa(JSON.stringify({ sub, email: `${sub}@example.com`, roles: ['student'] }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `h.${payload}.s`;
}

/** Renders one "tab" and hands back its live context. */
function renderTab(testId: string) {
  const ref: { current: AuthContextValue | null } = { current: null };
  function Probe() {
    const ctx = useAuthContext();
    useEffect(() => {
      ref.current = ctx;
    });
    return <span data-testid={testId}>{ctx.isLoading ? 'loading' : ctx.user?.id ?? 'anonymous'}</span>;
  }
  render(<AuthProvider><Probe /></AuthProvider>);
  return ref;
}

beforeEach(() => {
  FakeBroadcastChannel.instances = [];
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  refresh.mockReset();
  login.mockReset();
  logout.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AuthProvider — cross-tab session signal', () => {
  it('a logout in one tab drops the session in every other tab at once', async () => {
    refresh.mockResolvedValue({ accessToken: jwt('u1') });
    const tabA = renderTab('tab-a');
    const tabB = renderTab('tab-b');
    await waitFor(() => expect(screen.getByTestId('tab-b').textContent).toBe('u1'));
    expect(screen.getByTestId('tab-a').textContent).toBe('u1');

    await act(async () => { await tabA.current!.logout(); });

    expect(screen.getByTestId('tab-a').textContent).toBe('anonymous');
    expect(screen.getByTestId('tab-b').textContent).toBe('anonymous');
    expect(tabB.current!.accessToken).toBeNull();
    expect(logout).toHaveBeenCalledTimes(1); // only the tab that clicked calls the API
  });

  it('a login in one tab restores the session in the other tabs from the cookie', async () => {
    refresh.mockResolvedValue(null);
    const tabA = renderTab('tab-a');
    renderTab('tab-b');
    await waitFor(() => expect(screen.getByTestId('tab-b').textContent).toBe('anonymous'));

    login.mockResolvedValue({
      accessToken: jwt('u2'),
      user: { id: 'u2', name: 'U2', email: 'u2@example.com', roles: [] },
    });
    refresh.mockResolvedValue({ accessToken: jwt('u2') });

    await act(async () => { await tabA.current!.login('u2@example.com', 'pw'); });

    expect(screen.getByTestId('tab-a').textContent).toBe('u2');
    await waitFor(() => expect(screen.getByTestId('tab-b').textContent).toBe('u2'));
  });

  it('an expired session in one tab is propagated as a logout', async () => {
    refresh.mockResolvedValue({ accessToken: jwt('u1') });
    const tabA = renderTab('tab-a');
    renderTab('tab-b');
    await waitFor(() => expect(screen.getByTestId('tab-b').textContent).toBe('u1'));

    act(() => { tabA.current!.onSessionExpired(); });

    expect(screen.getByTestId('tab-b').textContent).toBe('anonymous');
  });

  it('keeps working without BroadcastChannel', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    refresh.mockResolvedValue({ accessToken: jwt('u1') });
    const tab = renderTab('tab-a');
    await waitFor(() => expect(screen.getByTestId('tab-a').textContent).toBe('u1'));
    await act(async () => { await tab.current!.logout(); });
    expect(screen.getByTestId('tab-a').textContent).toBe('anonymous');
  });
});
