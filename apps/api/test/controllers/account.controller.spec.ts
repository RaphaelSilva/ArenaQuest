import { describe, it, expect } from 'vitest';
import { AccountController } from '@api/controllers/account.controller';
import type {
  IAuthAdapter,
  IUserRepository,
  IRefreshTokenRepository,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-change-pw-1';

const ACTIVE_USER: Entities.Identity.User = {
  id: USER_ID,
  name: 'Alice',
  email: 'alice@example.com',
  status: Entities.Config.UserStatus.ACTIVE,
  roles: [],
  groups: [],
  createdAt: new Date(),
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

function makeUserRepo(user: Entities.Identity.User | null = ACTIVE_USER): IUserRepository {
  const updatedHashes: string[] = [];
  return {
    findById: async (id) => (user && user.id === id ? user : null),
    findByEmail: async (email) => {
      if (!user || user.email !== email) return null;
      return { ...user, passwordHash: 'hashed:OldPass1' };
    },
    create: async () => ACTIVE_USER,
    update: async () => ACTIVE_USER,
    delete: async () => {},
    list: async () => [],
    count: async () => 0,
    countActiveAdmins: async () => 1,
    updatePasswordHash: async (_id, hash) => { updatedHashes.push(hash); },
    _updatedHashes: updatedHashes,
  } as IUserRepository & { _updatedHashes: string[] };
}

function makeRefreshTokenRepo(): IRefreshTokenRepository & {
  deletedUserIds: string[];
  keptTokens: string[];
} {
  const deletedUserIds: string[] = [];
  const keptTokens: string[] = [];
  return {
    deletedUserIds,
    keptTokens,
    save: async () => {},
    findByToken: async () => null,
    delete: async () => {},
    deleteAllForUser: async (userId) => { deletedUserIds.push(userId); },
    deleteAllForUserExcept: async (userId, keepToken) => {
      deletedUserIds.push(userId);
      keptTokens.push(keepToken);
    },
  };
}

function makeController(userRepo = makeUserRepo()) {
  return new AccountController(makeAuthAdapter(), userRepo, makeRefreshTokenRepo());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AccountController.changePassword', () => {
  it('returns 400 for missing body', async () => {
    const ctrl = makeController();
    const result = await ctrl.changePassword(USER_ID, undefined, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 400 for missing newPassword', async () => {
    const ctrl = makeController();
    const result = await ctrl.changePassword(USER_ID, undefined, { currentPassword: 'OldPass1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 400 for newPassword shorter than 8 chars', async () => {
    const ctrl = makeController();
    const result = await ctrl.changePassword(USER_ID, undefined, {
      currentPassword: 'OldPass1',
      newPassword: 'sh0rt',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 400 for newPassword with no digit', async () => {
    const ctrl = makeController();
    const result = await ctrl.changePassword(USER_ID, undefined, {
      currentPassword: 'OldPass1',
      newPassword: 'NoDigitHere',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 400 InvalidCurrentPassword for a wrong current password', async () => {
    const ctrl = makeController();
    const result = await ctrl.changePassword(USER_ID, undefined, {
      currentPassword: 'WrongPass9',
      newPassword: 'NewPass123',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe('InvalidCurrentPassword');
    }
  });

  it('returns 200 and updates password hash for valid input', async () => {
    const userRepo = makeUserRepo();
    const updatedHashes: string[] = [];
    userRepo.updatePasswordHash = async (_id, hash) => { updatedHashes.push(hash); };

    const ctrl = new AccountController(makeAuthAdapter(), userRepo, makeRefreshTokenRepo());
    const result = await ctrl.changePassword(USER_ID, undefined, {
      currentPassword: 'OldPass1',
      newPassword: 'NewPass123',
    });

    expect(result.ok).toBe(true);
    expect(updatedHashes).toHaveLength(1);
    expect(updatedHashes[0]).toBe('hashed:NewPass123');
  });

  it('calls deleteAllForUserExcept when a refresh token is provided', async () => {
    const refreshRepo = makeRefreshTokenRepo();
    const ctrl = new AccountController(makeAuthAdapter(), makeUserRepo(), refreshRepo);

    await ctrl.changePassword(USER_ID, 'my-refresh-token', {
      currentPassword: 'OldPass1',
      newPassword: 'NewPass123',
    });

    expect(refreshRepo.keptTokens).toContain('my-refresh-token');
    expect(refreshRepo.deletedUserIds).toContain(USER_ID);
  });

  it('calls deleteAllForUser when no refresh token is provided', async () => {
    const refreshRepo = makeRefreshTokenRepo();
    const ctrl = new AccountController(makeAuthAdapter(), makeUserRepo(), refreshRepo);

    await ctrl.changePassword(USER_ID, undefined, {
      currentPassword: 'OldPass1',
      newPassword: 'NewPass123',
    });

    expect(refreshRepo.deletedUserIds).toContain(USER_ID);
    expect(refreshRepo.keptTokens).toHaveLength(0);
  });

  it('returns 401 when user is not found', async () => {
    const ctrl = makeController(makeUserRepo(null));
    const result = await ctrl.changePassword('nonexistent', undefined, {
      currentPassword: 'OldPass1',
      newPassword: 'NewPass123',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });
});
