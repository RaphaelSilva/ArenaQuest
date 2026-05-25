import type { HttpTransport } from './api-client';

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

export function createAccountApi(http: HttpTransport) {
  return {
    async changePassword(currentPassword: string, newPassword: string): Promise<void> {
      let res: Response;
      try {
        res = await http('POST', '/account/change-password', {
          body: JSON.stringify({ currentPassword, newPassword }),
        });
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
}

const _err = () => { throw new Error('accountApi is deprecated. Use useApiClient() hook instead.'); };
export const accountApi = { changePassword: _err };
