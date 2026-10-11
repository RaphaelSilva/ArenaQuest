/**
 * scripts/mcp/tools/ops.test.mjs — the eight ops tools with the API client,
 * the process spawner, the clock and the confirmation store stubbed. No
 * process is ever started and no network is touched.
 *
 * What is pinned here is the tier policy: the exact tool list and
 * annotations; that tier-1 children get `CLOUDFLARE_API_TOKEN` from
 * `AQ_CF_READ_TOKEN` through the env object only (never argv, never a result)
 * and nothing else from the server's environment; that tier-2 children get
 * NO token and run only after a valid single-use confirmation id; that a
 * reused, expired or foreign id is refused without a spawn; that the status
 * and check reports are parsed from `--json` with exit 1/2 as data; and that
 * `restore_instructions` spawns nothing.
 *
 * Run: node --test scripts/mcp/tools/ops.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';

import { bookmarkCommand, formatCommand, restoreCommand } from '../../db/reset-remote.mjs';
import { createConfirmations } from '../confirm.mjs';
import { READ_ANNOTATIONS, callTool } from './authoring.mjs';
import {
  ACTION_ANNOTATIONS,
  INFRA_ENVS,
  JOB_NAMES,
  NO_TOKEN_NOTE,
  OPS_TOOL_NAMES,
  REPO_ROOT,
  RESTORE_SCENARIOS,
  RUNBOOK,
  STATUS_CACHE_MS,
  TIER_1_TOOL_NAMES,
  TIER_2_TOOL_NAMES,
  TIER_3_TOOL_NAMES,
  buildOpsTools,
  childEnvFor,
  jobRunsQuery,
  registerOpsTools,
  restoreInstructionsFor,
} from './ops.mjs';

// -- fixtures -----------------------------------------------------------------

const TOKEN = 'cf-read-token-value-never-shown';

const CONFIG = {
  label: 'budo',
  env: 'production',
  cfReadToken: TOKEN,
  ops: {
    database: 'budo-db',
    wranglerEnv: 'budo',
    production: { database: 'budo-db', mediaBucket: 'budo-media', backupBucket: 'budo-backups' },
  },
};
const STAGING_CONFIG = { ...CONFIG, env: 'staging', ops: { ...CONFIG.ops, database: 'budo-db-staging', wranglerEnv: 'budo-staging' } };
const NO_TOKEN_CONFIG = { ...CONFIG, cfReadToken: null };

/** The server's environment: what a child may and may not inherit. */
const SERVER_ENV = {
  PATH: '/usr/bin',
  HOME: '/home/op',
  NODE_OPTIONS: '--max-old-space-size=512',
  PNPM_HOME: '/home/op/.pnpm',
  XDG_CONFIG_HOME: '/home/op/.config',
  TMPDIR: '/tmp',
  AQ_ADMIN_EMAIL: 'bot@example.invalid',
  AQ_ADMIN_PASSWORD: 'pw-never-inherited',
  AQ_CF_READ_TOKEN: TOKEN,
  CF_API_TOKEN: 'ci-write-token-never-inherited',
  CLOUDFLARE_API_TOKEN: 'ci-write-token-never-inherited',
  CF_ACCOUNT_ID: 'acct-never-inherited',
  R2_ACCESS_KEY_ID: 'r2-never-inherited',
  R2_SECRET_ACCESS_KEY: 'r2-never-inherited',
  JWT_SECRET: 'never-inherited',
};

const BOOKMARK = '00000085-0000000b-00004e5d-c1d6d2b7a6e4c7e0b5c3d4a1f2e3b4c5';

const STATUS_REPORT = {
  label: 'budo',
  env: 'production',
  checkedAt: '2026-10-18T09:30:00.000Z',
  status: 'amber',
  unverified: false,
  lines: [
    { id: 'd1.dump', status: 'green', detail: 'latest dump is 2 h old', fix: null },
    { id: 'timeTravel', status: 'green', detail: `bookmark ${BOOKMARK}; window up to 30 days`, fix: null },
    { id: 'homeLab', status: 'amber', detail: 'never pulled on this machine', fix: 'make backup-pull-prod LABEL=budo' },
  ],
  data: {
    dump: { ts: '2026-10-18T07:30:00.000Z', ageHours: 2, bytes: 950, sha256: 'abc' },
    timeTravel: { bookmark: BOOKMARK, windowNote: 'up to 30 days (plan-dependent: 30 on paid, 7 on free)' },
    homeLab: { pulledAt: null, ageDays: null, dumpTs: null, objects: null },
  },
};

