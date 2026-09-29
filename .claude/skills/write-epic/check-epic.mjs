#!/usr/bin/env node
// Validate ArenaQuest epic(s) against the house standard.
//
//   node check-epic.mjs [file.epic.md ...]     # check given files
//   node check-epic.mjs                         # check every */*.epic.md in docs/product/epics
//   node check-epic.mjs --dir path/to/epics     # override the directory
//
// ERRORS (exit 1) are hard violations of the standard:
//   - filename not <YYYY-MM-DD>-<kebab>.epic.md, or not a real calendar date
//   - epic not inside a folder named after its own stem
//   - missing `# Epic: <Title>` heading
//   - missing Status / Author / Date metadata, or Date != the filename's date
//   - a `Derived from` link that does not resolve to a file
//   - not linked from the README.md index
// WARNINGS (exit 0) flag missing recommended sections, and task files in the
// epic folder that the Task Breakdown table does not mention.
// Legacy epic folders without an *.epic.md (e.g. design-system/) are not
// inspected. Dependency-free.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';

const REQUIRED_META = ['Status', 'Author', 'Date'];
// Section names are matched case-insensitively against `## ...` headings.
const RECOMMENDED = [
  ['Summary'],
  ['Motivation'],
  ['Goals & Non-Goals', 'Goals'],
  ['Proposed Approach', 'Proposed Design'],
  ['Task Breakdown'],
  ['Acceptance Criteria'],
  ['Tradeoffs & Risks', 'Risks'],
];

const FILE_RE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.epic\.md$/;

function parseArgs(argv) {
  const opts = { dir: 'docs/product/epics', files: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') opts.dir = argv[++i];
    else opts.files.push(argv[i]);
  }
  return opts;
}

function isCalendarDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function meta(text, field) {
  const m = new RegExp(`^\\*\\*${field}:\\*\\*\\s*(.*)$`, 'mi').exec(text);
  return m ? m[1].trim() : null;
}

function headings(text) {
  return text.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim().toLowerCase());
}

function checkFile(path, readmeText) {
  const errs = [];
  const warns = [];
  const name = basename(path);
  const folder = dirname(path);

  const fn = FILE_RE.exec(name);
  if (!fn) {
    errs.push(`filename "${name}" is not <YYYY-MM-DD>-<kebab-subject>.epic.md`);
  } else {
    if (!isCalendarDate(fn[1])) errs.push(`"${fn[1]}" is not a real calendar date`);
    const stem = name.slice(0, -'.epic.md'.length);
    if (basename(folder) !== stem) {
      errs.push(`epic must live in a folder named "${stem}/" (found "${basename(folder)}/")`);
    }
  }

  const text = readFileSync(path, 'utf8');
  if (!/^#\s+Epic:\s+\S/m.test(text)) errs.push('missing `# Epic: <Title>` heading');

  for (const field of REQUIRED_META) {
    if (meta(text, field) === null) errs.push(`missing **${field}:** metadata`);
  }
  const date = meta(text, 'Date');
  if (fn && date !== null && date !== fn[1]) {
    errs.push(`**Date:** ${date} != filename date ${fn[1]} (the date is the epic's identity; use **Revised:** for later edits)`);
  }

  // Every relative link on the Derived-from line must resolve.
  const derived = meta(text, 'Derived from');
  if (derived !== null) {
    for (const [, target] of derived.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^[a-z]+:/i.test(target)) continue; // absolute URL
      const abs = resolve(folder, target.split('#')[0]);
      if (!existsSync(abs)) errs.push(`Derived from link does not resolve: ${target}`);
    }
  }

  const heads = headings(text);
  for (const group of RECOMMENDED) {
    if (!group.some((n) => heads.some((h) => h.includes(n.toLowerCase())))) {
      warns.push(`no "${group[0]}" section`);
    }
  }

  // Task files next to the epic should appear in its breakdown table.
  for (const f of readdirSync(folder)) {
    const t = /^(\d{2})-.+\.task\.md$/.exec(f);
    if (t && !new RegExp(`^\\|\\s*\\[?${t[1]}\\b`, 'm').test(text) && !text.includes(f)) {
      warns.push(`task ${f} is not listed in the Task Breakdown table`);
    }
  }

  if (fn && readmeText !== null) {
    const esc = name.replace(/[.]/g, '\\.');
    if (!new RegExp(`\\]\\(\\.?/?(?:[^)]*/)?${esc}\\)`).test(readmeText)) {
      errs.push('not linked from README.md index');
    }
  } else if (readmeText === null) {
    errs.push('no README.md index next to the epic folders');
  }

  return { name, errs, warns };
}

const opts = parseArgs(process.argv.slice(2));
const dir = resolve(process.cwd(), opts.dir);
const readmePath = join(dir, 'README.md');
const readmeText = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : null;

let files = opts.files.map((f) => resolve(process.cwd(), f));
if (files.length === 0) {
  if (!existsSync(dir)) {
    console.error(`Epics directory not found: ${dir}\nRun from the repo root, or pass --dir.`);
    process.exit(2);
  }
  for (const entry of readdirSync(dir)) {
    const sub = join(dir, entry);
    if (!statSync(sub).isDirectory()) continue;
    for (const f of readdirSync(sub)) if (f.endsWith('.epic.md')) files.push(join(sub, f));
  }
  if (files.length === 0) console.log('No *.epic.md files found.');
}

let hadError = false;
for (const f of files) {
  const { name, errs, warns } = checkFile(f, readmeText);
  if (errs.length === 0 && warns.length === 0) {
    console.log(`✓ ${name}`);
  } else {
    console.log(`${errs.length ? '✗' : '⚠'} ${name}`);
    for (const e of errs) console.log(`    ERROR: ${e}`);
    for (const w of warns) console.log(`    warn:  ${w}`);
  }
  if (errs.length) hadError = true;
}

process.exit(hadError ? 1 : 0);
