import type { IAuthAdapter, IUserRepository, IRefreshTokenRepository } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { AuthError } from '@api/core/auth/auth-error';
import { JwtAuthAdapter } from '@api/adapters/auth/jwt-auth-adapter';

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Pre-computed PBKDF2 hash of the throwaway string "arenaquest-dummy-password".
// Purpose: keep login timing constant when the email does not exist, so a missing
// account cannot be distinguished from a wrong password by wall-clock observation.
// The iteration count MUST match the adapter's current working count so both
// branches converge on the same CPU cost.
// Regenerate with `pnpm --filter api run gen-hash` if the iteration target changes.
const DUMMY_PASSWORD_HASH =
  'pbkdf2:100000:dc8c64a8f5fef10858c4e8e21727f0c5:7816d289ea2195b4b2d25c1fdfb78c0d67e9cdf2b9178aaf22606eda394a2ebb';

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

    // S-06: transparent PBKDF2 rehash — upgrade stale hashes on successful
    // login so the fleet migrates to the current iteration target without any
    // forced password-reset flow. A rehash failure must never break the login.
    const currentIter = this.auth.currentPbkdf2Iterations;
    const storedIter = JwtAuthAdapter.readIterationsFromHash(record.passwordHash);
    if (storedIter !== null && storedIter < currentIter) {
      const newHash = await this.auth.hashPassword(password);
      await this.users.updatePasswordHash(record.id, newHash).catch((e) => {
        console.warn('[auth] rehash failed, login proceeds', e);
      });
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
