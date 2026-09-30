import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildDemoMatcher,
  buildDemoWhereClause,
  buildGuardQuery,
  buildSeedMatcher,
  buildSeedWhereClause,
  extractSeedUsersFromSql,
  isFreshDatabaseError,
  matchesDemoRow,
  matchesSeedRow,
  parseArgs,
  readSeedSqlFiles,
  runGuard,
  type GuardArgs,
  type WranglerResult,
} from '../../scripts/check-no-dev-seed';
import { demoEmail, demoId, demoUserIds, listLabels } from '../../../../scripts/demo/ids.mjs';

const SEED_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations/seed',
);

describe('isFreshDatabaseError', () => {
  it('recognizes a newly provisioned database without users', () => {
    expect(isFreshDatabaseError('no such table: users: SQLITE_ERROR')).toBe(true);
  });

  it('does not hide unrelated Wrangler failures', () => {
    expect(isFreshDatabaseError('Authentication failed')).toBe(false);
    expect(isFreshDatabaseError('no such table: topics')).toBe(false);
  });
});

describe('extractSeedUsersFromSql', () => {
  it('extracts id/email/password_hash from a users INSERT block, honoring the declared column order', () => {
    const sql = `
      INSERT OR IGNORE INTO users (id, name, email, password_hash, status) VALUES
        (
          'seed-x-1',
          'X Test',
          'x@arenaquest.dev',
          'pbkdf2:100000:aaaa:bbbb',
          'active'
        ),
        (
          'seed-x-2',
          'Y Test',
          'y@arenaquest.dev',
          'pbkdf2:100000:cccc:dddd',
          'active'
        );
    `;

    expect(extractSeedUsersFromSql(sql)).toEqual([
      { id: 'seed-x-1', email: 'x@arenaquest.dev', passwordHash: 'pbkdf2:100000:aaaa:bbbb' },
      { id: 'seed-x-2', email: 'y@arenaquest.dev', passwordHash: 'pbkdf2:100000:cccc:dddd' },
    ]);
  });

  it('honors a reordered column list rather than assuming position', () => {
    const sql = `
      INSERT OR IGNORE INTO users (email, id, status, password_hash, name) VALUES
        (
          'z@arenaquest.dev',
          'seed-z-1',
          'active',
          'pbkdf2:100000:eeee:ffff',
          'Z Test'
        );
    `;

    expect(extractSeedUsersFromSql(sql)).toEqual([
      { id: 'seed-z-1', email: 'z@arenaquest.dev', passwordHash: 'pbkdf2:100000:eeee:ffff' },
    ]);
  });

  it('ignores INSERT statements against unrelated tables', () => {
    const sql = `
      INSERT OR IGNORE INTO billing_plans (id, name) VALUES ('seed-plan-1', 'Monthly');
    `;

    expect(extractSeedUsersFromSql(sql)).toEqual([]);
  });
});

