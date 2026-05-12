import { describe, it, expect, vi } from 'vitest';
import { PasswordController } from '@api/controllers/password.controller';
import type {
  IAuthAdapter,
  IUserRepository,
  IRefreshTokenRepository,
  IPasswordResetTokenRepository,
  IMailer,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTIVE_USER: Entities.Identity.User = {
  id: 'user-reset-1',
  name: 'Alice',
  email: 'alice@example.com',
  status: Entities.Config.UserStatus.ACTIVE,
  roles: [],
  groups: [],
  createdAt: new Date(),
};

const INACTIVE_USER: Entities.Identity.User = {
  ...ACTIVE_USER,
  id: 'user-reset-2',
  email: 'inactive@example.com',
  status: Entities.Config.UserStatus.INACTIVE,
};

function makeAuthAdapter(): IAuthAdapter {
  return {
    hashPassword: async (plain) => `hashed:${plain}`,
    verifyPassword: async (plain, stored) => stored === `hashed:${plain}`,
    signAccessToken: async (payload) => `access.${payload.sub}`,
    verifyAccessToken: async () => null,
    generateRefreshToken: async () => 'refresh-token',
    get currentPbkdf2Iterations() { return 1; },
  };
}

function makeRefreshTokenRepo(): IRefreshTokenRepository & { deletedUserIds: string[] } {
  const deletedUserIds: string[] = [];
  return {
    deletedUserIds,
    save: async () => {},
    findByToken: async () => null,
    delete: async () => {},
    deleteAllForUser: async (userId) => { deletedUserIds.push(userId); },
    deleteAllForUserExcept: async () => {},
  };
}

function makeUserRepo(user: Entities.Identity.User | null = ACTIVE_USER): IUserRepository {
  return {
    findByEmail: async (email) => {
      if (!user || user.email !== email) return null;
      return { ...user, passwordHash: 'pbkdf2:100000:aa:bb' };
    },
    findById: async () => null,
    create: async () => ACTIVE_USER,
    update: async () => ACTIVE_USER,
    delete: async () => {},
    list: async () => [],
    count: async () => 0,
    countActiveAdmins: async () => 1,
    updatePasswordHash: async () => {},
  };
}

function makeResetTokenRepo(): IPasswordResetTokenRepository & {
  createdTokens: Array<{ userId: string; expiresAt: Date }>;
  invalidatedUserIds: string[];
} {
  const createdTokens: Array<{ userId: string; expiresAt: Date }> = [];
  const invalidatedUserIds: string[] = [];
  return {
    createdTokens,
    invalidatedUserIds,
    create: async (input) => { createdTokens.push({ userId: input.userId, expiresAt: input.expiresAt }); },
    consumeByPlainToken: async () => ({ outcome: 'invalid' }),
    invalidateAllForUser: async (userId) => { invalidatedUserIds.push(userId); },
    purgeExpired: async () => {},
  };
}

function makeMailer(): IMailer & { sent: Array<{ to: string; subject: string }> } {
  const sent: Array<{ to: string; subject: string }> = [];
  return {
    sent,
    send: async (msg) => { sent.push({ to: msg.to, subject: msg.subject }); },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PasswordController.forgotPassword', () => {
  it('returns 400 for an invalid email', async () => {
    const controller = new PasswordController(makeAuthAdapter(), makeUserRepo(), makeRefreshTokenRepo(), makeResetTokenRepo(), makeMailer(), 'http://localhost:3000');
    const result = await controller.forgotPassword({ email: 'not-an-email' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 400 for a missing body', async () => {
    const controller = new PasswordController(makeAuthAdapter(), makeUserRepo(), makeRefreshTokenRepo(), makeResetTokenRepo(), makeMailer(), 'http://localhost:3000');
    const result = await controller.forgotPassword(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 200 and sends email for a known active user', async () => {
    const tokenRepo = makeResetTokenRepo();
    const mailer = makeMailer();
    const controller = new PasswordController(makeAuthAdapter(), makeUserRepo(), makeRefreshTokenRepo(), tokenRepo, mailer, 'http://localhost:3000');

    const result = await controller.forgotPassword({ email: 'alice@example.com' });

    expect(result.ok).toBe(true);
    expect(tokenRepo.createdTokens).toHaveLength(1);
    expect(tokenRepo.createdTokens[0].userId).toBe(ACTIVE_USER.id);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe('alice@example.com');
  });

  it('returns 200 but sends no email for an unknown email', async () => {
    const tokenRepo = makeResetTokenRepo();
    const mailer = makeMailer();
    const controller = new PasswordController(makeAuthAdapter(), makeUserRepo(null), makeRefreshTokenRepo(), tokenRepo, mailer, 'http://localhost:3000');

    const result = await controller.forgotPassword({ email: 'unknown@example.com' });

    expect(result.ok).toBe(true);
    expect(tokenRepo.createdTokens).toHaveLength(0);
    expect(mailer.sent).toHaveLength(0);
  });

  it('returns 200 but sends no email for an inactive user', async () => {
    const tokenRepo = makeResetTokenRepo();
    const mailer = makeMailer();
    const controller = new PasswordController(makeAuthAdapter(), makeUserRepo(INACTIVE_USER), makeRefreshTokenRepo(), tokenRepo, mailer, 'http://localhost:3000');

    const result = await controller.forgotPassword({ email: 'inactive@example.com' });

    expect(result.ok).toBe(true);
    expect(mailer.sent).toHaveLength(0);
  });

  it('invalidates previous tokens before creating a new one', async () => {
    const tokenRepo = makeResetTokenRepo();
    const controller = new PasswordController(makeAuthAdapter(), makeUserRepo(), makeRefreshTokenRepo(), tokenRepo, makeMailer(), 'http://localhost:3000');

    await controller.forgotPassword({ email: 'alice@example.com' });

    expect(tokenRepo.invalidatedUserIds).toContain(ACTIVE_USER.id);
  });

  it('reset URL is built from webBaseUrl and contains the token', async () => {
    const tokenRepo = makeResetTokenRepo();
    const mailer = makeMailer();

    // Spy on renderPasswordResetEmail indirectly via mailer
    const sendSpy = vi.spyOn(mailer, 'send');
    const controller = new PasswordController(makeAuthAdapter(), makeUserRepo(), makeRefreshTokenRepo(), tokenRepo, mailer, 'https://app.example.com/');

    await controller.forgotPassword({ email: 'alice@example.com' });

    expect(sendSpy).toHaveBeenCalledOnce();
    const message = sendSpy.mock.calls[0][0];
    expect(message.text).toContain('https://app.example.com/reset-password?token=');
  });

  it('returns 200 even when the mailer throws', async () => {
    const mailer: IMailer = { send: async () => { throw new Error('SMTP down'); } };
    const controller = new PasswordController(makeAuthAdapter(), makeUserRepo(), makeRefreshTokenRepo(), makeResetTokenRepo(), mailer, 'http://localhost:3000');

    const result = await controller.forgotPassword({ email: 'alice@example.com' });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resetPassword
// ---------------------------------------------------------------------------

function makeConsumeableResetTokenRepo(outcome: 'consumed' | 'expired' | 'already_used' | 'invalid' = 'consumed'): IPasswordResetTokenRepository {
  return {
    create: async () => {},
    consumeByPlainToken: async () =>
      outcome === 'consumed'
        ? { outcome: 'consumed', userId: ACTIVE_USER.id }
        : { outcome },
    invalidateAllForUser: async () => {},
    purgeExpired: async () => {},
  };
}

describe('PasswordController.resetPassword', () => {
  it('returns 400 for missing newPassword', async () => {
    const controller = new PasswordController(makeAuthAdapter(), makeUserRepo(), makeRefreshTokenRepo(), makeConsumeableResetTokenRepo(), makeMailer(), 'http://localhost:3000');
    const result = await controller.resetPassword({ token: 'abc' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 400 for a newPassword shorter than 8 chars', async () => {
    const controller = new PasswordController(makeAuthAdapter(), makeUserRepo(), makeRefreshTokenRepo(), makeConsumeableResetTokenRepo(), makeMailer(), 'http://localhost:3000');
    const result = await controller.resetPassword({ token: 'abc', newPassword: 'short1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 400 for newPassword with no digit', async () => {
    const controller = new PasswordController(makeAuthAdapter(), makeUserRepo(), makeRefreshTokenRepo(), makeConsumeableResetTokenRepo(), makeMailer(), 'http://localhost:3000');
    const result = await controller.resetPassword({ token: 'abc', newPassword: 'NoDigitHere' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 400 InvalidOrExpiredToken for an expired token', async () => {
    const controller = new PasswordController(makeAuthAdapter(), makeUserRepo(), makeRefreshTokenRepo(), makeConsumeableResetTokenRepo('expired'), makeMailer(), 'http://localhost:3000');
    const result = await controller.resetPassword({ token: 'expired-token', newPassword: 'ValidPass1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe('InvalidOrExpiredToken');
    }
  });

  it('returns 400 InvalidOrExpiredToken for an already-used token', async () => {
    const controller = new PasswordController(makeAuthAdapter(), makeUserRepo(), makeRefreshTokenRepo(), makeConsumeableResetTokenRepo('already_used'), makeMailer(), 'http://localhost:3000');
    const result = await controller.resetPassword({ token: 'used-token', newPassword: 'ValidPass1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('InvalidOrExpiredToken');
  });

  it('returns 400 InvalidOrExpiredToken for an unknown token', async () => {
    const controller = new PasswordController(makeAuthAdapter(), makeUserRepo(), makeRefreshTokenRepo(), makeConsumeableResetTokenRepo('invalid'), makeMailer(), 'http://localhost:3000');
    const result = await controller.resetPassword({ token: 'unknown', newPassword: 'ValidPass1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('InvalidOrExpiredToken');
  });

  it('returns 200 and updates password hash for a valid token', async () => {
    const auth = makeAuthAdapter();
    const userRepo = makeUserRepo();
    const updatedHashes: string[] = [];
    userRepo.updatePasswordHash = async (_id, hash) => { updatedHashes.push(hash); };

    const controller = new PasswordController(auth, userRepo, makeRefreshTokenRepo(), makeConsumeableResetTokenRepo(), makeMailer(), 'http://localhost:3000');
    const result = await controller.resetPassword({ token: 'valid', newPassword: 'NewPass123' });

    expect(result.ok).toBe(true);
    expect(updatedHashes).toHaveLength(1);
    expect(updatedHashes[0]).toBe('hashed:NewPass123');
  });

  it('invalidates all refresh tokens for the user on success', async () => {
    const refreshTokenRepo = makeRefreshTokenRepo();
    const controller = new PasswordController(makeAuthAdapter(), makeUserRepo(), refreshTokenRepo, makeConsumeableResetTokenRepo(), makeMailer(), 'http://localhost:3000');

    await controller.resetPassword({ token: 'valid', newPassword: 'NewPass123' });

    expect(refreshTokenRepo.deletedUserIds).toContain(ACTIVE_USER.id);
  });
});
