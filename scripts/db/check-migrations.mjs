#!/usr/bin/env node
/**
 * check-migrations.mjs — keep the shared staging D1 safe from candidate
 * migrations (RFC 0021 §2.1–2.2).
 *
 *   node scripts/db/check-migrations.mjs [--base origin/main] [--dir apps/api/migrations]
 *
 * Compares the top-level `*.sql` files of `--dir` (`seed/` is never a migration)
 * with the same directory on `--base`, and enforces two rules:
 *
 *   frozen    — a migration that exists on the base ref may not be modified,
 *               renamed or deleted. D1 records a migration by file name, so an
 *               edited file never re-runs on staging (or production) and the
 *               schema silently diverges from the checkout.
 *   additive  — a migration that is NOT on the base ref may only contain
 *                 CREATE TABLE · CREATE [UNIQUE] INDEX ·
 *                 ALTER TABLE … ADD [COLUMN] (nullable, or NOT NULL with a DEFAULT) ·
 *                 INSERT (incl. OR IGNORE / OR REPLACE) · UPDATE
 *               Everything else fails: DROP, RENAME, DELETE, CREATE VIEW/TRIGGER,
 *               PRAGMA, a CTE… — the create-copy-drop table rebuild is caught by
 *               its DROP and RENAME. Staging is shared by every open candidate,
 *               so a destructive step breaks the code still reading the old shape.
 *
 * Escape hatch: a new file whose leading comment header (the comments before
 * its first statement) holds `-- @contract: <reason>` is a reviewed contract
 * step — shipped after the code stopped reading the old shape — and skips the
 * additive rule. The frozen rule has no escape hatch.
 *
 * The scanner is deliberately conservative and dependency-free: comments,
 * string literals and quoted identifiers are blanked (newlines kept, so line
 * numbers hold) before any keyword is matched, and anything it does not
 * recognise fails. A false positive costs a `@contract` header; a false
 * negative costs staging.
 *
 * Exit codes: 0 clean · 1 violations · 2 usage or git error (e.g. missing base).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs as nodeParseArgs } from 'node:util';

import log from '../lib/log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE)); // repo root (scripts/db/..)

export const DEFAULT_BASE = 'origin/main';
export const DEFAULT_DIR = 'apps/api/migrations';
export const RULES = { frozen: 'frozen', additive: 'additive' };

const CONTRACT_RE = /^--\s*@contract:\s*(\S.*)$/;

// ════════════════════════════════════════════════════════════════════════════
// PURE: scanner
// ════════════════════════════════════════════════════════════════════════════

/**
 * Blank out comments, string literals and quoted identifiers. Every removed
 * character becomes a space except newlines, so offsets and line numbers of
 * the result match the input. An unterminated literal or block comment blanks
 * to end of input (the statement it swallowed still has to pass on its own).
 */
export function stripSql(text) {
  const out = [];
  const n = text.length;
  let i = 0;
  const blank = (ch) => (ch === '\n' ? '\n' : ' ');
  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '-' && next === '-') {
      while (i < n && text[i] !== '\n') out.push(blank(text[i++]));
    } else if (ch === '/' && next === '*') {
      out.push(' ', ' ');
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) out.push(blank(text[i++]));
      if (i < n) {
        out.push(' ', ' ');
        i += 2;
      }
    } else if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch;
      // A string literal keeps its quotes (so `DEFAULT ''` still reads as a
      // value); an identifier becomes a neutral word.
      const isString = ch === "'";
      out.push(isString ? "'" : 'x');
      i++;
      while (i < n) {
        if (text[i] === close) {
          if (close !== ']' && text[i + 1] === close) {
            out.push(' ', ' '); // doubled quote = escaped quote
            i += 2;
            continue;
          }
          break;
        }
        out.push(blank(text[i++]));
      }
      if (i < n) {
        out.push(isString ? "'" : ' ');
        i++;
      }
    } else {
      out.push(ch);
      i++;
    }
  }
  return out.join('');
}

/** Split stripped SQL on `;` into `{ text, line }` (1-based line of the first token). */
export function splitStatements(stripped) {
  const statements = [];
  let start = 0;
  const push = (end) => {
    const raw = stripped.slice(start, end);
    const lead = raw.search(/\S/);
    if (lead !== -1) {
      const offset = start + lead;
      const line = stripped.slice(0, offset).split('\n').length;
      statements.push({ text: raw.trim().replace(/\s+/g, ' '), line });
    }
  };
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === ';') {
      push(i);
      start = i + 1;
    }
  }
  push(stripped.length);
  return statements;
}

