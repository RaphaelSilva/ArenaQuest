import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { D1OAuthAccountRepository } from '@api/adapters/db/d1-oauth-account-repository';

const MIGRATION_SQL = [
  `CREATE TABLE IF NOT EXISTS users (
    id            TEXT NOT NULL PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS roles (
    id          TEXT NOT NULL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_accounts (
    provider         TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email            TEXT NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (provider, provider_user_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_accounts_provider_user
     ON oauth_accounts (provider, user_id)`,
];

const USER_ID_1 = 'oauth-test-user-1';
const USER_ID_2 = 'oauth-test-user-2';
const GOOGLE_SUB_1 = 'google-sub-111';
const GOOGLE_SUB_2 = 'google-sub-222';

describe('D1OAuthAccountRepository', () => {
  let repo: D1OAuthAccountRepository;

  beforeAll(async () => {
    await env.DB.batch(MIGRATION_SQL.map(sql => env.DB.prepare(sql)));

    await env.DB.batch([
      env.DB
        .prepare("INSERT OR IGNORE INTO roles (id, name, description) VALUES ('role-student', 'student', 'Student')")
        .bind(),
      env.DB
        .prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash, status) VALUES (?, ?, ?, ?, ?)')
        .bind(USER_ID_1, 'Alice', 'alice@oauth.test', 'pbkdf2:1:aa:bb', 'active'),
      env.DB
        .prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash, status) VALUES (?, ?, ?, ?, ?)')
        .bind(USER_ID_2, 'Bob', 'bob@oauth.test', 'pbkdf2:1:cc:dd', 'active'),
      env.DB
        .prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)')
        .bind(USER_ID_1, 'role-student'),
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
