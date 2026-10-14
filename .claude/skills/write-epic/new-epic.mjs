#!/usr/bin/env node
// Scaffold a new ArenaQuest epic from the canonical template.
//
//   node new-epic.mjs "Title of the epic" [--slug SUBJECT] [--date YYYY-MM-DD]
//                     [--author NAME] [--status Draft] [--rfc path/to/RFC.md ...]
//                     [--dir docs/product/epics]
//
// - An epic is identified by its creation date + subject, not by a sequence
//   number: docs/product/epics/<YYYY-MM-DD>-<subject>/<YYYY-MM-DD>-<subject>.epic.md
//   The folder also holds the epic's NN-<slug>.task.md files, and its name is
//   the <epic_name> the developer skill uses for `feature/epic/<epic_name>/…`.
// - --rfc (repeatable) pre-wires the `Derived from` link(s); without it the epic
//   is standalone and the field reads "—".
// - Inserts an index row, in date order, into docs/product/epics/README.md
//   (creating the README when it does not exist yet).
// Prints the created path. Dependency-free (Node stdlib only).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));

function die(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { status: 'Draft', dir: 'docs/product/epics', rfcs: [] };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--author') opts.author = argv[++i];
    else if (a === '--status') opts.status = argv[++i];
    else if (a === '--date') opts.date = argv[++i];
    else if (a === '--slug') opts.slug = argv[++i];
    else if (a === '--rfc') opts.rfcs.push(argv[++i]);
    else if (a === '--dir') opts.dir = argv[++i];
    else rest.push(a);
  }
  opts.title = rest.join(' ').trim();
  return opts;
}

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/** Today in the author's local timezone — the date is the epic's identity. */
function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
function isCalendarDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function gitUser() {
  try {
    return execSync('git config user.name').toString().trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** `[RFC NNNN](rel)` for one RFC file, read from its `# RFC NNNN: …` heading. */
function rfcLink(rfcPath, folder) {
  const abs = resolve(process.cwd(), rfcPath);
  if (!existsSync(abs)) die(`RFC not found: ${rfcPath}`);
  const m = /^#\s+RFC\s+(\d{4})\b/m.exec(readFileSync(abs, 'utf8'));
  if (!m) die(`${rfcPath} has no "# RFC NNNN: Title" heading`);
  const rel = relative(folder, abs).split('\\').join('/');
  return `[RFC ${m[1]}](${rel})`;
}

const README_HEADER = `# Epics

Bodies of work too large for one task and too small, or too cross-cutting, for a
numbered milestone. An epic is identified by its **creation date + subject** —
\`<YYYY-MM-DD>-<subject>/<YYYY-MM-DD>-<subject>.epic.md\` — never by a sequence
number, so two planning branches opened on the same day cannot collide unless
they pick the same subject. Its tasks live in the same folder as
\`NN-<slug>.task.md\`. Scaffold and validate with the \`write-epic\` skill.

## Index

| Epic | Title | Status | Derived from | Date |
|------|-------|--------|--------------|------|
`;

const ROW_RE = /^\|\s*\[(\d{4}-\d{2}-\d{2})-[^\]]*\]\(/;

/** Inserts `row` after the last index row whose date is <= `date`. */
function insertIndexRow(readmePath, row, date) {
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, README_HEADER + row + '\n');
    return 'created';
  }
  const lines = readFileSync(readmePath, 'utf8').split('\n');
  let firstRow = -1;
  let insertAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = ROW_RE.exec(lines[i]);
    if (!m) continue;
    if (firstRow === -1) firstRow = i;
    if (m[1] <= date) insertAt = i + 1;
  }
  if (firstRow === -1) {
    // No row yet: place it right after the table separator, if there is one.
    const sep = lines.findIndex((l) => /^\|[\s:|-]+\|$/.test(l));
    if (sep === -1) return 'no-table';
    insertAt = sep + 1;
  } else if (insertAt === -1) {
    insertAt = firstRow; // older than every existing epic
  }
  lines.splice(insertAt, 0, row);
  writeFileSync(readmePath, lines.join('\n'));
  return 'inserted';
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.title) {
  die('usage: node new-epic.mjs "Title" [--slug S] [--date YYYY-MM-DD] [--author NAME] ' +
      '[--status S] [--rfc path ...] [--dir PATH]');
}

const dir = resolve(process.cwd(), opts.dir);
if (!existsSync(dir)) die(`Epics directory not found: ${dir}\nRun from the repo root, or pass --dir.`);

const date = opts.date || localToday();
if (!isCalendarDate(date)) die(`--date must be a real calendar date in YYYY-MM-DD form, got "${date}"`);

const subject = slugify(opts.slug || opts.title);
if (!subject) die('Could not derive a subject slug from the title — pass --slug.');

const stem = `${date}-${subject}`;
const folder = join(dir, stem);
const filename = `${stem}.epic.md`;
const filepath = join(folder, filename);

if (existsSync(filepath)) die(`Refusing to overwrite existing epic: ${relative(process.cwd(), filepath)}`);

const derived = opts.rfcs.length ? opts.rfcs.map((r) => rfcLink(r, folder)).join(', ') : '—';
const author = opts.author || gitUser();

const body = readFileSync(join(HERE, 'template.md'), 'utf8')
  .replaceAll('{{TITLE}}', opts.title)
  .replaceAll('{{DATE}}', date)
  .replaceAll('{{STATUS}}', opts.status)
  .replaceAll('{{AUTHOR}}', author)
  .replaceAll('{{DERIVED}}', derived);

mkdirSync(folder, { recursive: true });
writeFileSync(filepath, body);

// The README sits one level above the epic folder, so the RFC links are rebuilt
// relative to it rather than reused from the epic body.
const indexDerived = opts.rfcs.length ? opts.rfcs.map((r) => rfcLink(r, dir)).join(', ') : '—';
const row = `| [${stem}](./${stem}/${filename}) | ${opts.title} | ${opts.status} | ${indexDerived} | ${date} |`;
const outcome = insertIndexRow(join(dir, 'README.md'), row, date);
if (outcome === 'no-table') {
  console.error(`No index table found in ${opts.dir}/README.md — add the row manually:\n  ${row}`);
} else {
  console.error(`Index row ${outcome === 'created' ? 'written to new' : 'added to'} ${opts.dir}/README.md`);
}

console.log(`${opts.dir}/${stem}/${basename(filepath)}`);
