import { z } from 'zod';
import type {
  IAuthAdapter,
  IUserRepository,
  IRefreshTokenRepository,
} from '@arenaquest/shared/ports';
import type { ControllerResult } from '@api/core/result';

const PASSWORD_MIN = 8;

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(PASSWORD_MIN, 'TooShort').regex(/\d/, 'NoDigit'),
});

export class AccountController {
  constructor(
    private readonly auth: IAuthAdapter,
    private readonly users: IUserRepository,
    private readonly refreshTokens: IRefreshTokenRepository,
  ) {}

  async changePassword(
    userId: string,
    currentRefreshToken: string | undefined,
    input: unknown,
  ): Promise<ControllerResult<null>> {
    const parsed = ChangePasswordSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, status: 400, error: 'BadRequest' };
    }

    const { currentPassword, newPassword } = parsed.data;

    const userRecord = await this.users.findById(userId);
    if (!userRecord) {
      return { ok: false, status: 401, error: 'Unauthorized' };
    }

    const fullRecord = await this.users.findByEmail(userRecord.email);
    if (!fullRecord) {
      return { ok: false, status: 401, error: 'Unauthorized' };
    }

    const valid = await this.auth.verifyPassword(currentPassword, fullRecord.passwordHash);
    if (!valid) {
      return { ok: false, status: 400, error: 'InvalidCurrentPassword' };
    }

    const newHash = await this.auth.hashPassword(newPassword);
    await this.users.updatePasswordHash(userId, newHash);

    if (currentRefreshToken) {
      await this.refreshTokens.deleteAllForUserExcept(userId, currentRefreshToken);
    } else {
      await this.refreshTokens.deleteAllForUser(userId);
    }

    return { ok: true, data: null };
  }
}
