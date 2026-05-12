import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { D1PasswordResetTokenRepository } from '@api/adapters/db/d1-password-reset-token-repository';

const MIGRATION_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id            TEXT    NOT NULL PRIMARY KEY,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'active',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_hash   TEXT    NOT NULL PRIMARY KEY,
    user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at   INTEGER NOT NULL,
    consumed_at  INTEGER,
    created_at   INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
    ON password_reset_tokens (user_id)`,
];

const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_USER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('D1PasswordResetTokenRepository', () => {
  let repo: D1PasswordResetTokenRepository;

  beforeAll(async () => {
    await env.DB.batch(MIGRATION_STATEMENTS.map(sql => env.DB.prepare(sql)));
    await env.DB.batch([
      env.DB
        .prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
        .bind(USER_ID, 'Reset User', 'reset@example.com', 'pbkdf2:100000:aa:bb'),
      env.DB
        .prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
        .bind(OTHER_USER_ID, 'Other User', 'other@example.com', 'pbkdf2:100000:cc:dd'),
    ]);
    repo = new D1PasswordResetTokenRepository(env.DB);
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM password_reset_tokens').run();
  });

  it('create + consumeByPlainToken round-trip', async () => {
    const token = 'valid-reset-token-abc123';
    const expiresAt = new Date(Date.now() + 60_000);

    await repo.create({ plainToken: token, userId: USER_ID, expiresAt });

    const result = await repo.consumeByPlainToken(token);
    expect(result.outcome).toBe('consumed');
    if (result.outcome === 'consumed') {
      expect(result.userId).toBe(USER_ID);
    }
  });

  it('stores a hash — the plaintext token is not in the DB', async () => {
    const token = 'my-secret-reset-token';
    await repo.create({ plainToken: token, userId: USER_ID, expiresAt: new Date(Date.now() + 60_000) });

    const row = await env.DB
      .prepare('SELECT token_hash FROM password_reset_tokens WHERE user_id = ?')
      .bind(USER_ID)
      .first<{ token_hash: string }>();

    expect(row).not.toBeNull();
    expect(row!.token_hash).not.toBe(token);
    expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns invalid for an unknown token', async () => {
    const result = await repo.consumeByPlainToken('does-not-exist');
    expect(result.outcome).toBe('invalid');
  });

  it('returns expired for a token past its TTL', async () => {
    const token = 'expired-token';
    const expiresAt = new Date(Date.now() - 1_000); // already expired
    await repo.create({ plainToken: token, userId: USER_ID, expiresAt });

    const result = await repo.consumeByPlainToken(token);
    expect(result.outcome).toBe('expired');
  });

  it('returns already_used when consuming a token a second time', async () => {
    const token = 'double-consume-token';
    await repo.create({ plainToken: token, userId: USER_ID, expiresAt: new Date(Date.now() + 60_000) });

    const first = await repo.consumeByPlainToken(token);
    expect(first.outcome).toBe('consumed');

    const second = await repo.consumeByPlainToken(token);
    expect(second.outcome).toBe('already_used');
  });

  it('concurrent double-consume: only one request succeeds', async () => {
    const token = 'concurrent-token';
    await repo.create({ plainToken: token, userId: USER_ID, expiresAt: new Date(Date.now() + 60_000) });

    const [r1, r2] = await Promise.all([
      repo.consumeByPlainToken(token),
      repo.consumeByPlainToken(token),
    ]);

    const outcomes = [r1.outcome, r2.outcome].sort();
    expect(outcomes).toEqual(['already_used', 'consumed']);
  });

  it('invalidateAllForUser removes only unconsumed tokens for that user', async () => {
    const tokenA = 'token-a-user1';
    const tokenB = 'token-b-user1';
    const tokenC = 'token-c-user2';

    await repo.create({ plainToken: tokenA, userId: USER_ID, expiresAt: new Date(Date.now() + 60_000) });
    await repo.create({ plainToken: tokenB, userId: USER_ID, expiresAt: new Date(Date.now() + 60_000) });
    await repo.create({ plainToken: tokenC, userId: OTHER_USER_ID, expiresAt: new Date(Date.now() + 60_000) });

    // Consume tokenA before invalidating — it should not be deleted
    await repo.consumeByPlainToken(tokenA);

    await repo.invalidateAllForUser(USER_ID);

    // tokenB (unconsumed for USER_ID) is gone
    const result = await repo.consumeByPlainToken(tokenB);
    expect(result.outcome).toBe('invalid');

    // tokenC (OTHER_USER_ID) survives
    const otherResult = await repo.consumeByPlainToken(tokenC);
    expect(otherResult.outcome).toBe('consumed');
  });

  it('purgeExpired removes only expired rows', async () => {
    const fresh = 'fresh-token';
    const stale = 'stale-token';
    await repo.create({ plainToken: fresh, userId: USER_ID, expiresAt: new Date(Date.now() + 60_000) });
    await repo.create({ plainToken: stale, userId: USER_ID, expiresAt: new Date(Date.now() - 1_000) });

    await repo.purgeExpired(new Date());

    expect((await repo.consumeByPlainToken(stale)).outcome).toBe('invalid');
    expect((await repo.consumeByPlainToken(fresh)).outcome).toBe('consumed');
  });
});
