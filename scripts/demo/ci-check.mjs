#!/usr/bin/env node
/**
 * ci-check.mjs — prove the demo seed still works on the current migrations
 * (RFC 0021 §3, Task 08). Runs in CI (`.github/workflows/ci.yml`, job
 * "Demo seed check") and locally:
 *
 *   node scripts/demo/ci-check.mjs [--label <label>]… [--keep]
 *
 * In throwaway stores under the OS temp dir — never the developer's replica,
 * never a remote:
 *   1. `wrangler d1 migrations apply arenaquest-db --local --persist-to <tmp>`,
 *      once; every label then gets its own copy of that migrated store, as each
 *      label has its own D1 when deployed (demo group names and tag slugs are
 *      the same in every label, so two labels cannot share one database);
 *   2. pre-fill a throwaway media cache from `scripts/demo/fixtures/` (the pinned
 *      manifest files themselves, SHA-256 checked), so no media is downloaded;
 *   3. for each label (default: every `config/labels/*.jsonc`), run the seed
 *      (`seed-demo.mjs`'s `main`, in-process) TWICE against that store, with a
 *      throwaway `AQ_DEMO_PASSWORD` generated here;
 *   4. after each run assert RFC 0021's success criteria for the label — 6 demo
 *      users, 21 topics, ≥ 21 `ready` media whose objects exist with the pinned
 *      SHA-256, 1 group with 2 members, 2 enrollments, student XP 350 / 950 / 0
 *      with their badges, `user_xp` = the `xp_events` ledger — plus the Task 14
 *      extensions (3 events and the restricted grant, 2 plans, 2 active
 *      contracts, 1 paid + 1 open invoice, 1 payment, the task with its stages
 *      and links, the comment thread and its like) — and that the second run
 *      changed no row count in any seeded table.
 *
 * A migration that breaks the demo (e.g. drops a column it writes) makes the
 * seed's `d1 execute` fail, so the PR introducing it fails this check.
 *
 * Offline by construction: the seed's media `fetch` throws, the global `fetch`
 * refuses any non-loopback URL, and wrangler/miniflare's own telemetry and
 * `Request.cf` download are disabled for this process and its children. Any
 * blocked request fails the check.
 *
 * Needs wrangler's Node (≥ 22, see apps/api's wrangler `engines`).
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs as nodeParseArgs } from 'node:util';

import log from '../lib/log.mjs';
import { loadDataset } from './dataset.mjs';
import { demoId, demoMediaKey, listLabels } from './ids.mjs';
import { cachePath, localPlatformProxy, sha256Hex } from './media.mjs';
import { checkXpConsistency, xpConsistencyQuery } from './gamification.mjs';
import { LOCAL_DATABASE, PASSWORD_VAR, main as seedMain } from './seed-demo.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE));

export const FIXTURES_DIR = join(HERE, 'fixtures');
export const MIN_NODE_MAJOR = 22;

/** RFC 0021 success criteria (P1) every label's demo must at least meet. */
export const RFC_FLOOR = Object.freeze({ users: 6, topics: 21, readyMedia: 21, student1Xp: 350, student1Badges: 1 });

/** Every table the seed writes; a second run must not change any of their counts. */
export const SEEDED_TABLES = Object.freeze([
  'users',
  'user_roles',
  'user_groups',
  'user_group_members',
  'tags',
  'topic_nodes',
  'topic_node_tags',
  'media',
  'enrollments_user',
  'enrollments_user_group',
  'topic_progress',
  'xp_events',
  'user_badges',
  'user_xp',
  'user_streak',
  'quest_progress',
  'missions',
  'mission_requirements',
  'events',
  'event_audience_group',
  'billing_plans',
  'subscriptions',
  'invoices',
  'payments',
  'tasks',
  'task_stages',
  'task_topic_links',
  'task_stage_topic_links',
  'topic_comments',
  'comment_likes',
]);

/** Settings that keep wrangler/miniflare off the network (inherited by child processes). */
export const OFFLINE_ENV = Object.freeze({ CLOUDFLARE_CF_FETCH_ENABLED: 'false', WRANGLER_SEND_METRICS: 'false' });

// ════════════════════════════════════════════════════════════════════════════
// PURE
// ════════════════════════════════════════════════════════════════════════════

