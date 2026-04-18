import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { D1UserRepository } from '../../src/adapters/db/d1-user-repository';
import { Entities } from '@arenaquest/shared/types/entities';

// D1's exec() processes one statement at a time in the local simulator
const MIGRATION_STATEMENTS = [
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
];

describe('D1UserRepository', () => {
  let repo: D1UserRepository;

  beforeAll(async () => {
    await env.DB.batch(MIGRATION_STATEMENTS.map(sql => env.DB.prepare(sql)));
    repo = new D1UserRepository(env.DB);
  });

  it('create + findByEmail round-trip', async () => {
    const created = await repo.create({
      name: 'Alice',
      email: 'alice@example.com',
      passwordHash: 'pbkdf2:100000:aabbcc:ddeeff',
    });

    expect(created.id).toBeTypeOf('string');
    expect(created.email).toBe('alice@example.com');
    expect(created.status).toBe(Entities.Config.UserStatus.ACTIVE);
    expect(created.roles).toEqual([]);

    const record = await repo.findByEmail('alice@example.com');
    expect(record).not.toBeNull();
    expect(record!.id).toBe(created.id);
    expect(record!.name).toBe('Alice');
    expect(record!.passwordHash).toBe('pbkdf2:100000:aabbcc:ddeeff');
  });

  it('findById returns null for unknown id', async () => {
    const result = await repo.findById('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('delete removes the record', async () => {
    const user = await repo.create({
      name: 'Bob',
      email: 'bob@example.com',
      passwordHash: 'pbkdf2:100000:112233:445566',
    });

    await repo.delete(user.id);

    const deleted = await repo.findById(user.id);
    expect(deleted).toBeNull();
  });

  it('findByEmail returns null for unknown email', async () => {
    const result = await repo.findByEmail('nobody@example.com');
    expect(result).toBeNull();
  });

  it('update modifies name and status', async () => {
    const user = await repo.create({
      name: 'Carol',
      email: 'carol@example.com',
      passwordHash: 'pbkdf2:100000:778899:aabbcc',
    });

    const updated = await repo.update(user.id, {
      name: 'Carol Updated',
      status: Entities.Config.UserStatus.INACTIVE,
    });

    expect(updated.name).toBe('Carol Updated');
    expect(updated.status).toBe(Entities.Config.UserStatus.INACTIVE);
  });

  it('list returns paginated users', async () => {
    await repo.create({ name: 'Dave', email: 'dave@example.com', passwordHash: 'hash1' });
    await repo.create({ name: 'Eve', email: 'eve@example.com', passwordHash: 'hash2' });

    const page = await repo.list({ limit: 2, offset: 0 });
    expect(Array.isArray(page)).toBe(true);
    expect(page.length).toBe(2);

    const all = await repo.list({ limit: 100, offset: 0 });
    expect(all.length).toBeGreaterThanOrEqual(2);
  });
});
