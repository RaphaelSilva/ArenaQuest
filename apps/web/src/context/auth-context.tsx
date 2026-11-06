'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import type { Entities } from '@arenaquest/shared/types/entities';
import { authApi } from '@web/lib/auth-api';
import { ApiClient } from '@web/lib/api-client';
import { openAuthBroadcast, type AuthBroadcast } from '@web/lib/auth-broadcast';

// ---------------------------------------------------------------------------
// JWT decoder — no external deps, client-side only
// ---------------------------------------------------------------------------

function decodeJwtClaims(
  token: string,
): { sub: string; email: string; roles: string[] } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(padded)) as { sub: string; email: string; roles: string[] };
  } catch {
    return null;
  }
}

function userFromClaims(claims: {
  sub: string;
  email: string;
  roles: string[];
}): Entities.Identity.User {
  return {
    id: claims.sub,
    name: '',
    email: claims.email,
    status: 'active' as Entities.Config.UserStatus,
    roles: claims.roles.map((name) => ({
      id: name,
      name,
      description: '',
      createdAt: new Date(0),
    })),
    groups: [],
    timezone: '',
    createdAt: new Date(0),
  };
}

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export interface AuthContextValue {
  user: Entities.Identity.User | null;
  accessToken: string | null;
  isLoading: boolean;
  apiClient: ApiClient;
  login(email: string, password: string): Promise<void>;
  loginWithAccessToken(token: string): void;
  logout(): Promise<void>;
  refreshSession(): Promise<string | null>;
  setAccessToken(token: string | null): void;
  onSessionExpired(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Entities.Identity.User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Cross-tab session signal; opened in an effect below (never during SSR).
  const broadcastRef = useRef<AuthBroadcast | null>(null);

  // On mount: attempt to restore session from the HttpOnly refresh-token cookie.
  useEffect(() => {
    authApi.refresh().then((result) => {
      if (result) {
        setAccessToken(result.accessToken);
        const claims = decodeJwtClaims(result.accessToken);
        if (claims) setUser(userFromClaims(claims));
      }
    }).finally(() => {
      setIsLoading(false);
    });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { accessToken: token, user: apiUser } = await authApi.login(email, password);
    setAccessToken(token);
    setUser({
      id: apiUser.id,
      name: apiUser.name,
      email: apiUser.email,
      status: 'active' as Entities.Config.UserStatus,
      roles: apiUser.roles,
      groups: [],
      timezone: '',
      createdAt: new Date(),
    });
    broadcastRef.current?.post({ type: 'login' });
  }, []);

  const loginWithAccessToken = useCallback((token: string) => {
    setAccessToken(token);
    const claims = decodeJwtClaims(token);
    if (claims) setUser(userFromClaims(claims));
    broadcastRef.current?.post({ type: 'login' });
  }, []);

  const clearSession = useCallback(() => {
    setUser(null);
    setAccessToken(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      clearSession();
      broadcastRef.current?.post({ type: 'logout' });
    }
  }, [clearSession]);

  const refreshSession = useCallback(async () => {
    try {
      const result = await authApi.refresh();
      if (!result) return null;

      setAccessToken(result.accessToken);
      const claims = decodeJwtClaims(result.accessToken);
      if (claims) setUser(userFromClaims(claims));

      return result.accessToken;
    } catch {
      setUser(null);
      setAccessToken(null);
      return null;
    }
  }, []);

  const onSessionExpired = useCallback(() => {
    clearSession();
    broadcastRef.current?.post({ type: 'logout' });
  }, [clearSession]);

  // Another tab logged out → drop this tab's in-memory session at once instead
  // of letting its access token run out its 15 minutes. Another tab logged in →
  // pick the session up from the refresh cookie it just set (`refresh()` is
  // serialised across tabs, so this cannot race the other tab's rotation).
  useEffect(() => {
    const broadcast = openAuthBroadcast((message) => {
      if (message.type === 'logout') clearSession();
      else void refreshSession();
    });
    broadcastRef.current = broadcast;
    return () => {
      broadcastRef.current = null;
      broadcast.close();
    };
  }, [clearSession, refreshSession]);

  const apiClient = useMemo(
    () => new ApiClient(accessToken, refreshSession, setAccessToken, onSessionExpired),
    [accessToken, refreshSession, setAccessToken, onSessionExpired],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        isLoading,
        apiClient,
        login,
        loginWithAccessToken,
        logout,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Internal hook — consumed by public hooks
// ---------------------------------------------------------------------------

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within <AuthProvider>');
  return ctx;
}

export function useApiClient(): ApiClient {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useApiClient must be used within <AuthProvider>');
  return ctx.apiClient;
}
