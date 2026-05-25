import { z } from 'zod';
import type {
  IAuthAdapter,
  IRefreshTokenRepository,
  IUserRepository,
  IMailer,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import type { ControllerResult } from '@api/core/result';
import { renderAdminPasswordResetEmail } from '@api/mail/templates/admin-password-reset-email';

const ResetPasswordSchema = z.object({
  sendEmail: z.boolean().default(false),
  adminNote: z.string().max(500).optional(),
});

interface ResetPasswordResponse {
  userId: string;
  temporaryPassword: string;
  emailSent: boolean;
  resetAt: string;
}

/**
 * Generate a cryptographically secure temporary password.
 * Uses 16 random bytes encoded as base64url.
 */
function generateTemporaryPassword(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class AdminUsersController {
  constructor(
    private readonly auth: IAuthAdapter,
    private readonly users: IUserRepository,
    private readonly refreshTokens: IRefreshTokenRepository,
    private readonly mailer: IMailer,
  ) {}

  /**
   * Reset a user's password (admin-initiated).
   *
   * @param adminId - The ID of the admin performing the reset
   * @param userId - The ID of the user whose password is being reset
   * @param input - The request body (sendEmail, adminNote)
   * @returns ControllerResult containing the temporary password and reset details
   */
  async resetPassword(
    adminId: string,
    userId: string,
    input: unknown,
  ): Promise<ControllerResult<ResetPasswordResponse>> {
    // Validate input
    const parsed = ResetPasswordSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, status: 400, error: 'BadRequest' };
    }

    const { sendEmail, adminNote } = parsed.data;

    // Prevent self-reset
    if (adminId === userId) {
      return { ok: false, status: 422, error: 'SelfResetNotAllowed' };
    }

    // Check that user exists and is active
    const targetUser = await this.users.findById(userId);
    if (!targetUser || targetUser.status !== Entities.Config.UserStatus.ACTIVE) {
      return { ok: false, status: 404, error: 'UserNotFound' };
    }

    // Generate temporary password
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.auth.hashPassword(temporaryPassword);

    // Update password hash and revoke all refresh tokens
    await this.users.updatePasswordHash(userId, passwordHash);
    await this.refreshTokens.deleteAllForUser(userId);

    // Send email if requested
    let emailSent = false;
    if (sendEmail) {
      try {
        const message = renderAdminPasswordResetEmail({
          to: targetUser.email,
          name: targetUser.name,
          temporaryPassword,
          adminNote,
        });
        await this.mailer.send(message);
        emailSent = true;
      } catch (err) {
        console.error('[admin-users] password reset email send failed', err);
        // Don't fail the response — password was already updated
      }
    }

    // Log audit event (TODO: implement audit logging infrastructure)
    this.auditPasswordReset(adminId, userId, 'success');

    return {
      ok: true,
      data: {
        userId,
        temporaryPassword,
        emailSent,
        resetAt: new Date().toISOString(),
      },
    };
  }

  private auditPasswordReset(adminId: string, targetUserId: string, result: 'success' | string): void {
    console.info(
      JSON.stringify({
        event: 'user.password.reset_by_admin',
        adminId,
        targetUserId,
        result,
        at: new Date().toISOString(),
      }),
    );
  }
}
