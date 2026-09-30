/**
 * check-no-dev-seed.ts
 *
 * Pre-deploy guard: fails loudly (exit 1) if the target database holds
 * accounts that must never be released. Run this before every production or
 * staging deploy. Two matchers:
 *
 *   • dev seed — the `seed-` rows parsed from migrations/seed/*.sql (by id or
 *     password-hash prefix). Enforced for every target.
 *   • demo    — the demo user ids of EVERY label in config/labels/, derived by
 *     scripts/demo/ids.mjs, plus any e-mail in a `*.demo.invalid` domain
 *     (RFC 0021 §3.6). Enforced for production targets only: staging is
 *     allowed to carry the demo.
 *
 * Usage:
 *   tsx scripts/check-no-dev-seed.ts --db <database-name> [--env <wrangler-env>]
 *       [--target production|staging] [--local]
 *
 * Flags:
 *   --db <name>       D1 database name (e.g. arenaquest-db, arenaquest-db-staging)
 *   --env <name>      Wrangler environment (e.g. staging). Omit for production.
 *   --target <name>   Deploy target: `production` (default — fail-safe) or
 *                     `staging`. Selects whether the demo matcher is enforced.
 *                     Passed by scripts/cloudflare/deploy.mjs; it is never
 *                     inferred from the database or wrangler env name.
 *   --local           Query the local D1 replica instead of the remote database.
 *
 * Exit codes:
 *   0  Nothing found — safe to deploy.
 *   1  Dev-seed or (production) demo accounts found — abort deploy; the
 *      matched accounts are printed to stderr by id and e-mail.
 *   2  Usage error or unexpected wrangler failure.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The one source of demo identities (RFC 0021 §3.1) — never a local list.
import {
  DEMO_EMAIL_DOMAIN_SUFFIX,
  demoUserIds,
  isDemoEmail,
  listLabels,
} from '../../../scripts/demo/ids.mjs';

/** A newly provisioned D1 has no schema yet; migrations will create it. */
export function isFreshDatabaseError(output: string): boolean {
  return /no such table:\s*users\b/i.test(output);
}

// ---------------------------------------------------------------------------
// Seed matcher — derived at runtime from apps/api/migrations/seed/*.sql, so
// the guard can never drift from the accounts the seed actually creates. See
// docs/product/backlog/security/03-dev-seed-guard-hash-drift.task.md.
// ---------------------------------------------------------------------------

const SEED_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../migrations/seed',
);

// Chars of the derived key kept for the exact-prefix match done in JS.
const HASH_PREFIX_KEY_CHARS = 8;
// Chars of the salt kept in the SQL LIKE pattern. Short and deliberate: local
// D1 (miniflare/workerd SQLite) raises "LIKE or GLOB pattern too complex" on
// long patterns, so the SQL filter stays coarse and the exact match happens
// in JS via matchesSeedRow.
const SALT_LIKE_PREFIX_CHARS = 16;

export interface SeedUserRow {
  id: string;
  email: string;
  passwordHash: string;
}

export interface SeedMatcher {
  hashPrefixes: string[];
  likePatterns: string[];
  seedIds: string[];
}

/** Reads every *.sql file in a seed directory. Fails closed: throws if the
 * directory is missing/unreadable or holds no seed files, rather than let the
 * caller silently build an empty matcher. */
export function readSeedSqlFiles(seedDir: string = SEED_DIR): string[] {
  let files: string[];
  try {
    files = readdirSync(seedDir).filter((f) => f.endsWith('.sql'));
  } catch (err) {
    throw new Error(`cannot read seed directory "${seedDir}": ${(err as Error).message}`);
  }
  if (files.length === 0) {
    throw new Error(`no *.sql seed files found in "${seedDir}"`);
  }
  return files.map((file) => {
    const filePath = path.join(seedDir, file);
    let content: string;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch (err) {
      throw new Error(`cannot read seed SQL file "${filePath}": ${(err as Error).message}`);
    }
    if (content.trim().length === 0) {
      throw new Error(`empty seed SQL file "${filePath}"`);
    }
    return content;
  });
}

