/**
 * check-no-dev-seed.ts
 *
 * Pre-deploy guard: fails loudly (exit 1) if the known dev-seed password hash
 * is present in the target database. Run this before every production or
 * staging deploy.
 *
 * Usage:
 *   tsx scripts/check-no-dev-seed.ts --db <database-name> [--env staging] [--local]
 *
 * Flags:
 *   --db <name>    D1 database name (e.g. arenaquest-db, arenaquest-db-staging)
 *   --env <name>   Wrangler environment (e.g. staging). Omit for production.
 *   --local        Query the local D1 replica instead of the remote database.
 *
 * Exit codes:
 *   0  No dev hash found — safe to deploy.
 *   1  Dev hash found — abort deploy; listed emails are printed to stderr.
 *   2  Usage error or unexpected wrangler failure.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
// Argument parsing (no external deps)
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  db: string | null;
  env: string | null;
  local: boolean;
} {
  let db: string | null = null;
  let env: string | null = null;
  let local = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db' && argv[i + 1]) {
      db = argv[++i];
    } else if (argv[i] === '--env' && argv[i + 1]) {
      env = argv[++i];
    } else if (argv[i] === '--local') {
      local = true;
    }
  }

  return { db, env, local };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.db) {
    // Default DB names match wrangler.jsonc bindings.
    args.db = args.env === 'staging' ? 'arenaquest-db-staging' : 'arenaquest-db';
  }

  let matcher: SeedMatcher;
  try {
    matcher = buildSeedMatcher(readSeedSqlFiles());
  } catch (err) {
    process.stderr.write(
      `[check-no-dev-seed] failed to build the seed matcher from migrations/seed/*.sql: ${(err as Error).message}\n`,
    );
    process.exit(2);
  }

  if (matcher.seedIds.length === 0 && matcher.hashPrefixes.length === 0) {
    process.stderr.write(
      '[check-no-dev-seed] no seed matcher could be derived from migrations/seed/*.sql — refusing to report OK on an empty matcher.\n',
    );
    process.exit(2);
  }

  const query = `SELECT id, email, password_hash FROM users WHERE ${buildSeedWhereClause(matcher)}`;

  // Build the wrangler argument list directly (avoids shell quoting issues
  // and lets spawnSync pipe stdout/stderr independently).
  const wranglerArgs = [
    'exec', 'wrangler', 'd1', 'execute',
    args.db,
    args.local ? '--local' : '--remote',
    '--json',
    '--command', query,
    ...(args.env ? ['--env', args.env] : []),
  ];

  const wranglerEnv = { ...process.env };
  if (wranglerEnv.CF_ACCOUNT_ID && !wranglerEnv.CLOUDFLARE_ACCOUNT_ID) {
    wranglerEnv.CLOUDFLARE_ACCOUNT_ID = wranglerEnv.CF_ACCOUNT_ID;
  }
  if (wranglerEnv.CF_API_TOKEN && !wranglerEnv.CLOUDFLARE_API_TOKEN) {
    wranglerEnv.CLOUDFLARE_API_TOKEN = wranglerEnv.CF_API_TOKEN;
  }

  const result = spawnSync('pnpm', wranglerArgs, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: wranglerEnv,
  });

  // Surface the real wrangler error (auth, unknown DB, network, etc.)
  // before printing our own message.
  if (result.error || result.status !== 0) {
    const wranglerOutput = [result.stderr, result.stdout]
      .map(s => s?.trim())
      .filter(Boolean)
      .join('\n');
    if (isFreshDatabaseError(wranglerOutput)) {
      process.stdout.write(
        `[check-no-dev-seed] OK — database "${args.db}" has no users table yet; migrations will initialize it.\n`,
      );
      process.exit(0);
    }
    if (wranglerOutput) {
      process.stderr.write(`${wranglerOutput}\n`);
    }
    process.stderr.write(
      `[check-no-dev-seed] wrangler failed (exit ${result.status ?? 'null'}) for database "${args.db}".\n` +
      `Hints:\n` +
      `  • \`wrangler whoami\`           — verify Cloudflare authentication\n` +
      `  • \`make db-migrate-staging\`   — apply migrations to remote staging DB\n` +
      `  • \`wrangler d1 migrations apply ${args.db} --remote\` — apply migrations manually\n`,
    );
    process.exit(2);
  }

  let rows: Array<{ email: string }>;
  try {
    // wrangler --json returns an array of result sets; each has a `results` array.
    type Row = { id: string; email: string; password_hash: string };
    const parsed = JSON.parse(result.stdout) as Array<{ results: Array<Row> }>;
    // Exact match in JS (by seed id or hash prefix) eliminates theoretical
    // false positives from the intentionally coarse LIKE/IN filter used in
    // the SQL query.
    rows = parsed
      .flatMap(r => r.results ?? [])
      .filter(r => matchesSeedRow(r, matcher));
  } catch {
    process.stderr.write(
      `[check-no-dev-seed] failed to parse wrangler output:\n${result.stdout}\n`,
    );
    process.exit(2);
  }

  if (rows.length === 0) {
    process.stdout.write('[check-no-dev-seed] OK — no dev-seed hashes found.\n');
    process.exit(0);
  }

  const emails = rows.map(r => `  • ${r.email}`).join('\n');
  process.stderr.write(
    `[check-no-dev-seed] BLOCKED — dev-seed password hash found in database "${args.db}".\n` +
    `Affected accounts:\n${emails}\n\n` +
    `Remove or re-hash these accounts before deploying.\n` +
    `See docs/product/api/bootstrap-first-admin.md for the correct procedure.\n`,
  );
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
