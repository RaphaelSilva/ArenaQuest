import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applyMigrations, parseStatements } from '../helpers/apply-migrations';

/**
 * Migration 0027 carries Milestone 20's security posture in the schema rather
 * than in application code, so every test here asserts the *database* enforces
 * it. Without `PRAGMA foreign_keys = ON` the cascade tests would pass vacuously:
 * foreign keys are off by default in the Miniflare D1.
 */

const MIGRATION_0027 = Object.values(
  import.meta.glob<string>('../../migrations/0027_*.sql', {
    eager: true,
    query: '?raw',
    import: 'default',
  }),
)[0];

describe('events schema constraints (migration 0027)', () => {
  let adminId: string;

  beforeAll(async () => {
    await applyMigrations(env.DB);
    await env.DB.exec('PRAGMA foreign_keys = ON');
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM events').run();
    adminId = crypto.randomUUID();
    await env.DB
      .prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .bind(adminId, 'Admin', `a-${adminId}@example.com`, 'hash')
      .run();
  });

  function insertMinimalEvent(id: string, slug: string): Promise<D1Result> {
    return env.DB
      .prepare(
        `INSERT INTO events (id, slug, title, starts_at, created_by)
         VALUES (?, ?, 'Some event', '2030-01-01 19:00:00', ?)`,
      )
      .bind(id, slug, adminId)
      .run();
  }

  it('applies a second time without error: the migration is idempotent', async () => {
    const statements = parseStatements(MIGRATION_0027);
    expect(statements.length).toBeGreaterThan(0);
    await env.DB.batch(statements.map(sql => env.DB.prepare(sql)));

    const tables = await env.DB
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type = 'table'
            AND name IN ('events','event_audience_group','event_audience_user')
          ORDER BY name`,
      )
      .all<{ name: string }>();

    expect(tables.results.map(r => r.name)).toEqual([
      'event_audience_group',
      'event_audience_user',
      'events',
    ]);
  });

  it('creates the listing and reverse-lookup indexes', async () => {
    const { results } = await env.DB
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_event%' ORDER BY name`,
      )
      .all<{ name: string }>();

    expect(results.map(r => r.name)).toEqual([
      'idx_event_audience_group_group',
      'idx_event_audience_user_user',
      'idx_events_listing',
    ]);
  });

  // -------------------------------------------------------------------------
  // The two defaults that decide who a mistake is visible to
  // -------------------------------------------------------------------------

  it('defaults status to draft and audience to members when neither is given', async () => {
    const id = crypto.randomUUID();
    await insertMinimalEvent(id, 'defaults-check');

    const row = await env.DB
      .prepare('SELECT status, audience, flyer_status, timezone FROM events WHERE id = ?')
      .bind(id)
      .first<{ status: string; audience: string; flyer_status: string; timezone: string }>();

    // A forgotten column must lose readers, never publish a private event.
    expect(row?.status).toBe('draft');
    expect(row?.audience).toBe('members');
    expect(row?.flyer_status).toBe('none');
    expect(row?.timezone).toBe('America/Sao_Paulo');
  });

  it('rejects a status outside the allowed set', async () => {
    await expect(
      env.DB
        .prepare(
          `INSERT INTO events (id, slug, title, starts_at, status, created_by)
           VALUES (?, 'bad-status', 'X', '2030-01-01 19:00:00', 'live', ?)`,
        )
        .bind(crypto.randomUUID(), adminId)
        .run(),
    ).rejects.toThrow();
  });

  it('rejects an audience outside the allowed set', async () => {
    await expect(
      env.DB
        .prepare(
          `INSERT INTO events (id, slug, title, starts_at, audience, created_by)
           VALUES (?, 'bad-audience', 'X', '2030-01-01 19:00:00', 'everyone', ?)`,
        )
        .bind(crypto.randomUUID(), adminId)
        .run(),
    ).rejects.toThrow();
  });

  it('rejects a flyer status outside the allowed set', async () => {
    await expect(
      env.DB
        .prepare(
          `INSERT INTO events (id, slug, title, starts_at, flyer_status, created_by)
           VALUES (?, 'bad-flyer', 'X', '2030-01-01 19:00:00', 'uploaded', ?)`,
        )
        .bind(crypto.randomUUID(), adminId)
        .run(),
    ).rejects.toThrow();
  });

  it('rejects a duplicate slug', async () => {
    await insertMinimalEvent(crypto.randomUUID(), 'taken');
    await expect(insertMinimalEvent(crypto.randomUUID(), 'taken')).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Referential behaviour
  // -------------------------------------------------------------------------

  it('refuses to delete the user who created an event (ON DELETE RESTRICT)', async () => {
    await insertMinimalEvent(crypto.randomUUID(), 'restrict-creator');

    await expect(
      env.DB.prepare('DELETE FROM users WHERE id = ?').bind(adminId).run(),
    ).rejects.toThrow();
  });

  it('cascades grant rows when the event is deleted', async () => {
    const eventId = crypto.randomUUID();
    const groupId = crypto.randomUUID();
    await insertMinimalEvent(eventId, 'cascade-event');
    await env.DB
      .prepare('INSERT INTO user_groups (id, name) VALUES (?, ?)')
      .bind(groupId, `grp-${groupId}`)
      .run();
    await env.DB
      .prepare('INSERT INTO event_audience_group (event_id, group_id) VALUES (?, ?)')
      .bind(eventId, groupId)
      .run();

    await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(eventId).run();

    const remaining = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM event_audience_group WHERE event_id = ?')
      .bind(eventId)
      .first<{ n: number }>();
    expect(remaining?.n).toBe(0);
  });
});
