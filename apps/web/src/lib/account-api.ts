import { fetchWithAuth } from './fetch-with-auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export type AccountApiErrorCode =
  | 'InvalidCurrentPassword'
  | 'Unauthorized'
  | 'NetworkError'
  | 'Unknown';

export class AccountApiError extends Error {
  readonly code: AccountApiErrorCode;
  readonly status: number;

  constructor(code: AccountApiErrorCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export const accountApi = {
  async changePassword(
    accessToken: string,
    currentPassword: string,
    newPassword: string,
    refreshFn: () => Promise<string | null>,
    onTokenUpdate: (token: string) => void,
    onSessionExpired: () => void,
  ): Promise<void> {
    let res: Response;
    try {
      res = await fetchWithAuth(
        `${API_URL}/account/change-password`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ currentPassword, newPassword }),
        },
        accessToken,
        refreshFn,
        onTokenUpdate,
        onSessionExpired,
      );
    } catch {
      throw new AccountApiError('NetworkError', 0, 'Falha de rede.');
    }

    if (res.status === 401) throw new AccountApiError('Unauthorized', 401, 'Sessão expirada.');
    if (!res.ok) {
      const body = await readJson(res);
      const errStr = typeof body.error === 'string' ? body.error : '';
      if (errStr === 'InvalidCurrentPassword') {
        throw new AccountApiError('InvalidCurrentPassword', res.status, 'Senha atual incorreta.');
      }
      throw new AccountApiError('Unknown', res.status, errStr || `Failed (${res.status})`);
    }
  },
};
