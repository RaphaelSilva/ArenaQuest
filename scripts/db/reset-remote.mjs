#!/usr/bin/env node
/**
 * reset-remote.mjs — make a label's staging D1 disposable (RFC 0021 §4).
 *
 *   AQ_DEMO_PASSWORD=… node scripts/db/reset-remote.mjs --label <label> -e staging [--dry-run] [--yes]
 *
 * The order is fixed, and each step runs only if the previous one succeeded:
 *   1. bookmark — `wrangler d1 time-travel info <db> --json` records the current
 *      Time Travel bookmark and the exact restore command is printed, so the
 *      reset itself can be undone. No bookmark → abort before anything is dropped;
 *   2. drop     — every table (and view) in `sqlite_master` except `sqlite_*` and
 *      `_cf_*` is dropped in one statement batch that starts with
 *      `PRAGMA defer_foreign_keys = on` (D1 forbids `foreign_keys = off`).
 *      `d1_migrations` is dropped too, so a migration that exists only on
 *      staging (an abandoned candidate) is forgotten along with its tables;
 *   3. migrate  — `wrangler d1 migrations apply <db> --remote` from this checkout;
 *   4. seed     — the demo seed's own CLI, `seed-demo.mjs --label <l> -e staging --yes`.
 *
 * The database is emptied IN PLACE: its `database_id` never changes, so neither
 * the label profile nor `wrangler.jsonc` needs an edit. The bucket is left alone
 * (the demo re-uses its own objects; anything else becomes an orphan for the
 * RFC 0018 audit).
 *
 * Refusals run before any wrangler call, and there is no flag that skips them:
 *   - `-e production` and `-e local` (local has `make db-reset-local`);
 *   - a staging D1 / R2 bucket named in ANY profile's production block — the
 *     target resolution and that refusal are the seed's own `resolveTarget`.
 * `AQ_DEMO_PASSWORD` is checked before step 1 too, so a reset never ends with an
 * empty database for want of the seed's password.
 *
 * `--dry-run` prints the plan and stops: no wrangler call, no credentials needed.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs as nodeParseArgs } from 'node:util';

import log from '../lib/log.mjs';
import { PASSWORD_VAR, loadAllProfiles, parseD1Json, readPassword, resolveTarget } from '../demo/seed-demo.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE)); // repo root (scripts/db/..)
const SEED_SCRIPT = join('scripts', 'demo', 'seed-demo.mjs');
const WRANGLER = ['pnpm', '--filter', 'api', 'exec', 'wrangler'];

export const ENVS = ['staging'];

/** Tables and views the reset drops: everything but SQLite's and Cloudflare's own. */
export const LIST_OBJECTS_QUERY =
  "SELECT type, name FROM sqlite_master WHERE type IN ('table', 'view') " +
  "AND substr(name, 1, 7) <> 'sqlite_' AND substr(name, 1, 4) <> '_cf_' ORDER BY type DESC, name";

// ════════════════════════════════════════════════════════════════════════════
// PURE: arguments, target, commands
// ════════════════════════════════════════════════════════════════════════════

