import type { Entities } from '@arenaquest/shared/types/entities';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

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

export const authApi = {
  async login(email: string, password: string): Promise<LoginResponse> {
    let res: Response;
    try {
      res = await fetch(`${API_URL}/auth/login`, {
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
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  },

  async refresh(): Promise<{ accessToken: string } | null> {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!res.ok) return null;
    return res.json();
  },

  async register(input: { name: string; email: string; password: string }): Promise<{ status: 'pending_activation' }> {
    let res: Response;
    try {
      res = await fetch(`${API_URL}/auth/register`, {
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

  async activate(input: { token: string }): Promise<{ status: 'activated' | 'already_active' }> {
    let res: Response;
    try {
      res = await fetch(`${API_URL}/auth/activate`, {
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
