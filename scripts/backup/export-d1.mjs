#!/usr/bin/env node
/**
 * export-d1.mjs — take a production label's D1 off the database (RFC 0025 §4.1).
 *
 *   node scripts/backup/export-d1.mjs --label <label> -e production [--dry-run] [--yes]
 *
 * For one label, in a fixed order where each step runs only if the previous
 * one succeeded:
 *   0. manifest — `d1/production/manifest.json` is READ first (a corrupt one
 *      aborts before the database is touched; a missing one is the first run);
 *   1. export   — `wrangler d1 export <db> --remote --env <label> --output <tmp>.sql -y`,
 *      timed on its own (`durationMs`), so "the export holds the database" is observable;
 *   2. count    — the table list from `sqlite_master`, then ONE `UNION ALL`
 *      `SELECT COUNT(*)` statement → `{ table: n }`. Nothing but these two
 *      SELECTs and the export reaches D1: the script never writes to it;
 *   3. gzip     — zlib level 9;
 *   4. hash     — SHA-256 + size of the gzipped dump;
 *   5. put      — `d1/production/daily/YYYY/MM/DD/<stamp>.sql.gz`;
 *   6. verify   — the object is fetched back and compared, bytes and SHA-256;
 *   7. monthly  — on the first run of a calendar month, a second copy under
 *      `d1/production/monthly/YYYY/MM/`;
 *   8. manifest — `latest` + appended `history` entry, written ONLY after verify.
 *
 * Integrity first: a failure anywhere exits non-zero and leaves the previous
 * manifest untouched, so `latest` always names an object whose hash matched.
 *
 * Refusals run before any wrangler call, and no flag skips them: `-e staging`,
 * `-e local`, an unknown environment, a profile without `backup.bucket` or
 * `d1.name`, a production database that is also a staging name in some profile,
 * and a backup bucket that is also a media bucket. Mirrors the demo seed's
 * `resolveTarget` in the other direction.
 *
 * `--dry-run` prints the plan with its keys and stops: no wrangler call, no
 * credentials needed. `--yes` is how a real run is acknowledged — the script
 * never prompts; `make backup-d1-prod` asks (`confirm-prod`) and passes it.
 * No secret is handled: credentials are wrangler's context (`wrangler login`
 * locally, `CF_API_TOKEN` in CI), as for the deploy CLI.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { parseArgs as nodeParseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

import log from '../lib/log.mjs';
import { backupBucketName } from '../label.mjs';
import { loadAllProfiles, parseD1Json } from '../demo/seed-demo.mjs';
import {
  appendD1Entry,
  emptyManifest,
  getObjectCommand,
  monthlyCopyNeeded,
  objectKeys,
  parseManifest,
  putObjectCommand,
  runCaptured,
  serializeManifest,
  wranglerObjectStore,
} from './manifest.mjs';

const WRANGLER = ['pnpm', '--filter', 'api', 'exec', 'wrangler'];

export const ENVS = ['production'];
export const DUMP_CONTENT_TYPE = 'application/gzip';
export const MANIFEST_CONTENT_TYPE = 'application/json';

/** Every user table: SQLite's and Cloudflare's own are left out. */
export const LIST_TABLES_QUERY =
  "SELECT name FROM sqlite_master WHERE type = 'table' " +
  "AND substr(name, 1, 7) <> 'sqlite_' AND substr(name, 1, 4) <> '_cf_' ORDER BY name";

// ════════════════════════════════════════════════════════════════════════════
// PURE: arguments, target, commands, plan
// ════════════════════════════════════════════════════════════════════════════

export function parseArgs(argv) {
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
  if (values.env === undefined || values.env === '') throw new Error('-e/--env is required (production)');
  return { label: values.label, env: values.env, dryRun: Boolean(values['dry-run']), yes: Boolean(values.yes) };
}

/**
 * Where the export goes: `{ label, env, database, bucket, wranglerEnv }`.
 * Throws — before anything is spawned — on any environment but production and
 * on a profile that cannot be backed up safely.
 */
