import { z } from 'zod';
import type {
  IUserRepository,
  IPasswordResetTokenRepository,
  IMailer,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { toMilliseconds } from '@arenaquest/shared/domain/time';
import type { ControllerResult } from '@api/core/result';
import { renderPasswordResetEmail } from '@api/mail/templates/password-reset-email';

const TOKEN_TTL_MS = toMilliseconds(1, 'hours');
const TOKEN_BYTES = 32;

const ForgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid'),
});

function generateResetToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class PasswordController {
  constructor(
    private readonly users: IUserRepository,
    private readonly resetTokens: IPasswordResetTokenRepository,
    private readonly mailer: IMailer,
    private readonly webBaseUrl: string,
  ) {}

  async forgotPassword(input: unknown): Promise<ControllerResult<null>> {
    const parsed = ForgotPasswordSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, status: 400, error: 'BadRequest' };
    }

    const { email } = parsed.data;

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
