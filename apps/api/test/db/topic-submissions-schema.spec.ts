import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, parseStatements } from '../helpers/apply-migrations';

/**
 * Migration 0030 (RFC 0020 §1). Foreign keys are off by default in the
 * Miniflare D1, so the FK tests switch them on — otherwise they pass vacuously.
 */
const MIGRATION_0030 = Object.values(
  import.meta.glob('../../migrations/0030_*.sql', {
    eager: true,
    query: '?raw',
    import: 'default',
  }),
)[0] as string;

async function user(name = 'U'): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB
    .prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .bind(id, name, `${id}@test.local`, 'hash')
    .run();
  return id;
}

async function topic(): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO topic_nodes (id, title) VALUES (?, 'T')").bind(id).run();
  return id;
}

function insert(
  id: string,
  topicId: string,
  authorId: string,
  extra: { status?: string; visibility?: string } = {},
): Promise<D1Result> {
  return env.DB
    .prepare(
      `INSERT INTO topic_submissions
         (id, topic_node_id, author_id, title, storage_key, original_name, content_type, size_bytes, status, visibility)
       VALUES (?, ?, ?, 'x', ?, 'x.mp4', 'video/mp4', 1, ?, ?)`,
    )
    .bind(id, topicId, authorId, `submissions/${authorId}/${id}`, extra.status ?? 'pending', extra.visibility ?? 'private')
    .run();
}

describe('topic_submissions schema (migration 0030)', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
    await env.DB.exec('PRAGMA foreign_keys = ON');
  });

  it('creates the table and its three indexes', async () => {
    const { results } = await env.DB
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE tbl_name = 'topic_submissions' AND type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'
          ORDER BY name`,
      )
      .all<{ name: string }>();
    expect(results.map(r => r.name)).toEqual([
      'idx_topic_submissions_author',
      'idx_topic_submissions_sweep',
      'idx_topic_submissions_topic',
      'topic_submissions',
    ]);
  });

  it('re-applies over a replica that already holds data, keeping the rows', async () => {
    const author = await user();
    const t = await topic();
    const id = crypto.randomUUID();
    await insert(id, t, author);

    const statements = parseStatements(MIGRATION_0030);
    expect(statements.length).toBe(4);
    await env.DB.batch(statements.map(sql => env.DB.prepare(sql)));

    const row = await env.DB.prepare('SELECT id FROM topic_submissions WHERE id = ?').bind(id).first();
    expect(row).not.toBeNull();
  });

  it('defaults a new row to pending, private, empty description', async () => {
    const author = await user();
    const t = await topic();
    const id = crypto.randomUUID();
    await env.DB
      .prepare(
        `INSERT INTO topic_submissions (id, topic_node_id, author_id, title, original_name, content_type, size_bytes)
         VALUES (?, ?, ?, 'x', 'x.pdf', 'application/pdf', 1)`,
      )
      .bind(id, t, author)
      .run();
    const row = await env.DB
      .prepare('SELECT status, visibility, description, created_at FROM topic_submissions WHERE id = ?')
      .bind(id)
      .first<{ status: string; visibility: string; description: string; created_at: string }>();
    expect(row).toMatchObject({ status: 'pending', visibility: 'private', description: '' });
    expect(row!.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('rejects an unknown status or visibility (CHECK)', async () => {
    const author = await user();
    const t = await topic();
    await expect(insert(crypto.randomUUID(), t, author, { status: 'deleted' })).rejects.toThrow();
    await expect(insert(crypto.randomUUID(), t, author, { visibility: 'public' })).rejects.toThrow();
  });

  it('allows many NULL storage keys but no duplicate key', async () => {
    const author = await user();
    const t = await topic();
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await insert(a, t, author);
    await insert(b, t, author);
    await env.DB.prepare('UPDATE topic_submissions SET storage_key = NULL WHERE id IN (?, ?)').bind(a, b).run();
    const dup = env.DB
      .prepare(
        `INSERT INTO topic_submissions (id, topic_node_id, author_id, title, storage_key, original_name, content_type, size_bytes)
         SELECT ?, topic_node_id, author_id, title, 'dup-key', original_name, content_type, size_bytes FROM topic_submissions WHERE id = ?`,
      );
    await dup.bind(crypto.randomUUID(), a).run();
    await expect(dup.bind(crypto.randomUUID(), a).run()).rejects.toThrow();
  });

  it('deleting a staff user nulls moderated_by / removed_by instead of failing', async () => {
    const author = await user();
    const staff = await user('Staff');
    const t = await topic();
    const id = crypto.randomUUID();
    await insert(id, t, author, { status: 'removed' });
    await env.DB
      .prepare(
        `UPDATE topic_submissions
            SET moderated_by = ?1, moderated_at = datetime('now'), removed_by = ?1, removed_at = datetime('now')
          WHERE id = ?2`,
      )
      .bind(staff, id)
      .run();

    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(staff).run();

    const row = await env.DB
      .prepare('SELECT moderated_by, removed_by, moderated_at, removed_at FROM topic_submissions WHERE id = ?')
      .bind(id)
      .first<Record<string, string | null>>();
    expect(row!.moderated_by).toBeNull();
    expect(row!.removed_by).toBeNull();
    expect(row!.moderated_at).not.toBeNull();
    expect(row!.removed_at).not.toBeNull();
  });

  it('cascades the row when its author or topic is deleted', async () => {
    const author = await user();
    const t1 = await topic();
    const t2 = await topic();
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await insert(a, t1, author);
    await insert(b, t2, (await user()));

    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(author).run();
    await env.DB.prepare('DELETE FROM topic_nodes WHERE id = ?').bind(t2).run();

    const { results } = await env.DB
      .prepare('SELECT id FROM topic_submissions WHERE id IN (?, ?)')
      .bind(a, b)
      .all();
    expect(results).toHaveLength(0);
  });
});
