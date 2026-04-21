import type { IAuthAdapter, IUserRepository, IRefreshTokenRepository } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { AuthError } from '@api/core/auth/auth-error';

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Pre-computed PBKDF2 hash of the throwaway string "arenaquest-dummy-password".
// Purpose: keep login timing constant when the email does not exist, so a missing
// account cannot be distinguished from a wrong password by wall-clock observation.
// The iteration count MUST match the adapter's current working count so both
// branches converge on the same CPU cost.
// Regenerate with `pnpm --filter api run gen-hash` if the iteration target changes.
const DUMMY_PASSWORD_HASH =
  'pbkdf2:100000:ba904c14cba9520e3a05b0d00517578b:3d97c7ed7c33202d720b3e9fe93821090dcc4f3e1985831f71e0f0390332349e';

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: Entities.Identity.User;
}

export class AuthService {
  constructor(
    private readonly auth: IAuthAdapter,
    private readonly users: IUserRepository,
    private readonly tokens: IRefreshTokenRepository,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const record = await this.users.findByEmail(email);

    // S-03: run the verify on both branches so the missing-email path pays the
    // same PBKDF2 cost as a wrong-password path. Never short-circuit before the
    // verify completes.
    const hashToVerify = record ? record.passwordHash : DUMMY_PASSWORD_HASH;
    const valid = await this.auth.verifyPassword(password, hashToVerify);

    if (!record || !valid) {
      throw new AuthError('INVALID_CREDENTIALS', 'Invalid credentials');
    }

    if (record.status !== Entities.Config.UserStatus.ACTIVE) {
      throw new AuthError('ACCOUNT_INACTIVE', 'Account is not active');
    }

    const { passwordHash: _, ...user } = record;
    return this.issueTokens(user);
  }

  async refreshTokens(refreshToken: string): Promise<LoginResult> {
    const stored = await this.tokens.findByToken(refreshToken);
    if (!stored || stored.expiresAt < new Date()) {
      throw new AuthError('INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token');
    }

    const user = await this.users.findById(stored.userId);
    if (!user) {
      throw new AuthError('INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token');
    }

    await this.tokens.delete(refreshToken);
    return this.issueTokens(user);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.delete(refreshToken);
  }

  private async issueTokens(user: Entities.Identity.User): Promise<LoginResult> {
    const [accessToken, refreshToken] = await Promise.all([
      this.auth.signAccessToken({
        sub: user.id,
        email: user.email,
        roles: user.roles.map(r => r.name),
      }),
      this.auth.generateRefreshToken(),
    ]);

    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    await this.tokens.save(user.id, refreshToken, expiresAt);

    return { accessToken, refreshToken, user };
  }
}