export function resolveBackupTarget({ label, env, profiles }) {
  if (env === 'staging') throw new Error('refusing -e staging: only production is backed up (staging is disposable, RFC 0021 §4)');
  if (env === 'local') throw new Error('refusing -e local: the local replica is not backed up (make db-reset-local rebuilds it)');
  if (!ENVS.includes(env)) throw new Error(`unknown environment "${env}" (expected ${ENVS.join('|')})`);
  const profile = profiles?.[label];
  if (!profile) throw new Error(`profile not found: config/labels/${label}.jsonc`);

  const production = profile.environments?.production;
  const database = production?.d1?.name;
  if (!database) throw new Error(`config/labels/${label}.jsonc has no environments.production.d1.name`);
  const bucket = backupBucketName(profile, env);
  if (!bucket) throw new Error(`config/labels/${label}.jsonc has no environments.production.backup.bucket (RFC 0025: run make infra-check-production LABEL=${label})`);

  for (const [otherLabel, other] of Object.entries(profiles)) {
    for (const [otherEnv, block] of Object.entries(other?.environments ?? {})) {
      if (otherEnv !== 'production' && block?.d1?.name === database) {
        throw new Error(`refusing: production D1 "${database}" of "${label}" is the ${otherEnv} database name of "${otherLabel}"`);
      }
      if (block?.r2?.bucket === bucket) {
        throw new Error(`refusing: backup bucket "${bucket}" of "${label}" is the ${otherEnv} media bucket of "${otherLabel}"`);
      }
    }
  }
  return { label, env, database, bucket, wranglerEnv: label };
}

export function exportCommand(target, outputPath) {
  return [...WRANGLER, 'd1', 'export', target.database, '--remote', '--env', target.wranglerEnv, '--output', outputPath, '-y'];
}

export function listTablesCommand(target) {
  return [...WRANGLER, 'd1', 'execute', target.database, '--remote', '--env', target.wranglerEnv, '--command', LIST_TABLES_QUERY, '--json'];
}

