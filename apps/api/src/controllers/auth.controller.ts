import type { AuthService } from '@api/core/auth/auth-service';
import { AuthError } from '@api/core/auth/auth-error';
import type { Entities } from '@arenaquest/shared/types/entities';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

type UserDTO = {
  id: string;
  name: string;
  email: string;
  roles: Entities.Security.Role[];
};

export type LoginSuccess = {
  accessToken: string;
  refreshToken: string;
  user: UserDTO;
};

export type RefreshSuccess = {
  accessToken: string;
  refreshToken: string;
};

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; status: 400 | 401; error: string };
export type ControllerResult<T> = Ok<T> | Err;

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  async login(input: { email?: string; password?: string }): Promise<ControllerResult<LoginSuccess>> {
    if (!input.email || !input.password) {
      return { ok: false, status: 400, error: 'BadRequest' };
    }

    try {
      const { accessToken, refreshToken, user } = await this.authService.login(
        input.email,
        input.password,
      );
      return {
        ok: true,
        data: {
          accessToken,
          refreshToken,
          user: { id: user.id, name: user.name, email: user.email, roles: user.roles },
        },
      };
    } catch (err) {
      if (
        err instanceof AuthError &&
        (err.code === 'INVALID_CREDENTIALS' || err.code === 'ACCOUNT_INACTIVE')
      ) {
        return { ok: false, status: 401, error: 'InvalidCredentials' };
      }
      throw err;
    }
  }

  async logout(refreshToken: string | undefined): Promise<ControllerResult<null>> {
    if (!refreshToken) {
      return { ok: false, status: 401, error: 'Unauthorized' };
    }
    await this.authService.logout(refreshToken);
    return { ok: true, data: null };
  }

  async refresh(refreshToken: string | undefined): Promise<ControllerResult<RefreshSuccess>> {
    if (!refreshToken) {
      return { ok: false, status: 401, error: 'Unauthorized' };
    }

    try {
      const { accessToken, refreshToken: newToken } = await this.authService.refreshTokens(refreshToken);
      return { ok: true, data: { accessToken, refreshToken: newToken } };
    } catch (err) {
      if (err instanceof AuthError && err.code === 'INVALID_REFRESH_TOKEN') {
        return { ok: false, status: 401, error: 'Unauthorized' };
      }
      throw err;
    }
  }
}