describe('buildSeedMatcher + matchesSeedRow, against the real seed files', () => {
  const matcher = buildSeedMatcher(readSeedSqlFiles(SEED_DIR));

  it('builds a matcher covering all four seeded accounts, student2@arenaquest.dev included', () => {
    expect(matcher.seedIds).toEqual(
      expect.arrayContaining([
        'seed-admin-00000000-0000-0000-0000-000000000001',
        'seed-student-0000-0000-0000-0000-000000000002',
        'seed-professor-000-0000-0000-0000-000000000003',
        'seed-student-free-0000-0000-00000004',
      ]),
    );
  });

  it('matches every seeded account by its real id + password_hash pair', () => {
    const seededRows = [
      {
        id: 'seed-admin-00000000-0000-0000-0000-000000000001',
        password_hash:
          'pbkdf2:100000:14987ad9c165000b3c1deb276aceb877:829f6ee1357f13811ab9c944fc1535da74f5ff8ab67215c79b45319b68ecb48a',
      },
      {
        id: 'seed-student-0000-0000-0000-0000-000000000002',
        password_hash:
          'pbkdf2:100000:fd6f1ec294b6ab4140128e8e417da852:a2bcfeaa95deb970cb74e273c99799eb3a6a25b02a18ed6759bb016bc9e47afc',
      },
      {
        id: 'seed-professor-000-0000-0000-0000-000000000003',
        password_hash:
          'pbkdf2:100000:eafc23fd552a682ad8f800dd8df7a027:9308fbe92ddf94090a1b39c9eae8341040b1eabee6028223f5e7aa346c389f86',
      },
      {
        id: 'seed-student-free-0000-0000-00000004',
        password_hash:
          'pbkdf2:100000:fd6f1ec294b6ab4140128e8e417da852:a2bcfeaa95deb970cb74e273c99799eb3a6a25b02a18ed6759bb016bc9e47afc',
      },
    ];

    for (const row of seededRows) {
      expect(matchesSeedRow(row, matcher)).toBe(true);
    }
  });

  it('does not match a real, non-seed user with an unrelated hash and id', () => {
    const realRow = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      password_hash:
        'pbkdf2:100000:00112233445566778899aabbccddeeff:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd',
    };

    expect(matchesSeedRow(realRow, matcher)).toBe(false);
  });

  it('would still match a seeded account after a hash regeneration, by id alone', () => {
    const regeneratedRow = {
      id: 'seed-admin-00000000-0000-0000-0000-000000000001',
      password_hash: 'pbkdf2:100000:brandnewsaltafterregeneration00:brandnewderivedkey',
    };

    expect(matchesSeedRow(regeneratedRow, matcher)).toBe(true);
  });

  it('keeps every SQL LIKE pattern short enough to avoid "LIKE or GLOB pattern too complex" on local D1', () => {
    expect(matcher.likePatterns.length).toBeGreaterThan(0);
    for (const pattern of matcher.likePatterns) {
      expect(pattern.length).toBeLessThanOrEqual(40);
    }
  });

  it('builds a non-empty WHERE clause combining the id list and the LIKE patterns', () => {
    const whereClause = buildSeedWhereClause(matcher);
    expect(whereClause).toContain('id IN (');
    expect(whereClause).toContain('LIKE');
    for (const id of matcher.seedIds) {
      expect(whereClause).toContain(id);
    }
  });
});

describe('readSeedSqlFiles — fail closed on missing or empty seed data', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('throws when the seed directory does not exist', () => {
    expect(() => readSeedSqlFiles(path.join(tmpdir(), 'does-not-exist-aq-guard'))).toThrow();
  });

  it('throws when the seed directory has no .sql files', () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'aq-guard-empty-'));
    writeFileSync(path.join(tempDir, 'README.md'), '# not sql');

    expect(() => readSeedSqlFiles(tempDir)).toThrow();
  });

  it('throws when a seed directory contains an empty .sql file', () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'aq-guard-empty-sql-'));
    writeFileSync(path.join(tempDir, 'valid.sql'), '-- a non-empty seed file');
    writeFileSync(path.join(tempDir, 'empty.sql'), '');

    expect(() => readSeedSqlFiles(tempDir!)).toThrow(/empty seed SQL file/i);
  });

  it('reads the real seed directory and returns non-empty SQL content', () => {
    const files = readSeedSqlFiles(SEED_DIR);
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const content of files) {
      expect(content.length).toBeGreaterThan(0);
    }
  });
});

