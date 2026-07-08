import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { D1OAuthAccountRepository } from '@api/adapters/db/d1-oauth-account-repository';
import { applyMigrations } from '../helpers/apply-migrations';

const USER_ID_1 = 'oauth-test-user-1';
const USER_ID_2 = 'oauth-test-user-2';
const GOOGLE_SUB_1 = 'google-sub-111';
const GOOGLE_SUB_2 = 'google-sub-222';

describe('D1OAuthAccountRepository', () => {
  let repo: D1OAuthAccountRepository;

  beforeAll(async () => {
    await applyMigrations(env.DB);

    await env.DB.batch([
      env.DB
        .prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash, status) VALUES (?, ?, ?, ?, ?)')
        .bind(USER_ID_1, 'Alice', 'alice@oauth.test', 'pbkdf2:1:aa:bb', 'active'),
      env.DB
        .prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash, status) VALUES (?, ?, ?, ?, ?)')
        .bind(USER_ID_2, 'Bob', 'bob@oauth.test', 'pbkdf2:1:cc:dd', 'active'),
      env.DB
        .prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)')
        .bind(USER_ID_1, 'bf3d0f1d-7d77-5151-922e-b87dff0fa7ad'),
    ]);

    repo = new D1OAuthAccountRepository(env.DB);
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM oauth_accounts').run();
  });

  // ---------------------------------------------------------------------------

  it('findUserByProvider returns null for an unknown provider identity', async () => {
    const user = await repo.findUserByProvider('google', 'unknown-sub');
    expect(user).toBeNull();
  });

  it('link + findUserByProvider round-trip returns the linked user with roles', async () => {
    await repo.link('google', GOOGLE_SUB_1, USER_ID_1, 'alice@gmail.com');

    const user = await repo.findUserByProvider('google', GOOGLE_SUB_1);
    expect(user).not.toBeNull();
    expect(user!.id).toBe(USER_ID_1);
    expect(user!.email).toBe('alice@oauth.test');
    expect(user!.roles.map(r => r.name)).toContain('student');
  });

  it('findByUser returns null when no link exists', async () => {
    const record = await repo.findByUser('google', USER_ID_1);
    expect(record).toBeNull();
  });

  it('link + findByUser round-trip returns the OAuthAccount record', async () => {
    await repo.link('google', GOOGLE_SUB_1, USER_ID_1, 'alice@gmail.com');

    const record = await repo.findByUser('google', USER_ID_1);
    expect(record).not.toBeNull();
    expect(record!.provider).toBe('google');
    expect(record!.providerUserId).toBe(GOOGLE_SUB_1);
    expect(record!.userId).toBe(USER_ID_1);
    expect(record!.email).toBe('alice@gmail.com');
    expect(record!.createdAt).toBeInstanceOf(Date);
  });

  it('link throws on duplicate (provider, providerUserId) — unique PK constraint', async () => {
    await repo.link('google', GOOGLE_SUB_1, USER_ID_1, 'alice@gmail.com');
    await expect(
      repo.link('google', GOOGLE_SUB_1, USER_ID_2, 'alice2@gmail.com'),
    ).rejects.toThrow();
  });

  it('link throws on duplicate (provider, userId) — unique index constraint', async () => {
    await repo.link('google', GOOGLE_SUB_1, USER_ID_1, 'alice@gmail.com');
    await expect(
      repo.link('google', GOOGLE_SUB_2, USER_ID_1, 'alice-alt@gmail.com'),
    ).rejects.toThrow();
  });

  it('findUserByProvider does not return a user linked under a different provider', async () => {
    await repo.link('google', GOOGLE_SUB_1, USER_ID_1, 'alice@gmail.com');

    const user = await repo.findUserByProvider('github', GOOGLE_SUB_1);
    expect(user).toBeNull();
  });

  it('findByUser does not return a record for a different provider', async () => {
    await repo.link('google', GOOGLE_SUB_1, USER_ID_1, 'alice@gmail.com');

    const record = await repo.findByUser('github', USER_ID_1);
    expect(record).toBeNull();
  });
});
