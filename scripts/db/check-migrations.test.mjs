/**
 * Unit tests for scripts/db/check-migrations.mjs — the additive scanner over
 * fixture SQL, the frozen comparison over in-memory file maps, and main()
 * against a throwaway git repository (no network).
 * Run with: node --test scripts/db/check-migrations.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  RULES,
  checkMigrations,
  classifyStatement,
  contractReason,
  lintMigrationSql,
  main,
  parseCheckArgs,
  splitStatements,
  stripSql,
} from './check-migrations.mjs';

const HEADER = '-- Migration 0028: fixture\n-- Apply locally: wrangler d1 execute …\n\n';

// ── additive: allowed forms ──────────────────────────────────────────────────

test('each allowed form passes', () => {
  const allowed = [
    'CREATE TABLE IF NOT EXISTS widgets (id TEXT PRIMARY KEY, owner_id TEXT REFERENCES users(id) ON DELETE CASCADE);',
    'CREATE TABLE snapshot AS SELECT id FROM users;',
    'CREATE INDEX IF NOT EXISTS idx_widgets_owner ON widgets (owner_id);',
    'CREATE UNIQUE INDEX idx_widgets_slug ON widgets (slug);',
    'ALTER TABLE users ADD COLUMN nickname TEXT;',
    "ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'pt';",
    "ALTER TABLE users ADD COLUMN flag TEXT NOT NULL DEFAULT '';",
    'ALTER TABLE users ADD score INTEGER DEFAULT 0 NOT NULL;',
    "INSERT INTO roles (id, name) VALUES ('r1', 'admin');",
    "INSERT OR IGNORE INTO roles (id, name) VALUES ('r2', 'student');",
    "INSERT OR REPLACE INTO level_definitions (level, xp) VALUES (1, 0);",
    "UPDATE topic_nodes SET visibility = 'restricted' WHERE visibility IS NULL;",
  ];
  for (const sql of allowed) assert.deepEqual(lintMigrationSql(HEADER + sql), [], sql);
});

test('a realistic multi-statement additive migration passes', () => {
  const sql = `${HEADER}CREATE TABLE widgets (
  id   TEXT PRIMARY KEY,
  note TEXT DEFAULT 'a; b' -- a ; inside a string and a comment
);

/* block
   comment; DROP TABLE users; */
CREATE INDEX idx_w ON widgets (note);
`;
  assert.deepEqual(lintMigrationSql(sql), []);
});

// ── additive: forbidden forms ────────────────────────────────────────────────

test('each forbidden form fails with the additive rule', () => {
  const forbidden = [
    'DROP TABLE widgets;',
    'DROP TABLE IF EXISTS widgets;',
    'DROP INDEX idx_widgets_owner;',
    'ALTER TABLE users DROP COLUMN nickname;',
    'ALTER TABLE users RENAME TO people;',
    'ALTER TABLE users RENAME COLUMN name TO full_name;',
    'ALTER TABLE users ADD COLUMN locale TEXT NOT NULL;',
    'DELETE FROM roles;',
    "REPLACE INTO roles (id) VALUES ('x');",
    'CREATE VIEW v AS SELECT 1;',
    'CREATE TRIGGER t AFTER INSERT ON users BEGIN SELECT 1; END;',
    'PRAGMA foreign_keys = off;',
    'WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x;',
  ];
  for (const sql of forbidden) {
    const v = lintMigrationSql(HEADER + sql);
    assert.ok(v.length >= 1, `expected a violation: ${sql}`);
    assert.equal(v[0].rule, RULES.additive);
    assert.equal(v[0].line, 4, sql); // after the three-line header
  }
});

test('the create-copy-drop table rebuild fails on its DROP and RENAME, naming each line', () => {
  const sql = `${HEADER}CREATE TABLE users_new (id TEXT PRIMARY KEY);
INSERT INTO users_new SELECT id FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
`;
  const v = lintMigrationSql(sql);
  assert.deepEqual(v.map((x) => x.line), [6, 7]);
  assert.match(v[0].message, /DROP/);
  assert.match(v[1].message, /RENAME/);
  assert.equal(v[0].excerpt, 'DROP TABLE users;');
});

test('DROP / RENAME inside a string literal, comment or quoted identifier does not trip', () => {
  const sql = `${HEADER}-- DROP TABLE users; we used to do this
/* ALTER TABLE users RENAME TO x; */
INSERT INTO notes (body) VALUES ('please DROP TABLE users; it''s fine');
UPDATE notes SET body = 'RENAME me' WHERE id = 'drop';
CREATE TABLE "drop" (id TEXT, \`rename\` TEXT, [delete] TEXT);
`;
  assert.deepEqual(lintMigrationSql(sql), []);
});

test('a keyword that merely contains DROP/RENAME as a substring does not trip', () => {
  assert.equal(classifyStatement('ALTER TABLE users ADD COLUMN dropped_at TEXT'), null);
  assert.equal(classifyStatement('CREATE INDEX idx_renamed ON t (renamed_by)'), null);
});

// ── @contract escape hatch ───────────────────────────────────────────────────

test('@contract in the leading header skips the additive rule', () => {
  const sql = '-- Migration 0029: drop legacy column\n-- @contract: code stopped reading users.legacy in #412\n\nALTER TABLE users DROP COLUMN legacy;\n';
  assert.equal(contractReason(sql), 'code stopped reading users.legacy in #412');
  assert.deepEqual(lintMigrationSql(sql), []);
});