describe('buildSeedMatcher — fail closed on an empty matcher set', () => {
  it('produces no ids and no hash prefixes from SQL with no users rows', () => {
    const matcher = buildSeedMatcher(['-- no users here']);
    expect(matcher.seedIds).toEqual([]);
    expect(matcher.hashPrefixes).toEqual([]);
    expect(matcher.likePatterns).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Demo matcher + production-only enforcement (RFC 0021 §3.6, M26 Task 07)
// ---------------------------------------------------------------------------

const SEED_ADMIN = {
  id: 'seed-admin-00000000-0000-0000-0000-000000000001',
  email: 'admin@arenaquest.dev',
  password_hash:
    'pbkdf2:100000:14987ad9c165000b3c1deb276aceb877:829f6ee1357f13811ab9c944fc1535da74f5ff8ab67215c79b45319b68ecb48a',
};
const REAL_USER = {
  id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  email: 'someone@example.com',
  password_hash:
    'pbkdf2:100000:00112233445566778899aabbccddeeff:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd',
};
const DEMO_ADMIN = {
  id: demoId('budo', 'user', 'admin'),
  email: demoEmail('budo', 'admin'),
  password_hash: 'pbkdf2:100000:demosaltdemosaltdemosaltdemosalt:demokey',
};

function rowsResult(rows: object[]): WranglerResult {
  return { status: 0, stdout: JSON.stringify([{ results: rows, success: true }]), stderr: '' };
}

/** A fake wrangler that answers every query with `result` and records the argv. */
function fakeWrangler(result: WranglerResult) {
  const calls: string[][] = [];
  const run = (argv: string[]) => {
    calls.push(argv);
    return result;
  };
  return { run, calls };
}

function args(target: GuardArgs['target']): GuardArgs {
  return { db: 'budo-db', env: null, target, local: false };
}

describe('buildDemoMatcher — ids from scripts/demo/ids.mjs, for every label', () => {
  const matcher = buildDemoMatcher();

  it('covers the demo user ids of every label in config/labels/', () => {
    const labels = listLabels();
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(matcher.demoIds).toEqual(expect.arrayContaining(demoUserIds(label)));
    }
  });

  it('fails closed on an empty label list', () => {
    expect(() => buildDemoMatcher([])).toThrow(/no label/);
  });

  it('matches a demo row by id alone and by e-mail domain alone', () => {
    expect(matchesDemoRow({ id: DEMO_ADMIN.id, email: 'renamed@example.com' }, matcher)).toBe(true);
    expect(matchesDemoRow({ id: REAL_USER.id, email: 'demo.x@newlabel.demo.invalid' }, matcher)).toBe(true);
    expect(matchesDemoRow({ id: REAL_USER.id, email: 'Demo.X@Budo.DEMO.INVALID' }, matcher)).toBe(true);
  });

  it('does not match a real user or a dev-seed user', () => {
    expect(matchesDemoRow(REAL_USER, matcher)).toBe(false);
    expect(matchesDemoRow(SEED_ADMIN, matcher)).toBe(false);
    expect(matchesDemoRow({ id: REAL_USER.id, email: 'x@demo.invalid.example.com' }, matcher)).toBe(false);
  });

  it('builds `id IN (…) OR email LIKE \'%.demo.invalid\'`', () => {
    const where = buildDemoWhereClause(matcher);
    expect(where).toMatch(/^id IN \(/);
    expect(where).toContain(DEMO_ADMIN.id);
    expect(where).toContain("email LIKE '%.demo.invalid'");
  });
});

describe('buildGuardQuery', () => {
  const seed = buildSeedMatcher(readSeedSqlFiles(SEED_DIR));

  it('is exactly the dev-seed query when no demo matcher is enforced', () => {
    expect(buildGuardQuery(seed, null)).toBe(
      `SELECT id, email, password_hash FROM users WHERE ${buildSeedWhereClause(seed)}`,
    );
  });

  it('ORs the demo clause into one read-only users query when enforced', () => {
    const query = buildGuardQuery(seed, buildDemoMatcher());
    expect(query).toMatch(/^SELECT id, email, password_hash FROM users WHERE \(/);
    expect(query).toContain("email LIKE '%.demo.invalid'");
    expect(query).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
  });
});

describe('parseArgs — the target mode', () => {
  it('defaults to production (fail-safe)', () => {
    expect(parseArgs(['--db', 'x']).target).toBe('production');
    expect(parseArgs(['--db', 'x', '--env', 'staging']).target).toBe('production');
  });

  it('reads --target staging|production', () => {
    expect(parseArgs(['--target', 'staging']).target).toBe('staging');
    expect(parseArgs(['--target', 'production', '--local'])).toEqual({
      db: null, env: null, target: 'production', local: true,
    });
  });

  it('rejects an unknown or missing target rather than weakening the guard', () => {
    expect(() => parseArgs(['--target', 'prod'])).toThrow(/--target/);
    expect(() => parseArgs(['--target'])).toThrow(/--target/);
  });
});

describe('runGuard', () => {
  it('passes on a fresh database (no users table) in both modes', () => {
    for (const target of ['production', 'staging'] as const) {
      const { run } = fakeWrangler({
        status: 1, stdout: '', stderr: 'no such table: users: SQLITE_ERROR',
      });
      const outcome = runGuard(args(target), run);
      expect(outcome.code).toBe(0);
      expect(outcome.stdout).toMatch(/no users table yet/);
    }
  });

  it('passes on a clean database in both modes', () => {
    for (const target of ['production', 'staging'] as const) {
      const outcome = runGuard(args(target), fakeWrangler(rowsResult([REAL_USER])).run);
      expect(outcome.code).toBe(0);
    }
  });

  it('fails on a dev-seed row in both modes, with the unchanged message', () => {
    for (const target of ['production', 'staging'] as const) {
      const outcome = runGuard(args(target), fakeWrangler(rowsResult([SEED_ADMIN])).run);
      expect(outcome.code).toBe(1);
      expect(outcome.stderr).toContain('BLOCKED — dev-seed password hash found in database "budo-db"');
      expect(outcome.stderr).toContain('  • admin@arenaquest.dev');
      expect(outcome.stderr).not.toMatch(/demo accounts/);
    }
  });

  it('fails on a demo row for production, listing id and e-mail but never the hash', () => {
    const outcome = runGuard(args('production'), fakeWrangler(rowsResult([REAL_USER, DEMO_ADMIN])).run);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain('BLOCKED — demo accounts found in production database "budo-db"');
    expect(outcome.stderr).toContain(`  • ${DEMO_ADMIN.id}  ${DEMO_ADMIN.email}`);
    expect(outcome.stderr).not.toContain(DEMO_ADMIN.password_hash);
    expect(outcome.stderr).not.toContain('pbkdf2');
    expect(outcome.stderr).not.toContain(REAL_USER.email);
  });

  it('passes on a demo row for staging, whose query does not even ask for demo rows', () => {
    const { run, calls } = fakeWrangler(rowsResult([DEMO_ADMIN]));
    const outcome = runGuard(args('staging'), run);
    expect(outcome.code).toBe(0);
    expect(calls[0].join(' ')).not.toContain('demo.invalid');
  });

  it('reports both matchers when production holds dev-seed and demo rows', () => {
    const outcome = runGuard(args('production'), fakeWrangler(rowsResult([SEED_ADMIN, DEMO_ADMIN])).run);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain('dev-seed password hash found');
    expect(outcome.stderr).toContain('demo accounts found');
  });

  it('runs exactly one read-only query, local/remote and --env as before', () => {
    const { run, calls } = fakeWrangler(rowsResult([]));
    runGuard({ db: 'budo-db-staging', env: 'budo-staging', target: 'production', local: true }, run);
    expect(calls).toHaveLength(1);
    const argv = calls[0];
    expect(argv.slice(0, 7)).toEqual(['exec', 'wrangler', 'd1', 'execute', 'budo-db-staging', '--local', '--json']);
    expect(argv.slice(-2)).toEqual(['--env', 'budo-staging']);
    expect(argv[argv.indexOf('--command') + 1]).toMatch(/^SELECT id, email, password_hash FROM users WHERE/);
  });

  it('exits 2 on an unexpected wrangler failure, surfacing its output', () => {
    const outcome = runGuard(args('production'), fakeWrangler({ status: 1, stdout: '', stderr: 'Authentication failed' }).run);
    expect(outcome.code).toBe(2);
    expect(outcome.stderr).toContain('Authentication failed');
  });
});
