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
import { pathToFileURL } from 'node:url';

// Full prefix of the known dev-seed password_hash.
// Used for exact startsWith() filtering in JS after the DB query.
const DEV_PASSWORD_HASH_PREFIX =
  'pbkdf2:100000:e83835066ab015b5ed4449b68a349b38:8baf9add';

// The LIKE pattern used in SQL is intentionally shorter than the full prefix.
// The local D1 (miniflare/workerd SQLite) raises "LIKE or GLOB pattern too
// complex" for long patterns, so we use the iteration count + salt prefix
// (unique enough to the dev seed) and filter the exact prefix in JavaScript.
const DEV_HASH_LIKE_PATTERN = 'pbkdf2:100000:e83835066ab015b5%';

/** A newly provisioned D1 has no schema yet; migrations will create it. */
export function isFreshDatabaseError(output: string): boolean {
  return /no such table:\s*users\b/i.test(output);
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

  const query = `SELECT email, password_hash FROM users WHERE password_hash LIKE '${DEV_HASH_LIKE_PATTERN}'`;

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
    type Row = { email: string; password_hash: string };
    const parsed = JSON.parse(result.stdout) as Array<{ results: Array<Row> }>;
    // Exact-prefix filter in JS eliminates theoretical false positives from
    // the intentionally shorter LIKE pattern used in the SQL query.
    rows = parsed
      .flatMap(r => r.results ?? [])
      .filter(r => r.password_hash.startsWith(DEV_PASSWORD_HASH_PREFIX));
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
