import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { D1RefreshTokenRepository } from '@api/adapters/db/d1-refresh-token-repository';
import { sha256Hex } from '@api/adapters/db/hash';

const MIGRATION_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id            TEXT NOT NULL PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS refresh_tokens (
    token      TEXT NOT NULL PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  )`,
];

const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';

describe('D1RefreshTokenRepository', () => {
  let repo: D1RefreshTokenRepository;

  beforeAll(async () => {
    await env.DB.batch(MIGRATION_STATEMENTS.map(sql => env.DB.prepare(sql)));
    await env.DB.batch([
      env.DB
        .prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
        .bind(USER_ID, 'Token User', 'token-user@example.com', 'pbkdf2:100000:aa:bb'),
      env.DB
        .prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
        .bind(OTHER_USER_ID, 'Other User', 'other-user@example.com', 'pbkdf2:100000:cc:dd'),
    ]);
    repo = new D1RefreshTokenRepository(env.DB);
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM refresh_tokens').run();
  });

  it('save + findByToken + delete round-trip with the plain token', async () => {
    const token = 'plain-refresh-token-abc';
    const expiresAt = new Date(Date.now() + 60_000);

    await repo.save(USER_ID, token, expiresAt);

    const found = await repo.findByToken(token);
    expect(found).not.toBeNull();
    expect(found!.userId).toBe(USER_ID);
    expect(found!.expiresAt.toISOString()).toBe(expiresAt.toISOString());

    await repo.delete(token);
    expect(await repo.findByToken(token)).toBeNull();
  });

  it('stores a 64-char hex digest, not the raw token', async () => {
    const token = 'another-plain-token-xyz';
    await repo.save(USER_ID, token, new Date(Date.now() + 60_000));

    const row = await env.DB
      .prepare('SELECT token FROM refresh_tokens WHERE user_id = ?')
      .bind(USER_ID)
      .first<{ token: string }>();

    expect(row).not.toBeNull();
    expect(row!.token).not.toBe(token);
    expect(row!.token).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.token).toBe(await sha256Hex(token));
  });

  it('findByToken returns null when a raw plaintext row bypasses the adapter', async () => {
    const rawToken = 'inserted-without-hashing';
    await env.DB
      .prepare('INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(rawToken, USER_ID, new Date(Date.now() + 60_000).toISOString())
      .run();

    const result = await repo.findByToken(rawToken);
    expect(result).toBeNull();
  });

  it('deleteAllForUser removes every token for that user', async () => {
    await repo.save(USER_ID, 'token-a', new Date(Date.now() + 60_000));
    await repo.save(USER_ID, 'token-b', new Date(Date.now() + 60_000));
    await repo.save(OTHER_USER_ID, 'token-c', new Date(Date.now() + 60_000));

    await repo.deleteAllForUser(USER_ID);

    expect(await repo.findByToken('token-a')).toBeNull();
    expect(await repo.findByToken('token-b')).toBeNull();
    expect(await repo.findByToken('token-c')).not.toBeNull();
  });

  it('deleteAllForUserExcept keeps the specified token and removes the rest', async () => {
    await repo.save(USER_ID, 'keep-token', new Date(Date.now() + 60_000));
    await repo.save(USER_ID, 'remove-token-1', new Date(Date.now() + 60_000));
    await repo.save(USER_ID, 'remove-token-2', new Date(Date.now() + 60_000));
    await repo.save(OTHER_USER_ID, 'other-user-token', new Date(Date.now() + 60_000));

    await repo.deleteAllForUserExcept(USER_ID, 'keep-token');

    expect(await repo.findByToken('keep-token')).not.toBeNull();
    expect(await repo.findByToken('remove-token-1')).toBeNull();
    expect(await repo.findByToken('remove-token-2')).toBeNull();
    expect(await repo.findByToken('other-user-token')).not.toBeNull();
  });
});
