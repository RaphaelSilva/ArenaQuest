#!/usr/bin/env node
/**
 * restore-local.mjs — turn a pulled backup into a production replica on THIS
 * machine (RFC 0025 §4.3): the local D1 replica plus wrangler's local bucket,
 * so `make dev-api` serves real data for testing a migration or a content
 * change before a deploy.
 *
 *   node scripts/backup/restore-local.mjs --label <label> -e local [--from <dir>] [--dump <path>]
 *        [--persist-to <dir>] [--skip-media] [--dry-run] [--yes]
 *
 * In a fixed order, each step only after the previous one succeeded:
 *   1. locate  — the dump (`--dump`, else the newest `d1/*.sql.gz` under
 *      `--from`) and the pulled `d1/manifest.json`; the manifest entry whose
 *      key ends with the dump's file name supplies the SHA-256 and row counts;
 *   2. verify  — bytes and SHA-256 against that entry. A mismatch ABORTS with
 *      the re-pull command before anything local is touched;
 *   3. confirm — what will be replaced is printed (the persist dir's D1 state
 *      and the local bucket); `--yes` bypasses; no TTY without it aborts;
 *   4. replace — `<persist>/v3/d1` is removed (only that subtree: KV, cache
 *      and the bucket's own objects stay), the dump is gunzipped and applied
 *      with `wrangler d1 execute arenaquest-db --local --persist-to <dir>
 *      --file` — the drill's mechanism — on the now-empty store;
 *   5. count   — the restored tables are counted with export-d1's statements
 *      and compared with the entry's `rowCounts`; a mismatch is reported,
 *      exits 1 and leaves the replica in place for inspection;
 *   6. media   — every file under `<from>/r2/` (the index copy aside) is put
 *      into the local bucket in-process through `getPlatformProxy`, the path
 *      the demo seed uses, under its source key.
 *
 * **Local only.** The replica holds real student data, so `-e staging` and
 * `-e production` are refused before anything is read, and so is a
 * `--persist-to` whose path carries any profile's production or staging D1 or
 * bucket name; the target then goes through the demo seed's `resolveTarget`,
 * which knows only `local` and `staging`. The local database name is
 * `arenaquest-db` whatever the label: it is only a handle into the persist
 * dir, which defaults to `apps/api/.wrangler/state` (what `make dev-api`
 * serves). No wrangler call ever carries `--remote`.
 *
 * `--dry-run` prints the plan and performs no removal, apply or put.
 */

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs as nodeParseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';

import log from '../lib/log.mjs';
import { contentTypeFor, formatBytes, runPool } from '../lib/api-client.mjs';
import { defaultLocalPersistTo, localBucketName, openLocalR2 } from '../demo/media.mjs';
import { LOCAL_DATABASE, loadAllProfiles, parseD1Json, resolveTarget } from '../demo/seed-demo.mjs';
import { applyCommand, compareCounts, localQueryCommand } from './drill.mjs';
import { LIST_TABLES_QUERY, buildCountSql, rowCountsFrom, tableNames } from './export-d1.mjs';
import { firstLine, parseManifest, runCaptured } from './manifest.mjs';
import { defaultOutDir } from './pull.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE)); // repo root (scripts/backup/..)

export const ENV = 'local';
export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
export const MEDIA_CONCURRENCY = 4;

// ════════════════════════════════════════════════════════════════════════════
// PURE: arguments, target, dump selection, media listing
// ════════════════════════════════════════════════════════════════════════════