/** The `@contract` reason from the file's leading comment header, or null. */
export function contractReason(text) {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    if (!line.startsWith('--')) return null; // first statement reached
    const m = CONTRACT_RE.exec(line);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * Classify one statement (already stripped and whitespace-squeezed).
 * Returns null when it is additive, or the reason it is not.
 */
export function classifyStatement(stmt) {
  const s = stmt.toUpperCase();
  // Belt and braces: a DROP or RENAME anywhere outside a literal/comment fails,
  // whatever the statement starts with.
  if (/\bDROP\b/.test(s)) return 'DROP is destructive';
  if (/\bRENAME\b/.test(s)) return 'RENAME breaks code reading the old name';

  if (/^CREATE (TEMP |TEMPORARY )?TABLE\b/.test(s)) return null;
  if (/^CREATE (UNIQUE )?INDEX\b/.test(s)) return null;
  if (/^INSERT (OR (IGNORE|REPLACE|ABORT|FAIL|ROLLBACK) )?INTO\b/.test(s)) return null;
  if (/^UPDATE\b/.test(s)) return null;

  const alter = /^ALTER TABLE \S+(?: ?\. ?\S+)? ADD (?:COLUMN )?(.*)$/.exec(s);
  if (alter) {
    const def = alter[1];
    if (/\bNOT NULL\b/.test(def) && !/\bDEFAULT\b/.test(def)) {
      return 'ADD COLUMN … NOT NULL needs a DEFAULT (existing rows and old code have no value for it)';
    }
    return null;
  }
  if (/^ALTER TABLE\b/.test(s)) return 'only ALTER TABLE … ADD COLUMN is additive';
  if (/^DELETE\b/.test(s)) return 'DELETE removes data';
  if (/^REPLACE\b/.test(s)) return 'REPLACE deletes the conflicting row';
  if (/^CREATE (TEMP |TEMPORARY )?(VIEW|TRIGGER)\b/.test(s)) return 'CREATE VIEW/TRIGGER is not on the additive list';

  const first = s.split(' ', 2).join(' ');
  return `\`${first}\` is not on the additive list`;
}

/**
 * Lint one new migration. Returns `[{ line, rule, message, excerpt }]`.
 * A `@contract` header skips the whole file.
 */
export function lintMigrationSql(text) {
  if (contractReason(text) !== null) return [];
  const original = text.split('\n');
  const violations = [];
  for (const { text: stmt, line } of splitStatements(stripSql(text))) {
    const reason = classifyStatement(stmt);
    if (reason) {
      violations.push({
        line,
        rule: RULES.additive,
        message: reason,
        excerpt: (original[line - 1] ?? '').trim().slice(0, 100),
      });
    }
  }
  return violations;
}

/**
 * Compare the working tree with the base ref.
 *   baseFiles: Map<name, Buffer> (content on base)
 *   workFiles: Map<name, Buffer> (content on disk)
 * Returns `[{ file, line, rule, message, excerpt? }]`, files in name order.
 */
export function checkMigrations({ baseFiles, workFiles }) {
  const violations = [];
  const names = [...new Set([...baseFiles.keys(), ...workFiles.keys()])].sort();
  for (const name of names) {
    const base = baseFiles.get(name);
    const work = workFiles.get(name);
    if (base && !work) {
      violations.push({
        file: name,
        line: 1,
        rule: RULES.frozen,
        message: 'deleted or renamed — D1 tracks migrations by file name; restore it and add a new migration instead',
      });
    } else if (base && work) {
      if (!Buffer.from(base).equals(Buffer.from(work))) {
        violations.push({
          file: name,
          line: firstDifferingLine(base, work),
          rule: RULES.frozen,
          message: 'modified — an applied migration never re-runs; revert it and add a new migration instead',
        });
      }
    } else {
      for (const v of lintMigrationSql(Buffer.from(work).toString('utf8'))) violations.push({ file: name, ...v });
    }
  }
  return violations;
}

function firstDifferingLine(a, b) {
  const la = Buffer.from(a).toString('utf8').split('\n');
  const lb = Buffer.from(b).toString('utf8').split('\n');
  const max = Math.max(la.length, lb.length);
  for (let i = 0; i < max; i++) if (la[i] !== lb[i]) return i + 1;
  return 1;
}

export function formatViolation(dir, v) {
  const where = `${posix.join(dir, v.file)}:${v.line}`;
  return `${where}  [${v.rule}]  ${v.message}${v.excerpt ? `\n        ${v.excerpt}` : ''}`;
}

// ════════════════════════════════════════════════════════════════════════════
// SIDE EFFECTS: git + filesystem
// ════════════════════════════════════════════════════════════════════════════

export function parseCheckArgs(argv) {
  let values;
  try {
    ({ values } = nodeParseArgs({
      args: argv,
      options: {
        base: { type: 'string' },
        dir: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    throw new Error(`invalid arguments: ${error.message}`);
  }
  if (values.help) return { help: true };
  const dir = (values.dir ?? DEFAULT_DIR).replace(/\/+$/, '');
  return { base: values.base || DEFAULT_BASE, dir };
}

function gitRunner(cwd) {
  return (args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

/** Top-level `*.sql` of `dir` on `base`, as Map<name, Buffer>. */
export function readBaseFiles({ git, base, dir }) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
  } catch {
    throw new UsageError(`base ref '${base}' not found — run \`git fetch origin main\` (or pass --base <ref>)`);
  }
  const listing = git(['ls-tree', '--name-only', base, `${dir}/`]).toString('utf8');
  const files = new Map();
  for (const path of listing.split('\n').filter(Boolean)) {
    const name = posix.basename(path);
    if (!name.endsWith('.sql')) continue; // `seed/` is a tree, not a migration
    files.set(name, git(['show', `${base}:${path}`]));
  }
  return files;
}

/** Top-level `*.sql` of `dir` on disk, as Map<name, Buffer>. */
export function readWorkFiles(absDir) {
  if (!existsSync(absDir)) throw new UsageError(`migrations directory not found: ${absDir}`);
  const files = new Map();
  for (const name of readdirSync(absDir)) {
    const abs = join(absDir, name);
    if (name.endsWith('.sql') && statSync(abs).isFile()) files.set(name, readFileSync(abs));
  }
  return files;
}

export class UsageError extends Error {}

function usage() {
  console.log(`Usage: node scripts/db/check-migrations.mjs [--base <ref>] [--dir <path>]

  --base <ref>   git ref to compare against (default ${DEFAULT_BASE})
  --dir <path>   migrations directory, relative to the repo root (default ${DEFAULT_DIR})

Rules: base migrations are frozen; new migrations are additive unless their
header carries \`-- @contract: <reason>\`. See CONTRIBUTING.md (expand/contract).`);
}

export function main(argv = process.argv.slice(2), deps = {}) {
  const { root = ROOT, git = gitRunner(root) } = deps;
  let args;
  try {
    args = parseCheckArgs(argv);
  } catch (error) {
    log.fail(error.message);
    return 2;
  }
  if (args.help) {
    usage();
    return 0;
  }

  let baseFiles;
  let workFiles;
  try {
    baseFiles = readBaseFiles({ git, base: args.base, dir: args.dir });
    workFiles = readWorkFiles(join(root, args.dir));
  } catch (error) {
    log.fail(error instanceof UsageError ? error.message : `git failed: ${String(error.stderr || error.message).trim()}`);
    return 2;
  }

  const added = [...workFiles.keys()].filter((name) => !baseFiles.has(name));
  log.heading(`Migration lint — ${args.dir} vs ${args.base}`);
  log.info(`${baseFiles.size} base migration(s) checked frozen · ${added.length} new migration(s) checked additive`);
  for (const name of added) {
    const reason = contractReason(workFiles.get(name).toString('utf8'));
    if (reason !== null) log.warn(`${name}: @contract — additive rule skipped (${reason})`);
  }

  const violations = checkMigrations({ baseFiles, workFiles });
  if (violations.length === 0) {
    log.ok('migrations are frozen and additive');
    return 0;
  }
  for (const v of violations) log.fail(formatViolation(args.dir, v));
  log.hint('frozen: never edit an applied migration — add a new one');
  log.hint('additive: expand now, contract later with a `-- @contract: <reason>` header (CONTRIBUTING.md)');
  return 1;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) process.exit(main());
