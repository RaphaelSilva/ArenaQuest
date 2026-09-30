#!/usr/bin/env node
/**
 * seed-demo.mjs — write the demo dataset into a label's local or staging D1
 * (RFC 0021 §3).
 *
 *   AQ_DEMO_PASSWORD=… node scripts/demo/seed-demo.mjs --label <label> -e local|staging [--dry-run] [--yes]
 *                      [--persist-to <dir>]   (local only: a throwaway store, e.g. the CI check)
 *
 * Pipeline: parse → resolve the target from the label profile → refuse anything
 * production → check AQ_DEMO_PASSWORD → load + validate the dataset (Task 03) →
 * build ONE SQL file (`.arenaquest/demo-<label>-<env>.sql`, gitignored) with
 * `sql.mjs` → resolve every media object (media.mjs: exists / cached / download)
 * → confirm a remote write → fetch, validate, upload and confirm the missing
 * objects → `wrangler d1 execute --file` → assert `user_xp` = ledger sum for
 * every demo student → summary. The SQL (whose `media` rows are `ready`) runs
 * only once every object is in the bucket; any media failure aborts before it.
 * The XP assertion is a read-only query; a mismatch fails the run loudly.
 *
 * Target (resolved like the deploy CLI, `scripts/cloudflare/deploy.mjs`):
 *   local    → `arenaquest-db --local`, the one local replica every label
 *              shares (the label only picks the dataset); `--persist-to <dir>`
 *              points it (D1 and R2 alike) at another on-disk store;
 *   staging  → the profile's `environments.staging.d1.name`, `--remote --env <label>-staging`.
 *
 * Production is unreachable by construction, and the refusal runs before any
 * file is written or any process spawned:
 *   - `-e production` (and any env other than local|staging) is rejected;
 *   - a remote target whose D1 name or R2 bucket appears in ANY profile's
 *     `production` block is rejected — a staging block pasted from production
 *     cannot slip through. (The local replica is exempt: it is addressed with
 *     `--local`, and its name happens to equal the stock label's production D1.)
 *
 * Credentials: `AQ_DEMO_PASSWORD` is read from the environment (no flag exists
 * for it); when it is unset on a real run with a TTY, the password is asked for
 * with hidden input, twice (`resolvePassword`). Never logged; the SQL file
 * carries its PBKDF2 hash, never the value. A dry run without it writes a
 * placeholder hash no password verifies against.
 *
 * Media bucket: local → the top-level `R2` bucket of `apps/api/wrangler.jsonc`,
 * served in-process (media.mjs `openLocalR2`); staging → the profile's
 * `environments.staging.r2.bucket` (`wrangler r2 object … --remote`).
 *
 * `--dry-run` writes the SQL file, prints the per-object media plan (reading the
 * bucket, never downloading from a manifest URL or uploading) and stops. A
 * re-run converges (see sql.mjs) and uploads nothing.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs as nodeParseArgs } from 'node:util';

import { parseJsonc } from '../label.mjs';
import log from '../lib/log.mjs';
import { loadDataset, renderTopicMarkdown, readSampleTopic } from './dataset.mjs';
import { checkXpConsistency, readGamificationReference, xpConsistencyQuery } from './gamification.mjs';
import { hashPassword } from './hash.mjs';
import { listLabels } from './ids.mjs';
import {
  buildMediaPlan,
  createR2,
  defaultCacheDir,
  formatMediaPlan,
  materialiseMedia,
  mediaTarget,
  openLocalR2,
  resolveMediaPlan,
  runWrangler,
} from './media.mjs';
import { buildSeedSql, demoContext } from './sql.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE)); // repo root (scripts/demo/..)

export const ENVS = ['local', 'staging'];
/** The local replica every label shares (Makefile `db-*-local`). */
export const LOCAL_DATABASE = 'arenaquest-db';
export const PASSWORD_VAR = 'AQ_DEMO_PASSWORD';
/** Written on a dry run without a password: not `pbkdf2:…`, so the adapter rejects it. */
export const DRY_RUN_PASSWORD_HASH = '!dry-run:no-password-set';

// ════════════════════════════════════════════════════════════════════════════
// PURE: arguments, target resolution, refusals
// ════════════════════════════════════════════════════════════════════════════

