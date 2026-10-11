#!/usr/bin/env node
/**
 * mirror-r2.mjs — incremental copy of a production label's media bucket into
 * its backup bucket (RFC 0025 §4.2).
 *
 *   node scripts/backup/mirror-r2.mjs --label <label> -e production [--dry-run] [--yes]
 *        [--max-bytes <n>] [--max-seconds <n>]
 *   node scripts/backup/mirror-r2.mjs --label <label> -e staging --scratch --yes   (verification only)
 *
 * One run, in a fixed order:
 *   1. list    — every object of the source bucket (paginated), key + ETag + size;
 *   2. index   — `r2/production/index.json` is READ from the backup bucket
 *                (missing → first run; corrupt → abort before any copy);
 *   3. plan    — diff by key + ETag (`planMirror`, pure): new, changed and
 *                restored objects to copy, keys gone from the source to
 *                tombstone, tombstones past the window to prune;
 *   4. copy    — server-side `CopyObject` into `r2/production/<sourceKey>`,
 *                in listing order, until the byte or time budget is hit (then
 *                the run stops cleanly and what is left is `pending`); the
 *                index is checkpointed every CHECKPOINT_EVERY copies so an
 *                interrupted run resumes; one failed copy is logged, counted as
 *                pending, and the run goes on (exit non-zero at the end);
 *   5. tombstone — an object gone from the source is NOT deleted: the index
 *                records `removedAt` and the mirror object stays, which is what
 *                makes an accidental delete recoverable;
 *   6. prune   — only tombstones older than `backup.retention.tombstoneDays`
 *                are deleted from the BACKUP bucket; the count is logged;
 *   7. index   — written to the backup bucket;
 *   8. manifest — `r2.lastRun` in `d1/production/manifest.json` (Task 02's
 *                store), after the index, so a reader never sees a run the
 *                index does not reflect.
 *
 * State lives only in the backup bucket (the index). The mirror key equals
 * the source key under the prefix, so a copy-back is a plain prefix copy.
 * `submissions/` is mirrored with the rest; nothing here is served publicly.
 *
 * The source is read-only: the S3 client is built with the media bucket in
 * `readOnlyBuckets`, so a copy, delete or put aimed at it throws before any
 * request is signed — and the tests inspect every stubbed call besides.
 *
 * Refusals run before any call, and no flag skips them: `-e staging` and
 * `-e local` (unless `--scratch`, below), an unknown environment, a profile
 * without `backup.bucket`, `r2.bucket` or `r2.s3Endpoint`, a backup bucket
 * that is also a media bucket of any profile, and missing credentials.
 *
 * Credentials are `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` from the
 * environment only — the same names as the Worker secrets, so the operator
 * already holds them — never argv, never logged. The endpoint comes from the
 * profile's `r2.s3Endpoint`.
 *
 * `--scratch` is the task's verification mode: `-e staging --scratch` mirrors
 * the STAGING media bucket into the label's backup bucket under
 * `scratch/staging/` (its own index, same code path) and never writes the
 * production manifest. `--scratch` with `-e production` is refused.
 *
 * `--dry-run` lists the source, reads the index and prints the plan counts:
 * no copy, delete or put. `--yes` is how a real run is acknowledged — the
 * script never prompts; `make backup-r2-prod` asks (`confirm-prod`) and passes it.
 * Logs carry keys, sizes, counts and durations — never object content.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { parseArgs as nodeParseArgs } from 'node:util';

import log from '../lib/log.mjs';
import { backupBucketName } from '../label.mjs';
import { loadAllProfiles } from '../demo/seed-demo.mjs';
import { MANIFEST_KEY, emptyManifest, parseManifest, serializeManifest, setR2LastRun, wranglerObjectStore } from './manifest.mjs';
import { createS3 } from './s3.mjs';

export const ENVS = ['production'];
export const INDEX_VERSION = 1;
export const DEFAULT_MAX_BYTES = 20 * 1024 ** 3; // 20 GiB
export const DEFAULT_MAX_SECONDS = 3000;
export const CHECKPOINT_EVERY = 50;
export const CREDENTIAL_VARS = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
export const MANIFEST_CONTENT_TYPE = 'application/json';
const DAY_MS = 24 * 60 * 60 * 1000;

// ════════════════════════════════════════════════════════════════════════════
// PURE: arguments, target, credentials
// ════════════════════════════════════════════════════════════════════════════

function positiveInt(value, flag) {
  if (value === undefined) return null;
  if (!/^\d+$/.test(value) || Number(value) <= 0 || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${flag} must be a positive integer (got ${JSON.stringify(value)})`);
  }
  return Number(value);
}

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
        scratch: { type: 'boolean' },
        'max-bytes': { type: 'string' },
        'max-seconds': { type: 'string' },
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
  return {
    label: values.label,
    env: values.env,
    dryRun: Boolean(values['dry-run']),
    yes: Boolean(values.yes),
    scratch: Boolean(values.scratch),
    maxBytes: positiveInt(values['max-bytes'], '--max-bytes') ?? DEFAULT_MAX_BYTES,
    maxSeconds: positiveInt(values['max-seconds'], '--max-seconds') ?? DEFAULT_MAX_SECONDS,
  };
}

/**
 * Where the mirror goes: `{ label, env, scratch, source, dest, prefix, indexKey,
 * manifestKey, endpoint, tombstoneDays }`. Throws — before anything is sent —
 * on any environment but production (staging only with `--scratch`) and on a
 * profile that cannot be mirrored safely.
 */