const INFRA_REPORT = {
  label: 'budo',
  env: 'production',
  resources: [{ id: 'd1', kind: 'd1', name: 'budo-db', present: true, fix: null }],
  secrets: [{ name: 'JWT_SECRET', scope: 'worker', present: false, fix: 'make secret-prod NAME=JWT_SECRET' }],
  exitCode: 1,
};

/** Which script (or command) a spawn call is, for routing canned answers. */
function kindOf(file, args) {
  if (file === process.execPath) {
    const script = basename(args[0]);
    if (script === 'status.mjs') return 'status';
    if (script === 'provision-label.mjs') return 'check';
    if (script === 'export-d1.mjs') return args.includes('--dry-run') ? 'export-dry' : args.includes('--yes') ? 'export-yes' : 'export-other';
    return `node:${script}`;
  }
  if (file === 'pnpm' && args.includes('time-travel') && args.includes('info')) return 'bookmark';
  return `${file} ${args.join(' ')}`;
}

const DEFAULT_ANSWERS = {
  status: { status: 2, stdout: `${JSON.stringify(STATUS_REPORT, null, 2)}\n`, stderr: '' },
  check: { status: 1, stdout: `${JSON.stringify(INFRA_REPORT, null, 2)}\n`, stderr: '' },
  'export-dry': { status: 0, stdout: '\n  D1 backup — budo production → budo-db (env budo) → bucket budo-backups\n\n  →  1. export …\n  ✔  dry run: no wrangler call was made\n', stderr: '' },
  'export-yes': { status: 0, stdout: '  →  1. export …\n  →  2. gzip …\n  ✔  budo-db backed up: d1/production/daily/2026/10/18/x.sql.gz (950 bytes)\n', stderr: '' },
  bookmark: { status: 0, stdout: `⛅️ wrangler 4.0.0\n{\n  "bookmark": "${BOOKMARK}"\n}\n`, stderr: '' },
};

/** A recording spawner: every call's file, args, cwd and env, answered from `answers`. */
function stubSpawn(answers = {}) {
  const calls = [];
  const spawn = (file, args, opts = {}) => {
    const kind = kindOf(file, args);
    calls.push({ kind, file, args: [...args], cwd: opts.cwd, env: opts.env });
    const answer = answers[kind] ?? DEFAULT_ANSWERS[kind];
    if (!answer) throw new Error(`unexpected spawn: ${kind}`);
    return typeof answer === 'function' ? answer({ file, args }) : answer;
  };
  spawn.calls = calls;
  spawn.ofKind = (kind) => calls.filter((call) => call.kind === kind);
  return spawn;
}

/** A recording API client answering by `METHOD path`. */
function stubClient(routes = {}) {
  const calls = [];
  return {
    calls,
    async request(method, path, opts = {}) {
      calls.push({ method, path, body: opts.body });
      const key = `${method} ${path}`;
      if (key in routes) {
        const value = routes[key];
        if (value instanceof Error) throw value;
        return typeof value === 'function' ? value(opts) : value;
      }
      if (method === 'GET' && path === '/v1/admin/ops/health') return { status: 'ok', dependencies: { d1: { ok: true, latencyMs: 3 } } };
      if (method === 'GET' && path.startsWith('/v1/admin/ops/job-runs')) return { data: [{ id: 'r1', job: 'billing', status: 'succeeded' }] };
      throw new Error(`unexpected ${key}`);
    },
  };
}

function build(overrides = {}) {
  const client = overrides.client ?? stubClient();
  const spawn = overrides.spawn ?? stubSpawn();
  let clockMs = Date.parse('2026-10-18T10:00:00.000Z');
  let counter = 0;
  const confirmations =
    overrides.confirmations ??
    createConfirmations({ now: () => clockMs, random: (n) => Buffer.alloc(n, ++counter) });
  const tools = buildOpsTools({
    client,
    config: CONFIG,
    env: SERVER_ENV,
    spawn,
    confirmations,
    clock: () => new Date(clockMs),
    cwd: '/repo',
    ...overrides,
  });
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  return { tools, byName, client, spawn, confirmations, tick: (ms) => (clockMs += ms) };
}

