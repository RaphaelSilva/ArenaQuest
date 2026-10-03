import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, parseStatements } from '../helpers/apply-migrations';
import { insertEvent, insertMission, insertRequirement, insertTopic, insertUser } from './mission-fixtures';

/**
 * Migration 0031 (RFC 0022 §1): columns, defaults, table checks, unique keys and
 * partial indexes, and the guarantee that it touches no table but its own.
 */
const MIGRATION_0031 = Object.values(
  import.meta.glob('../../migrations/0031_*.sql', {
    eager: true,
    query: '?raw',
    import: 'default',
  }),
)[0] as string;

const NEW_TABLES = [
  'mission_audience_group',
  'mission_audience_user',
  'mission_enrollments',
  'mission_evidence',
  'mission_requirement_progress',
  'mission_requirements',
];

describe('mission requirements schema (migration 0031)', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  it('creates the six tables and their indexes', async () => {
    const { results } = await env.DB
      .prepare(
        `SELECT type, name FROM sqlite_master
          WHERE tbl_name IN (${NEW_TABLES.map(() => '?').join(', ')})
            AND type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'
          ORDER BY type, name`,
      )
      .bind(...NEW_TABLES)
      .all<{ type: string; name: string }>();
    expect(results.filter(r => r.type === 'table').map(r => r.name)).toEqual(NEW_TABLES);
    expect(results.filter(r => r.type === 'index').map(r => r.name)).toEqual([
      'idx_mission_audience_group_group',
      'idx_mission_audience_user_user',
      'idx_mission_enrollments_user',
      'idx_mission_requirement_progress_user',
      'idx_mission_requirements_event',
      'idx_mission_requirements_topic',
    ]);
  });

  it('makes the target and enrollment indexes partial', async () => {
    const { results } = await env.DB
      .prepare(
        `SELECT name, sql FROM sqlite_master
          WHERE name IN ('idx_mission_requirements_topic', 'idx_mission_requirements_event', 'idx_mission_enrollments_user')
          ORDER BY name`,
      )
      .all<{ name: string; sql: string }>();
    expect(results.map(r => /WHERE/.test(r.sql))).toEqual([true, true, true]);
  });

  it('reads an existing missions row back with mode parallel and enrollment_mode auto', async () => {
    const id = crypto.randomUUID();
    // The M7 insert shape: no mode / enrollment_mode columns.
    await env.DB
      .prepare(
        `INSERT INTO missions (id, title, start_at, end_at, predicate_kind)
         VALUES (?, 'Legacy', '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', 'complete_topics')`,
      )
      .bind(id)
      .run();
    const row = await env.DB
      .prepare('SELECT mode, enrollment_mode FROM missions WHERE id = ?')
      .bind(id)
      .first<{ mode: string; enrollment_mode: string }>();
    expect(row).toEqual({ mode: 'parallel', enrollment_mode: 'auto' });
  });

  it('rejects an unknown mode or enrollment_mode', async () => {
    await expect(insertMission({ mode: 'random' as never })).rejects.toThrow(/CHECK/i);
    await expect(insertMission({ enrollmentMode: 'invite' as never })).rejects.toThrow(/CHECK/i);
  });

  it('rejects a manual_check requirement with a topic_node_id', async () => {
    const mission = await insertMission();
    const topic = await insertTopic();
    await expect(insertRequirement(mission, 1, 'manual_check', { topicId: topic })).rejects.toThrow(/CHECK/i);
  });

  it('rejects a video_watched requirement without a topic_node_id', async () => {
    const mission = await insertMission();
    await expect(insertRequirement(mission, 1, 'video_watched')).rejects.toThrow(/CHECK/i);
  });

  it('rejects an event_participation requirement carrying a topic, and accepts a well-paired one', async () => {
    const mission = await insertMission();
    const topic = await insertTopic();
    const admin = await insertUser();
    const event = await insertEvent('2026-05-10 19:00:00', admin);
    await expect(
      insertRequirement(mission, 1, 'event_participation', { eventId: event, topicId: topic }),
    ).rejects.toThrow(/CHECK/i);
    await expect(insertRequirement(mission, 1, 'event_participation', { eventId: event })).resolves.toBeTypeOf('string');
  });

  it('rejects an unknown kind and a position below 1', async () => {
    const mission = await insertMission();
    await expect(insertRequirement(mission, 1, 'quiz_passed')).rejects.toThrow(/CHECK/i);
    await expect(insertRequirement(mission, 0, 'manual_check')).rejects.toThrow(/CHECK/i);
  });

  it('rejects a duplicate (mission_id, position)', async () => {
    const mission = await insertMission();
    await insertRequirement(mission, 1, 'manual_check');
    await expect(insertRequirement(mission, 1, 'manual_check')).rejects.toThrow(/UNIQUE/i);
  });

  it('rejects an out-of-range completed_by, enrollment source and evidence source', async () => {
    const mission = await insertMission();
    const req = await insertRequirement(mission, 1, 'manual_check');
    const user = await insertUser();
    await expect(
      env.DB
        .prepare(
          `INSERT INTO mission_requirement_progress (requirement_id, user_id, mission_id, target_count, completed_by)
           VALUES (?, ?, ?, 1, 'cron')`,
        )
        .bind(req, user, mission)
        .run(),
    ).rejects.toThrow(/CHECK/i);
    await expect(
      env.DB
        .prepare(`INSERT INTO mission_enrollments (mission_id, user_id, source, counts_from) VALUES (?, ?, 'invite', 'x')`)
        .bind(mission, user)
        .run(),
    ).rejects.toThrow(/CHECK/i);
    await expect(
      env.DB
        .prepare(
          `INSERT INTO mission_evidence (requirement_id, user_id, ref_id, occurred_at, source)
           VALUES (?, ?, 'r', '2026-05-01 10:00:00', 'cron')`,
        )
        .bind(req, user)
        .run(),
    ).rejects.toThrow(/CHECK/i);
  });

  it('issues statements only on missions and the six new tables', () => {
    const statements = parseStatements(MIGRATION_0031);
    expect(statements.length).toBe(14);

    const allowed = new Set(['missions', ...NEW_TABLES]);
    for (const statement of statements) {
      const target =
        /^ALTER TABLE (\w+)/i.exec(statement)?.[1] ??
        /^CREATE TABLE IF NOT EXISTS (\w+)/i.exec(statement)?.[1] ??
        /^CREATE INDEX IF NOT EXISTS \w+\s+ON (\w+)/i.exec(statement)?.[1];
      expect(target, statement).toBeDefined();
      expect(allowed.has(target as string), statement).toBe(true);
    }
    // ALTER is only ever an ADD COLUMN on missions; nothing inserts, updates, deletes or drops.
    expect(statements.filter(s => /^ALTER/i.test(s)).every(s => /^ALTER TABLE missions ADD COLUMN/i.test(s))).toBe(true);
    expect(statements.some(s => /^(INSERT|UPDATE|DELETE|DROP|REPLACE)\b/i.test(s))).toBe(false);
    // The forbidden tables only ever appear as a foreign-key target.
    for (const forbidden of ['topic_progress', 'topic_submissions', 'tasks', 'quest_', 'xp_events', 'user_badges']) {
      expect(MIGRATION_0031.includes(forbidden), forbidden).toBe(false);
    }
  });
});