function quoteIdent(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

function quoteLiteral(text) {
  return `'${text.replaceAll("'", "''")}'`;
}

/** One statement: `SELECT 'users' AS t, COUNT(*) AS n FROM "users" UNION ALL …`. */
export function buildCountSql(tables) {
  if (tables.length === 0) throw new Error('buildCountSql: no tables');
  return tables.map((name) => `SELECT ${quoteLiteral(name)} AS t, COUNT(*) AS n FROM ${quoteIdent(name)}`).join(' UNION ALL ');
}

export function countCommand(target, tables) {
  return [...WRANGLER, 'd1', 'execute', target.database, '--remote', '--env', target.wranglerEnv, '--command', buildCountSql(tables), '--json'];
}

/** `[{ name }]` → the table names, re-filtered here (defence in depth). */
export function tableNames(rows) {
  return rows
    .map((row) => row?.name)
    .filter((name) => typeof name === 'string' && name !== '' && !name.startsWith('sqlite_') && !name.startsWith('_cf_'));
}

/** `[{ t, n }]` → `{ [table]: n }`, every requested table present with an integer count. */
export function rowCountsFrom(rows, tables) {
  const counts = {};
  for (const row of rows) {
    if (typeof row?.t === 'string') counts[row.t] = row.n;
  }
  const out = {};
  for (const table of tables) {
    const n = counts[table];
    if (!Number.isInteger(n) || n < 0) throw new Error(`row count for "${table}" is missing or not an integer (got ${JSON.stringify(n)})`);
    out[table] = n;
  }
  return out;
}

/**
 * The ordered steps of one export at instant `now`: `{ id, title, argv?, note }`.
 * `tmpDir` only names the paths the plan prints; the run makes its own.
 */
export function buildExportPlan(target, now, { tmpDir = '<tmp>' } = {}) {
  const keys = objectKeys(target.env, now);
  const sqlPath = join(tmpDir, 'dump.sql');
  const gzPath = join(tmpDir, basename(keys.daily));
  const backPath = join(tmpDir, 'verify.sql.gz');
  const manifestPath = join(tmpDir, 'manifest.json');
  return [
    {
      id: 'export',
      title: `export ${target.database} (remote, env ${target.wranglerEnv}) to a temp .sql`,
      argv: exportCommand(target, sqlPath),
      note: 'timed on its own → durationMs',
    },
    {
      id: 'count',
      title: 'count rows per table',
      argv: listTablesCommand(target),
      note: "then ONE statement: SELECT '<t>' AS t, COUNT(*) AS n FROM \"<t>\" UNION ALL … (read-only)",
    },
    { id: 'gzip', title: 'gzip the dump', note: `zlib level 9 → ${gzPath}` },
    { id: 'hash', title: 'hash the gzipped dump', note: 'SHA-256 + bytes' },
    {
      id: 'put',
      title: `upload the daily dump → ${keys.daily}`,
      argv: putObjectCommand(target.bucket, keys.daily, gzPath, DUMP_CONTENT_TYPE),
      note: `bucket ${target.bucket}`,
    },
    {
      id: 'verify',
      title: 'fetch the daily dump back and compare bytes + SHA-256',
      argv: getObjectCommand(target.bucket, keys.daily, backPath),
      note: 'a mismatch aborts before the manifest is written',
    },
    {
      id: 'monthly',
      title: `monthly copy → ${keys.monthly}`,
      argv: putObjectCommand(target.bucket, keys.monthly, gzPath, DUMP_CONTENT_TYPE),
      note: `only when d1.monthly has no entry for ${now.toISOString().slice(0, 7)} (first run of the month)`,
    },
    {
      id: 'manifest',
      title: `update ${keys.manifest}`,
      argv: putObjectCommand(target.bucket, keys.manifest, manifestPath, MANIFEST_CONTENT_TYPE),
      note: 'read before the upload (a corrupt manifest aborts early); latest + history entry written only after verify',
    },
  ];
}

export function renderCommand(argv) {
  return argv.map((part) => (/^[\w@%+=:,./<>-]+$/.test(part) ? part : `'${part.replaceAll("'", "'\\''")}'`)).join(' ');
}

/** Human-readable plan (what `--dry-run` prints, and the preamble of a real run). */
export function formatPlan(steps) {
  const lines = [];
  steps.forEach((step, index) => {
    lines.push(`${index + 1}. ${step.id.padEnd(9)}${step.title}`);
    if (step.argv) lines.push(`   $ ${renderCommand(step.argv)}`);
    if (step.note) lines.push(`   → ${step.note}`);
  });
  return lines;
}

// ════════════════════════════════════════════════════════════════════════════
// I/O
// ════════════════════════════════════════════════════════════════════════════

function check(result, what) {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n')[0] ?? '';
    throw new Error(`${what} exited with status ${result.status}${output ? `: ${output}` : ''}`);
  }
  return result;
}

function sha256Of(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Execute the plan against an already-resolved `target`. `run(argv)` returns
 * spawnSync's shape and is the only way out of the process (the tests inject
 * it); `store` defaults to `wranglerObjectStore(target.bucket, { run })`.
 * Temp files live under `mkdtempSync(join(tmpDir, 'aq-backup-'))` and are
 * removed whatever happens. Returns `{ entry, monthlyKey, manifest, keys }`,
 * or throws — the previous manifest is then untouched.
 */