test('@contract after the first statement, or without a reason, does not count', () => {
  const late = 'ALTER TABLE users DROP COLUMN legacy;\n-- @contract: too late\n';
  assert.equal(contractReason(late), null);
  assert.equal(lintMigrationSql(late).length, 1);
  const empty = '-- @contract:\nDROP TABLE t;\n';
  assert.equal(contractReason(empty), null);
  assert.equal(lintMigrationSql(empty).length, 1);
});

// ── scanner internals ────────────────────────────────────────────────────────

test('stripSql keeps offsets and newlines', () => {
  const src = "a -- c\n'x;y' /* z\n */ b";
  const out = stripSql(src);
  assert.equal(out.length, src.length);
  assert.equal(out.split('\n').length, src.split('\n').length);
  assert.ok(!out.includes(';'));
});

test('splitStatements reports the line of each statement', () => {
  const st = splitStatements(stripSql('-- h\n\nCREATE TABLE a (x);\n\n  INSERT INTO a VALUES (1);'));
  assert.deepEqual(st.map((s) => s.line), [3, 5]);
});

// ── frozen ───────────────────────────────────────────────────────────────────

const buf = (s) => Buffer.from(s);
const BASE = new Map([
  ['0026_create_billing_tables.sql', buf('CREATE TABLE billing (id TEXT);\n')],
  ['0027_create_events.sql', buf('CREATE TABLE events (id TEXT);\nCREATE INDEX i ON events (id);\n')],
]);

test('unchanged base migrations pass', () => {
  assert.deepEqual(checkMigrations({ baseFiles: BASE, workFiles: new Map(BASE) }), []);
});

test('an edited base migration fails frozen at the first differing line', () => {
  const work = new Map(BASE);
  work.set('0027_create_events.sql', buf('CREATE TABLE events (id TEXT);\nCREATE INDEX i ON events (id, x);\n'));
  const v = checkMigrations({ baseFiles: BASE, workFiles: work });
  assert.equal(v.length, 1);
  assert.deepEqual([v[0].file, v[0].rule, v[0].line], ['0027_create_events.sql', RULES.frozen, 2]);
});

test('a renamed base migration fails frozen (and the new name is linted as new)', () => {
  const work = new Map(BASE);
  work.set('0027_events.sql', work.get('0027_create_events.sql'));
  work.delete('0027_create_events.sql');
  const v = checkMigrations({ baseFiles: BASE, workFiles: work });
  assert.deepEqual(v.map((x) => [x.file, x.rule]), [['0027_create_events.sql', RULES.frozen]]);
});

test('a deleted base migration fails frozen', () => {
  const work = new Map(BASE);
  work.delete('0026_create_billing_tables.sql');
  const v = checkMigrations({ baseFiles: BASE, workFiles: work });
  assert.deepEqual(v.map((x) => [x.file, x.rule]), [['0026_create_billing_tables.sql', RULES.frozen]]);
});

test('base migrations are not re-linted for additivity', () => {
  const base = new Map([['0004_hash.sql', buf('DROP TABLE refresh_tokens;\n')]]);
  assert.deepEqual(checkMigrations({ baseFiles: base, workFiles: new Map(base) }), []);
});

// ── args ─────────────────────────────────────────────────────────────────────

test('parseCheckArgs defaults and overrides', () => {
  assert.deepEqual(parseCheckArgs([]), { base: 'origin/main', dir: 'apps/api/migrations' });
  assert.deepEqual(parseCheckArgs(['--base', 'origin/feat', '--dir', 'x/m/']), { base: 'origin/feat', dir: 'x/m' });
  assert.throws(() => parseCheckArgs(['--nope']), /invalid arguments/);
});

// ── main() against a real throwaway repository ───────────────────────────────

function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), 'aq-check-migrations-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  const dir = join(root, 'apps/api/migrations');
  mkdirSync(join(dir, 'seed'), { recursive: true });
  writeFileSync(join(dir, '0001_create_users.sql'), 'CREATE TABLE users (id TEXT);\n');
  writeFileSync(join(dir, '0002_rebuild.sql'), 'DROP TABLE IF EXISTS legacy;\n'); // shipped: not re-linted
  writeFileSync(join(dir, 'seed', '0001_test_users.sql'), 'DELETE FROM users;\n'); // seed/ excluded
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  return { root, dir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const quiet = (fn) => {
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, { log, error });
  }
};

test('main: clean tree passes; destructive migration fails; @contract passes; edited base fails', () => {
  const { root, dir, cleanup } = fixtureRepo();
  try {
    const run = (...argv) => quiet(() => main(['--base', 'main', ...argv], { root }));
    assert.equal(run(), 0);

    writeFileSync(join(dir, '0003_drop_col.sql'), '-- Migration 0003\nALTER TABLE users DROP COLUMN nickname;\n');
    assert.equal(run(), 1);

    writeFileSync(join(dir, '0003_drop_col.sql'), '-- Migration 0003\n-- @contract: reviewed\nALTER TABLE users DROP COLUMN nickname;\n');
    assert.equal(run(), 0);

    writeFileSync(join(dir, '0001_create_users.sql'), 'CREATE TABLE users (id TEXT, x TEXT);\n');
    assert.equal(run(), 1);
  } finally {
    cleanup();
  }
});

test('main: a renamed base migration fails', () => {
  const { root, dir, cleanup } = fixtureRepo();
  try {
    renameSync(join(dir, '0001_create_users.sql'), join(dir, '0001_users.sql'));
    assert.equal(quiet(() => main(['--base', 'main'], { root })), 1);
  } finally {
    cleanup();
  }
});

test('main: a missing base ref is a usage error (exit 2)', () => {
  const { root, cleanup } = fixtureRepo();
  try {
    assert.equal(quiet(() => main(['--base', 'origin/does-not-exist'], { root })), 2);
  } finally {
    cleanup();
  }
});