function splitSqlTuple(tuple: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of tuple) {
    if (ch === "'") {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  values.push(current.trim());
  return values;
}

/** Parses id/email/password_hash out of every `INSERT INTO users (...) VALUES
 * (...)` block in a seed SQL file. Column order is read from the statement
 * itself rather than assumed, so it survives reordering. */
export function extractSeedUsersFromSql(sql: string): SeedUserRow[] {
  const rows: SeedUserRow[] = [];
  const insertRe = /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+users\s*\(([^)]+)\)\s*VALUES\s*([\s\S]*?);/gi;
  let stmt: RegExpExecArray | null;
  while ((stmt = insertRe.exec(sql))) {
    const columns = stmt[1].split(',').map((c) => c.trim().toLowerCase());
    const idIdx = columns.indexOf('id');
    const emailIdx = columns.indexOf('email');
    const hashIdx = columns.indexOf('password_hash');
    if (idIdx === -1 || emailIdx === -1 || hashIdx === -1) continue;

    const tupleRe = /\(([^()]*)\)/g;
    let tuple: RegExpExecArray | null;
    while ((tuple = tupleRe.exec(stmt[2]))) {
      const values = splitSqlTuple(tuple[1]);
      const id = values[idIdx];
      const email = values[emailIdx];
      const passwordHash = values[hashIdx];
      if (id && email && passwordHash) {
        rows.push({ id, email, passwordHash });
      }
    }
  }
  return rows;
}

/** Builds the id/hash matcher from one or more seed SQL file contents. */
export function buildSeedMatcher(seedSqlFiles: string[]): SeedMatcher {
  const hashPrefixes = new Set<string>();
  const likePatterns = new Set<string>();
  const seedIds = new Set<string>();

  for (const sql of seedSqlFiles) {
    for (const row of extractSeedUsersFromSql(sql)) {
      if (!row.id.startsWith('seed-')) continue;
      seedIds.add(row.id);

      const parts = row.passwordHash.split(':');
      if (parts.length !== 4 || parts[0] !== 'pbkdf2') continue;
      const [, iterations, salt, key] = parts;
      hashPrefixes.add(`pbkdf2:${iterations}:${salt}:${key.slice(0, HASH_PREFIX_KEY_CHARS)}`);
      likePatterns.add(`pbkdf2:${iterations}:${salt.slice(0, SALT_LIKE_PREFIX_CHARS)}%`);
    }
  }

  return {
    hashPrefixes: [...hashPrefixes],
    likePatterns: [...likePatterns],
    seedIds: [...seedIds],
  };
}

/** True if a users row was produced by the local dev seed — matched by its
 * stable seed id (survives a hash regeneration) or by its password hash
 * prefix (survives a change to the seeded id list). */
export function matchesSeedRow(
  row: { id: string; password_hash: string },
  matcher: SeedMatcher,
): boolean {
  if (matcher.seedIds.includes(row.id)) return true;
  return matcher.hashPrefixes.some((prefix) => row.password_hash.startsWith(prefix));
}

function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Builds the SQL WHERE clause used to pull candidate rows: an IN over the
 * stable seed ids plus one short LIKE per distinct salt, OR-ed together. */
export function buildSeedWhereClause(matcher: SeedMatcher): string {
  const clauses: string[] = [];
  if (matcher.seedIds.length > 0) {
    clauses.push(`id IN (${matcher.seedIds.map(sqlQuote).join(', ')})`);
  }
  for (const pattern of matcher.likePatterns) {
    clauses.push(`password_hash LIKE ${sqlQuote(pattern)}`);
  }
  return clauses.join(' OR ');
}

// ---------------------------------------------------------------------------
// Demo matcher — RFC 0021 §3.6. The ids come from scripts/demo/ids.mjs for
// every label in config/labels/, so a label added later is covered without
// touching this file; the e-mail domain catches a demo row whatever its id.
// ---------------------------------------------------------------------------

export type GuardTarget = 'production' | 'staging';

export const GUARD_TARGETS: readonly GuardTarget[] = ['production', 'staging'];

export interface DemoMatcher {
  demoIds: string[];
  emailSuffix: string;
}

/** Builds the demo matcher from the given labels (default: every label in
 * config/labels/). Fails closed: throws on an empty label list. */
export function buildDemoMatcher(labels: string[] = listLabels()): DemoMatcher {
  if (labels.length === 0) {
    throw new Error('no label found in config/labels/ — cannot derive the demo user ids');
  }
  const demoIds = new Set<string>();
  for (const label of labels) {
    for (const id of demoUserIds(label)) demoIds.add(id);
  }
  return { demoIds: [...demoIds], emailSuffix: DEMO_EMAIL_DOMAIN_SUFFIX };
}

/** True if a users row is a demo account — by derived id or by e-mail domain. */
export function matchesDemoRow(
  row: { id: string; email: string },
  matcher: DemoMatcher,
): boolean {
  return matcher.demoIds.includes(row.id) || isDemoEmail(row.email);
}

