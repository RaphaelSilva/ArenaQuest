/**
 * Unit tests for scripts/demo/gamification.mjs — the demo's gamification rows,
 * their parity with the engine, and the post-run user_xp assertion.
 * No wrangler, no network.
 * Run with: node --test scripts/demo/gamification.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadDataset } from './dataset.mjs';
import {
  BADGE_RULE_KINDS,
  REQUIREMENTS_PREDICATE_KIND,
  SOURCE_KIND,
  XP_KEY_VERSION,
  badgesDue,
  buildGamification,
  checkXpConsistency,
  isoWeekKey,
  questPeriodKey,
  readGamificationReference,
  sqliteDateTime,
  xpConsistencyQuery,
  xpIdempotencyKey,
} from './gamification.mjs';
import { demoId } from './ids.mjs';
import { assertXpConsistency, parseD1Json, wranglerQueryCommand } from './seed-demo.mjs';
import { gamificationSection } from './sql.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const read = (relPath) => readFileSync(join(ROOT, relPath), 'utf8');

const NOW = new Date('2026-09-29T10:00:00Z'); // a Tuesday, ISO week 40
const reference = readGamificationReference();
const dataset = loadDataset('budo');
const ctx = { label: 'budo', id: (entity, key) => demoId('budo', entity, key), now: NOW, gamification: reference };
const { rows, totals } = buildGamification(dataset, ctx);

const uid = (key) => demoId('budo', 'user', key);
const tid = (key) => demoId('budo', 'topic', key);
const forUser = (list, key) => list.filter((row) => row.user_id === uid(key));

// ── Level curve (migration 0017), read from the file, never copied ─────────────
const levels = [...read('apps/api/migrations/0017_seed_level_definitions.sql').matchAll(/\(\s*(\d+),\s*'[^']*',\s*(\d+),/g)].map(
  (m) => ({ level: Number(m[1]), minXp: Number(m[2]) }),
);
const levelOf = (xp) => levels.filter((row) => row.minXp <= xp).at(-1).level;

test('reference comes from the files that own the rules', () => {
  assert.equal(reference.topicCompleteXp, 100);
  assert.deepEqual(reference.badges['alicerce-solido'], {
    id: 'badge-alicerce-solido',
    xpReward: 250,
    ruleKind: 'topic_completed',
    ruleParams: { count: 1 },
  });
  assert.deepEqual(reference.badges['levantador-bronze'], {
    id: 'badge-levantador-bronze',
    xpReward: 300,
    ruleKind: 'total_xp',
    ruleParams: { min_xp: 500 },
  });
  assert.equal(reference.badges['tecnica-afiada'].id, 'badge-tecnica-afiada');
  assert.equal(Object.keys(reference.badges).length, 8);
  assert.deepEqual(reference.quests['weekly-topic'], { kind: 'weekly', target: 2 });
  assert.deepEqual(reference.quests['daily-topic'], { kind: 'daily', target: 1 });
  assert.deepEqual(reference.requirementLimits, { stepsMax: 20, titleMax: 120, minCountMax: 50, instructionsMax: 500 });
});

test('totals: student-1 350 (level 3), student-2 950 (level 4, one lesson from 5), student-3 0', () => {
  assert.deepEqual(totals, { 'student-1': 350, 'student-2': 950, 'student-3': 0 });
  assert.equal(levelOf(350), 3);
  assert.equal(levelOf(950), 4);
  assert.equal(levelOf(950 + reference.topicCompleteXp), 5);
  for (const state of dataset.gamification.students) assert.equal(totals[state.user], state.expectedTotalXp);
  // The read-model rows equal the ledger they sit next to; student-3 has neither.
  for (const row of rows.user_xp) {
    const ledger = rows.xp_events.filter((event) => event.user_id === row.user_id).reduce((sum, event) => sum + event.points, 0);
    assert.equal(row.total_xp, ledger);
  }
  assert.deepEqual(rows.user_xp.map((row) => row.user_id), [uid('student-1'), uid('student-2')]);
  for (const table of Object.keys(rows)) {
    if (table !== 'missions') assert.equal(forUser(rows[table], 'student-3').length, 0, table);
  }
});

test('student-1: one Root 1 lesson, badge alicerce-solido, 3-day streak, weekly-topic 1/2', () => {
  const [progress] = forUser(rows.topic_progress, 'student-1');
  assert.equal(progress.topic_node_id, tid('root-1/module-1/lesson-1'));
  assert.equal(progress.status, 'completed');
  assert.deepEqual(
    forUser(rows.xp_events, 'student-1').map((e) => [e.source_kind, e.points]),
    [
      ['topic', 100],
      ['badge_award', 250],
    ],
  );
  assert.deepEqual(forUser(rows.user_badges, 'student-1').map((b) => b.badge_id), ['badge-alicerce-solido']);
  assert.deepEqual(forUser(rows.user_streak, 'student-1'), [
    { user_id: uid('student-1'), current_streak: 3, longest_streak: 3, last_activity_date: '2026-09-28' },
  ]);
  assert.deepEqual(forUser(rows.quest_progress, 'student-1'), [
    {
      user_id: uid('student-1'),
      quest_id: 'weekly-topic',
      period_key: '2026-W40',
      current_value: 1,
      target_value: 2,
      completed: 0,
      completed_at: null,
    },
  ]);
});

test('student-2: two Root 2 lessons, alicerce-solido + levantador-bronze and one admin adjustment by the demo admin', () => {
  assert.deepEqual(
    forUser(rows.topic_progress, 'student-2').map((p) => p.topic_node_id),
    [tid('root-2/module-1/lesson-1'), tid('root-2/module-1/lesson-2')],
  );
  const adjustment = forUser(rows.xp_events, 'student-2').filter((e) => e.source_kind === 'admin_adjustment');
  assert.equal(adjustment.length, 1);
  assert.equal(adjustment[0].points, 200);
  assert.deepEqual(forUser(rows.user_badges, 'student-2').map((b) => b.badge_id), ['badge-alicerce-solido', 'badge-levantador-bronze']);
  assert.deepEqual(
    forUser(rows.xp_events, 'student-2').map((e) => [e.source_kind, e.points]),
    [
      ['topic', 100],
      ['topic', 100],
      ['badge_award', 250],
      ['badge_award', 300],
      ['admin_adjustment', 200],
    ],
  );
  assert.equal(adjustment[0].source_id, uid('admin'));
  assert.equal(adjustment[0].idempotency_key, `admin_adjustment:${demoId('budo', 'xp-adjustment', 'student-2#0')}:v1`);
  assert.equal(forUser(rows.user_streak, 'student-2').length, 0);
});

test('idempotency keys are the engine shape <kind>:<sourceId>:v1 and unique per user', () => {
  assert.equal(xpIdempotencyKey('topic', 'abc'), 'topic:abc:v1');
  for (const event of rows.xp_events) {
    if (event.source_kind === SOURCE_KIND.adminAdjustment) {
      assert.match(event.idempotency_key, /^admin_adjustment:[0-9a-f-]{36}:v1$/);
    } else {
      assert.equal(event.idempotency_key, `${event.source_kind}:${event.source_id}:${XP_KEY_VERSION}`);
    }
  }
  assert.ok(rows.xp_events.some((e) => e.idempotency_key === `topic:${tid('root-1/module-1/lesson-1')}:v1`));
  assert.ok(rows.xp_events.some((e) => e.idempotency_key === 'badge_award:badge-alicerce-solido:v1'));
  const keys = rows.xp_events.map((e) => `${e.user_id}|${e.source_kind}|${e.idempotency_key}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('source kinds and the key template match what the engine writes (read from its source)', () => {
  const xpEngine = read('packages/shared/domain/gamification/xp-engine.ts');
  assert.ok(xpEngine.includes("version = 'v1'"), 'xp-engine default version');
  assert.ok(xpEngine.includes('`${sourceKind}:${sourceId ?? \'none\'}:${version}`'), 'xp-engine key template');
  assert.equal(XP_KEY_VERSION, 'v1');

  const progress = read('apps/api/src/routes/me/progress.ts');
  const topicKind = progress.match(/action:\s*'topic_complete',\s*sourceKind:\s*'([a-z_]+)',\s*sourceId:\s*topicId/)?.[1];
  assert.equal(SOURCE_KIND.topic, topicKind);

  const badgeEngine = read('packages/shared/domain/gamification/badge-engine.ts');
  const badgeKind = badgeEngine.match(/action:\s*'badge_award',\s*sourceKind:\s*'([a-z_]+)',\s*sourceId:\s*badge\.id/)?.[1];
  assert.equal(SOURCE_KIND.badge, badgeKind);

  const admin = read('apps/api/src/controllers/admin-progression.controller.ts');
  const adminKind = admin.match(/sourceKind:\s*'([a-z_]+)',\s*sourceId:\s*adminId/)?.[1];
  assert.equal(SOURCE_KIND.adminAdjustment, adminKind);
});

test('isoWeekKey matches the quest evaluator (transpiled from its source) across year edges', async () => {
  const source = read('packages/shared/domain/gamification/quest-evaluator.ts');
  const fn = source.match(/function isoWeekKey\([\s\S]*?\n\}\n/)?.[0];
  assert.ok(fn, 'quest-evaluator.ts no longer defines isoWeekKey');
  const ts = createRequire(join(ROOT, 'packages', 'shared', 'package.json'))('typescript');
  const { outputText } = ts.transpileModule(`export ${fn}`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const engine = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

  assert.equal(isoWeekKey(NOW), '2026-W40');
  assert.equal(isoWeekKey(new Date('2021-01-01T00:00:00Z')), '2020-W53');
  assert.equal(isoWeekKey(new Date('2024-12-30T23:59:59Z')), '2025-W01');
  for (let t = Date.UTC(2019, 11, 20); t < Date.UTC(2027, 0, 20); t += 86_400_000 * 3 + 3_600_000) {
    const date = new Date(t);
    assert.equal(isoWeekKey(date), engine.isoWeekKey(date), date.toISOString());
  }
  assert.equal(questPeriodKey('daily', NOW), '2026-09-29');
  assert.equal(questPeriodKey('weekly', NOW), '2026-W40');
  assert.throws(() => questPeriodKey('monthly', NOW), /unknown quest kind/);
});

test('dates are relative to ctx.now: completions end yesterday, the mission runs now → +14 days', () => {
  assert.equal(sqliteDateTime(NOW), '2026-09-29 10:00:00');
  assert.deepEqual(forUser(rows.topic_progress, 'student-1').map((p) => p.completed_at), ['2026-09-28 12:00:00']);
  assert.deepEqual(forUser(rows.topic_progress, 'student-2').map((p) => p.completed_at), ['2026-09-27 12:00:00', '2026-09-28 12:00:00']);
  for (const event of rows.xp_events) assert.ok(event.earned_at < sqliteDateTime(NOW), event.earned_at);

  const [mission] = rows.missions;
  assert.equal(mission.id, demoId('budo', 'mission', 'first-topic'));
  assert.equal(mission.start_at, '2026-09-29T10:00:00.000Z');
  assert.equal(mission.end_at, '2026-10-13T10:00:00.000Z');
  assert.equal(mission.predicate_kind, 'requirements');
  assert.equal(mission.predicate_params, '{}');
  assert.equal(mission.mode, 'parallel');
  assert.equal(mission.enrollment_mode, 'auto');
  assert.equal(mission.xp_reward, 100);
  assert.equal(mission.badge_id, 'badge-tecnica-afiada');
  assert.equal(mission.active, 1);

  const later = buildGamification(dataset, { ...ctx, now: new Date('2027-01-04T08:00:00Z') }).rows;
  assert.equal(forUser(later.user_streak, 'student-1')[0].last_activity_date, '2027-01-03');
  assert.equal(forUser(later.quest_progress, 'student-1')[0].period_key, '2027-W01');
  // Ids and keys do not depend on the date: a re-run on another day converges.
  assert.deepEqual(later.xp_events.map((e) => e.idempotency_key), rows.xp_events.map((e) => e.idempotency_key));
  assert.deepEqual(later.topic_progress.map((p) => p.id), rows.topic_progress.map((p) => p.id));
  assert.deepEqual(later.mission_requirements, rows.mission_requirements);
});

// ── Missions (RFC 0022) ────────────────────────────────────────────────────────

/** requirements.ts itself, transpiled (zod resolved from packages/shared) — test only. */
async function importRequirementsModule() {
  const require = createRequire(join(ROOT, 'packages', 'shared', 'package.json'));
  const ts = require('typescript');
  const { outputText } = ts.transpileModule(read('packages/shared/domain/missions/requirements.ts'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const code = outputText.replace(/from ['"]zod['"]/, `from ${JSON.stringify(pathToFileURL(require.resolve('zod')).href)}`);
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

test('the mission requirements: one row per step, in order, on seeded topics, with the API’s stored params', async () => {
  const missionId = demoId('budo', 'mission', 'first-topic');
  assert.deepEqual(rows.mission_requirements, [
    {
      id: demoId('budo', 'mission-requirement', 'first-topic#1'),
      mission_id: missionId,
      position: 1,
      kind: 'topic_visited',
      title: 'Open your first lesson',
      topic_node_id: tid('root-1/module-1/lesson-1'),
      event_id: null,
      params: '{}',
      xp_reward: 20,
    },
    {
      id: demoId('budo', 'mission-requirement', 'first-topic#2'),
      mission_id: missionId,
      position: 2,
      kind: 'submissions_on_topic',
      title: 'Share one demonstration',
      topic_node_id: tid('root-1/module-1/lesson-2'),
      event_id: null,
      params: '{"minCount":1,"requireDescription":true,"visibility":"any","countModerated":false}',
      xp_reward: 50,
    },
  ]);

  // Parity with what the API stores: the predicate marker, and each step's
  // params as JSON.stringify(parseRequirementParams(kind, params)) (d1-mission-repository.ts).
  const shared = await importRequirementsModule();
  assert.equal(REQUIREMENTS_PREDICATE_KIND, shared.REQUIREMENTS_PREDICATE_KIND);
  const [definition] = dataset.gamification.missions;
  definition.requirements.forEach((step, index) => {
    assert.equal(rows.mission_requirements[index].params, JSON.stringify(shared.parseRequirementParams(step.kind, step.params)), step.key);
  });
  // The rows satisfy the step schema the admin API validates against (ids for keys).
  const input = rows.mission_requirements.map((row) => ({
    kind: row.kind,
    title: row.title,
    xpReward: row.xp_reward,
    params: JSON.parse(row.params),
    ...(row.topic_node_id ? { topicId: row.topic_node_id } : {}),
    ...(row.event_id ? { eventId: row.event_id } : {}),
  }));
  assert.equal(shared.RequirementInputList.safeParse(input).success, true);

  // No enrollment or progress is seeded: the evaluator creates them.
  assert.ok(!Object.keys(rows).some((table) => /enrollment|requirement_progress|evidence|audience/.test(table)));
});

test('the requirement rows match the migration 0031 kind/target CHECK', () => {
  const migration = read('apps/api/migrations/0031_create_mission_requirements.sql');
  assert.match(migration, /UNIQUE \(mission_id, position\)/);
  const topicKinds = migration.match(/kind IN \(('submissions_on_topic'[^)]*)\)\s+AND topic_node_id IS NOT NULL/)?.[1];
  assert.ok(topicKinds, 'migration 0031 CHECK not found');
  for (const row of rows.mission_requirements) {
    assert.ok(topicKinds.includes(`'${row.kind}'`), `${row.kind} targets a topic`);
    assert.ok(row.topic_node_id && row.event_id === null, row.id);
    assert.ok(row.position >= 1 && row.xp_reward >= 0, row.id);
  }
  // A manual step takes no target; its instructions are trimmed and defaulted.
  const manual = structuredClone(dataset);
  manual.gamification.missions[0].requirements.push({ key: 'check', kind: 'manual_check', title: ' Bow ', params: { instructions: ' Ask ' } });
  const extra = buildGamification(manual, ctx).rows.mission_requirements[2];
  assert.deepEqual(
    { position: extra.position, title: extra.title, topic: extra.topic_node_id, event: extra.event_id, params: extra.params, xp: extra.xp_reward },
    { position: 3, title: 'Bow', topic: null, event: null, params: '{"instructions":"Ask"}', xp: 0 },
  );
});

test('a requirement whose params the schema refuses fails the builder', () => {
  const broken = structuredClone(dataset);
  broken.gamification.missions[0].requirements[1].params = { minCount: 0 };
  assert.throws(() => buildGamification(broken, ctx), /mission "first-topic" requirement "demo": params "minCount"/);
});

test('the builder refuses to run without a clock or a reference', () => {
  assert.throws(() => buildGamification(dataset, { ...ctx, now: null }), /ctx\.now/);
  assert.throws(() => buildGamification(dataset, { ...ctx, now: new Date('nope') }), /ctx\.now/);
  assert.throws(() => buildGamification(dataset, { ...ctx, gamification: null }), /ctx\.gamification/);
});

test('SQL: keyed by each table’s unique key, user_xp is the ledger sum, quest progress is insert-only', () => {
  const { statements, counts } = gamificationSection.build(dataset, ctx);
  assert.deepEqual(counts, {
    topic_progress: 3,
    xp_events: 7,
    user_badges: 3,
    user_xp: 2,
    user_streak: 1,
    quest_progress: 1,
    missions: 1,
    mission_requirements: 2,
  });
  const into = (table) => statements.filter((s) => s.startsWith(`INSERT INTO ${table} `));
  for (const s of into('topic_progress')) assert.match(s, /ON CONFLICT\(user_id, topic_node_id\) DO UPDATE/);
  for (const s of into('xp_events')) assert.match(s, /ON CONFLICT\(user_id, source_kind, idempotency_key\) DO UPDATE/);
  for (const s of into('user_badges')) assert.match(s, /ON CONFLICT\(user_id, badge_id\) DO UPDATE/);
  for (const s of [...into('topic_progress'), ...into('xp_events'), ...into('user_badges')]) {
    assert.doesNotMatch(s.split('DO UPDATE SET')[1], /\bid = excluded\.id/, 'the id is insert-only');
  }
  for (const s of into('user_xp')) {
    assert.match(s, /\(SELECT MAX\(0, COALESCE\(SUM\(points\), 0\)\) FROM xp_events WHERE user_id = '[0-9a-f-]{36}'\)/);
  }
  assert.match(into('quest_progress')[0], /ON CONFLICT\(user_id, quest_id, period_key\) DO NOTHING;$/);
  assert.match(into('missions')[0], /ON CONFLICT\(id\) DO UPDATE SET .*predicate_kind = excluded\.predicate_kind/);
  assert.match(into('missions')[0], /mode = excluded\.mode, enrollment_mode = excluded\.enrollment_mode/);
  assert.equal(into('mission_requirements').length, 2);
  for (const s of into('mission_requirements')) {
    // Keyed by the table's UNIQUE (mission_id, position); the id is insert-only.
    assert.match(s, /ON CONFLICT\(mission_id, position\) DO UPDATE SET/);
    assert.doesNotMatch(s.split('DO UPDATE SET')[1], /\bid = excluded\.id/);
    assert.match(s, /WHERE mission_requirements\.kind IS NOT excluded\.kind/, 'a no-op re-run leaves updated_at alone');
  }
  // Every requirement row follows the mission it references.
  assert.ok(statements.findLastIndex((s) => s.startsWith('INSERT INTO missions ')) < statements.findIndex((s) => s.startsWith('INSERT INTO mission_requirements ')));
  // The read model is written after every ledger row it sums.
  const lastEvent = statements.findLastIndex((s) => s.startsWith('INSERT INTO xp_events '));
  const firstXp = statements.findIndex((s) => s.startsWith('INSERT INTO user_xp '));
  assert.ok(lastEvent < firstXp);
});

test('badge rules: the seeded state leaves no badge due, so a login awards nothing', () => {
  const engine = read('packages/shared/domain/gamification/badge-engine.ts');
  const cases = [...engine.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]);
  assert.deepEqual([...cases].sort(), [...BADGE_RULE_KINDS].sort(), 'badge-engine.ts rule kinds');

  for (const state of dataset.gamification.students) {
    const stats = { totalXp: totals[state.user], completedTopics: state.completedTopics.length, streakDays: state.streakDays, held: state.badges };
    assert.deepEqual(badgesDue(stats, reference), [], state.user);
  }
  // What the engine would award on student-3's first completion, and at 500 XP.
  assert.deepEqual(badgesDue({ totalXp: 100, completedTopics: 1, streakDays: 1, held: [] }, reference), ['alicerce-solido']);
  assert.deepEqual(badgesDue({ totalXp: 950, completedTopics: 2, streakDays: 0, held: ['alicerce-solido'] }, reference), ['levantador-bronze']);
  assert.deepEqual(badgesDue({ totalXp: 0, completedTopics: 0, streakDays: 0, completedMissions: 1, held: [] }, reference), ['tecnica-afiada']);
});

test('a dataset that leaves a badge due is refused', () => {
  const broken = structuredClone(dataset);
  const s2 = broken.gamification.students.find((state) => state.user === 'student-2');
  s2.badges = ['alicerce-solido'];
  s2.adminAdjustments = [500];
  assert.throws(() => buildGamification(broken, ctx), /student-2 \(950 XP.*due badge\(s\) levantador-bronze/);
  const unknownRule = { ...reference, badges: { odd: { id: 'badge-odd', xpReward: 0, ruleKind: 'moon_phase', ruleParams: {} } } };
  assert.throws(() => badgesDue({ totalXp: 0, completedTopics: 0, streakDays: 0 }, unknownRule), /rule kind "moon_phase"/);
});

// ── Post-run assertion ─────────────────────────────────────────────────────────

const STUDENTS = dataset.gamification.students.map((state) => state.user);
const IDS = STUDENTS.map(uid);
const NAMES = Object.fromEntries(STUDENTS.map((key) => [uid(key), key]));

/** What the consistency query would return over `ledger` (xp_events rows) and `readModel` (user_xp rows). */
function simulate(ledger, readModel) {
  return IDS.map((id) => ({
    user_id: id,
    total_xp: readModel.find((row) => row.user_id === id)?.total_xp ?? 0,
    ledger_xp: Math.max(0, ledger.filter((row) => row.user_id === id).reduce((sum, row) => sum + row.points, 0)),
  }));
}

test('the XP assertion passes on the seeded state', () => {
  assert.deepEqual(checkXpConsistency(simulate(rows.xp_events, rows.user_xp), IDS, NAMES), []);
});

test('the XP assertion fails when a ledger row is removed', () => {
  const removed = rows.xp_events.findIndex((row) => row.user_id === uid('student-2') && row.source_kind === 'admin_adjustment');
  const ledger = rows.xp_events.filter((_, index) => index !== removed);
  assert.deepEqual(checkXpConsistency(simulate(ledger, rows.user_xp), IDS, NAMES), [
    'student-2: user_xp.total_xp 950 but the xp_events ledger sums to 750',
  ]);
  assert.deepEqual(checkXpConsistency([], [uid('student-1')], NAMES), ['student-1: user not found']);
});

test('the consistency query is read-only and names every student', () => {
  const query = xpConsistencyQuery(IDS);
  assert.match(query, /^SELECT /);
  assert.doesNotMatch(query, /\b(INSERT|UPDATE|DELETE|DROP)\b/i);
  for (const id of IDS) assert.ok(query.includes(`'${id}'`));
  assert.throws(() => xpConsistencyQuery([]), /no users/);
});

test('assertXpConsistency parses wrangler JSON after a banner and throws loudly on a mismatch', () => {
  const target = { database: 'arenaquest-db', wranglerArgs: ['--local'] };
  const stdout = (results) => `▲ [WARNING] Proxy environment variables detected.\n\n${JSON.stringify([{ results, success: true }], null, 2)}\n`;
  const commands = [];
  const ok = assertXpConsistency({
    target,
    dataset,
    ctx,
    query: (command) => {
      commands.push(command);
      return { status: 0, stdout: stdout(simulate(rows.xp_events, rows.user_xp)) };
    },
  });
  assert.deepEqual(ok, [
    { user: 'student-1', totalXp: 350 },
    { user: 'student-2', totalXp: 950 },
    { user: 'student-3', totalXp: 0 },
  ]);
  assert.deepEqual(commands[0].slice(-5), ['arenaquest-db', '--local', '--command', xpConsistencyQuery(IDS), '--json']);
  assert.deepEqual(wranglerQueryCommand(target, 'SELECT 1').slice(-4), ['--local', '--command', 'SELECT 1', '--json']);

  const ledger = rows.xp_events.filter((row) => !(row.user_id === uid('student-1') && row.source_kind === 'topic'));
  assert.throws(
    () => assertXpConsistency({ target, dataset, ctx, query: () => ({ status: 0, stdout: stdout(simulate(ledger, rows.user_xp)) }) }),
    /user_xp does not match the xp_events ledger[\s\S]*student-1: user_xp\.total_xp 350 but the xp_events ledger sums to 250/,
  );
  assert.throws(() => parseD1Json('no json here'), /no JSON result/);
});