export function resolveMirrorTarget({ label, env, profiles, scratch = false }) {
  if (scratch && env === 'production') throw new Error('refusing --scratch with -e production: the scratch mode is for staging verification only');
  if (!scratch && env === 'staging') throw new Error('refusing -e staging: only production is mirrored (staging is disposable, RFC 0021 §4); --scratch is the verification mode');
  if (env === 'local') throw new Error('refusing -e local: the local bucket is not mirrored');
  if (!(scratch ? ['staging'] : ENVS).includes(env)) throw new Error(`unknown environment "${env}" (expected ${(scratch ? ['staging'] : ENVS).join('|')})`);
  const profile = profiles?.[label];
  if (!profile) throw new Error(`profile not found: config/labels/${label}.jsonc`);

  const block = profile.environments?.[env];
  const source = block?.r2?.bucket;
  const endpoint = block?.r2?.s3Endpoint;
  if (!source) throw new Error(`config/labels/${label}.jsonc has no environments.${env}.r2.bucket`);
  if (!endpoint) throw new Error(`config/labels/${label}.jsonc has no environments.${env}.r2.s3Endpoint`);
  const dest = backupBucketName(profile, 'production');
  if (!dest) throw new Error(`config/labels/${label}.jsonc has no environments.production.backup.bucket (RFC 0025: run make infra-check-production LABEL=${label})`);
  const tombstoneDays = profile.environments?.production?.backup?.retention?.tombstoneDays;
  if (!Number.isInteger(tombstoneDays) || tombstoneDays <= 0) {
    throw new Error(`config/labels/${label}.jsonc: environments.production.backup.retention.tombstoneDays must be a positive integer`);
  }
  if (source === dest) throw new Error(`refusing: backup bucket "${dest}" of "${label}" is its own ${env} media bucket`);

  for (const [otherLabel, other] of Object.entries(profiles)) {
    for (const [otherEnv, otherBlock] of Object.entries(other?.environments ?? {})) {
      if (otherBlock?.r2?.bucket === dest) {
        throw new Error(`refusing: backup bucket "${dest}" of "${label}" is the ${otherEnv} media bucket of "${otherLabel}"`);
      }
    }
  }

  const prefix = scratch ? 'scratch/staging/' : `r2/${env}/`;
  return {
    label,
    env,
    scratch,
    source,
    dest,
    prefix,
    indexKey: `${prefix}index.json`,
    manifestKey: scratch ? null : MANIFEST_KEY,
    endpoint,
    tombstoneDays,
  };
}

/** `{ accessKeyId, secretAccessKey }` from the environment, or throws naming the missing variables (never a value). */
export function resolveCredentials(envVars = process.env) {
  const missing = CREDENTIAL_VARS.filter((name) => typeof envVars[name] !== 'string' || envVars[name].trim() === '');
  if (missing.length > 0) {
    throw new Error(`missing ${missing.join(' and ')} in the environment (the R2 S3 token: same names as the Worker secrets; never passed on argv)`);
  }
  return { accessKeyId: envVars.R2_ACCESS_KEY_ID, secretAccessKey: envVars.R2_SECRET_ACCESS_KEY };
}