export function parseSeedArgs(argv) {
  let values;
  try {
    ({ values } = nodeParseArgs({
      args: argv,
      options: {
        label: { type: 'string' },
        env: { type: 'string', short: 'e' },
        'dry-run': { type: 'boolean' },
        yes: { type: 'boolean' },
        'persist-to': { type: 'string' },
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
    throw new Error('refusing -e production: the demo seed never writes to production (RFC 0021 §3)');
  }
  if (!ENVS.includes(values.env)) {
    throw new Error(`-e/--env must be one of ${ENVS.join('|')} (got ${values.env === undefined ? 'nothing' : `"${values.env}"`})`);
  }
  const persistTo = values['persist-to'];
  if (persistTo !== undefined) {
    if (values.env !== 'local') throw new Error('--persist-to only applies to -e local');
    if (persistTo.trim() === '') throw new Error('--persist-to needs a directory');
  }
  return {
    label: values.label,
    env: values.env,
    dryRun: Boolean(values['dry-run']),
    yes: Boolean(values.yes),
    ...(persistTo === undefined ? {} : { persistTo }),
  };
}

/** Every production D1 name and R2 bucket across `profiles` (`{ label: profile }`). */
export function productionResources(profiles) {
  const d1 = new Set();
  const buckets = new Set();
  for (const profile of Object.values(profiles)) {
    const production = profile?.environments?.production;
    if (production?.d1?.name) d1.add(production.d1.name);
    if (production?.r2?.bucket) buckets.add(production.r2.bucket);
  }
  return { d1, buckets };
}

/**
 * Where the seed goes: `{ env, remote, database, wranglerArgs }`. Throws — before
 * anything is written or spawned — on production or a production-named resource.
 */
export function resolveTarget({ label, env, profiles, persistTo = null }) {
  if (env === 'production') throw new Error('refusing -e production: the demo seed never writes to production');
  if (!ENVS.includes(env)) throw new Error(`unknown environment "${env}" (expected ${ENVS.join('|')})`);
  const profile = profiles[label];
  if (!profile) throw new Error(`profile not found: config/labels/${label}.jsonc`);

  if (env === 'local') {
    if (!persistTo) return { env, remote: false, database: LOCAL_DATABASE, wranglerArgs: ['--local'] };
    // Absolute: wrangler runs from apps/api and resolves a relative path there.
    const dir = resolve(persistTo);
    return { env, remote: false, database: LOCAL_DATABASE, persistTo: dir, wranglerArgs: ['--local', '--persist-to', dir] };
  }
  if (persistTo) throw new Error('--persist-to only applies to -e local');

  const staging = profile.environments?.staging;
  const database = staging?.d1?.name;
  if (!database) throw new Error(`config/labels/${label}.jsonc has no environments.staging.d1.name`);
  const { d1, buckets } = productionResources(profiles);
  if (d1.has(database)) {
    throw new Error(`refusing: staging D1 "${database}" of "${label}" is a production database name in some label profile`);
  }
  const bucket = staging.r2?.bucket;
  if (bucket && buckets.has(bucket)) {
    throw new Error(`refusing: staging R2 bucket "${bucket}" of "${label}" is a production bucket in some label profile`);
  }
  const wranglerEnv = `${label}-staging`;
  return { env, remote: true, database, bucket, wranglerEnv, wranglerArgs: ['--remote', '--env', wranglerEnv] };
}

export const MIN_PROMPTED_PASSWORD = 8;

/**
 * Read a line from a TTY without echoing it. Ctrl-C rejects; backspace edits.
 */
export function askHidden(question, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve, reject) => {
    output.write(question);
    let value = '';
    const wasRaw = input.isRaw;
    const done = () => {
      input.removeListener('data', onData);
      input.setRawMode(wasRaw);
      input.pause();
      output.write('\n');
    };
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          done();
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          done();
          reject(new Error('aborted'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();
    input.on('data', onData);
  });
}

/**
 * The password for a run: `AQ_DEMO_PASSWORD` when set; `null` on a dry run;
 * otherwise asked for on the TTY (hidden, typed twice, at least
 * MIN_PROMPTED_PASSWORD characters). With no TTY it throws naming the variable.
 */
export async function resolvePassword(envVars, { dryRun }, { isTTY = Boolean(process.stdin.isTTY), ask = askHidden } = {}) {
  const value = envVars[PASSWORD_VAR];
  if (typeof value === 'string' && value.length > 0) return value;
  if (dryRun) return null;
  if (!isTTY) {
    throw new Error(`${PASSWORD_VAR} is not set and there is no TTY to ask on: export it (it is never accepted as a flag)`);
  }
  const first = await ask(`Password for the demo accounts (${PASSWORD_VAR} is unset): `);
  if (first.length < MIN_PROMPTED_PASSWORD) {
    throw new Error(`the demo password needs at least ${MIN_PROMPTED_PASSWORD} characters`);
  }
  const second = await ask('Type it again: ');
  if (first !== second) throw new Error('the two passwords did not match');
  return first;
}

export function sqlFilePath(label, env, repoRoot = ROOT) {
  return join(repoRoot, '.arenaquest', `demo-${label}-${env}.sql`);
}

/** The wrangler argv that runs `file` against `target`. */
export function wranglerCommand(target, file) {
  return ['pnpm', '--filter', 'api', 'exec', 'wrangler', 'd1', 'execute', target.database, ...target.wranglerArgs, '--file', file, '--yes'];
}

/** The wrangler argv that runs the read-only `query` against `target`, printing JSON. */
export function wranglerQueryCommand(target, query) {
  return ['pnpm', '--filter', 'api', 'exec', 'wrangler', 'd1', 'execute', target.database, ...target.wranglerArgs, '--command', query, '--json'];
}

/**
 * The result rows of `wrangler d1 execute --json` output. Wrangler may print
 * banners (e.g. the proxy warning) before the JSON array, so parsing starts at
 * the first line that opens it.
 */
export function parseD1Json(stdout) {
  const text = String(stdout ?? '');
  const start = text.search(/^\[/m);
  if (start < 0) throw new Error('wrangler d1 execute --json printed no JSON result');
  const parsed = JSON.parse(text.slice(start));
  const results = Array.isArray(parsed) ? parsed.flatMap((entry) => entry?.results ?? []) : [];
  return results;
}

/**
 * Throws naming every demo student whose `user_xp.total_xp` differs from its
 * `xp_events` sum (see gamification.mjs). `query(command)` returns spawnSync's shape.
 */
export function assertXpConsistency({ target, dataset, ctx, query }) {
  const students = dataset.gamification.students.map((state) => state.user);
  const ids = students.map((key) => ctx.id('user', key));
  const names = Object.fromEntries(students.map((key, index) => [ids[index], key]));
  const result = query(wranglerQueryCommand(target, xpConsistencyQuery(ids)));
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    throw new Error(`the user_xp consistency query exited with status ${result.status}`);
  }
  const rows = parseD1Json(result.stdout);
  const problems = checkXpConsistency(rows, ids, names);
  if (problems.length > 0) {
    throw new Error(`user_xp does not match the xp_events ledger after the seed:\n  - ${problems.join('\n  - ')}`);
  }
  const byId = new Map(rows.map((row) => [row.user_id, row]));
  return ids.map((id) => ({ user: names[id], totalXp: Number(byId.get(id).total_xp) }));
}

export function formatSummary(summary) {
  const width = Math.max(...summary.map((row) => row.entity.length));
  return summary.map((row) => `${row.entity.padEnd(width)}  ${String(row.rows).padStart(3)}  (${row.section})`);
}

// ════════════════════════════════════════════════════════════════════════════
// I/O
// ════════════════════════════════════════════════════════════════════════════

/** `{ label: profile }` for every `config/labels/*.jsonc`. */
export function loadAllProfiles(repoRoot = ROOT) {
  return Object.fromEntries(
    listLabels(repoRoot).map((label) => [
      label,
      parseJsonc(readFileSync(join(repoRoot, 'config', 'labels', `${label}.jsonc`), 'utf8')),
    ]),
  );
}

/**
 * The shared write-side `sanitizeMarkdown`, from `packages/shared/utils/sanitize-markdown.ts`
 * itself — not a copy. The TypeScript is transpiled in memory with the
 * workspace's own `typescript` (Node 20 cannot import .ts), and its `marked`
 * import is pointed at the workspace's `marked`, so the function run here is
 * the one the API runs on write.
 */
export async function loadSanitizeMarkdown(repoRoot = ROOT) {
  const sharedRequire = createRequire(join(repoRoot, 'packages', 'shared', 'package.json'));
  const ts = sharedRequire('typescript');
  const source = readFileSync(join(repoRoot, 'packages', 'shared', 'utils', 'sanitize-markdown.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const markedUrl = pathToFileURL(sharedRequire.resolve('marked')).href;
  const code = outputText.replace(/from\s+['"]marked['"]/g, `from ${JSON.stringify(markedUrl)}`);
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  if (typeof module.sanitizeMarkdown !== 'function') throw new Error('sanitize-markdown.ts no longer exports sanitizeMarkdown');
  return module.sanitizeMarkdown;
}

async function confirmRemote(target, label, { yes }) {
  if (yes) return;
  if (!process.stdin.isTTY) {
    throw new Error(`writing to remote D1 "${target.database}" needs confirmation: re-run with --yes (no TTY to ask on)`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) =>
    rl.question(`Seed the demo for "${label}" into remote D1 "${target.database}"? Type the database name to confirm: `, resolve),
  );
  rl.close();
  if (answer.trim() !== target.database) throw new Error('aborted: the database name did not match');
}

function usage() {
  console.log(`Usage: ${PASSWORD_VAR}=… node scripts/demo/seed-demo.mjs --label <label> -e local|staging [--dry-run] [--yes] [--persist-to <dir>]`);
}

function runSqlFile(command) {
  // Output is captured: `--local` echoes one JSON result per statement (hundreds
  // of lines). It is shown only when the run fails.
  return spawnSync(command[0], command.slice(1), {
    cwd: ROOT,
    stdio: ['inherit', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * `deps` exists for the tests and the CI check (ci-check.mjs): `runR2`
 * (wrangler for the remote bucket), `openLocalR2(bucket)` (the local bucket,
 * `{ get, put, dispose? }`), `fetchImpl`, `executeSql(command)` (the d1
 * execute, also used for the read-only XP check), `cacheDir`, `sqlFile`,
 * `dataset`, `now`. Returns 0, or throws.
 */
export async function main(argv = process.argv.slice(2), envVars = process.env, deps = {}) {
  const {
    runR2 = runWrangler,
    openLocalR2: openLocal = (bucket) => openLocalR2(bucket),
    fetchImpl = globalThis.fetch,
    executeSql = runSqlFile,
    cacheDir = defaultCacheDir(),
    sqlFile = null,
    dataset: datasetOverride = null,
    now = new Date(),
  } = deps;
  const args = parseSeedArgs(argv);
  if (args.help) {
    usage();
    return 0;
  }

  // Refusals first: nothing is written or spawned before these pass.
  const target = resolveTarget({ label: args.label, env: args.env, profiles: loadAllProfiles(), persistTo: args.persistTo });

  const where = target.remote ? `, env ${target.wranglerEnv}` : `, local${target.persistTo ? ` at ${target.persistTo}` : ''}`;
  log.heading(`Demo seed — ${args.label} → ${target.env} (${target.database}${where})`);
  // Asked for after the heading, so the operator sees which database it is for.
  const password = await resolvePassword(envVars, args, { isTTY: deps.isTTY, ask: deps.ask });
  const dataset = datasetOverride ?? loadDataset(args.label);
  const template = readSampleTopic();
  const ctx = demoContext({
    label: args.label,
    passwordHash: password === null ? DRY_RUN_PASSWORD_HASH : await hashPassword(password),
    sanitizeMarkdown: await loadSanitizeMarkdown(),
    renderMarkdown: (title) => renderTopicMarkdown(title, template),
    now,
    gamification: readGamificationReference(),
  });
  const { sql, summary } = buildSeedSql(dataset, ctx);

  const file = sqlFile ?? sqlFilePath(args.label, args.env);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, sql, { mode: 0o600 });
  log.ok(`wrote ${relative(ROOT, file)}`);
  if (password === null) log.warn(`${PASSWORD_VAR} unset: the file carries a placeholder hash nobody can log in with`);

  const bucket = mediaTarget(target);
  const r2 = bucket.local ? await openLocal(bucket) : createR2(bucket, runR2);
  // The local store is served in-process; it is closed before wrangler opens it.
  let media;
  try {
    log.info(`checking ${summary.find((row) => row.entity === 'media')?.rows ?? 0} media objects in R2 "${bucket.bucket}" (${bucket.args.join(' ')})`);
    const resolved = await resolveMediaPlan(buildMediaPlan(dataset, ctx), { r2, cacheDir, concurrency: bucket.concurrency });
    const planLines = formatMediaPlan(resolved);

    if (args.dryRun) {
      for (const line of planLines) log.info(`media ${line}`);
      for (const line of formatSummary(summary)) log.info(`would upsert ${line}`);
      log.ok('dry run: nothing downloaded, uploaded or executed');
      return 0;
    }

    if (target.remote) await confirmRemote(target, args.label, args);

    media = await materialiseMedia(resolved, {
      r2,
      cacheDir,
      fetchImpl,
      concurrency: bucket.concurrency,
      onUpload: (entry) => log.ok(`uploaded ${entry.key} (${entry.manifestKey})`),
    });
  } finally {
    await r2.dispose?.();
  }
  log.ok(`media objects: ${media.uploaded} uploaded, ${media.skipped} already present`);

  const command = wranglerCommand(target, file);
  log.info(`running wrangler d1 execute ${target.database} ${target.wranglerArgs.join(' ')} --file ${relative(ROOT, file)}`);
  const result = executeSql(command);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    throw new Error(`wrangler d1 execute exited with status ${result.status}`);
  }

  for (const line of formatSummary(summary)) log.ok(`upserted ${line}`);

  const xp = assertXpConsistency({ target, dataset, ctx, query: executeSql });
  log.ok(`user_xp matches the xp_events ledger: ${xp.map((row) => `${row.user} ${row.totalXp} XP`).join(', ')}`);
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
