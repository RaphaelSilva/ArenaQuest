import { z } from 'zod';
import type {
  IAuthAdapter,
  IUserRepository,
  IPasswordResetTokenRepository,
  IRefreshTokenRepository,
  IMailer,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { toMilliseconds } from '@arenaquest/shared/domain/time';
import type { ControllerResult } from '@api/core/result';
import { renderPasswordResetEmail } from '@api/mail/templates/password-reset-email';
import { ForgotPasswordRequestSchema, ResetPasswordRequestSchema } from '@api/openapi/components/entities';

export type ForgotPasswordInput = z.infer<typeof ForgotPasswordRequestSchema>;
export type ResetPasswordInput = z.infer<typeof ResetPasswordRequestSchema>;

const TOKEN_TTL_MS = toMilliseconds(1, 'hours');
const TOKEN_BYTES = 32;

function generateResetToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class PasswordController {
  constructor(
    private readonly auth: IAuthAdapter,
    private readonly users: IUserRepository,
    private readonly refreshTokens: IRefreshTokenRepository,
    private readonly resetTokens: IPasswordResetTokenRepository,
    private readonly mailer: IMailer,
    private readonly webBaseUrl: string,
  ) {}

  async resetPassword(input: ResetPasswordInput): Promise<ControllerResult<null>> {
    const { token, newPassword } = input;

    const result = await this.resetTokens.consumeByPlainToken(token);

    if (result.outcome !== 'consumed') {
      return { ok: false, status: 400, error: 'InvalidOrExpiredToken' };
    }

    const newHash = await this.auth.hashPassword(newPassword);
    await this.users.updatePasswordHash(result.userId, newHash);
    await this.refreshTokens.deleteAllForUser(result.userId);

    return { ok: true, data: null };
  }

  async forgotPassword(input: ForgotPasswordInput): Promise<ControllerResult<null>> {
    const { email } = input;

    try {
      const user = await this.users.findByEmail(email);

      if (user && user.status === Entities.Config.UserStatus.ACTIVE) {
        await this.resetTokens.invalidateAllForUser(user.id);

        const plainToken = generateResetToken();
        const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
        await this.resetTokens.create({ plainToken, userId: user.id, expiresAt });

        const baseUrl = this.webBaseUrl.replace(/\/+$/, '');
        const resetUrl = `${baseUrl}/reset-password?token=${plainToken}`;
        const message = renderPasswordResetEmail({ to: email, name: user.name, resetUrl });

        await this.mailer.send(message).catch((err) => {
          console.error('[password] reset email send failed', err);
        });
      }
    } catch (err) {
      console.error('[password] forgotPassword error', err);
    }

    // Always succeed — never reveal whether the email is registered.
    return { ok: true, data: null };
  }
}
