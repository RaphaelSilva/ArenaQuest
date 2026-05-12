import { describe, it, expect, vi } from 'vitest';
import { PasswordController } from '@api/controllers/password.controller';
import type {
  IUserRepository,
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
    const controller = new PasswordController(makeUserRepo(), makeResetTokenRepo(), makeMailer(), 'http://localhost:3000');
    const result = await controller.forgotPassword({ email: 'not-an-email' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 400 for a missing body', async () => {
    const controller = new PasswordController(makeUserRepo(), makeResetTokenRepo(), makeMailer(), 'http://localhost:3000');
    const result = await controller.forgotPassword(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 200 and sends email for a known active user', async () => {
    const tokenRepo = makeResetTokenRepo();
    const mailer = makeMailer();
    const controller = new PasswordController(makeUserRepo(), tokenRepo, mailer, 'http://localhost:3000');

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
    const controller = new PasswordController(makeUserRepo(null), tokenRepo, mailer, 'http://localhost:3000');

    const result = await controller.forgotPassword({ email: 'unknown@example.com' });

    expect(result.ok).toBe(true);
    expect(tokenRepo.createdTokens).toHaveLength(0);
    expect(mailer.sent).toHaveLength(0);
  });

  it('returns 200 but sends no email for an inactive user', async () => {
    const tokenRepo = makeResetTokenRepo();
    const mailer = makeMailer();
    const controller = new PasswordController(makeUserRepo(INACTIVE_USER), tokenRepo, mailer, 'http://localhost:3000');

    const result = await controller.forgotPassword({ email: 'inactive@example.com' });

    expect(result.ok).toBe(true);
    expect(mailer.sent).toHaveLength(0);
  });

  it('invalidates previous tokens before creating a new one', async () => {
    const tokenRepo = makeResetTokenRepo();
    const controller = new PasswordController(makeUserRepo(), tokenRepo, makeMailer(), 'http://localhost:3000');

    await controller.forgotPassword({ email: 'alice@example.com' });

    expect(tokenRepo.invalidatedUserIds).toContain(ACTIVE_USER.id);
  });

  it('reset URL is built from webBaseUrl and contains the token', async () => {
    const tokenRepo = makeResetTokenRepo();
    const mailer = makeMailer();

    // Spy on renderPasswordResetEmail indirectly via mailer
    const sendSpy = vi.spyOn(mailer, 'send');
    const controller = new PasswordController(makeUserRepo(), tokenRepo, mailer, 'https://app.example.com/');

    await controller.forgotPassword({ email: 'alice@example.com' });

    expect(sendSpy).toHaveBeenCalledOnce();
    const message = sendSpy.mock.calls[0][0];
    expect(message.text).toContain('https://app.example.com/reset-password?token=');
  });

  it('returns 200 even when the mailer throws', async () => {
    const mailer: IMailer = { send: async () => { throw new Error('SMTP down'); } };
    const controller = new PasswordController(makeUserRepo(), makeResetTokenRepo(), mailer, 'http://localhost:3000');

    const result = await controller.forgotPassword({ email: 'alice@example.com' });
    expect(result.ok).toBe(true);
  });
});
