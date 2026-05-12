'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import type { Entities } from '@arenaquest/shared/types/entities';
import { authApi } from '@web/lib/auth-api';

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
  login(email: string, password: string): Promise<void>;
  loginWithAccessToken(token: string): void;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Entities.Identity.User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
      createdAt: new Date(),
    });
  }, []);

  const loginWithAccessToken = useCallback((token: string) => {
    setAccessToken(token);
    const claims = decodeJwtClaims(token);
    if (claims) setUser(userFromClaims(claims));
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
    setAccessToken(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, accessToken, isLoading, login, loginWithAccessToken, logout }}>
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