export function parseArgs(argv) {
  let values;
  try {
    ({ values } = nodeParseArgs({
      args: argv,
      options: {
        label: { type: 'string' },
        env: { type: 'string', short: 'e' },
        from: { type: 'string' },
        dump: { type: 'string' },
        'persist-to': { type: 'string' },
        'skip-media': { type: 'boolean' },
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
  if (values.env === undefined || values.env === '') throw new Error('-e/--env is required (local)');
  return {
    label: values.label,
    env: values.env,
    from: values.from ?? null,
    dump: values.dump ?? null,
    persistTo: values['persist-to'] ?? null,
    skipMedia: Boolean(values['skip-media']),
    dryRun: Boolean(values['dry-run']),
    yes: Boolean(values.yes),
  };
}

/** Every production and staging D1 and bucket name across the profiles — none may appear in a local path. */
export function deployedResourceNames(profiles) {
  const names = new Set();
  for (const profile of Object.values(profiles ?? {})) {
    for (const env of ['production', 'staging']) {
      const block = profile?.environments?.[env];
      if (block?.d1?.name) names.add(block.d1.name);
      if (block?.r2?.bucket) names.add(block.r2.bucket);
    }
  }
  return names;
}

/**
 * Where the restore goes: `{ label, env: 'local', database, persistTo, bucket }`.
 * Throws — before anything is read, spawned or opened — on any environment
 * but local, on a `--persist-to` carrying a deployed resource name, and on a
 * profile the demo seed's `resolveTarget` refuses. `bucket` is the top-level
 * `R2` binding of `apps/api/wrangler.jsonc` unless injected (tests).
 */
export function resolveRestoreTarget({ label, env, profiles, persistTo = null, bucket = null, repoRoot = ROOT }) {
  if (env === 'staging') throw new Error('refusing -e staging: the restore replays production data on the local replica only (staging is reset with make db-reset-staging)');
  if (env === 'production') throw new Error('refusing -e production: the restore never writes to production (see docs/operations/backup-restore.md §2)');
  if (env !== ENV) throw new Error(`unknown environment "${env}" (expected ${ENV})`);
  if (persistTo !== null) {
    const absolute = resolve(persistTo);
    for (const name of deployedResourceNames(profiles)) {
      if (absolute.includes(name)) throw new Error(`refusing --persist-to ${absolute}: its path carries the deployed resource name "${name}"`);
    }
  }
  const seedTarget = resolveTarget({ label, env, profiles, persistTo });
  if (seedTarget.remote || seedTarget.database !== LOCAL_DATABASE) throw new Error('refusing: the resolved target is not the local replica');
  return {
    label,
    env: ENV,
    database: seedTarget.database,
    persistTo: seedTarget.persistTo ?? null,
    bucket: bucket ?? localBucketName(repoRoot),
  };
}

/** The newest `*.sql.gz` under `dir` by name (the stamp sorts chronologically), or null. */
export function newestDump(dir) {
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.sql.gz'))
    .sort();
  return names.length === 0 ? null : join(dir, names[names.length - 1]);
}

/** The manifest entry (latest first, then history, newest first) whose key's file name is `name`, or null. */
export function entryForDump(manifest, name) {
  const candidates = [manifest?.d1?.latest, ...[...(manifest?.d1?.history ?? [])].reverse()];
  return candidates.find((entry) => entry && typeof entry.key === 'string' && basename(entry.key) === name) ?? null;
}

/** Every file under `<from>/r2/` as `{ key, path, size }`, the index copy left out; `[]` when the directory is absent. */
export function listPulledMedia(from) {
  const root = join(from, 'r2');
  if (!existsSync(root)) return [];
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && !entry.name.endsWith('.part')) files.push({ key: relative(root, path).split(/[\\/]/).join('/'), path, size: statSync(path).size });
    }
  };
  walk(root);
  return files.filter((file) => file.key !== 'index.json');
}

/** The plan as log lines (what `--dry-run` prints, and what the confirmation shows). */
export function formatRestorePlan({ target, persistRoot, dumpPath, entry, media, skipMedia }) {
  const lines = [
    `dump: ${basename(dumpPath)} (${formatBytes(entry.bytes)}, exported ${entry.ts}, ${Object.keys(entry.rowCounts).length} tables)`,
    `replace: ${join(persistRoot, 'v3', 'd1')} (the local D1 state of ${target.database}) — removed, then the dump applied`,
    skipMedia ? 'media: skipped (--skip-media)' : `media: ${media.length} objects (${formatBytes(media.reduce((sum, file) => sum + file.size, 0))}) → local bucket ${target.bucket} in ${persistRoot}`,
    'nothing deployed is touched: no wrangler call carries --remote',
  ];
  return lines;
}

// ════════════════════════════════════════════════════════════════════════════
// I/O
// ════════════════════════════════════════════════════════════════════════════

function check(result, what) {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.status !== 0) {
    const output = firstLine(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
    throw new Error(`${what} exited with status ${result.status}${output ? `: ${output}` : ''}`);
  }
  return result;
}

function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolveHash(hash.digest('hex')));
  });
}

