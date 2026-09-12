import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildSeedMatcher,
  buildSeedWhereClause,
  extractSeedUsersFromSql,
  isFreshDatabaseError,
  matchesSeedRow,
  readSeedSqlFiles,
} from '../../scripts/check-no-dev-seed';

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
