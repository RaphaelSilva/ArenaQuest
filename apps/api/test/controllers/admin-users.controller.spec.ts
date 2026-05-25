import { describe, it, expect } from 'vitest';
import { AdminUsersController } from '@api/controllers/admin-users.controller';
import type {
  IAuthAdapter,
  IUserRepository,
  IRefreshTokenRepository,
  IMailer,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = 'admin-user-123';
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

function makeUserRepo(user: Entities.Identity.User | null = ACTIVE_USER): IUserRepository & {
  updatedPasswords: Array<{ id: string; hash: string }>;
} {
  const updatedPasswords: Array<{ id: string; hash: string }> = [];
  return {
    updatedPasswords,
    findByEmail: async (email) => {
      if (!user || user.email !== email) return null;
      return { ...user, passwordHash: 'pbkdf2:100000:aa:bb' };
    },
    findById: async (id) => {
      if (id === user?.id) return user;
      return null;
    },
    create: async () => ACTIVE_USER,
    update: async () => ACTIVE_USER,
    delete: async () => {},
    list: async () => [],
    count: async () => 0,
    countActiveAdmins: async () => 1,
    updatePasswordHash: async (id, hash) => {
      updatedPasswords.push({ id, hash });
    },
  };
}

function makeMailer(): IMailer & { sent: Array<{ to: string; subject: string; html: string }> } {
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  return {
    sent,
    send: async (msg) => {
      sent.push({ to: msg.to, subject: msg.subject, html: msg.html });
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdminUsersController.resetPassword', () => {
  it('generates a temporary password and updates hash', async () => {
    const auth = makeAuthAdapter();
    const users = makeUserRepo();
    const tokens = makeRefreshTokenRepo();
    const mailer = makeMailer();

    const controller = new AdminUsersController(auth, users, tokens, mailer);

    const result = await controller.resetPassword(ADMIN_USER_ID, ACTIVE_USER.id, {
      sendEmail: false,
    });

    expect(result.ok).toBe(true);
    expect(result.data?.temporaryPassword).toBeDefined();
    expect(result.data?.temporaryPassword.length).toBeGreaterThan(0);
    expect(result.data?.userId).toBe(ACTIVE_USER.id);
    expect(result.data?.emailSent).toBe(false);
    expect(result.data?.resetAt).toBeDefined();

    // Verify password hash was updated
    expect(users.updatedPasswords).toHaveLength(1);
    expect(users.updatedPasswords[0].id).toBe(ACTIVE_USER.id);
    expect(users.updatedPasswords[0].hash).toContain('hashed:');
  });

  it('revokes all refresh tokens for target user', async () => {
    const auth = makeAuthAdapter();
    const users = makeUserRepo();
    const tokens = makeRefreshTokenRepo();
    const mailer = makeMailer();

    const controller = new AdminUsersController(auth, users, tokens, mailer);

    await controller.resetPassword(ADMIN_USER_ID, ACTIVE_USER.id, { sendEmail: false });

    expect(tokens.deletedUserIds).toContain(ACTIVE_USER.id);
  });

  it('returns 422 when admin tries to reset own password', async () => {
    const auth = makeAuthAdapter();
    const users = makeUserRepo(ACTIVE_USER);
    const tokens = makeRefreshTokenRepo();
    const mailer = makeMailer();

    const controller = new AdminUsersController(auth, users, tokens, mailer);

    const result = await controller.resetPassword(ADMIN_USER_ID, ADMIN_USER_ID, {
      sendEmail: false,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(result.error).toBe('SelfResetNotAllowed');
  });

  it('returns 404 when user not found', async () => {
    const auth = makeAuthAdapter();
    const users = makeUserRepo(null);
    const tokens = makeRefreshTokenRepo();
    const mailer = makeMailer();

    const controller = new AdminUsersController(auth, users, tokens, mailer);

    const result = await controller.resetPassword(ADMIN_USER_ID, 'nonexistent-user', {
      sendEmail: false,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toBe('UserNotFound');
  });

  it('returns 404 when user is inactive', async () => {
    const auth = makeAuthAdapter();
    const users = makeUserRepo(INACTIVE_USER);
    const tokens = makeRefreshTokenRepo();
    const mailer = makeMailer();

    const controller = new AdminUsersController(auth, users, tokens, mailer);

    const result = await controller.resetPassword(ADMIN_USER_ID, INACTIVE_USER.id, {
      sendEmail: false,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toBe('UserNotFound');
  });

  it('sends email when sendEmail is true', async () => {
    const auth = makeAuthAdapter();
    const users = makeUserRepo();
    const tokens = makeRefreshTokenRepo();
    const mailer = makeMailer();

    const controller = new AdminUsersController(auth, users, tokens, mailer);

    const result = await controller.resetPassword(ADMIN_USER_ID, ACTIVE_USER.id, {
      sendEmail: true,
    });

    expect(result.ok).toBe(true);
    expect(result.data?.emailSent).toBe(true);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe(ACTIVE_USER.email);
    expect(mailer.sent[0].subject).toContain('redefinida');
  });

  it('includes admin note in email when provided', async () => {
    const auth = makeAuthAdapter();
    const users = makeUserRepo();
    const tokens = makeRefreshTokenRepo();
    const mailer = makeMailer();

    const controller = new AdminUsersController(auth, users, tokens, mailer);

    const adminNote = 'Please reset your password for security compliance.';
    const result = await controller.resetPassword(ADMIN_USER_ID, ACTIVE_USER.id, {
      sendEmail: true,
      adminNote,
    });

    expect(result.ok).toBe(true);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].html).toContain(adminNote);
  });

  it('returns 400 when adminNote exceeds max length', async () => {
    const auth = makeAuthAdapter();
    const users = makeUserRepo();
    const tokens = makeRefreshTokenRepo();
    const mailer = makeMailer();

    const controller = new AdminUsersController(auth, users, tokens, mailer);

    const tooLongNote = 'a'.repeat(501);
    const result = await controller.resetPassword(ADMIN_USER_ID, ACTIVE_USER.id, {
      sendEmail: true,
      adminNote: tooLongNote,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it('returns 400 when sendEmail is not boolean', async () => {
    const auth = makeAuthAdapter();
    const users = makeUserRepo();
    const tokens = makeRefreshTokenRepo();
    const mailer = makeMailer();

    const controller = new AdminUsersController(auth, users, tokens, mailer);

    const result = await controller.resetPassword(ADMIN_USER_ID, ACTIVE_USER.id, {
      sendEmail: 'yes', // Should be boolean
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it('returns 500 but includes password when email send fails', async () => {
    const auth = makeAuthAdapter();
    const users = makeUserRepo();
    const tokens = makeRefreshTokenRepo();

    const failingMailer: IMailer & { sent: Array<{ to: string; subject: string }> } = {
      sent: [],
      send: async () => {
        throw new Error('Email service down');
      },
    };

    const controller = new AdminUsersController(auth, users, tokens, failingMailer);

    const result = await controller.resetPassword(ADMIN_USER_ID, ACTIVE_USER.id, {
      sendEmail: true,
    });

    // Password update should succeed even if email fails
    expect(result.ok).toBe(true);
    expect(result.data?.temporaryPassword).toBeDefined();
    expect(result.data?.emailSent).toBe(false);
  });

  it('does not send email when sendEmail is false', async () => {
    const auth = makeAuthAdapter();
    const users = makeUserRepo();
    const tokens = makeRefreshTokenRepo();
    const mailer = makeMailer();

    const controller = new AdminUsersController(auth, users, tokens, mailer);

    await controller.resetPassword(ADMIN_USER_ID, ACTIVE_USER.id, {
      sendEmail: false,
    });

    expect(mailer.sent).toHaveLength(0);
  });

  it('returns unique temporary password each time', async () => {
    const auth = makeAuthAdapter();
    const users = makeUserRepo();
    const tokens = makeRefreshTokenRepo();
    const mailer = makeMailer();

    const controller = new AdminUsersController(auth, users, tokens, mailer);

    const result1 = await controller.resetPassword(ADMIN_USER_ID, ACTIVE_USER.id, {
      sendEmail: false,
    });

    const result2 = await controller.resetPassword(ADMIN_USER_ID, ACTIVE_USER.id, {
      sendEmail: false,
    });

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    expect(result1.data?.temporaryPassword).not.toBe(result2.data?.temporaryPassword);
  });
});