export function parseCheckArgs(argv) {
  let values;
  try {
    ({ values } = nodeParseArgs({
      args: argv,
      options: {
        label: { type: 'string', multiple: true },
        keep: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    throw new Error(`invalid arguments: ${error.message}`);
  }
  if (values.help) return { help: true };
  return { labels: values.label ?? null, keep: Boolean(values.keep) };
}

/** Throws unless `version` (`process.versions.node`) meets wrangler's floor. */
export function assertNodeVersion(version) {
  const major = Number(String(version).split('.')[0]);
  if (!(major >= MIN_NODE_MAJOR)) {
    throw new Error(`Node ${version}: the demo check runs wrangler, which needs Node >= ${MIN_NODE_MAJOR}`);
  }
}

/** Every distinct manifest file across `datasets`, by SHA-256. */
export function manifestFiles(datasets) {
  const files = new Map();
  for (const dataset of datasets) for (const file of dataset.media.manifest) files.set(file.sha256, file);
  return [...files.values()];
}

/**
 * Copy each manifest file's fixture (`<fixturesDir>/<fileName>`) into
 * `<cacheDir>/<sha256>`, the cache media.mjs reads before it would download.
 * Throws naming the file when a fixture is missing or is not the pinned bytes.
 */
export function prefillCache(files, { cacheDir, fixturesDir = FIXTURES_DIR }) {
  mkdirSync(cacheDir, { recursive: true });
  for (const file of files) {
    const fixture = join(fixturesDir, file.fileName);
    if (!existsSync(fixture)) throw new Error(`no fixture for media.manifest["${file.key}"]: add ${fixture}`);
    const actual = sha256Hex(readFileSync(fixture));
    if (actual !== file.sha256) {
      throw new Error(`fixture ${file.fileName} is not the pinned media.manifest["${file.key}"] (SHA-256 ${actual}, expected ${file.sha256})`);
    }
    copyFileSync(fixture, cachePath(cacheDir, file.sha256));
  }
  return files.length;
}

function isLoopback(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
}

/**
 * A `fetch` that passes loopback URLs (miniflare's own traffic) to `inner` and
 * refuses anything else, recording it in `blocked`.
 */
export function guardedFetch(inner, blocked = []) {
  const guarded = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    if (isLoopback(url)) return inner(input, init);
    blocked.push(String(url));
    throw new Error(`ci-check: network request refused: ${url}`);
  };
  return { fetch: guarded, blocked };
}

/**
 * What the database must hold for `dataset` (ids derived exactly as the seed
 * derives them): `{ userIds, topicIds, media: [{ id, key, sha256 }], groupIds,
 * enrollmentIds, students: [{ user, id, xp, badges }], expect }`.
 */
export function expectations(dataset) {
  const { label } = dataset;
  const id = (entity, key) => demoId(label, entity, key);
  const media = [];
  const manifest = new Map(dataset.media.manifest.map((file) => [file.key, file]));
  for (const topic of dataset.topics) {
    for (const manifestKey of dataset.media.assign[topic.key] ?? []) {
      media.push({ id: id('media', demoMediaKey(topic.key, manifestKey)), sha256: manifest.get(manifestKey).sha256 });
    }
  }
  const students = dataset.gamification.students.map((state) => ({
    user: state.user,
    id: id('user', state.user),
    xp: state.expectedTotalXp,
    badges: state.badges.length,
  }));
  // Task 14: each count is `SELECT COUNT(*) FROM <table> WHERE <column> IN (<ids>) [AND <filter>]`.
  const billing = dataset.billing ?? { plans: [], subscriptions: [], invoices: [] };
  const eventIds = (dataset.events ?? []).map((event) => id('event', event.key));
  const taskIds = (dataset.tasks ?? []).map((task) => id('task', task.key));
  const stageIds = (dataset.tasks ?? []).flatMap((task) => task.stages.map((stage) => id('task-stage', `${task.key}/${stage.key}`)));
  const invoiceIds = billing.invoices.map((invoice) => id('invoice', invoice.key));
  const commentIds = (dataset.comments?.entries ?? []).map((comment) => id('comment', comment.key));
  // M27: every demo mission is a requirements mission, and carries one row per step.
  const missions = dataset.gamification.missions;
  const missionIds = missions.map((mission) => id('mission', mission.key));
  const extension = (what, table, column, ids, wanted, filter = null) => ({ what, table, column, ids, wanted, filter });
  const extensions = [
    extension('events', 'events', 'id', eventIds, eventIds.length, "status = 'published'"),
    extension('eventGrants', 'event_audience_group', 'event_id', eventIds, (dataset.events ?? []).reduce((n, e) => n + (e.groups ?? []).length, 0)),
    extension('billingPlans', 'billing_plans', 'id', billing.plans.map((plan) => id('billing-plan', plan.key)), billing.plans.length),
    extension('activeSubscriptions', 'subscriptions', 'id', billing.subscriptions.map((s) => id('subscription', s.key)), billing.subscriptions.length, "status = 'active'"),
    extension('paidInvoices', 'invoices', 'id', invoiceIds, billing.invoices.filter((i) => i.status === 'paid').length, "status = 'paid'"),
    extension('openInvoices', 'invoices', 'id', invoiceIds, billing.invoices.filter((i) => i.status === 'open').length, "status = 'open'"),
    extension('payments', 'payments', 'invoice_id', invoiceIds, billing.invoices.filter((i) => i.payment).length),
    extension('tasks', 'tasks', 'id', taskIds, taskIds.length, "status = 'published'"),
    extension('taskStages', 'task_stages', 'id', stageIds, stageIds.length),
    extension('taskTopicLinks', 'task_topic_links', 'task_id', taskIds, (dataset.tasks ?? []).reduce((n, t) => n + (t.topics ?? []).length, 0)),
    extension('stageTopicLinks', 'task_stage_topic_links', 'stage_id', stageIds, stageIds.length),
    extension('comments', 'topic_comments', 'id', commentIds, commentIds.length, 'deleted_at IS NULL'),
    extension('commentLikes', 'comment_likes', 'comment_id', commentIds, (dataset.comments?.likes ?? []).length),
    extension('missions', 'missions', 'id', missionIds, missionIds.length, "predicate_kind = 'requirements'"),
    extension(
      'missionRequirements',
      'mission_requirements',
      'mission_id',
      missionIds,
      missions.reduce((n, mission) => n + mission.requirements.length, 0),
    ),
  ];
  return {
    extensions,
    userIds: dataset.users.map((user) => id('user', user.key)),
    topicIds: dataset.topics.map((topic) => id('topic', topic.key)),
    media,
    groupIds: dataset.groups.map((group) => id('group', group.key)),
    enrollmentIds: dataset.enrollments.map((grant) => id('enrollment', grant.key)),
    students,
    expect: {
      users: dataset.users.length,
      topics: dataset.topics.length,
      readyMedia: media.length,
      groups: dataset.groups.length,
      groupMembers: dataset.groups.reduce((sum, group) => sum + (group.members ?? []).length, 0),
      enrollments: dataset.enrollments.length,
      ...Object.fromEntries(extensions.map((entry) => [entry.what, entry.wanted])),
    },
  };
}

/** Problems with `observed` (see `inspectLabel`) against `expected` (see `expectations`) and the RFC floor. */
export function checkLabel(observed, expected) {
  const problems = [];
  const want = (what, actual, wanted) => {
    if (actual !== wanted) problems.push(`${what}: ${actual}, expected ${wanted}`);
  };
  for (const [what, wanted] of Object.entries(expected.expect)) want(what, observed.counts[what], wanted);
  if (observed.counts.users < RFC_FLOOR.users) problems.push(`users: ${observed.counts.users} < RFC floor ${RFC_FLOOR.users}`);
  if (observed.counts.topics < RFC_FLOOR.topics) problems.push(`topics: ${observed.counts.topics} < RFC floor ${RFC_FLOOR.topics}`);
  if (observed.counts.readyMedia < RFC_FLOOR.readyMedia) {
    problems.push(`ready media: ${observed.counts.readyMedia} < RFC floor ${RFC_FLOOR.readyMedia}`);
  }
  for (const object of observed.objects) {
    if (object.state !== 'ok') problems.push(`media ${object.id} (${object.key ?? 'no row'}): object ${object.state}`);
  }
  const byId = new Map(observed.students.map((row) => [row.id, row]));
  for (const student of expected.students) {
    const row = byId.get(student.id);
    if (!row) {
      problems.push(`${student.user}: not found`);
      continue;
    }
    want(`${student.user} total_xp`, row.xp, student.xp);
    want(`${student.user} badges`, row.badges, student.badges);
  }
  const student1 = expected.students.find((student) => student.user === 'student-1');
  const s1 = student1 && byId.get(student1.id);
  if (!s1 || s1.xp !== RFC_FLOOR.student1Xp || s1.badges !== RFC_FLOOR.student1Badges) {
    problems.push(`student-1: ${s1 ? `${s1.xp} XP, ${s1.badges} badge(s)` : 'missing'}, RFC expects ${RFC_FLOOR.student1Xp} XP and ${RFC_FLOOR.student1Badges} badge`);
  }
  problems.push(...observed.xpProblems);
  return problems;
}

/** Tables whose row count differs between two `tableCounts` snapshots. */
export function countDrift(before, after) {
  return Object.keys(before)
    .filter((table) => before[table] !== after[table])
    .map((table) => `${table}: ${before[table]} → ${after[table]}`);
}

// ════════════════════════════════════════════════════════════════════════════
// I/O
// ════════════════════════════════════════════════════════════════════════════

const placeholders = (list) => list.map(() => '?').join(', ');

async function scalar(db, sql, params) {
  const row = await db.prepare(sql).bind(...params).first();
  return Number(row?.n ?? 0);
}

/** `{ table: count }` for every seeded table. */
export async function tableCounts(db) {
  const counts = {};
  for (const table of SEEDED_TABLES) counts[table] = await scalar(db, `SELECT COUNT(*) AS n FROM ${table}`, []);
  return counts;
}

/** What the store holds for one label's expectations (read-only). */
export async function inspectLabel({ DB: db, R2: r2 }, expected) {
  const counts = {
    users: await scalar(db, `SELECT COUNT(*) AS n FROM users WHERE id IN (${placeholders(expected.userIds)})`, expected.userIds),
    topics: await scalar(db, `SELECT COUNT(*) AS n FROM topic_nodes WHERE id IN (${placeholders(expected.topicIds)})`, expected.topicIds),
    readyMedia: 0,
    groups: expected.groupIds.length
      ? await scalar(db, `SELECT COUNT(*) AS n FROM user_groups WHERE id IN (${placeholders(expected.groupIds)})`, expected.groupIds)
      : 0,
    groupMembers: expected.groupIds.length
      ? await scalar(db, `SELECT COUNT(*) AS n FROM user_group_members WHERE group_id IN (${placeholders(expected.groupIds)})`, expected.groupIds)
      : 0,
    enrollments: expected.enrollmentIds.length
      ? (await scalar(db, `SELECT COUNT(*) AS n FROM enrollments_user WHERE id IN (${placeholders(expected.enrollmentIds)})`, expected.enrollmentIds)) +
        (await scalar(db, `SELECT COUNT(*) AS n FROM enrollments_user_group WHERE id IN (${placeholders(expected.enrollmentIds)})`, expected.enrollmentIds))
      : 0,
  };

  for (const entry of expected.extensions ?? []) {
    counts[entry.what] = entry.ids.length
      ? await scalar(
          db,
          `SELECT COUNT(*) AS n FROM ${entry.table} WHERE ${entry.column} IN (${placeholders(entry.ids)})${entry.filter ? ` AND ${entry.filter}` : ''}`,
          entry.ids,
        )
      : 0;
  }

  const mediaIds = expected.media.map((entry) => entry.id);
  const { results: rows } = await db
    .prepare(`SELECT id, storage_key, status FROM media WHERE id IN (${placeholders(mediaIds)})`)
    .bind(...mediaIds)
    .all();
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const objects = [];
  for (const entry of expected.media) {
    const row = rowById.get(entry.id);
    if (!row) {
      objects.push({ id: entry.id, key: null, state: 'row missing' });
      continue;
    }
    if (row.status === 'ready') counts.readyMedia += 1;
    const object = await r2.get(row.storage_key);
    const bytes = object ? Buffer.from(await object.arrayBuffer()) : null;
    const state = !bytes ? 'missing' : sha256Hex(bytes) === entry.sha256 ? 'ok' : 'differs from the pinned SHA-256';
    objects.push({ id: entry.id, key: row.storage_key, state });
  }

  const ids = expected.students.map((student) => student.id);
  const names = Object.fromEntries(expected.students.map((student) => [student.id, student.user]));
  const { results: xpRows } = await db.prepare(xpConsistencyQuery(ids)).all();
  const xpById = new Map(xpRows.map((row) => [row.user_id, Number(row.total_xp)]));
  const students = [];
  for (const id of ids) {
    if (!xpById.has(id)) continue;
    students.push({ id, xp: xpById.get(id), badges: await scalar(db, 'SELECT COUNT(*) AS n FROM user_badges WHERE user_id = ?', [id]) });
  }
  return { counts, objects, students, xpProblems: checkXpConsistency(xpRows, ids, names) };
}

/** `wrangler d1 migrations apply` on the throwaway store; throws with its output on failure. */
function applyMigrations(persistTo) {
  const argv = ['--filter', 'api', 'exec', 'wrangler', 'd1', 'migrations', 'apply', LOCAL_DATABASE, '--local', '--persist-to', persistTo];
  const result = spawnSync('pnpm', argv, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    throw new Error(`wrangler d1 migrations apply exited with status ${result.status}`);
  }
}

async function withStore(persistTo, fn) {
  const proxy = await localPlatformProxy({ persistTo });
  try {
    return await fn(proxy.env);
  } finally {
    await proxy.dispose();
  }
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

function usage() {
  console.log('Usage: node scripts/demo/ci-check.mjs [--label <label>]… [--keep]');
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseCheckArgs(argv);
  if (args.help) {
    usage();
    return 0;
  }
  assertNodeVersion(process.versions.node);
  const labels = args.labels ?? listLabels();
  const datasets = labels.map((label) => loadDataset(label));

  Object.assign(process.env, OFFLINE_ENV);
  const { fetch: guarded, blocked } = guardedFetch(globalThis.fetch.bind(globalThis));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = guarded;
  const mediaFetch = async (url) => {
    blocked.push(String(url));
    throw new Error(`ci-check: media download refused (${url}): the fixtures must cover every manifest file`);
  };

  const started = Date.now();
  const tmp = mkdtempSync(join(tmpdir(), 'aq-demo-ci-'));
  const migrated = join(tmp, 'migrated');
  const cacheDir = join(tmp, 'cache');
  const password = randomBytes(24).toString('base64url'); // throwaway: lives only in this process
  const timings = [];
  const failures = [];

  try {
    log.heading(`Demo seed check — ${labels.join(', ')} (throwaway stores under ${tmp})`);
    let at = Date.now();
    applyMigrations(migrated);
    log.ok(`applied every migration to a fresh local D1 (${seconds(Date.now() - at)})`);
    log.ok(`media cache pre-filled from fixtures: ${prefillCache(manifestFiles(datasets), { cacheDir })} files, no download`);

    for (const dataset of datasets) {
      const { label } = dataset;
      const expected = expectations(dataset);
      const persistTo = join(tmp, label);
      cpSync(migrated, persistTo, { recursive: true });
      let before = null;
      for (const run of [1, 2]) {
        at = Date.now();
        try {
          await seedMain(
            ['--label', label, '-e', 'local', '--persist-to', persistTo],
            { [PASSWORD_VAR]: password },
            { fetchImpl: mediaFetch, cacheDir, sqlFile: join(tmp, `demo-${label}-local.sql`) },
          );
        } catch (error) {
          throw new Error(`the seed of "${label}" (run ${run}) failed on the current migrations: ${error.message}`);
        }
        const took = Date.now() - at;
        timings.push({ label, run, ms: took });
        const { problems, counts } = await withStore(persistTo, async (env) => ({
          problems: checkLabel(await inspectLabel(env, expected), expected),
          counts: await tableCounts(env.DB),
        }));
        if (run === 2) problems.push(...countDrift(before, counts).map((drift) => `second run changed a row count — ${drift}`));
        before = counts;
        if (problems.length > 0) {
          failures.push(...problems.map((problem) => `${label} (run ${run}): ${problem}`));
          log.fail(`${label} run ${run} (${seconds(took)}): ${problems.length} problem(s)`);
        } else {
          log.ok(`${label} run ${run} (${seconds(took)}): criteria met${run === 2 ? ', no row count changed' : ''}`);
        }
      }
    }

  } finally {
    globalThis.fetch = originalFetch;
    if (args.keep) log.info(`kept ${tmp}`);
    else rmSync(tmp, { recursive: true, force: true });
  }

  if (blocked.length > 0) failures.push(...[...new Set(blocked)].map((url) => `network request attempted: ${url}`));
  for (const timing of timings) log.info(`timing ${timing.label} run ${timing.run}: ${seconds(timing.ms)}`);
  log.info(`total ${seconds(Date.now() - started)}`);
  if (failures.length > 0) {
    throw new Error(`demo seed check failed:\n  - ${failures.join('\n  - ')}`);
  }
  log.ok('demo seed check passed');
  return 0;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      log.fail(error.message);
      process.exit(1);
    },
  );
}