export function parseResetArgs(argv) {
  let values;
  try {
    ({ values } = nodeParseArgs({
      args: argv,
      options: {
        label: { type: 'string' },
        env: { type: 'string', short: 'e' },
        'dry-run': { type: 'boolean' },
        yes: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    throw new Error(`invalid arguments: ${error.message}`);
  }
  if (values.help) return { help: true };
  if (!values.label || !/^[a-z][a-z0-9-]*$/.test(values.label)) throw new Error('--label <label> is required (lowercase kebab-case)');
  if (values.env === 'production') {
    throw new Error('refusing -e production: only staging is disposable (RFC 0021 §4)');
  }
  if (values.env === 'local') {
    throw new Error('refusing -e local: reset the local replica with `make db-reset-local`');
  }
  if (!ENVS.includes(values.env)) {
    throw new Error(`-e/--env must be staging (got ${values.env === undefined ? 'nothing' : `"${values.env}"`})`);
  }
  return { label: values.label, env: values.env, dryRun: Boolean(values['dry-run']), yes: Boolean(values.yes) };
}

/**
 * The remote staging target of `label` — the seed's `resolveTarget`, so the
 * production-name refusal is the same code. Throws on anything but a remote target.
 */
export function resolveResetTarget({ label, env, profiles }) {
  if (env !== 'staging') throw new Error(`refusing -e ${env}: only staging is disposable`);
  const target = resolveTarget({ label, env, profiles });
  if (!target.remote) throw new Error(`refusing: ${target.database} is not a remote database`);
  return target;
}

export function bookmarkCommand(target) {
  return [...WRANGLER, 'd1', 'time-travel', 'info', target.database, ...envArgs(target), '--json'];
}

/** Printed, never run: the undo for the reset. */
export function restoreCommand(target, bookmark) {
  return [...WRANGLER, 'd1', 'time-travel', 'restore', target.database, `--bookmark=${bookmark}`, ...envArgs(target)];
}

export function listObjectsCommand(target) {
  return [...WRANGLER, 'd1', 'execute', target.database, ...target.wranglerArgs, '--command', LIST_OBJECTS_QUERY, '--json'];
}

export function dropCommand(target, sql) {
  return [...WRANGLER, 'd1', 'execute', target.database, ...target.wranglerArgs, '--command', sql, '--yes'];
}

export function migrateCommand(target) {
  return [...WRANGLER, 'd1', 'migrations', 'apply', target.database, ...target.wranglerArgs];
}

export function seedCommand(label, env = 'staging') {
  return [process.execPath, SEED_SCRIPT, '--label', label, '-e', env, '--yes'];
}

/** `--env <label>-staging` (time-travel is remote-only and takes no --remote). */
function envArgs(target) {
  return target.wranglerEnv ? ['--env', target.wranglerEnv] : [];
}

/** The bookmark from `wrangler d1 time-travel info --json` (banners before the JSON are skipped). */
export function parseBookmark(stdout) {
  const text = String(stdout ?? '');
  const start = text.search(/^\{/m);
  if (start < 0) throw new Error('wrangler d1 time-travel info --json printed no JSON object');
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start));
  } catch (error) {
    throw new Error(`wrangler d1 time-travel info --json printed invalid JSON: ${error.message}`);
  }
  const bookmark = parsed?.bookmark;
  if (typeof bookmark !== 'string' || bookmark.trim() === '') throw new Error('wrangler d1 time-travel info --json returned no bookmark');
  return bookmark;
}

/** `[{ type, name }]` → the objects to drop, re-filtered here (defence in depth). */
export function droppableObjects(rows) {
  return rows
    .filter((row) => (row.type === 'table' || row.type === 'view') && typeof row.name === 'string')
    .filter((row) => !row.name.startsWith('sqlite_') && !row.name.startsWith('_cf_'))
    .map((row) => ({ type: row.type, name: row.name }));
}

function quoteIdent(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

/** One batch: defer FK checks, drop views first (they reference tables), then every table. */
export function buildDropSql(objects) {
  const views = objects.filter((object) => object.type === 'view');
  const tables = objects.filter((object) => object.type === 'table');
  return [
    'PRAGMA defer_foreign_keys = on;',
    ...views.map((view) => `DROP VIEW IF EXISTS ${quoteIdent(view.name)};`),
    ...tables.map((table) => `DROP TABLE IF EXISTS ${quoteIdent(table.name)};`),
  ].join(' ');
}

/** Human-readable plan (what `--dry-run` prints, and the preamble of a real run). */
export function formatPlan(target, label) {
  return [
    `1. bookmark  ${formatCommand(bookmarkCommand(target))}`,
    `             → prints: ${formatCommand(restoreCommand(target, '<bookmark>'))}`,
    `2. drop      ${formatCommand(listObjectsCommand(target))}`,
    `             → every table/view except sqlite_* and _cf_* (d1_migrations included), in one batch:`,
    `               PRAGMA defer_foreign_keys = on; DROP VIEW …; DROP TABLE …;`,
    `3. migrate   ${formatCommand(migrateCommand(target))}`,
    `4. seed      ${formatCommand(seedCommand(label, target.env))}`,
  ];
}

export function formatCommand(command) {
  return command
    .map((part) => (part === process.execPath ? 'node' : /^[\w@%+=:,./<>-]+$/.test(part) ? part : `'${part.replaceAll("'", "'\\''")}'`))
    .join(' ');
}

// ════════════════════════════════════════════════════════════════════════════
// I/O
// ════════════════════════════════════════════════════════════════════════════

/** Captured run (bookmark, list, drop): spawnSync's shape. */
function runCaptured(command) {
  return spawnSync(command[0], command.slice(1), {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Streamed run (migrate, seed). stdin is closed: the operator has already
 * confirmed, and wrangler skips its own apply prompt when stdin is not a TTY.
 */
function runStreamed(command) {
  return spawnSync(command[0], command.slice(1), { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
}

function check(result, what) {
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    throw new Error(`${what} exited with status ${result.status}`);
  }
  return result;
}

async function askDatabaseName(target, label) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) =>
    rl.question(
      `This DROPS every table in remote D1 "${target.database}" (${label} staging) and re-seeds the demo. Type the database name to confirm: `,
      resolve,
    ),
  );
  rl.close();
  return answer;
}

export async function confirmReset(target, label, { yes, isTTY = Boolean(process.stdin.isTTY), ask = askDatabaseName }) {
  if (yes) return;
  if (!isTTY) throw new Error(`resetting remote D1 "${target.database}" needs confirmation: re-run with --yes (no TTY to ask on)`);
  const answer = await ask(target, label);
  if (String(answer).trim() !== target.database) throw new Error('aborted: the database name did not match');
}

/**
 * Steps 1–4 against an already-resolved and confirmed `target`. `run` captures
 * output (bookmark, list, drop); `stream` shows it (migrate, seed). Returns
 * `{ bookmark, restore, dropped }`, or throws — naming the restore command
 * whenever the failure comes after the bookmark.
 */
export function executeReset({ target, label, run = runCaptured, stream = runStreamed, seed = seedCommand(label, target.env) }) {
  // 1. bookmark — nothing is dropped unless this succeeds.
  let bookmark;
  try {
    bookmark = parseBookmark(check(run(bookmarkCommand(target)), 'wrangler d1 time-travel info').stdout);
  } catch (error) {
    throw new Error(`aborted before dropping anything: could not record a Time Travel bookmark (${error.message})`);
  }
  const restore = formatCommand(restoreCommand(target, bookmark));
  log.ok(`bookmark ${bookmark}`);
  log.hint(`undo this reset with: ${restore}`);

  const afterBookmark = (what, fn) => {
    try {
      return fn();
    } catch (error) {
      throw new Error(`${what} failed: ${error.message}\n     restore the pre-reset data with: ${restore}`);
    }
  };

  // 2. drop
  const dropped = afterBookmark('dropping the tables', () => {
    const objects = droppableObjects(parseD1Json(check(run(listObjectsCommand(target)), 'listing the tables').stdout));
    if (objects.length === 0) {
      log.warn(`${target.database} holds no tables: nothing to drop`);
      return [];
    }
    log.info(`dropping ${objects.length} objects: ${objects.map((object) => object.name).join(', ')}`);
    check(run(dropCommand(target, buildDropSql(objects))), 'the drop batch');
    const left = droppableObjects(parseD1Json(check(run(listObjectsCommand(target)), 'listing the tables').stdout));
    if (left.length > 0) throw new Error(`still present after the drop: ${left.map((object) => object.name).join(', ')}`);
    return objects.map((object) => object.name);
  });
  log.ok(`dropped ${dropped.length} tables/views (d1_migrations included)`);

  // 3. migrate
  afterBookmark('applying the migrations', () => {
    log.info(`running ${formatCommand(migrateCommand(target))}`);
    check(stream(migrateCommand(target)), 'wrangler d1 migrations apply');
  });
  log.ok('migrations applied from this checkout');

  // 4. seed
  afterBookmark('the demo seed', () => {
    log.info(`running ${formatCommand(seed)}`);
    check(stream(seed), 'seed-demo.mjs');
  });
  log.ok('demo seed loaded');
  return { bookmark, restore, dropped };
}

function usage() {
  console.log(`Usage: ${PASSWORD_VAR}=… node scripts/db/reset-remote.mjs --label <label> -e staging [--dry-run] [--yes]`);
}

/**
 * `deps` exists for the tests: `profiles`, `run`, `stream`, `isTTY`, `ask`.
 * Returns 0, or throws.
 */
export async function main(argv = process.argv.slice(2), envVars = process.env, deps = {}) {
  const { profiles = null, run = runCaptured, stream = runStreamed, isTTY = Boolean(process.stdin.isTTY), ask = askDatabaseName } = deps;
  const args = parseResetArgs(argv);
  if (args.help) {
    usage();
    return 0;
  }

  // Refusals first: no wrangler call happens before these pass.
  const target = resolveResetTarget({ label: args.label, env: args.env, profiles: profiles ?? loadAllProfiles() });
  const password = readPassword(envVars, args);

  log.heading(`Reset staging — ${args.label} → ${target.database} (env ${target.wranglerEnv})`);
  for (const line of formatPlan(target, args.label)) log.info(line);
  log.info('the bucket is not emptied: the demo re-uses its own objects');

  if (args.dryRun) {
    if (password === null) log.warn(`${PASSWORD_VAR} unset: a real run needs it for step 4`);
    log.ok('dry run: no wrangler call was made');
    return 0;
  }

  await confirmReset(target, args.label, { yes: args.yes, isTTY, ask });
  const { restore } = executeReset({ target, label: args.label, run, stream });
  log.ok(`${target.database} reset: same database_id, migrations from this checkout, demo loaded`);
  log.hint(`undo: ${restore}`);
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
