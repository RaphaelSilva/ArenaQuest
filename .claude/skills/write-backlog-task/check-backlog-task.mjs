#!/usr/bin/env node
// Validate standalone backlog tasks (docs/product/backlog/<topic>/NN-<slug>.task.md).
//
//   node check-backlog-task.mjs <file.task.md ...>   # given files
//   node check-backlog-task.mjs --topic security     # one topic folder
//   node check-backlog-task.mjs                      # every topic
//   node check-backlog-task.mjs --dir path           # override the backlog dir
//
// Only files carrying a `**Kind:**` line follow this standard. Older backlog
// files predate it and are skipped — except for the duplicate-number check,
// which looks at every NN-*.md in a topic because a collision hurts either way.
//
// ERRORS (exit 1):
//   - filename not `NN-<kebab-slug>.task.md`
//   - missing `# Task NN — <Backend|Frontend|Tooling>: <Title>`, or NN ≠ filename
//   - missing **Status:**, **Kind:** or **Team:**; unknown Kind or Team value
//   - heading team tag disagrees with **Team:**
//   - a required `## ` section for the Kind is missing
//   - no **Scope guardrail** in Technical Constraints
// WARNINGS (exit 0): no **Priority:** / **Found in:**, no gate command in the
//   Acceptance Criteria, no "No diff outside" line, no `git diff` in Verification,
//   a cross-layer path in the guardrail, a guardrail that adds a migration (RFC
//   signal), a **Depends On:** link to a missing file, leftover {{placeholders}},
//   a bug without a regression-test criterion, a duplicate NN in the topic.
// Stdlib only.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, relative, basename, dirname } from 'node:path';

const KINDS = ['Feature', 'Bug', 'Refactor', 'Tech Debt', 'Chore'];
const TEAMS = { 'Backend API': 'Backend', 'Frontend Web': 'Frontend', Tooling: 'Tooling' };

const COMMON = [
  ['Summary'],
  ['Scope'],
  ['Technical Constraints', 'Constraints'],
  ['Acceptance Criteria'],
  ['Verification Plan', 'Verification'],
];
const BY_KIND = {
  Feature: [['Motivation']],
  Bug: [['Reproduction', 'Steps to Reproduce'], ['Root Cause']],
  Refactor: [['Why It Is Worth Fixing', 'Why']],
  'Tech Debt': [['Why It Is Worth Fixing', 'Why']],
  Chore: [['Why It Is Worth Fixing', 'Why']],
};

function parseArgs(argv) {
  const opts = { dir: 'docs/product/backlog', files: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') opts.dir = argv[++i];
    else if (argv[i] === '--topic') opts.topic = argv[++i];
    else opts.files.push(argv[i]);
  }
  return opts;
}

const rel = (p) => relative(process.cwd(), p).split('\\').join('/');

function headings(text) {
  return text.split('\n').filter((l) => l.startsWith('## '))
    .map((l) => l.slice(3).replace(/^\d+\.\s*/, '').trim().toLowerCase());
}
const hasSection = (heads, names) => names.some((n) => heads.some((h) => h.includes(n.toLowerCase())));

// Body of the first `## ` section whose heading matches `re`, up to the next `## `.
function section(text, re) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('## ') && re.test(l));
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (lines[i].startsWith('## ')) { end = i; break; }
  return lines.slice(start, end).join('\n');
}

const meta = (text, field) => {
  const m = new RegExp(`^\\*\\*${field}:\\*\\*\\s*(.+?)\\s*$`, 'm').exec(text);
  return m ? m[1] : null;
};