// ════════════════════════════════════════════════════════════════════════════
// PURE: index, keys, plan
// ════════════════════════════════════════════════════════════════════════════

export function emptyIndex(label, env) {
  return { indexVersion: INDEX_VERSION, label, env, objects: {}, tombstones: {} };
}

/**
 * Parse the stored index. Throws on empty text, invalid JSON, another
 * `indexVersion`, a label/env mismatch or missing maps — a corrupt index
 * aborts the run before any copy, a MISSING one is the caller's first run.
 */
export function parseIndex(text, { label, env }) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('index.json is empty');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`index.json is not valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('index.json is not a JSON object');
  if (parsed.indexVersion !== INDEX_VERSION) {
    throw new Error(`index.json has indexVersion ${JSON.stringify(parsed.indexVersion)}; this tool reads version ${INDEX_VERSION}`);
  }
  if (parsed.label !== label || parsed.env !== env) {
    throw new Error(`index.json belongs to ${JSON.stringify(parsed.label)}/${JSON.stringify(parsed.env)}, not ${label}/${env}`);
  }
  for (const field of ['objects', 'tombstones']) {
    if (!parsed[field] || typeof parsed[field] !== 'object' || Array.isArray(parsed[field])) {
      throw new Error(`index.json: ${field} must be an object`);
    }
  }
  return parsed;
}

/** Pretty JSON with sorted keys inside each map and a trailing newline — byte-identical for the same state. */
export function serializeIndex(index) {
  const sorted = (map) => Object.fromEntries(Object.keys(map).sort().map((key) => [key, map[key]]));
  return `${JSON.stringify(
    { indexVersion: index.indexVersion, label: index.label, env: index.env, objects: sorted(index.objects), tombstones: sorted(index.tombstones) },
    null,
    2,
  )}\n`;
}

export function mirrorKey(prefix, sourceKey) {
  return `${prefix}${sourceKey}`;
}

/**
 * The diff of one run (pure): `{ toCopy, toTombstone, toPrune, unchanged }`.
 * `toCopy` keeps the source listing order; each item is
 * `{ key, etag, size, reason: 'new' | 'changed' | 'restored' }`. A key that
 * reappears after being tombstoned is copied again (`restored`) and its
 * tombstone is cleared when the copy lands. A tombstone is pruned once
 * `now ≥ removedAt + tombstoneDays`.
 */
export function planMirror({ sourceObjects, index, now, tombstoneDays }) {
  const toCopy = [];
  let unchanged = 0;
  const seen = new Set();
  for (const object of sourceObjects) {
    seen.add(object.key);
    const mirrored = index.objects[object.key];
    if (mirrored) {
      if (mirrored.etag === object.etag) unchanged += 1;
      else toCopy.push({ key: object.key, etag: object.etag, size: object.size, reason: 'changed' });
      continue;
    }
    toCopy.push({ key: object.key, etag: object.etag, size: object.size, reason: index.tombstones[object.key] ? 'restored' : 'new' });
  }
  const toTombstone = Object.keys(index.objects).filter((key) => !seen.has(key));
  const cutoff = now.getTime() - tombstoneDays * DAY_MS;
  const toPrune = Object.entries(index.tombstones)
    .filter(([key, tomb]) => !seen.has(key) && new Date(tomb.removedAt).getTime() <= cutoff)
    .map(([key]) => key);
  return { toCopy, toTombstone, toPrune, unchanged };
}

function bytesOf(items) {
  return items.reduce((sum, item) => sum + (item.size ?? 0), 0);
}

/** The plan as log lines (what `--dry-run` prints). */
export function formatPlan(plan, target) {
  const lines = [
    `source ${target.source} → ${target.dest}/${target.prefix} (index ${target.indexKey}; tombstones kept ${target.tombstoneDays} days)`,
    `copy      ${plan.toCopy.length} objects, ${bytesOf(plan.toCopy)} bytes (${['new', 'changed', 'restored']
      .map((reason) => `${plan.toCopy.filter((item) => item.reason === reason).length} ${reason}`)
      .join(', ')})`,
    `tombstone ${plan.toTombstone.length} objects gone from the source (kept in the mirror)`,
    `prune     ${plan.toPrune.length} tombstones past the window (deleted from ${target.dest} only)`,
    `unchanged ${plan.unchanged}`,
  ];
  return lines;
}

// ════════════════════════════════════════════════════════════════════════════
// I/O
// ════════════════════════════════════════════════════════════════════════════

/** A silent logger with the shape of scripts/lib/log.mjs — the tests inject it into runMirror. */
export const quietLog = { info() {}, ok() {}, warn() {}, fail() {}, hint() {}, heading() {} };

async function listSource(s3, target) {
  const objects = [];
  for await (const object of s3.list(target.source, '')) objects.push(object);
  return objects;
}

async function loadIndex(s3, target) {
  const text = await s3.getText(target.dest, target.indexKey);
  return text === null ? emptyIndex(target.label, target.env) : parseIndex(text, target);
}

/** List + index + plan, read-only: what `--dry-run` does and a real run starts with. */
export async function planRun(target, { s3 }) {
  const sourceObjects = await listSource(s3, target);
  const index = await loadIndex(s3, target);
  return { sourceObjects, index };
}

/**
 * Execute one run against an already-resolved `target`. `s3` is the client
 * from `createS3` (stubbed in tests); `store` is the manifest store
 * (`wranglerObjectStore(target.dest)` by default, unused for a scratch run);
 * `now` stamps the index and the manifest; `clock()` is the monotonic clock
 * the time budget reads. Returns `{ lastRun, index, plan, failures }` — the
 * caller exits non-zero when `failures` is not empty.
 */
export async function runMirror(
  target,
  {
    s3,
    store = null,
    now = new Date(),
    budget = {},
    clock = () => performance.now(),
    checkpointEvery = CHECKPOINT_EVERY,
    tmpDir = tmpdir(),
    log: out = log,
  } = {},
) {
  const maxBytes = budget.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxSeconds = budget.maxSeconds ?? DEFAULT_MAX_SECONDS;
  const started = clock();
  const stamp = now.toISOString();

  // 1–3. list, index, plan (reads only; a corrupt index throws here).
  const { sourceObjects, index } = await planRun(target, { s3 });
  const plan = planMirror({ sourceObjects, index, now, tombstoneDays: target.tombstoneDays });
  for (const line of formatPlan(plan, target)) out.info(line);

  const writeIndex = () => s3.putText(target.dest, target.indexKey, serializeIndex(index), 'application/json');

  // 4. copy, in listing order, within the budget.
  const copied = { objects: 0, bytes: 0 };
  const failures = [];
  let stoppedBy = null;
  let sinceCheckpoint = 0;
  let position = 0;
  for (; position < plan.toCopy.length; position += 1) {
    const item = plan.toCopy[position];
    if ((clock() - started) / 1000 >= maxSeconds) {
      stoppedBy = 'maxSeconds';
      break;
    }
    if (copied.bytes + item.size > maxBytes) {
      stoppedBy = 'maxBytes';
      break;
    }
    try {
      await s3.copy(target.source, item.key, target.dest, mirrorKey(target.prefix, item.key));
    } catch (error) {
      failures.push(item);
      out.warn(`copy failed: ${item.key} (${item.size} bytes): ${error.message}`);
      continue;
    }
    index.objects[item.key] = { etag: item.etag, size: item.size, mirroredAt: stamp };
    delete index.tombstones[item.key];
    copied.objects += 1;
    copied.bytes += item.size;
    sinceCheckpoint += 1;
    if (sinceCheckpoint >= checkpointEvery) {
      await writeIndex();
      sinceCheckpoint = 0;
      out.info(`checkpoint: ${copied.objects} copied, ${copied.bytes} bytes`);
    }
  }
  const remaining = plan.toCopy.slice(position);
  const pendingItems = [...failures, ...remaining];
  const pending = { objects: pendingItems.length, bytes: bytesOf(pendingItems) };
  if (stoppedBy) out.warn(`budget reached (${stoppedBy}): ${remaining.length} objects, ${bytesOf(remaining)} bytes left for the next run`);

  // 5. tombstones: index only, the mirror object stays.
  for (const key of plan.toTombstone) {
    const { etag, size } = index.objects[key];
    index.tombstones[key] = { etag, size, removedAt: stamp };
    delete index.objects[key];
  }

  // 6. prune: delete from the BACKUP bucket only; a failed delete keeps its tombstone for the next run.
  let pruned = 0;
  for (const key of plan.toPrune) {
    try {
      await s3.del(target.dest, mirrorKey(target.prefix, key));
      delete index.tombstones[key];
      pruned += 1;
    } catch (error) {
      out.warn(`prune failed: ${key}: ${error.message}`);
    }
  }

  // 7. index.
  await writeIndex();
  const durationMs = Math.round(clock() - started);
  const lastRun = {
    at: stamp,
    durationMs,
    copied,
    pending,
    failed: failures.length,
    tombstoned: plan.toTombstone.length,
    pruned,
    unchanged: plan.unchanged,
    sourceObjects: sourceObjects.length,
    stoppedBy,
  };
  out.ok(
    `copied ${copied.objects} (${copied.bytes} bytes), pending ${pending.objects} (${pending.bytes} bytes), ` +
      `tombstoned ${lastRun.tombstoned}, pruned ${pruned}, unchanged ${lastRun.unchanged}, ${durationMs} ms`,
  );

  // 8. manifest — never for a scratch run.
  if (target.manifestKey) {
    const objects = store ?? wranglerObjectStore(target.dest);
    const text = objects.getText(target.manifestKey);
    const manifest = text === null ? emptyManifest(target.label, target.env) : parseManifest(text);
    if (manifest.label !== target.label) throw new Error(`manifest.json belongs to label "${manifest.label}", not "${target.label}"`);
    const next = setR2LastRun(manifest, lastRun);
    const dir = mkdtempSync(join(tmpDir, 'aq-mirror-'));
    try {
      const path = join(dir, 'manifest.json');
      writeFileSync(path, serializeManifest(next));
      objects.putFile(target.manifestKey, path, MANIFEST_CONTENT_TYPE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    out.ok(`manifest updated: r2.lastRun at ${stamp}`);
  }

  return { lastRun, index, plan, failures };
}

function usage() {
  console.log(
    'Usage: node scripts/backup/mirror-r2.mjs --label <label> -e production [--dry-run] [--yes] [--max-bytes <n>] [--max-seconds <n>]\n' +
      '       node scripts/backup/mirror-r2.mjs --label <label> -e staging --scratch [--dry-run] [--yes]   (verification only)',
  );
}

/**
 * `deps` exists for the tests: `profiles`, `envVars`, `s3`, `store`, `now`,
 * `clock`, `tmpDir`. Returns 0, 1 when some copy failed, or throws.
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const { profiles = null, envVars = process.env, now = new Date(), clock, tmpDir, store = null } = deps;
  const args = parseArgs(argv);
  if (args.help) {
    usage();
    return 0;
  }

  // Refusals first: nothing is sent before these pass.
  const target = resolveMirrorTarget({ label: args.label, env: args.env, profiles: profiles ?? loadAllProfiles(), scratch: args.scratch });
  if (!args.dryRun && !args.yes) {
    throw new Error('a real run needs --yes (the confirmation lives in `make backup-r2-prod`, which passes it)');
  }
  const credentials = resolveCredentials(envVars);
  const s3 =
    deps.s3 ?? createS3({ endpoint: target.endpoint, ...credentials, readOnlyBuckets: [target.source] });

  log.heading(
    `R2 mirror — ${args.label} ${target.env}${target.scratch ? ' (scratch)' : ''}: ${target.source} → ${target.dest}/${target.prefix}`,
  );

  if (args.dryRun) {
    const { sourceObjects, index } = await planRun(target, { s3 });
    const plan = planMirror({ sourceObjects, index, now, tombstoneDays: target.tombstoneDays });
    for (const line of formatPlan(plan, target)) log.info(line);
    log.ok(`dry run: ${sourceObjects.length} source objects listed, index read; no copy, delete or put was made`);
    return 0;
  }

  const { failures } = await runMirror(target, {
    s3,
    store,
    now,
    budget: { maxBytes: args.maxBytes, maxSeconds: args.maxSeconds },
    ...(clock ? { clock } : {}),
    ...(tmpDir ? { tmpDir } : {}),
  });
  if (failures.length > 0) {
    log.fail(`${failures.length} copies failed (counted as pending; re-run to retry)`);
    return 1;
  }
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
