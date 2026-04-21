import { describe, it, expect, beforeEach } from 'vitest';
import { AuthService } from '@api/core/auth/auth-service';
import { AuthError } from '@api/core/auth/auth-error';
import type { IAuthAdapter, IUserRepository, IRefreshTokenRepository } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';

// ---------------------------------------------------------------------------
// Fixtures
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

// stored hash for the password "correct-password"
const STORED_HASH = 'hashed:correct-password';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

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

describe('AuthService', () => {
  let service: AuthService;
  let mockAuth: IAuthAdapter;
  let mockUsers: IUserRepository;
  let mockTokens: IRefreshTokenRepository;

  beforeEach(() => {
    mockAuth = makeMockAuth();
    mockUsers = makeMockUserRepo();
    mockTokens = makeMockTokenRepo();
    service = new AuthService(mockAuth, mockUsers, mockTokens);
  });

  // ── login ────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('returns LoginResult for valid credentials', async () => {
      const result = await service.login('alice@example.com', 'correct-password');

      expect(result.accessToken).toBe('access.user-1');
      expect(result.refreshToken).toBeTypeOf('string');
      expect(result.user.id).toBe('user-1');
      expect(result.user.email).toBe('alice@example.com');
      expect((result.user as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
    });

    it('stores a refresh token after successful login', async () => {
      const { refreshToken } = await service.login('alice@example.com', 'correct-password');
      const stored = await mockTokens.findByToken(refreshToken);

      expect(stored).not.toBeNull();
      expect(stored!.userId).toBe('user-1');
      expect(stored!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('throws INVALID_CREDENTIALS when email is not found', async () => {
      await expect(
        service.login('unknown@example.com', 'correct-password'),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('throws INVALID_CREDENTIALS when password is wrong', async () => {
      await expect(
        service.login('alice@example.com', 'wrong-password'),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('error for wrong email and wrong password are both AuthError', async () => {
      const errEmail = await service.login('x@x.com', 'p').catch(e => e);
      const errPass = await service.login('alice@example.com', 'bad').catch(e => e);

      expect(errEmail).toBeInstanceOf(AuthError);
      expect(errPass).toBeInstanceOf(AuthError);
    });

    it('throws ACCOUNT_INACTIVE when user is not active', async () => {
      mockUsers = makeMockUserRepo({ status: Entities.Config.UserStatus.INACTIVE });
      service = new AuthService(mockAuth, mockUsers, mockTokens);

      await expect(
        service.login('alice@example.com', 'correct-password'),
      ).rejects.toMatchObject({ code: 'ACCOUNT_INACTIVE' });
    });

    it('keeps missing-email and wrong-password branches within ±20% CPU time (S-03)', async () => {
      // Simulate a real PBKDF2-style verify: both branches must consume a
      // comparable chunk of work before login decides to reject.
      const VERIFY_WORK_MS = 30;
      const timingAuth: IAuthAdapter = {
        hashPassword: async (plain) => `hashed:${plain}`,
        verifyPassword: async (plain, stored) => {
          const end = Date.now() + VERIFY_WORK_MS;
          while (Date.now() < end) { /* busy-wait to emulate PBKDF2 */ }
          return stored === `hashed:${plain}`;
        },
        signAccessToken: async (payload) => `access.${payload.sub}`,
        verifyAccessToken: async () => null,
        generateRefreshToken: async () => 'refresh-token',
      };
      const timingService = new AuthService(timingAuth, makeMockUserRepo(), makeMockTokenRepo());

      const N = 5;
      async function avg(fn: () => Promise<unknown>): Promise<number> {
        // Warm-up — discard the first iteration.
        await fn().catch(() => {});
        let total = 0;
        for (let i = 0; i < N; i++) {
          const start = performance.now();
          await fn().catch(() => {});
          total += performance.now() - start;
        }
        return total / N;
      }

      const missing = await avg(() => timingService.login('unknown@example.com', 'whatever'));
      const wrong = await avg(() => timingService.login('alice@example.com', 'wrong'));

      const delta = Math.abs(missing - wrong) / Math.max(wrong, 1);
      console.info(
        `[timing] missing=${missing.toFixed(2)}ms wrong=${wrong.toFixed(2)}ms delta=${(delta * 100).toFixed(1)}%`,
      );
      expect(delta).toBeLessThan(0.2);
    });
  });

  // ── logout ───────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('deletes the refresh token so findByToken returns null', async () => {
      const { refreshToken } = await service.login('alice@example.com', 'correct-password');

      await service.logout(refreshToken);

      expect(await mockTokens.findByToken(refreshToken)).toBeNull();
    });

    it('does not throw when called with an unknown token', async () => {
      await expect(service.logout('nonexistent-token')).resolves.toBeUndefined();
    });
  });

  // ── refreshTokens ────────────────────────────────────────────────────────

  describe('refreshTokens', () => {
    it('returns new LoginResult with a different refresh token', async () => {
      const { refreshToken: oldToken } = await service.login('alice@example.com', 'correct-password');

      const result = await service.refreshTokens(oldToken);

      expect(result.accessToken).toBe('access.user-1');
      expect(result.refreshToken).not.toBe(oldToken);
      expect(result.user.id).toBe('user-1');
    });

    it('invalidates the old token after rotation', async () => {
      const { refreshToken: oldToken } = await service.login('alice@example.com', 'correct-password');

      await service.refreshTokens(oldToken);

      expect(await mockTokens.findByToken(oldToken)).toBeNull();
    });

    it('stores the new token so it can be used again', async () => {
      const { refreshToken: oldToken } = await service.login('alice@example.com', 'correct-password');

      const { refreshToken: newToken } = await service.refreshTokens(oldToken);

      expect(await mockTokens.findByToken(newToken)).not.toBeNull();
    });

    it('throws INVALID_REFRESH_TOKEN for an unknown token', async () => {
      await expect(
        service.refreshTokens('does-not-exist'),
      ).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    });

    it('throws INVALID_REFRESH_TOKEN for an expired token', async () => {
      const pastDate = new Date(Date.now() - 1000);
      await mockTokens.save('user-1', 'expired-token', pastDate);

      await expect(
        service.refreshTokens('expired-token'),
      ).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    });
  });
});