export async function runExport(target, { run = runCaptured, now = new Date(), tmpDir = tmpdir(), store = null } = {}) {
  const objects = store ?? wranglerObjectStore(target.bucket, { run });
  const keys = objectKeys(target.env, now);
  const dir = mkdtempSync(join(tmpDir, 'aq-backup-'));
  try {
    // 0. manifest read — a corrupt manifest aborts before the database is touched.
    const text = objects.getText(keys.manifest);
    const manifest = text === null ? emptyManifest(target.label, target.env) : parseManifest(text);
    if (manifest.label !== target.label) throw new Error(`manifest.json belongs to label "${manifest.label}", not "${target.label}"`);
    log.info(text === null ? 'no manifest yet: first export of this label' : `manifest read: ${manifest.d1.history.length} entries`);

    // 1. export (timed alone)
    const sqlPath = join(dir, 'dump.sql');
    const started = performance.now();
    check(run(exportCommand(target, sqlPath)), 'wrangler d1 export');
    const durationMs = Math.round(performance.now() - started);
    if (!existsSync(sqlPath) || statSync(sqlPath).size === 0) throw new Error('wrangler d1 export wrote no dump');
    log.ok(`exported ${target.database} in ${durationMs} ms (${statSync(sqlPath).size} bytes of SQL)`);

    // 2. count
    const tables = tableNames(parseD1Json(check(run(listTablesCommand(target)), 'listing the tables').stdout));
    const rowCounts = tables.length === 0 ? {} : rowCountsFrom(parseD1Json(check(run(countCommand(target, tables)), 'counting rows').stdout), tables);
    const totalRows = Object.values(rowCounts).reduce((sum, n) => sum + n, 0);
    log.ok(`counted ${tables.length} tables, ${totalRows} rows`);

    // 3. gzip
    const gzPath = join(dir, basename(keys.daily));
    writeFileSync(gzPath, gzipSync(readFileSync(sqlPath), { level: 9 }));

    // 4. hash
    const bytes = statSync(gzPath).size;
    const sha256 = sha256Of(gzPath);
    log.ok(`gzipped: ${bytes} bytes, sha256 ${sha256.slice(0, 12)}…`);

    // 5. put
    objects.putFile(keys.daily, gzPath, DUMP_CONTENT_TYPE);
    log.ok(`uploaded ${keys.daily}`);

    // 6. verify
    const backPath = join(dir, 'verify.sql.gz');
    objects.getFile(keys.daily, backPath);
    const backBytes = statSync(backPath).size;
    const backSha = sha256Of(backPath);
    if (backBytes !== bytes || backSha !== sha256) {
      throw new Error(`verify failed for ${keys.daily}: stored ${backBytes} bytes / ${backSha.slice(0, 12)}…, expected ${bytes} bytes / ${sha256.slice(0, 12)}…`);
    }
    log.ok('verified: stored bytes and sha256 match');

    // 7. monthly
    let monthlyKey = null;
    if (monthlyCopyNeeded(manifest, now)) {
      objects.putFile(keys.monthly, gzPath, DUMP_CONTENT_TYPE);
      monthlyKey = keys.monthly;
      log.ok(`monthly copy ${keys.monthly}`);
    } else {
      log.info(`monthly copy for ${now.toISOString().slice(0, 7)} already present`);
    }

    // 8. manifest
    const entry = { ts: now.toISOString(), key: keys.daily, bytes, sha256, rowCounts, durationMs };
    const next = appendD1Entry(manifest, entry, { monthlyKey });
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(manifestPath, serializeManifest(next));
    objects.putFile(keys.manifest, manifestPath, MANIFEST_CONTENT_TYPE);
    log.ok(`manifest updated: ${next.d1.history.length} entries, latest ${entry.ts}`);
    return { entry: next.d1.latest, monthlyKey, manifest: next, keys };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function usage() {
  console.log('Usage: node scripts/backup/export-d1.mjs --label <label> -e production [--dry-run] [--yes]');
}

/**
 * `deps` exists for the tests: `profiles`, `run`, `now`, `tmpDir`. Returns 0,
 * or throws.
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const { profiles = null, run = runCaptured, now = new Date(), tmpDir = tmpdir() } = deps;
  const args = parseArgs(argv);
  if (args.help) {
    usage();
    return 0;
  }

  // Refusals first: no wrangler call happens before these pass.
  const target = resolveBackupTarget({ label: args.label, env: args.env, profiles: profiles ?? loadAllProfiles() });
  const steps = buildExportPlan(target, now);

  log.heading(`D1 backup — ${args.label} production → ${target.database} (env ${target.wranglerEnv}) → bucket ${target.bucket}`);
  for (const line of formatPlan(steps)) log.info(line);

  if (args.dryRun) {
    log.ok('dry run: no wrangler call was made');
    return 0;
  }
  if (!args.yes) {
    throw new Error('a real export needs --yes (the confirmation lives in `make backup-d1-prod`, which passes it)');
  }

  const { entry, monthlyKey } = await runExport(target, { run, now, tmpDir });
  log.ok(`${target.database} backed up: ${entry.key} (${entry.bytes} bytes, sha256 ${entry.sha256.slice(0, 12)}…, ${entry.durationMs} ms)`);
  if (monthlyKey) log.hint(`monthly copy: ${monthlyKey}`);
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