/** Ask on the terminal; `--yes` skips, no TTY aborts. */
export async function confirmOnTerminal(question, { yes, isTTY = Boolean(process.stdin.isTTY), input = process.stdin, output = process.stdout }) {
  if (yes) return true;
  if (!isTTY) throw new Error('replacing the local replica needs confirmation: re-run with --yes (no TTY to ask on)');
  const rl = createInterface({ input, output });
  const answer = await new Promise((resolveAnswer) => rl.question(question, resolveAnswer));
  rl.close();
  return answer.trim().toLowerCase() === 'yes';
}

/**
 * Restore into an already-resolved `target`. `run(argv)` returns spawnSync's
 * shape; `confirm(question)` answers the prompt; `openR2(opts)` yields
 * `{ put, dispose }` over the local bucket — the tests inject all three.
 * Returns `{ ok, mismatches, media: { put, failed }, persistRoot, dumpPath }`;
 * throws before any local change when the dump is missing or does not match
 * its manifest entry, or when the confirmation is declined. `log` is the
 * logger (`quietLog` in the tests).
 */
export async function runRestore(
  target,
  { run = runCaptured, from = null, dump = null, confirm, openR2 = openLocalR2, skipMedia = false, dryRun = false, tmpDir = tmpdir(), repoRoot = ROOT, log: logger = log } = {},
) {
  const fromDir = resolve(from ?? defaultOutDir(target.label, 'production', repoRoot));
  const persistRoot = target.persistTo ?? defaultLocalPersistTo(repoRoot);
  const pullCommand = `make backup-pull-prod LABEL=${target.label}${from ? ` OUT=${fromDir}` : ''}`;

  // 1. locate
  const dumpPath = dump ? resolve(dump) : newestDump(join(fromDir, 'd1'));
  if (!dumpPath || !existsSync(dumpPath)) throw new Error(`no dump under ${join(fromDir, 'd1')}: pull one first (${pullCommand})`);
  const manifestCopy = join(fromDir, 'd1', 'manifest.json');
  if (!existsSync(manifestCopy)) throw new Error(`${manifestCopy} is missing: the pull writes it (${pullCommand})`);
  const manifest = parseManifest(readFileSync(manifestCopy, 'utf8'));
  if (manifest.label !== target.label) throw new Error(`${manifestCopy} belongs to label "${manifest.label}", not "${target.label}"`);
  const entry = entryForDump(manifest, basename(dumpPath));
  if (!entry) throw new Error(`${manifestCopy} has no entry for ${basename(dumpPath)}: re-pull (${pullCommand})`);

  // 2. verify — abort before anything local is touched.
  const bytes = statSync(dumpPath).size;
  const sha256 = await sha256File(dumpPath);
  if (bytes !== entry.bytes || sha256 !== entry.sha256) {
    throw new Error(
      `dump ${basename(dumpPath)} does not match its manifest entry: got ${bytes} bytes / ${sha256.slice(0, 12)}…, ` +
        `expected ${entry.bytes} bytes / ${entry.sha256.slice(0, 12)}… — nothing replaced; re-pull it (${pullCommand})`,
    );
  }
  logger.ok(`dump verified: ${basename(dumpPath)} (${formatBytes(bytes)}, sha256 ${sha256.slice(0, 12)}…)`);

  const media = skipMedia ? [] : listPulledMedia(fromDir);
  if (!skipMedia && media.length === 0) logger.warn(`no media under ${join(fromDir, 'r2')}: the local bucket receives nothing`);
  for (const line of formatRestorePlan({ target, persistRoot, dumpPath, entry, media, skipMedia })) logger.info(line);
  if (dryRun) return { ok: true, dryRun: true, mismatches: [], media: { put: 0, failed: 0 }, persistRoot, dumpPath };

  // 3. confirm
  const confirmed = await confirm(`Replace the local replica in ${persistRoot} with the production dump of "${target.label}"? Type yes to confirm: `);
  if (!confirmed) throw new Error('aborted: the replica was not replaced');

  // 4. replace — only the D1 subtree of the persist dir.
  const d1State = join(persistRoot, 'v3', 'd1');
  rmSync(d1State, { recursive: true, force: true });
  mkdirSync(persistRoot, { recursive: true });
  logger.info(`removed ${d1State}`);
  const dir = mkdtempSync(join(tmpDir, 'aq-restore-'));
  let actual;
  try {
    const sqlPath = join(dir, 'dump.sql');
    writeFileSync(sqlPath, gunzipSync(readFileSync(dumpPath)));
    check(run(applyCommand(persistRoot, sqlPath)), 'wrangler d1 execute --file (local restore)');
    logger.ok(`applied ${basename(dumpPath)} to ${target.database} in ${persistRoot}`);

    // 5. count + compare
    const tables = tableNames(parseD1Json(check(run(localQueryCommand(persistRoot, LIST_TABLES_QUERY)), 'listing the restored tables').stdout));
    actual = tables.length === 0 ? {} : rowCountsFrom(parseD1Json(check(run(localQueryCommand(persistRoot, buildCountSql(tables))), 'counting the restored rows').stdout), tables);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const mismatches = compareCounts(entry.rowCounts, actual);
  if (mismatches.length > 0) {
    for (const item of mismatches) logger.fail(`table ${item.table}: expected ${item.expected ?? 'absent'}, restored ${item.actual ?? 'absent'}`);
    logger.fail(`${mismatches.length} table(s) differ from the manifest: the replica is left in place for inspection; media not copied`);
    return { ok: false, mismatches, media: { put: 0, failed: 0 }, persistRoot, dumpPath };
  }
  logger.ok(`row counts match the manifest: ${Object.keys(actual).length} tables`);

  // 6. media — in-process, one Miniflare over the same persist dir.
  let put = 0;
  let failed = 0;
  if (media.length > 0) {
    const r2 = await openR2({ bucket: target.bucket, persistTo: persistRoot, repoRoot });
    try {
      const results = await runPool(media, MEDIA_CONCURRENCY, (file) => r2.put(file.key, file.path, contentTypeFor(basename(file.key)) ?? DEFAULT_CONTENT_TYPE));
      results.forEach((result, position) => {
        if (result.ok) put += 1;
        else {
          failed += 1;
          logger.fail(`${media[position].key}: ${firstLine(result.error.message)}`);
        }
      });
    } finally {
      await r2.dispose();
    }
    logger.ok(`media: ${put} objects put into ${target.bucket}${failed ? `, ${failed} failed` : ''}`);
  }
  return { ok: failed === 0, mismatches, media: { put, failed }, persistRoot, dumpPath };
}

function usage() {
  console.log(
    'Usage: node scripts/backup/restore-local.mjs --label <label> -e local [--from <dir>] [--dump <path>] [--persist-to <dir>] [--skip-media] [--dry-run] [--yes]',
  );
}

/**
 * `deps` exists for the tests: `profiles`, `run`, `openR2`, `isTTY`, `confirm`,
 * `bucket`, `tmpDir`, `repoRoot`, `log`. Returns 0 when the replica matches the
 * manifest, 1 on a count mismatch or a failed media put; throws when nothing
 * was replaced.
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const { profiles = null, run = runCaptured, openR2 = openLocalR2, isTTY = Boolean(process.stdin.isTTY), confirm = null, bucket = null, tmpDir = tmpdir(), repoRoot = ROOT, log: logger = log } = deps;
  const args = parseArgs(argv);
  if (args.help) {
    usage();
    return 0;
  }

  // Refusals first: nothing is read, spawned or opened before these pass.
  const target = resolveRestoreTarget({ label: args.label, env: args.env, profiles: profiles ?? loadAllProfiles(repoRoot), persistTo: args.persistTo, bucket, repoRoot });
  logger.heading(`Local restore — ${target.label}: pulled production dump → ${target.database} + bucket ${target.bucket} (local only)`);

  const result = await runRestore(target, {
    run,
    from: args.from,
    dump: args.dump,
    confirm: confirm ?? ((question) => confirmOnTerminal(question, { yes: args.yes, isTTY })),
    openR2,
    skipMedia: args.skipMedia,
    dryRun: args.dryRun,
    tmpDir,
    repoRoot,
    log: logger,
  });
  if (result.dryRun) {
    logger.ok('dry run: nothing removed, applied or put');
    return 0;
  }
  logger.warn('this replica holds real student data — local only: never copy it to a shared machine or a deployed environment');
  if (!result.ok) return 1;
  logger.ok(`replica ready in ${result.persistRoot}${target.persistTo ? ` (point make dev-api at it: pnpm --filter api exec wrangler dev --persist-to ${target.persistTo})` : ' (make dev-api serves it)'}`);
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
