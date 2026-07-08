#!/usr/bin/env node
// Validate ArenaQuest RFC(s) against the house standard.
//
//   node check-rfc.mjs [file.md ...]          # check given files
//   node check-rfc.mjs                         # check all NNNN-*.md in docs/product/RFCs
//   node check-rfc.mjs --dir path/to/RFCs      # override the directory
//
// ERRORS (exit 1) are hard violations of the standard:
//   - filename not NNNN-<kebab>.md
//   - missing/!matching `# RFC NNNN` title
//   - missing Status / Author / Date metadata
//   - not listed in README.md index
// WARNINGS (exit 0) flag missing recommended sections — older RFCs predate the
// full skeleton, so these are advisory, not blocking. Dependency-free.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';

// Each entry: [canonical label, ...accepted aliases]. PT aliases keep
// legitimately-Portuguese RFCs (e.g. 0001) from hard-failing.
const REQUIRED_META = [
  ['Status'],
  ['Author', 'Autor'],
  ['Date', 'Data'],
];
// Section names are matched case-insensitively against `## ...` headings.
// Alternatives accept PT or EN so the older RFCs (0001) don't hard-fail.
const RECOMMENDED = [
  ['Summary', 'Resumo', 'Context', 'Contexto'],
  ['Motivation', 'Motivação', 'Diagnóstico', 'Identified Problems'],
  ['Proposed Design', 'Proposed Solution', 'Proposta', 'Detailed Design'],
  ['Alternatives Considered', 'Alternatives'],
  ['Implementation Plan', 'Plano de execução', 'Remaining Work'],
  ['Tradeoffs & Risks', 'Riscos', 'Risks'],
  ['Success Criteria', 'Impacto esperado', 'Impacto'],
];

function parseArgs(argv) {
  const opts = { dir: 'docs/product/RFCs', files: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') opts.dir = argv[++i];
    else opts.files.push(argv[i]);
  }
  return opts;
}

function headings(text) {
  return text.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim().toLowerCase());
}

function hasSection(heads, names) {
  return names.some((n) => heads.some((h) => h.includes(n.toLowerCase())));
}

function checkFile(path, readmeText) {
  const errs = [];
  const warns = [];
  const name = basename(path);

  const fnMatch = /^(\d{4})-[a-z0-9-]+\.md$/.exec(name);
  if (!fnMatch) errs.push(`filename "${name}" is not NNNN-<kebab>.md`);

  const text = readFileSync(path, 'utf8');
  const titleMatch = /^#\s+RFC\s+(\d{4})\b/m.exec(text);
  if (!titleMatch) {
    errs.push('missing `# RFC NNNN: Title` heading');
  } else if (fnMatch && titleMatch[1] !== fnMatch[1]) {
    errs.push(`title number ${titleMatch[1]} != filename number ${fnMatch[1]}`);
  }

  for (const group of REQUIRED_META) {
    const found = group.some((field) =>
      new RegExp(`\\*\\*${field}:?\\*\\*|^${field}:`, 'mi').test(text));
    if (!found) errs.push(`missing **${group[0]}:** metadata`);
  }

  const heads = headings(text);
  for (const group of RECOMMENDED) {
    if (!hasSection(heads, group)) warns.push(`no "${group[0]}" section`);
  }

  if (fnMatch && readmeText !== null) {
    const inIndex = new RegExp(`\\[${fnMatch[1]}\\]\\(\\.?/?${name.replace(/[.]/g, '\\.')}\\)`).test(readmeText)
      || new RegExp(`\\(\\.?/?${name.replace(/[.]/g, '\\.')}\\)`).test(readmeText);
    if (!inIndex) errs.push('not linked from README.md index');
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
    console.error(`RFC directory not found: ${dir}\nRun from the repo root, or pass --dir.`);
    process.exit(2);
  }
  files = readdirSync(dir).filter((f) => /^\d{4}-.+\.md$/.test(f)).map((f) => join(dir, f));
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
