#!/usr/bin/env node
// Validate ArenaQuest milestone ("feature") doc(s) against the house standard.
//
//   node check-feature.mjs [milestone.md ...]   # check given files
//   node check-feature.mjs                       # check every */milestone.md
//   node check-feature.mjs --dir path            # override the milestones dir
//
// ERRORS (exit 1) are hard violations of the modern, RFC-derived standard:
//   - missing `# Milestone N — Title` heading
//   - missing **Status:** metadata
//   - missing "Derived from [RFC NNNN](...)" link
//   - missing the hard scope guardrail blockquote
//   - missing a required `## N.` section
//   - referenced RFC file does not exist on disk (when resolvable)
// WARNINGS (exit 0) are advisory — unfilled task table, leftover {{placeholders}},
// template stub bullets. Dependency-free (Node stdlib only).

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

// Canonical sections of the modern milestone.md (milestones 8–12). Each entry is
// [canonical label, ...accepted aliases], matched case-insensitively against
// `## ...` headings (the leading "N." is stripped before comparison).
const REQUIRED_SECTIONS = [
  ['Objectives', 'Objective', 'Goals'],
  ['Functional Requirements', 'Requirements'],
  ['Acceptance Criteria'],
  ['Specific Stack', 'Stack', 'Tech Stack'],
  ['Task Breakdown', 'Tasks'],
  ['Definition of Done'],
];

function parseArgs(argv) {
  const opts = { dir: 'docs/product/milestones', files: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') opts.dir = argv[++i];
    else opts.files.push(argv[i]);
  }
  return opts;
}

function headings(text) {
  return text
    .split('\n')
    .filter((l) => l.startsWith('## '))
    .map((l) => l.slice(3).replace(/^\d+\.\s*/, '').trim().toLowerCase());
}

function hasSection(heads, names) {
  return names.some((n) => heads.some((h) => h.includes(n.toLowerCase())));
}

function checkFile(path) {
  const errs = [];
  const warns = [];
  const name = relative(process.cwd(), path).split('\\').join('/');
  const text = readFileSync(path, 'utf8');

  if (!/^#\s+Milestone\s+\d+\s*[—:-]/m.test(text)) {
    errs.push('missing `# Milestone N — Title` heading');
  }
  if (!/\*\*Status:\*\*/.test(text)) {
    errs.push('missing **Status:** metadata');
  }

  const rfcLink = /Derived from\s*\[RFC\s*(\d{4})\]\(([^)]+)\)/i.exec(text);
  if (!rfcLink) {
    errs.push('missing "Derived from [RFC NNNN](...)" link');
  } else {
    const target = resolve(dirname(path), rfcLink[2]);
    if (!existsSync(target)) {
      errs.push(`linked RFC file not found: ${rfcLink[2]}`);
    }
  }

  // The hard scope guardrail is a `>` blockquote mentioning "scope".
  const hasGuardrail = text
    .split('\n')
    .some((l) => l.startsWith('>') && /scope/i.test(l));
  if (!hasGuardrail) {
    errs.push('missing hard scope guardrail blockquote (> … scope …)');
  }

  const heads = headings(text);
  for (const group of REQUIRED_SECTIONS) {
    if (!hasSection(heads, group)) errs.push(`missing "## N. ${group[0]}" section`);
  }

  // Advisory: leftover scaffolding the author still has to replace.
  if (/\{\{[A-Z_]+\}\}/.test(text)) warns.push('unfilled {{placeholders}} remain');
  if (/\[<title>\]\(\.\/01-<slug>\.task\.md\)/.test(text)) {
    warns.push('§5 task table still holds the template stub row');
  }
  if (/<Outcome>|<Non-Goal>|<Decision>|<Specific, observable assertion/.test(text)) {
    warns.push('template placeholder bullets (<Outcome>, <Decision>, …) remain');
  }

  return { name, errs, warns };
}

const opts = parseArgs(process.argv.slice(2));
let files = opts.files.map((f) => resolve(process.cwd(), f));
if (files.length === 0) {
  const dir = resolve(process.cwd(), opts.dir);
  if (!existsSync(dir)) {
    console.error(`Milestones directory not found: ${dir}\nRun from the repo root, or pass --dir.`);
    process.exit(2);
  }
  // Only validate folders that opted into the modern, RFC-derived standard:
  // those whose milestone.md actually carries a "Derived from [RFC ...]" line.
  // Legacy milestones (1–7) predate it and are intentionally skipped.
  files = readdirSync(dir)
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isDirectory())
    .map((p) => join(p, 'milestone.md'))
    .filter((p) => existsSync(p) && /Derived from\s*\[RFC/i.test(readFileSync(p, 'utf8')));
}

let hadError = false;
for (const f of files) {
  if (!existsSync(f)) {
    console.log(`✗ ${relative(process.cwd(), f).split('\\').join('/')}`);
    console.log('    ERROR: file not found');
    hadError = true;
    continue;
  }
  const { name, errs, warns } = checkFile(f);
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