/** No spawned argv and no result may carry the token or a server-only secret. */
function assertNoLeak(spawn, ...results) {
  for (const call of spawn.calls) {
    const argv = [call.file, ...call.args].join(' ');
    assert.equal(argv.includes(TOKEN), false, `token in argv: ${argv}`);
    assert.equal(argv.includes('never-inherited'), false, `secret in argv: ${argv}`);
    for (const [key, value] of Object.entries(call.env)) {
      assert.equal(String(value).includes('never-inherited'), false, `${key} inherited by a child`);
    }
  }
  for (const result of results) {
    const text = JSON.stringify(result);
    assert.equal(text.includes(TOKEN), false, `token in a result: ${text}`);
  }
}

// -- the list -----------------------------------------------------------------

test('exactly the eight tools, in tier order, with the tier annotations and a tier in every description', () => {
  const { tools } = build();
  assert.deepEqual(tools.map((t) => t.name), OPS_TOOL_NAMES);
  assert.deepEqual(OPS_TOOL_NAMES, [...TIER_1_TOOL_NAMES, ...TIER_2_TOOL_NAMES, ...TIER_3_TOOL_NAMES]);
  assert.equal(tools.length, 8);
  for (const tool of tools) {
    assert.ok(tool.title && tool.description, `${tool.name} has a title and a description`);
    assert.equal(typeof tool.run, 'function');
    if (TIER_1_TOOL_NAMES.includes(tool.name)) {
      assert.deepEqual(tool.annotations, READ_ANNOTATIONS, tool.name);
      assert.match(tool.description, /^Tier 1 \(read-only\)/);
    } else if (TIER_2_TOOL_NAMES.includes(tool.name)) {
      assert.deepEqual(tool.annotations, ACTION_ANNOTATIONS, tool.name);
      assert.match(tool.description, /^Tier 2 \(reversible action, two calls\)/);
      assert.deepEqual(Object.keys(tool.inputSchema), ['confirmationId']);
    } else {
      assert.deepEqual(tool.annotations, READ_ANNOTATIONS, tool.name);
      assert.match(tool.description, /^Tier 3 \(destructive — no executor\)/);
    }
    for (const key of Object.keys(tool.inputSchema)) assert.doesNotMatch(key, /status|token|password/i, `${tool.name}.${key}`);
  }
  assert.equal(ACTION_ANNOTATIONS.readOnlyHint, false);
  assert.equal(ACTION_ANNOTATIONS.destructiveHint, false);
  assert.equal(ACTION_ANNOTATIONS.openWorldHint, true);
  assert.deepEqual(JOB_NAMES, ['billing', 'sweep_submissions']);
  assert.deepEqual(INFRA_ENVS, ['staging', 'production']);
  assert.deepEqual(RESTORE_SCENARIOS, ['minutes-ago', 'database-lost', 'object-deleted']);
  assert.equal(RUNBOOK, 'docs/operations/backup-restore.md');
  assert.match(REPO_ROOT, /ArenaQuest|m28-candidate|\//);
});

test('buildOpsTools requires a client and a config; registerOpsTools requires an audit and registers each tool once', () => {
  assert.throws(() => buildOpsTools({ config: CONFIG }), /client is required/);
  assert.throws(() => buildOpsTools({ client: stubClient() }), /config is required/);
  const registered = [];
  const server = { registerTool: (name, config, cb) => registered.push({ name, config, cb }) };
  const tools = registerOpsTools(server, { audit: { record: () => {} }, client: stubClient(), config: CONFIG, spawn: stubSpawn() });
  assert.equal(tools.length, 8);
  assert.deepEqual(registered.map((r) => r.name), OPS_TOOL_NAMES);
  for (const r of registered) {
    const tool = tools.find((t) => t.name === r.name);
    assert.equal(r.config.annotations.readOnlyHint, tool.annotations.readOnlyHint);
    assert.equal(r.config.annotations.title, tool.title);
    assert.equal(typeof r.cb, 'function');
    assert.ok('inputSchema' in r.config);
  }
  assert.throws(() => registerOpsTools(server, { client: stubClient(), config: CONFIG }), /audit is required/);
});

// -- child environment --------------------------------------------------------

test('childEnvFor: the allowlist only; tier 1 adds the read token, tier 2 never carries one', () => {
  const tier1 = childEnvFor(1, { base: SERVER_ENV, token: TOKEN });
  assert.deepEqual(tier1, {
    PATH: '/usr/bin',
    HOME: '/home/op',
    NODE_OPTIONS: '--max-old-space-size=512',
    PNPM_HOME: '/home/op/.pnpm',
    XDG_CONFIG_HOME: '/home/op/.config',
    TMPDIR: '/tmp',
    CLOUDFLARE_API_TOKEN: TOKEN,
  });
  const tier1NoToken = childEnvFor(1, { base: SERVER_ENV });
  assert.equal('CLOUDFLARE_API_TOKEN' in tier1NoToken, false, 'nothing is inherited from CLOUDFLARE_API_TOKEN');
  assert.equal('CF_API_TOKEN' in tier1NoToken, false);
  assert.equal('CLOUDFLARE_API_TOKEN' in childEnvFor(1, { base: SERVER_ENV, token: '  ' }), false, 'a blank token is unset');

  const tier2 = childEnvFor(2, { base: SERVER_ENV, token: TOKEN });
  assert.equal('CLOUDFLARE_API_TOKEN' in tier2, false, 'tier 2 never gets a token, even when one is offered');
  for (const key of Object.keys(tier2)) assert.doesNotMatch(key, /^(AQ_|CF_|CLOUDFLARE_|R2_|JWT_)/, key);
  assert.deepEqual(childEnvFor(2, { base: { PATH: 'p', FOO: undefined } }), { PATH: 'p' });
  assert.throws(() => childEnvFor(3, { base: {} }), /tier must be 1 or 2/);
});

// -- tier 1: routes -----------------------------------------------------------

test('system_health answers GET /v1/admin/ops/health as is', async () => {
  const { byName, client, spawn } = build();
  const result = await byName.system_health.run({});
  assert.deepEqual(client.calls, [{ method: 'GET', path: '/v1/admin/ops/health', body: undefined }]);
  assert.deepEqual(result, { status: 'ok', dependencies: { d1: { ok: true, latencyMs: 3 } } });
  assert.equal(spawn.calls.length, 0);
});

test('job_runs encodes only the given filters into the query; a bad since is a refusal', async () => {
  assert.equal(jobRunsQuery({}), '');
  assert.equal(jobRunsQuery({ job: 'billing', since: '2026-10-01T00:00:00Z', limit: 5 }), '?job=billing&since=2026-10-01T00%3A00%3A00Z&limit=5');
  assert.equal(jobRunsQuery({ limit: 200 }), '?limit=200');

  const { byName, client } = build();
  await byName.job_runs.run({});
  await byName.job_runs.run({ job: 'sweep_submissions', since: '2026-10-01T00:00:00Z', limit: 10 });
  assert.deepEqual(client.calls.map((c) => c.path), [
    '/v1/admin/ops/job-runs',
    '/v1/admin/ops/job-runs?job=sweep_submissions&since=2026-10-01T00%3A00%3A00Z&limit=10',
  ]);
  const refused = await byName.job_runs.run({ since: 'yesterday' });
  assert.equal(refused.refused, true);
  assert.match(refused.reason, /ISO 8601/);
  assert.equal(client.calls.length, 2, 'no call for a refused since');
});

// -- tier 1: scripts ----------------------------------------------------------

test('backup_status spawns status.mjs --json with the read token in the child env only; exit 2 is data', async () => {
  const { byName, spawn } = build();
  const result = await byName.backup_status.run({});
  assert.equal(spawn.calls.length, 1);
  const [call] = spawn.calls;
  assert.equal(call.file, process.execPath);
  assert.deepEqual(call.args, ['scripts/backup/status.mjs', '--label', 'budo', '-e', 'production', '--json']);
  assert.equal(call.cwd, '/repo');
  assert.equal(call.env.CLOUDFLARE_API_TOKEN, TOKEN, 'tier 1 runs on AQ_CF_READ_TOKEN');
  assert.equal('AQ_CF_READ_TOKEN' in call.env, false);
  assert.equal('AQ_ADMIN_PASSWORD' in call.env, false);
  assert.deepEqual(result, STATUS_REPORT, 'the --json document, as is');
  assert.equal('note' in result, false);
  assertNoLeak(spawn, result);
});

test('backup_status without AQ_CF_READ_TOKEN runs on the wrangler session and says so', async () => {
  const { byName, spawn } = build({ config: NO_TOKEN_CONFIG });
  const result = await byName.backup_status.run({});
  assert.equal('CLOUDFLARE_API_TOKEN' in spawn.calls[0].env, false);
  assert.equal(result.note, NO_TOKEN_NOTE);
  assert.equal(result.status, 'amber');
  assertNoLeak(spawn, result);
});

test('backup_status: a red report (exit 1) is data; a non-JSON stdout, a refusal exit or a spawn failure is an error', async () => {
  const red = build({ spawn: stubSpawn({ status: { status: 1, stdout: JSON.stringify({ ...STATUS_REPORT, status: 'red' }), stderr: '' } }) });
  assert.equal((await red.byName.backup_status.run({})).status, 'red');

  const garbage = build({ spawn: stubSpawn({ status: { status: 1, stdout: '', stderr: '  ✖  refusing -e staging: only production is backed up\n' } }) });
  await assert.rejects(garbage.byName.backup_status.run({}), /printed no JSON \(✖ {2}refusing -e staging/);

  const broken = build({ spawn: stubSpawn({ status: { status: 0, stdout: '{ not json', stderr: '' } }) });
  await assert.rejects(broken.byName.backup_status.run({}), /printed invalid JSON/);

  const crashed = build({ spawn: stubSpawn({ status: { status: 3, stdout: '', stderr: 'boom\nmore' } }) });
  await assert.rejects(crashed.byName.backup_status.run({}), /exited 3: boom$/);

  const missing = build({ spawn: stubSpawn({ status: { status: null, stdout: '', stderr: '', error: new Error('ENOENT') } }) });
  await assert.rejects(missing.byName.backup_status.run({}), /could not be started: ENOENT/);
});

test('time_travel_status returns the timeTravel slice and reuses a report younger than 30 s (one spawn)', async () => {
  const { byName, spawn, tick } = build();
  const first = await byName.time_travel_status.run({});
  assert.deepEqual(first, {
    label: 'budo',
    env: 'production',
    checkedAt: STATUS_REPORT.checkedAt,
    bookmark: BOOKMARK,
    windowNote: STATUS_REPORT.data.timeTravel.windowNote,
    line: STATUS_REPORT.lines[1],
  });
  assert.equal(spawn.ofKind('status').length, 1);

  tick(STATUS_CACHE_MS);
  await byName.time_travel_status.run({});
  assert.equal(spawn.ofKind('status').length, 1, 'within 30 s: cached');

  tick(1);
  await byName.time_travel_status.run({});
  assert.equal(spawn.ofKind('status').length, 2, 'after 30 s: spawned again');

  // backup_status always spawns and refreshes the cache time_travel_status reads.
  await byName.backup_status.run({});
  await byName.time_travel_status.run({});
  assert.equal(spawn.ofKind('status').length, 3);

  const noToken = build({ config: NO_TOKEN_CONFIG });
  assert.equal((await noToken.byName.time_travel_status.run({})).note, NO_TOKEN_NOTE);
  assertNoLeak(spawn, first);
});

test('infra_status spawns provision-label.mjs --check --json for the server env or the given one; exit 1 is data', async () => {
  const { byName, spawn } = build();
  const result = await byName.infra_status.run({});
  assert.deepEqual(spawn.calls[0].args, ['scripts/cloudflare/provision-label.mjs', '--label', 'budo', '-e', 'production', '--check', '--json']);
  assert.equal(spawn.calls[0].env.CLOUDFLARE_API_TOKEN, TOKEN);
  assert.deepEqual(result, INFRA_REPORT);

  await byName.infra_status.run({ env: 'staging' });
  assert.deepEqual(spawn.calls[1].args.slice(1), ['--label', 'budo', '-e', 'staging', '--check', '--json']);

  const staging = build({ config: STAGING_CONFIG });
  await staging.byName.infra_status.run({});
  assert.equal(staging.spawn.calls[0].args[4], 'staging', 'defaults to the server env');

  const noToken = build({ config: NO_TOKEN_CONFIG });
  assert.equal((await noToken.byName.infra_status.run({})).note, NO_TOKEN_NOTE);
  assertNoLeak(spawn, result);
});

// -- tier 2: backup_now -------------------------------------------------------

test('backup_now without an id spawns only the dry run and returns the plan with a single-use id', async () => {
  const { byName, spawn } = build();
  const plan = await byName.backup_now.run({});
  assert.deepEqual(spawn.calls.map((c) => c.kind), ['export-dry']);
  assert.deepEqual(spawn.calls[0].args, ['scripts/backup/export-d1.mjs', '--label', 'budo', '-e', 'production', '--dry-run']);
  assert.match(plan.plan, /D1 backup — budo production/);
  assert.match(plan.plan, /dry run: no wrangler call was made/);
  assert.match(plan.confirmationId, /^[0-9a-f]{32}$/);
  assert.equal(plan.expiresAt, '2026-10-18T10:05:00.000Z');
  assert.match(plan.note, /plan only — nothing was executed/);
  assert.match(plan.note, /single use/);
  assert.equal(plan.refused, undefined);
  assertNoLeak(spawn, plan);
});

test('backup_now with the id runs the export once, on the operator session (no token in the child env)', async () => {
  const { byName, spawn } = build();
  const plan = await byName.backup_now.run({});
  const done = await byName.backup_now.run({ confirmationId: plan.confirmationId });
  assert.deepEqual(spawn.calls.map((c) => c.kind), ['export-dry', 'export-yes']);
  const run = spawn.calls[1];
  assert.deepEqual(run.args, ['scripts/backup/export-d1.mjs', '--label', 'budo', '-e', 'production', '--yes']);
  assert.equal('CLOUDFLARE_API_TOKEN' in run.env, false, 'tier 2 carries no token');
  assert.equal(run.env.HOME, '/home/op', 'the wrangler login session is reachable');
  assert.deepEqual(done, {
    ok: true,
    label: 'budo',
    env: 'production',
    finishedAt: '2026-10-18T10:00:00.000Z',
    summary: ['  →  1. export …', '  →  2. gzip …', '  ✔  budo-db backed up: d1/production/daily/2026/10/18/x.sql.gz (950 bytes)'],
  });
  assertNoLeak(spawn, plan, done);
});

test('backup_now refuses a reused, an expired, an unknown and a foreign (bookmark_now) id — without any spawn', async () => {
  const { byName, spawn, tick } = build();
  const plan = await byName.backup_now.run({});
  await byName.backup_now.run({ confirmationId: plan.confirmationId });
  const before = spawn.calls.length;

  const reused = await byName.backup_now.run({ confirmationId: plan.confirmationId });
  assert.equal(reused.refused, true);
  assert.equal(reused.code, 'used');
  assert.match(reused.reason, /already used/);

  const unknown = await byName.backup_now.run({ confirmationId: 'deadbeef' });
  assert.deepEqual([unknown.refused, unknown.code], [true, 'unknown']);

  const bookmarkPlan = await byName.bookmark_now.run({});
  const foreign = await byName.backup_now.run({ confirmationId: bookmarkPlan.confirmationId });
  assert.deepEqual([foreign.refused, foreign.code], [true, 'tool-mismatch']);
  assert.match(foreign.reason, /issued for another tool/);

  const fresh = await byName.backup_now.run({});
  tick(5 * 60_000);
  const expired = await byName.backup_now.run({ confirmationId: fresh.confirmationId });
  assert.deepEqual([expired.refused, expired.code], [true, 'expired']);

  assert.deepEqual(spawn.calls.slice(before).map((c) => c.kind), ['export-dry'], 'only the fresh plan spawned (a dry run)');
  assert.equal(spawn.ofKind('export-yes').length, 1, 'the export ran exactly once in total');
});

test('backup_now: a failing dry run or export is an error (first stderr line), never a silent success', async () => {
  const badPlan = build({ spawn: stubSpawn({ 'export-dry': { status: 1, stdout: '', stderr: '  ✖  config/labels/budo.jsonc has no environments.production.backup.bucket\n' } }) });
  await assert.rejects(badPlan.byName.backup_now.run({}), /--dry-run exited 1: ✖ {2}config\/labels\/budo\.jsonc has no/);
  assert.equal(badPlan.confirmations.size(), 0, 'no id is issued for a plan that failed');

  const badRun = build({ spawn: stubSpawn({ 'export-yes': { status: 1, stdout: '', stderr: 'wrangler d1 export failed\n' } }) });
  const plan = await badRun.byName.backup_now.run({});
  await assert.rejects(badRun.byName.backup_now.run({ confirmationId: plan.confirmationId }), /export-d1\.mjs exited 1: wrangler d1 export failed/);
});

// -- tier 2: bookmark_now -----------------------------------------------------

test('bookmark_now: the plan is the bookmark command; the confirmed call spawns exactly it with no token and returns the restore command as text', async () => {
  const { byName, spawn } = build();
  const target = { database: 'budo-db', wranglerEnv: 'budo' };
  const plan = await byName.bookmark_now.run({});
  assert.equal(spawn.calls.length, 0, 'planning spawns nothing');
  assert.equal(plan.plan, formatCommand(bookmarkCommand(target)));
  assert.equal(plan.plan, 'pnpm --filter api exec wrangler d1 time-travel info budo-db --env budo --json');
  assert.deepEqual([plan.database, plan.wranglerEnv], ['budo-db', 'budo']);
  assert.match(plan.confirmationId, /^[0-9a-f]{32}$/);

  const done = await byName.bookmark_now.run({ confirmationId: plan.confirmationId });
  assert.equal(spawn.calls.length, 1);
  const [call] = spawn.calls;
  assert.deepEqual([call.file, ...call.args], bookmarkCommand(target));
  assert.equal(call.cwd, '/repo');
  assert.equal('CLOUDFLARE_API_TOKEN' in call.env, false, 'tier 2 carries no token');
  assert.equal(done.bookmark, BOOKMARK);
  assert.equal(done.recordedAt, '2026-10-18T10:00:00.000Z');
  assert.equal(typeof done.restoreCommand, 'string');
  assert.equal(done.restoreCommand, formatCommand(restoreCommand(target, BOOKMARK)));
  assert.match(done.restoreCommand, /time-travel restore budo-db --bookmark=/);
  assert.match(done.note, /never runs it/);
  for (const c of spawn.calls) assert.equal(c.args.includes('restore'), false, 'the restore command is text, never spawned');

  const replay = await byName.bookmark_now.run({ confirmationId: plan.confirmationId });
  assert.deepEqual([replay.refused, replay.code], [true, 'used']);
  assert.equal(spawn.calls.length, 1);
  assertNoLeak(spawn, plan, done);
});

test('bookmark_now follows the server environment and fails clearly without a database name or a bookmark', async () => {
  const staging = build({ config: STAGING_CONFIG });
  const plan = await staging.byName.bookmark_now.run({});
  assert.equal(plan.plan, 'pnpm --filter api exec wrangler d1 time-travel info budo-db-staging --env budo-staging --json');

  const nameless = build({ config: { ...CONFIG, ops: { ...CONFIG.ops, database: null } } });
  await assert.rejects(nameless.byName.bookmark_now.run({}), /has no environments\.production\.d1\.name/);

  const failing = build({ spawn: stubSpawn({ bookmark: { status: 1, stdout: '', stderr: 'Not logged in.\n' } }) });
  const p = await failing.byName.bookmark_now.run({});
  await assert.rejects(failing.byName.bookmark_now.run({ confirmationId: p.confirmationId }), /time-travel info exited 1: Not logged in\./);

  const empty = build({ spawn: stubSpawn({ bookmark: { status: 0, stdout: '{}', stderr: '' } }) });
  const q = await empty.byName.bookmark_now.run({});
  await assert.rejects(empty.byName.bookmark_now.run({ confirmationId: q.confirmationId }), /returned no bookmark/);
});

// -- tier 3 -------------------------------------------------------------------

test('restore_instructions spawns nothing and returns the command, the runbook anchor and the steps per scenario', async () => {
  const spawn = () => {
    throw new Error('restore_instructions must not spawn');
  };
  const { byName, client } = build({ spawn });

  const minutes = await byName.restore_instructions.run({ scenario: 'minutes-ago', bookmark: BOOKMARK });
  assert.equal(minutes.runbook, `${RUNBOOK}#1-d1-time-travel`);
  assert.equal(minutes.command, `pnpm --filter api exec wrangler d1 time-travel restore budo-db --bookmark=${BOOKMARK} --env budo`);
  assert.ok(minutes.steps.length >= 3);
  assert.match(minutes.note, /never runs this/);
  const placeholder = await byName.restore_instructions.run({ scenario: 'minutes-ago' });
  assert.match(placeholder.command, /--bookmark=<bookmark> --env budo$/);

  const lost = await byName.restore_instructions.run({ scenario: 'database-lost' });
  assert.equal(lost.runbook, `${RUNBOOK}#2-restore-a-dump`);
  assert.match(lost.command, /r2 object get budo-backups\/d1\/production\/manifest\.json/);
  assert.match(lost.command, /d1 create budo-db-restored\n.*d1 execute budo-db-restored --remote --file dump\.sql$/);
  assert.ok(lost.steps.some((step) => /checksum or size mismatch/.test(step)));

  const object = await byName.restore_instructions.run({ scenario: 'object-deleted' });
  assert.equal(object.runbook, `${RUNBOOK}#3-r2-copy-back`);
  assert.match(object.command, /r2 object get budo-backups\/r2\/production\/<key>/);
  assert.match(object.command, /r2 object put budo-media\/<key>/);

  for (const result of [minutes, lost, object]) {
    assert.equal(result.label, 'budo');
    assert.equal(typeof result.command, 'string');
    assert.ok(Array.isArray(result.steps));
  }
  assert.equal(client.calls.length, 0, 'no API call either');
  await assert.rejects(byName.restore_instructions.run({ scenario: 'everything' }), /scenario must be one of minutes-ago \| database-lost \| object-deleted/);
});

test('restoreInstructionsFor falls back to the runbook conventions when the profile names are absent', () => {
  const bare = restoreInstructionsFor({ label: 'x' }, { scenario: 'object-deleted' });
  assert.match(bare.command, /x-backups\/r2\/production\/<key>/);
  assert.match(bare.command, /x-media\/<key>/);
  const lost = restoreInstructionsFor({ label: 'x' }, { scenario: 'database-lost' });
  assert.match(lost.command, /d1 create x-db-restored/);
});

// -- the envelope: audit of a refused confirmation -----------------------------

test('callTool audits every ops call, a refused confirmation included, and never writes the token', async () => {
  const lines = [];
  const audit = { record: (line) => lines.push(line) };
  let clock = 0;
  const now = () => (clock += 5);
  const { byName, spawn } = build();

  const health = await callTool(byName.system_health, {}, { audit, now });
  assert.equal(health.isError, undefined);
  const plan = JSON.parse((await callTool(byName.backup_now, {}, { audit, now })).content[0].text);
  const refused = await callTool(byName.backup_now, { confirmationId: 'nope' }, { audit, now });
  assert.equal(refused.isError, undefined);
  assert.equal(JSON.parse(refused.content[0].text).refused, true);
  const ok = await callTool(byName.backup_now, { confirmationId: plan.confirmationId }, { audit, now });
  assert.equal(ok.isError, undefined);
  const failed = await callTool(byName.restore_instructions, { scenario: 'nope' }, { audit, now });
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /^restore_instructions failed: restore_instructions: scenario must be one of/);

  assert.deepEqual(lines.map((l) => [l.tool, l.outcome]), [
    ['system_health', 'ok'],
    ['backup_now', 'ok'],
    ['backup_now', 'refused'],
    ['backup_now', 'ok'],
    ['restore_instructions', 'error'],
  ]);
  assert.deepEqual(lines[3].args, { confirmationId: plan.confirmationId }, 'the id is auditable; it is not a credential');
  assert.equal(JSON.stringify(lines).includes(TOKEN), false);
  assertNoLeak(spawn);
});