/** `id IN (<demo ids>) OR email LIKE '%.demo.invalid'`. */
export function buildDemoWhereClause(matcher: DemoMatcher): string {
  const clauses: string[] = [];
  if (matcher.demoIds.length > 0) {
    clauses.push(`id IN (${matcher.demoIds.map(sqlQuote).join(', ')})`);
  }
  clauses.push(`email LIKE ${sqlQuote(`%${matcher.emailSuffix}`)}`);
  return clauses.join(' OR ');
}

/** The single read-only query the guard runs. With no demo matcher (staging)
 * it is exactly the dev-seed query; with one (production) the demo clause is
 * OR-ed in so both matchers are served by one round trip. */
export function buildGuardQuery(seed: SeedMatcher, demo: DemoMatcher | null): string {
  const seedWhere = buildSeedWhereClause(seed);
  const where = demo ? `(${seedWhere}) OR (${buildDemoWhereClause(demo)})` : seedWhere;
  return `SELECT id, email, password_hash FROM users WHERE ${where}`;
}

// ---------------------------------------------------------------------------
// Argument parsing (no external deps)
// ---------------------------------------------------------------------------

export interface GuardArgs {
  db: string | null;
  env: string | null;
  target: GuardTarget;
  local: boolean;
}

/** Parses the CLI flags. `--target` defaults to `production` (fail-safe: an
 * invocation that does not say otherwise gets the strictest check); an unknown
 * value throws rather than silently weakening the guard. */
export function parseArgs(argv: string[]): GuardArgs {
  let db: string | null = null;
  let env: string | null = null;
  let target: GuardTarget = 'production';
  let local = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db' && argv[i + 1]) {
      db = argv[++i];
    } else if (argv[i] === '--env' && argv[i + 1]) {
      env = argv[++i];
    } else if (argv[i] === '--target') {
      const value = argv[++i];
      if (!GUARD_TARGETS.includes(value as GuardTarget)) {
        throw new Error(`--target must be one of ${GUARD_TARGETS.join(', ')} (got "${value ?? ''}")`);
      }
      target = value as GuardTarget;
    } else if (argv[i] === '--local') {
      local = true;
    }
  }

  return { db, env, target, local };
}

// ---------------------------------------------------------------------------
// Guard run — pure over an injected wrangler runner, so every outcome is unit
// testable without wrangler.
// ---------------------------------------------------------------------------

export interface WranglerResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type WranglerRunner = (wranglerArgs: string[]) => WranglerResult;

export interface GuardOutcome {
  code: 0 | 1 | 2;
  stdout: string;
  stderr: string;
}

type UserRow = { id: string; email: string; password_hash: string };

function listAccounts(rows: UserRow[]): string {
  return rows.map((r) => `  • ${r.id}  ${r.email}`).join('\n');
}