function checkFile(path) {
  const errs = [];
  const warns = [];
  const text = readFileSync(path, 'utf8');
  const file = basename(path);
  if (!/^\*\*Kind:\*\*/m.test(text)) return { name: rel(path), skip: true, errs, warns };

  const fn = /^(\d{2,})-[a-z0-9]+(?:-{1,2}[a-z0-9]+)*\.task\.md$/.exec(file);
  if (!fn) errs.push('filename must be `NN-<kebab-slug>.task.md` (zero-padded order)');

  const head = /^#\s+Task\s+(\d{2,})\s*[—:-]\s*(Backend|Frontend|Tooling)\s*:\s*\S/m.exec(text);
  if (!head) errs.push('missing `# Task NN — <Backend|Frontend|Tooling>: <Title>` heading');
  else if (fn && head[1] !== fn[1]) errs.push(`heading order (${head[1]}) ≠ filename order (${fn[1]})`);

  if (!meta(text, 'Status')) errs.push('missing **Status:**');
  const kind = meta(text, 'Kind');
  if (!KINDS.includes(kind)) errs.push(`**Kind:** must be one of ${KINDS.join(', ')} (got "${kind}")`);
  const team = meta(text, 'Team');
  if (!TEAMS[team]) errs.push(`**Team:** must be one of ${Object.keys(TEAMS).join(', ')} (got "${team}")`);
  else if (head && TEAMS[team] !== head[2]) errs.push(`heading says "${head[2]}" but **Team:** is "${team}"`);

  if (!meta(text, 'Priority')) warns.push('no **Priority:** line');
  if (!meta(text, 'Found in')) warns.push('no **Found in:** line (where this was noticed, and when)');

  const heads = headings(text);
  for (const group of [...COMMON, ...(BY_KIND[kind] || [])]) {
    if (!hasSection(heads, group)) errs.push(`missing "## ${group[0]}" section (required for ${kind || 'this kind'})`);
  }

  const constraints = section(text, /constraint/i);
  if (!/scope guardrail/i.test(constraints)) {
    errs.push('Technical Constraints has no **Scope guardrail** (the fenced file list)');
  } else {
    if (team === 'Backend API' && /apps\/web\//.test(constraints)) {
      warns.push('Backend guardrail references `apps/web/` — split the frontend part into its own task');
    }
    if (team === 'Frontend Web' && /apps\/api\/src\//.test(constraints)) {
      warns.push('Frontend guardrail references `apps/api/src/` — split the backend part into its own task');
    }
    if (/apps\/api\/migrations/.test(constraints)) {
      warns.push('guardrail adds a migration — a schema change usually deserves an RFC (see SKILL.md, "When to escalate")');
    }
  }

  const accept = section(text, /acceptance/i);
  if (!/make (lint|test)|pnpm (test|lint)|node --test/.test(accept)) {
    warns.push('Acceptance Criteria names no gate command (make lint / test-api / test-web)');
  }
  if (!/no diff outside/i.test(text)) warns.push('no "No diff outside the scope guardrail" criterion');
  if (!/git diff/i.test(section(text, /verification/i))) warns.push('Verification Plan does not confirm `git diff --stat`');
  if (kind === 'Bug' && !/regression/i.test(accept)) warns.push('Bug has no regression-test acceptance criterion');
  if (/\{\{[^}]+\}\}/.test(text)) warns.push('unfilled {{placeholders}} remain');

  const deps = meta(text, 'Depends On');
  if (deps) {
    for (const m of deps.matchAll(/\]\(([^)]+)\)/g)) {
      if (!/^https?:/.test(m[1]) && !existsSync(resolve(dirname(path), m[1]))) {
        warns.push(`**Depends On:** links a missing file: ${m[1]}`);
      }
    }
  }
  return { name: rel(path), errs, warns };
}

// Two files in one topic sharing NN make "Task 01" ambiguous for branches and links.
function checkDuplicates(folder) {
  const byOrder = new Map();
  for (const f of readdirSync(folder)) {
    const m = /^(\d+)-.*\.md$/.exec(f);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    byOrder.set(n, [...(byOrder.get(n) || []), f]);
  }
  const warns = [];
  for (const [n, files] of byOrder) {
    if (files.length > 1) warns.push(`number ${String(n).padStart(2, '0')} used ${files.length}× — ${files.join(', ')}`);
  }
  return { name: `${rel(folder)}/ (numbering)`, errs: [], warns };
}

const opts = parseArgs(process.argv.slice(2));
const root = resolve(process.cwd(), opts.dir);
let files = [];
let folders = [];

if (opts.files.length) {
  files = opts.files.map((f) => resolve(process.cwd(), f));
} else {
  if (!existsSync(root)) { console.error(`Backlog directory not found: ${root}`); process.exit(2); }
  folders = readdirSync(root).map((f) => join(root, f)).filter((p) => statSync(p).isDirectory());
  if (opts.topic) {
    folders = folders.filter((p) => basename(p) === opts.topic);
    if (!folders.length) { console.error(`Topic not found: ${opts.topic}`); process.exit(2); }
  }
  for (const folder of folders) {
    files.push(...readdirSync(folder).filter((f) => f.endsWith('.task.md')).map((f) => join(folder, f)));
  }
}

let hadError = false;
let checked = 0;
let skipped = 0;
function report({ name, skip, errs, warns }, counted = true) {
  if (skip) { skipped++; return; }
  if (counted) checked++;
  if (!errs.length && !warns.length) { console.log(`✓ ${name}`); return; }
  console.log(`${errs.length ? '✗' : '⚠'} ${name}`);
  for (const e of errs) console.log(`    ERROR: ${e}`);
  for (const w of warns) console.log(`    warn:  ${w}`);
  if (errs.length) hadError = true;
}

for (const f of files) {
  if (!existsSync(f)) { console.log(`✗ ${rel(f)}\n    ERROR: file not found`); hadError = true; continue; }
  report(checkFile(f));
}
for (const folder of folders) {
  const dup = checkDuplicates(folder);
  if (dup.warns.length) report(dup, false);
}
console.log(`\n${checked} checked, ${skipped} legacy file(s) skipped (no **Kind:** line).`);
process.exit(hadError ? 1 : 0);
