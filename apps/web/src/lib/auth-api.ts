import type { Entities } from '@arenaquest/shared/types/entities';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
const API_VERSION = '/v1';

export type LoginResponse = {
  accessToken: string;
  user: Pick<Entities.Identity.User, 'id' | 'name' | 'email' | 'roles'>;
};

/**
 * Discriminator the UI branches on to render copy/banners. `Unknown` is the
 * fallback for unexpected statuses so callers always have a code to switch on.
 */
export type AuthApiErrorCode =
  | 'ValidationFailed'
  | 'InvalidCredentials'
  | 'InvalidToken'
  | 'RateLimited'
  | 'NetworkError'
  | 'Unknown';

export interface ValidationFieldError {
  field: 'name' | 'email' | 'password';
  code: string;
}

export class AuthApiError extends Error {
  readonly code: AuthApiErrorCode;
  readonly status: number;
  readonly fields?: ValidationFieldError[];

  constructor(code: AuthApiErrorCode, status: number, message: string, fields?: ValidationFieldError[]) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

type RefreshResult = { accessToken: string } | null;

/** Name of the cross-tab Web Lock that serialises refresh-token rotation. */
export const REFRESH_LOCK_NAME = 'arenaquest:auth-refresh';

let inFlightRefresh: Promise<RefreshResult> | null = null;

async function sendRefresh(): Promise<RefreshResult> {
  const res = await fetch(`${API_URL}${API_VERSION}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!res.ok) return null;
  return res.json();
}

/** Run `fn` under the cross-tab refresh lock when the browser offers Web Locks. */
async function withRefreshLock(fn: () => Promise<RefreshResult>): Promise<RefreshResult> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks?.request) return fn();
  // The DOM lib types `request` as returning the callback's promise unwrapped
  // one level too few; the runtime value is the callback's resolved result.
  const result: unknown = await locks.request(REFRESH_LOCK_NAME, fn);
  return result as RefreshResult;
}

export const authApi = {
  async login(email: string, password: string): Promise<LoginResponse> {
    let res: Response;
    try {
      res = await fetch(`${API_URL}${API_VERSION}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
    } catch {
      throw new AuthApiError('NetworkError', 0, 'Falha de rede ao entrar.');
    }

    if (!res.ok) {
      const body = await readJson(res);
      const errStr = typeof body.error === 'string' ? body.error : '';
      if (res.status === 429) throw new AuthApiError('RateLimited', 429, 'Muitas tentativas.');
      if (res.status === 401 || errStr === 'InvalidCredentials') {
        throw new AuthApiError('InvalidCredentials', res.status, 'Credenciais inválidas.');
      }
      throw new AuthApiError('Unknown', res.status, errStr || `Login failed (${res.status})`);
    }

    return res.json();
  },

  async logout(): Promise<void> {
    await fetch(`${API_URL}${API_VERSION}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  },

  /**
   * Rotate the refresh-token cookie and return a fresh access token.
   *
   * The API deletes the presented refresh token on every rotation, so two
   * refreshes sent with the same cookie race: the loser gets a 401 and the
   * user is sent to /login. Calls are therefore serialised twice — within the
   * tab by sharing one in-flight promise (the mount-time restore, React's
   * StrictMode double effect and `fetchWithAuth`'s retry all funnel here), and
   * across tabs with a Web Lock, so a second tab's request leaves only after
   * the first tab's `Set-Cookie` has landed and carries the new cookie.
   */
  refresh(): Promise<{ accessToken: string } | null> {
    if (!inFlightRefresh) {
      inFlightRefresh = withRefreshLock(sendRefresh).finally(() => {
        inFlightRefresh = null;
      });
    }
    return inFlightRefresh;
  },

  async register(input: { name: string; email: string; password: string }): Promise<{ status: 'pending_activation' }> {
    let res: Response;
    try {
      res = await fetch(`${API_URL}${API_VERSION}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      });
    } catch {
      throw new AuthApiError('NetworkError', 0, 'Falha de rede ao cadastrar.');
    }

    if (res.status === 429) {
      throw new AuthApiError('RateLimited', 429, 'Muitas tentativas.');
    }

    if (!res.ok) {
      const body = await readJson(res);
      const errStr = typeof body.error === 'string' ? body.error : '';
      const fields = Array.isArray(body.fields) ? (body.fields as ValidationFieldError[]) : undefined;
      if (errStr === 'ValidationFailed') {
        throw new AuthApiError('ValidationFailed', res.status, 'Dados inválidos.', fields);
      }
      throw new AuthApiError('Unknown', res.status, errStr || `Register failed (${res.status})`);
    }

    return res.json();
  },

  async forgotPassword(email: string): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${API_URL}${API_VERSION}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch {
      throw new AuthApiError('NetworkError', 0, 'Falha de rede.');
    }
    if (res.status === 429) throw new AuthApiError('RateLimited', 429, 'Muitas tentativas.');
    if (!res.ok) {
      const body = await readJson(res);
      const errStr = typeof body.error === 'string' ? body.error : '';
      throw new AuthApiError('Unknown', res.status, errStr || `Failed (${res.status})`);
    }
  },

  async resetPassword(token: string, newPassword: string): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${API_URL}${API_VERSION}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
    } catch {
      throw new AuthApiError('NetworkError', 0, 'Falha de rede.');
    }
    if (res.status === 429) throw new AuthApiError('RateLimited', 429, 'Muitas tentativas.');
    if (!res.ok) {
      const body = await readJson(res);
      const errStr = typeof body.error === 'string' ? body.error : '';
      if (errStr === 'InvalidToken' || errStr === 'TokenExpired') {
        throw new AuthApiError('InvalidToken', res.status, 'Link inválido ou expirado.');
      }
      throw new AuthApiError('Unknown', res.status, errStr || `Failed (${res.status})`);
    }
  },

  async activate(input: { token: string }): Promise<{ status: 'activated' | 'already_active' }> {
    let res: Response;
    try {
      res = await fetch(`${API_URL}${API_VERSION}/auth/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      });
    } catch {
      throw new AuthApiError('NetworkError', 0, 'Falha de rede ao ativar.');
    }

    if (res.status === 429) {
      throw new AuthApiError('RateLimited', 429, 'Muitas tentativas.');
    }

    if (!res.ok) {
      const body = await readJson(res);
      const errStr = typeof body.error === 'string' ? body.error : '';
      if (errStr === 'InvalidToken') {
        throw new AuthApiError('InvalidToken', res.status, 'Link inválido ou expirado.');
      }
      throw new AuthApiError('Unknown', res.status, errStr || `Activate failed (${res.status})`);
    }

    return res.json();
  },
};