export function runGuard(
  args: GuardArgs,
  run: WranglerRunner,
  matchers: { seed?: SeedMatcher; demo?: DemoMatcher } = {},
): GuardOutcome {
  const db = args.db ?? (args.env === 'staging' ? 'arenaquest-db-staging' : 'arenaquest-db');
  const enforceDemo = args.target === 'production';

  let seed: SeedMatcher;
  try {
    seed = matchers.seed ?? buildSeedMatcher(readSeedSqlFiles());
  } catch (err) {
    return {
      code: 2,
      stdout: '',
      stderr: `[check-no-dev-seed] failed to build the seed matcher from migrations/seed/*.sql: ${(err as Error).message}\n`,
    };
  }

  if (seed.seedIds.length === 0 && seed.hashPrefixes.length === 0) {
    return {
      code: 2,
      stdout: '',
      stderr: '[check-no-dev-seed] no seed matcher could be derived from migrations/seed/*.sql — refusing to report OK on an empty matcher.\n',
    };
  }

  let demo: DemoMatcher | null = null;
  if (enforceDemo) {
    try {
      demo = matchers.demo ?? buildDemoMatcher();
    } catch (err) {
      return {
        code: 2,
        stdout: '',
        stderr: `[check-no-dev-seed] failed to build the demo matcher from scripts/demo/ids.mjs: ${(err as Error).message}\n`,
      };
    }
  }

  const mode =
    `[check-no-dev-seed] target: ${args.target} — dev-seed matcher` +
    (enforceDemo ? ' + demo matcher (RFC 0021 §3.6)' : ' only (staging may hold the demo)') +
    '.\n';

  // Build the wrangler argument list directly (avoids shell quoting issues
  // and lets spawnSync pipe stdout/stderr independently).
  const wranglerArgs = [
    'exec', 'wrangler', 'd1', 'execute',
    db,
    args.local ? '--local' : '--remote',
    '--json',
    '--command', buildGuardQuery(seed, demo),
    ...(args.env ? ['--env', args.env] : []),
  ];

  const result = run(wranglerArgs);

  // Surface the real wrangler error (auth, unknown DB, network, etc.)
  // before printing our own message.
  if (result.error || result.status !== 0) {
    const wranglerOutput = [result.stderr, result.stdout]
      .map(s => s?.trim())
      .filter(Boolean)
      .join('\n');
    if (isFreshDatabaseError(wranglerOutput)) {
      return {
        code: 0,
        stdout: mode + `[check-no-dev-seed] OK — database "${db}" has no users table yet; migrations will initialize it.\n`,
        stderr: '',
      };
    }
    return {
      code: 2,
      stdout: mode,
      stderr:
        (wranglerOutput ? `${wranglerOutput}\n` : '') +
        `[check-no-dev-seed] wrangler failed (exit ${result.status ?? 'null'}) for database "${db}".\n` +
        `Hints:\n` +
        `  • \`wrangler whoami\`           — verify Cloudflare authentication\n` +
        `  • \`make db-migrate-staging\`   — apply migrations to remote staging DB\n` +
        `  • \`wrangler d1 migrations apply ${db} --remote\` — apply migrations manually\n`,
    };
  }

  let candidates: UserRow[];
  try {
    // wrangler --json returns an array of result sets; each has a `results` array.
    const parsed = JSON.parse(result.stdout) as Array<{ results: Array<UserRow> }>;
    candidates = parsed.flatMap(r => r.results ?? []);
  } catch {
    return {
      code: 2,
      stdout: mode,
      stderr: `[check-no-dev-seed] failed to parse wrangler output:\n${result.stdout}\n`,
    };
  }

  // Exact match in JS (by seed id or hash prefix; by demo id or e-mail
  // domain) eliminates theoretical false positives from the intentionally
  // coarse LIKE/IN filter used in the SQL query.
  const seedRows = candidates.filter(r => matchesSeedRow(r, seed));
  const demoRows = demo
    ? candidates.filter(r => !matchesSeedRow(r, seed) && matchesDemoRow(r, demo))
    : [];

  if (seedRows.length === 0 && demoRows.length === 0) {
    return {
      code: 0,
      stdout:
        mode +
        '[check-no-dev-seed] OK — no dev-seed hashes found.\n' +
        (enforceDemo ? '[check-no-dev-seed] OK — no demo accounts found.\n' : ''),
      stderr: '',
    };
  }

  let stderr = '';
  if (seedRows.length > 0) {
    const emails = seedRows.map(r => `  • ${r.email}`).join('\n');
    stderr +=
      `[check-no-dev-seed] BLOCKED — dev-seed password hash found in database "${db}".\n` +
      `Affected accounts:\n${emails}\n\n` +
      `Remove or re-hash these accounts before deploying.\n` +
      `See docs/product/api/bootstrap-first-admin.md for the correct procedure.\n`;
  }
  if (demoRows.length > 0) {
    stderr +=
      (stderr ? '\n' : '') +
      `[check-no-dev-seed] BLOCKED — demo accounts found in production database "${db}".\n` +
      `Affected accounts (id, e-mail):\n${listAccounts(demoRows)}\n\n` +
      `The demo dataset belongs on staging only (RFC 0021 §3.6). Remove these accounts\n` +
      `and their data before releasing to production.\n`;
  }
  return { code: 1, stdout: mode, stderr };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  let args: GuardArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`[check-no-dev-seed] ${(err as Error).message}\n`);
    process.exit(2);
  }

  const wranglerEnv = { ...process.env };
  if (wranglerEnv.CF_ACCOUNT_ID && !wranglerEnv.CLOUDFLARE_ACCOUNT_ID) {
    wranglerEnv.CLOUDFLARE_ACCOUNT_ID = wranglerEnv.CF_ACCOUNT_ID;
  }
  if (wranglerEnv.CF_API_TOKEN && !wranglerEnv.CLOUDFLARE_API_TOKEN) {
    wranglerEnv.CLOUDFLARE_API_TOKEN = wranglerEnv.CF_API_TOKEN;
  }

  const outcome = runGuard(args, (wranglerArgs) => {
    const result = spawnSync('pnpm', wranglerArgs, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: wranglerEnv,
    });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error };
  });

  if (outcome.stdout) process.stdout.write(outcome.stdout);
  if (outcome.stderr) process.stderr.write(outcome.stderr);
  process.exit(outcome.code);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
