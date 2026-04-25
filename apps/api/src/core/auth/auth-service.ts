import type { IAuthAdapter, IUserRepository, IRefreshTokenRepository } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { AuthError } from '@api/core/auth/auth-error';
import { toMilliseconds } from '@arenaquest/shared/domain/time';

const REFRESH_TOKEN_TTL_MS = toMilliseconds(7, 'days');

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
    if (!record) {
      throw new AuthError('INVALID_CREDENTIALS', 'Invalid credentials');
    }

    const valid = await this.auth.verifyPassword(password, record.passwordHash);
    if (!valid) {
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
