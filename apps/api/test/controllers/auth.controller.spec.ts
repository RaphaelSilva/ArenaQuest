import { describe, it, expect, beforeEach } from 'vitest';
import { AuthController } from '@api/controllers/auth.controller';
import { AuthService } from '@api/core/auth/auth-service';
import { AuthError } from '@api/core/auth/auth-error';
import type { IAuthAdapter, IUserRepository, IRefreshTokenRepository } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';

// ---------------------------------------------------------------------------
// Fixtures — reuse the same pattern as auth-service.spec.ts
// ---------------------------------------------------------------------------

const BASE_USER: Entities.Identity.User = {
  id: 'user-1',
  name: 'Alice',
  email: 'alice@example.com',
  status: Entities.Config.UserStatus.ACTIVE,
  roles: [{ id: 'role-1', name: 'student', description: 'Student', createdAt: new Date() }],
  groups: [],
  createdAt: new Date(),
};

const STORED_HASH = 'hashed:correct-password';

function makeMockAuth(): IAuthAdapter {
  let counter = 0;
  return {
    hashPassword: async (plain) => `hashed:${plain}`,
    verifyPassword: async (plain, stored) => stored === `hashed:${plain}`,
    signAccessToken: async (payload) => `access.${payload.sub}`,
    verifyAccessToken: async () => null,
    generateRefreshToken: async () => `refresh-token-${++counter}`,
  };
}

function makeMockUserRepo(overrides: Partial<Entities.Identity.User> = {}): IUserRepository {
  const user = { ...BASE_USER, ...overrides };
  const record = { ...user, passwordHash: STORED_HASH };

  return {
    findByEmail: async (email) => (email === user.email ? record : null),
    findById: async (id) => (id === user.id ? user : null),
    create: async () => user,
    update: async () => user,
    delete: async () => {},
    list: async () => [user],
  };
}

function makeMockTokenRepo(): IRefreshTokenRepository {
  const store = new Map<string, { userId: string; expiresAt: Date }>();
  return {
    save: async (userId, token, expiresAt) => { store.set(token, { userId, expiresAt }); },
    findByToken: async (token) => store.get(token) ?? null,
    delete: async (token) => { store.delete(token); },
    deleteAllForUser: async (userId) => {
      for (const [token, record] of store) {
        if (record.userId === userId) store.delete(token);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthController', () => {
  let controller: AuthController;
  let mockTokens: IRefreshTokenRepository;

  beforeEach(() => {
    const mockAuth = makeMockAuth();
    const mockUsers = makeMockUserRepo();
    mockTokens = makeMockTokenRepo();
    const service = new AuthService(mockAuth, mockUsers, mockTokens);
    controller = new AuthController(service);
  });

  // ── login ─────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('returns ok with accessToken, refreshToken and user DTO on valid credentials', async () => {
      const result = await controller.login({
        email: 'alice@example.com',
        password: 'correct-password',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.accessToken).toBeTypeOf('string');
      expect(result.data.refreshToken).toBeTypeOf('string');
      expect(result.data.user.id).toBe('user-1');
      expect(result.data.user.email).toBe('alice@example.com');
    });

    it('user DTO does not expose passwordHash', async () => {
      const result = await controller.login({
        email: 'alice@example.com',
        password: 'correct-password',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect((result.data.user as Record<string, unknown>).passwordHash).toBeUndefined();
    });

    it('returns 400 BadRequest when email is missing', async () => {
      const result = await controller.login({ password: 'secret' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.error).toBe('BadRequest');
    });

    it('returns 400 BadRequest when password is missing', async () => {
      const result = await controller.login({ email: 'alice@example.com' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.error).toBe('BadRequest');
    });

    it('returns 401 InvalidCredentials on wrong password', async () => {
      const result = await controller.login({
        email: 'alice@example.com',
        password: 'wrong-password',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(401);
      expect(result.error).toBe('InvalidCredentials');
    });

    it('returns 401 InvalidCredentials for unknown email', async () => {
      const result = await controller.login({
        email: 'nobody@example.com',
        password: 'correct-password',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(401);
      expect(result.error).toBe('InvalidCredentials');
    });

    it('returns 401 InvalidCredentials for inactive account', async () => {
      const mockUsers = makeMockUserRepo({ status: Entities.Config.UserStatus.INACTIVE });
      const service = new AuthService(makeMockAuth(), mockUsers, mockTokens);
      const ctrl = new AuthController(service);

      const result = await ctrl.login({
        email: 'alice@example.com',
        password: 'correct-password',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(401);
      expect(result.error).toBe('InvalidCredentials');
    });
  });

  // ── logout ────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('returns ok with null data on valid token', async () => {
      const loginResult = await controller.login({
        email: 'alice@example.com',
        password: 'correct-password',
      });
      expect(loginResult.ok).toBe(true);
      if (!loginResult.ok) return;

      const result = await controller.logout(loginResult.data.refreshToken);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBeNull();
    });

    it('token is deleted from store after logout', async () => {
      const loginResult = await controller.login({
        email: 'alice@example.com',
        password: 'correct-password',
      });
      if (!loginResult.ok) return;
      const { refreshToken } = loginResult.data;

      await controller.logout(refreshToken);

      expect(await mockTokens.findByToken(refreshToken)).toBeNull();
    });

    it('returns 401 Unauthorized when token is undefined', async () => {
      const result = await controller.logout(undefined);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(401);
      expect(result.error).toBe('Unauthorized');
    });

    it('does not throw for an unknown token', async () => {
      const result = await controller.logout('nonexistent-token');
      expect(result.ok).toBe(true);
    });
  });

  // ── refresh ───────────────────────────────────────────────────────────────

  describe('refresh', () => {
    it('returns ok with new accessToken and rotated refreshToken', async () => {
      const loginResult = await controller.login({
        email: 'alice@example.com',
        password: 'correct-password',
      });
      expect(loginResult.ok).toBe(true);
      if (!loginResult.ok) return;
      const oldToken = loginResult.data.refreshToken;

      const result = await controller.refresh(oldToken);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.accessToken).toBeTypeOf('string');
      expect(result.data.refreshToken).not.toBe(oldToken);
    });

    it('old token is invalidated after rotation', async () => {
      const loginResult = await controller.login({
        email: 'alice@example.com',
        password: 'correct-password',
      });
      if (!loginResult.ok) return;
      const oldToken = loginResult.data.refreshToken;

      await controller.refresh(oldToken);

      expect(await mockTokens.findByToken(oldToken)).toBeNull();
    });

    it('returns 401 Unauthorized when token is undefined', async () => {
      const result = await controller.refresh(undefined);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(401);
      expect(result.error).toBe('Unauthorized');
    });

    it('returns 401 Unauthorized for an already-used token', async () => {
      const loginResult = await controller.login({
        email: 'alice@example.com',
        password: 'correct-password',
      });
      if (!loginResult.ok) return;
      const oldToken = loginResult.data.refreshToken;

      await controller.refresh(oldToken);
      const result = await controller.refresh(oldToken);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(401);
    });

    it('returns 401 Unauthorized for an expired token', async () => {
      const pastDate = new Date(Date.now() - 1000);
      await mockTokens.save('user-1', 'expired-token', pastDate);

      const result = await controller.refresh('expired-token');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(401);
    });
  });
});
