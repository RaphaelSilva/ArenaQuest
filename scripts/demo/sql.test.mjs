/**
 * Unit tests for scripts/demo/sql.mjs — the pure dataset → SQL builder.
 * Run with: node --test scripts/demo/sql.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadDataset, renderTopicMarkdown } from './dataset.mjs';
import { readGamificationReference } from './gamification.mjs';
import { demoEmail, demoId } from './ids.mjs';
import { loadSanitizeMarkdown } from './seed-demo.mjs';
import {
  SECTIONS,
  buildSeedSql,
  demoContext,
  link,
  raw,
  sqlValue,
  topicsParentsFirst,
  upsert,
} from './sql.mjs';

const HASH = 'pbkdf2:100000:00000000000000000000000000000000:' + 'a'.repeat(64);
const NOW = new Date('2026-09-29T10:00:00Z');
const GAMIFICATION = readGamificationReference();
const dataset = loadDataset('budo');
const sanitizeMarkdown = await loadSanitizeMarkdown();
const ctx = demoContext({
  label: 'budo',
  passwordHash: HASH,
  sanitizeMarkdown,
  renderMarkdown: (title) => renderTopicMarkdown(title),
  now: NOW,
  gamification: GAMIFICATION,
});
const { sql, statements, summary } = buildSeedSql(dataset, ctx);
const into = (table) => statements.filter((s) => s.startsWith(`INSERT INTO ${table} `));

test('sqlValue quotes strings, doubles quotes, and renders NULL/numbers', () => {
  assert.equal(sqlValue("it's"), "'it''s'");
  assert.equal(sqlValue(null), 'NULL');
  assert.equal(sqlValue(3), '3');
  assert.equal(sqlValue(true), '1');
  assert.throws(() => sqlValue(Number.NaN), TypeError);
  assert.throws(() => sqlValue('a\0b'), TypeError);
  assert.throws(() => sqlValue({}), TypeError);
});

test('upsert updates every non-key column on conflict', () => {
  const s = upsert('tags', { id: 'x', name: "O'Neil", slug: 'o' });
  assert.equal(
    s,
    "INSERT INTO tags (id, name, slug)\nVALUES ('x', 'O''Neil', 'o')\nON CONFLICT(id) DO UPDATE SET name = excluded.name, slug = excluded.slug;",
  );
});

test('upsert with touch moves the timestamp only when a value changed', () => {
  const s = upsert('user_groups', { id: 'g', name: 'n' }, { touch: 'updated_at' });
  assert.match(s, /VALUES \('g', 'n', datetime\('now'\)\)/);
  assert.match(s, /DO UPDATE SET name = excluded\.name, updated_at = datetime\('now'\)\n {2}WHERE user_groups\.name IS NOT excluded\.name;$/);
});

test('link is a composite-key insert that never updates', () => {
  assert.equal(
    link('user_group_members', { group_id: 'g', user_id: raw('(SELECT 1)') }),
    "INSERT INTO user_group_members (group_id, user_id)\nVALUES ('g', (SELECT 1))\nON CONFLICT(group_id, user_id) DO NOTHING;",
  );
});

test('identifiers are never interpolated from data', () => {
  assert.throws(() => upsert('users; DROP TABLE users', { id: 'x' }), TypeError);
  assert.throws(() => upsert('users', { 'id) --': 'x' }), TypeError);
});

test('every statement is an upsert; nothing deletes, updates bare, or opens a transaction', () => {
  assert.ok(statements.length > 0);
  for (const s of statements) {
    assert.match(s, /^INSERT INTO [a-z_]+ /, s.slice(0, 80));
    assert.match(s, /ON CONFLICT\([a-z_, ]+\) DO (UPDATE|NOTHING)/);
  }
  assert.doesNotMatch(sql, /^\s*(DELETE|DROP|BEGIN|COMMIT|UPDATE)\b/im);
});

test('summary counts: 6 users, 6 roles, 1 group, 2 members, 21 topics, 2 tags, 27 media, 2 enrollments, gamification, extensions', () => {
  const counts = Object.fromEntries(summary.map((row) => [row.entity, row.rows]));
  assert.deepEqual(counts, {
    users: 6,
    user_roles: 6,
    user_groups: 1,
    user_group_members: 2,
    tags: 2,
    topic_nodes: 21,
    topic_node_tags: dataset.topics.reduce((n, t) => n + t.tags.length, 0),
    media: Object.values(dataset.media.assign).reduce((n, keys) => n + keys.length, 0),
    enrollments_user: 1,
    enrollments_user_group: 1,
    topic_progress: 3,
    xp_events: 7,
    user_badges: 3,
    user_xp: 2,
    user_streak: 1,
    quest_progress: 1,
    missions: 1,
    events: 3,
    event_audience_group: 1,
    billing_plans: 2,
    subscriptions: 2,
    invoices: 2,
    payments: 1,
    tasks: 1,
    task_stages: 3,
    task_topic_links: 1,
    task_stage_topic_links: 3,
    topic_comments: 2,
    comment_likes: 1,
  });
  for (const [table, rows] of Object.entries(counts)) assert.equal(into(table).length, rows, table);
});

test('users carry the demo id, demo e-mail and the hash — never a clear password', () => {
  const admin = into('users').find((s) => s.includes(demoEmail('budo', 'admin')));
  assert.ok(admin.includes(`'${demoId('budo', 'user', 'admin')}'`));
  assert.ok(admin.includes(`'${HASH}'`));
  assert.ok(admin.includes('password_hash = excluded.password_hash'));
  assert.match(sql, /\(SELECT id FROM roles WHERE name = 'content_creator'\)/);
});

test('topics are written parents first with an explicit sort_order', () => {
  const order = topicsParentsFirst(dataset).map((t) => t.key);
  const seen = new Set();
  for (const key of order) {
    const topic = dataset.topics.find((t) => t.key === key);
    if (topic.parent !== null) assert.ok(seen.has(topic.parent), `${key} before its parent`);
    seen.add(key);
  }
  const topicSql = into('topic_nodes');
  assert.equal(topicSql.length, 21);
  for (const [i, key] of order.entries()) assert.ok(topicSql[i].includes(`'${demoId('budo', 'topic', key)}'`));
  assert.doesNotMatch(sql, /MAX\(sort_order\)/i);
  const draft = topicSql.find((s) => s.includes(`'${demoId('budo', 'topic', 'root-3/module-2')}'`));
  assert.match(draft, /'draft', 'restricted', 1, \d+, 0/);
});

test('topic content is the sample rendered with the title and passed through sanitizeMarkdown', () => {
  const expected = sanitizeMarkdown(renderTopicMarkdown('Lesson 1.1.1'));
  assert.ok(sql.includes(sqlValue(expected)));
  assert.doesNotMatch(sql, /\{\{title\}\}/);
  const hostile = demoContext({
    label: 'budo',
    passwordHash: HASH,
    sanitizeMarkdown,
    renderMarkdown: (title) => `# ${title}\n<script>alert(1)</script>[x](javascript:alert(1))`,
    now: NOW,
    gamification: GAMIFICATION,
  });
  const hostileSql = buildSeedSql(dataset, hostile).sql;
  assert.doesNotMatch(hostileSql, /<script>|javascript:/);
});

test('enrollments: group grant on Root 2, user grant on Root 3, granted by the demo admin', () => {
  const admin = demoId('budo', 'user', 'admin');
  const [group] = into('enrollments_user_group');
  assert.ok(group.includes(`'${demoId('budo', 'topic', 'root-2')}'`));
  assert.ok(group.includes(`'${demoId('budo', 'group', 'demo-class')}'`));
  assert.ok(group.includes(`'${admin}'`));
  const [user] = into('enrollments_user');
  assert.ok(user.includes(`'${demoId('budo', 'topic', 'root-3')}'`));
  assert.ok(user.includes(`'${demoId('budo', 'user', 'student-3')}'`));
  assert.ok(user.includes(`'${admin}'`));
});

test('the build is deterministic for a fixed ctx, and label-scoped', () => {
  assert.equal(buildSeedSql(dataset, ctx).sql, sql);
  const other = demoContext({ label: 'spaziord', passwordHash: HASH, sanitizeMarkdown, renderMarkdown: (t) => t, now: NOW, gamification: GAMIFICATION });
  assert.doesNotMatch(buildSeedSql(loadDataset('spaziord'), other).sql, new RegExp(demoId('budo', 'user', 'admin')));
});

test('sections compose in order and later tasks can append their own', () => {
  assert.deepEqual(SECTIONS.map((s) => s.name), [
    'users',
    'groups',
    'tags',
    'topics',
    'media',
    'enrollments',
    'gamification',
    'events',
    'billing',
    'tasks',
    'comments',
  ]);
  const extra = { name: 'extra', build: () => ({ statements: [link('x_links', { a: 'b' })], counts: { x_links: 1 } }) };
  const out = buildSeedSql(dataset, ctx, [...SECTIONS, extra]);
  assert.ok(out.sql.trimEnd().endsWith("ON CONFLICT(a) DO NOTHING;"));
  assert.deepEqual(out.summary.at(-1), { section: 'extra', entity: 'x_links', rows: 1 });
  assert.throws(() => buildSeedSql(dataset, ctx, [extra, extra]), /duplicate section/);
});

test('demoContext requires a hash and a sanitiser', () => {
  assert.throws(() => demoContext({ label: 'budo', sanitizeMarkdown, renderMarkdown: String }), /passwordHash/);
  assert.throws(() => demoContext({ label: 'budo', passwordHash: HASH, renderMarkdown: String }), /sanitizeMarkdown/);
});
