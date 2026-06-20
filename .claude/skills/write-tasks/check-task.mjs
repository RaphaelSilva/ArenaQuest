#!/usr/bin/env node
// Validate ArenaQuest task file(s) against the modern task standard, and check
// that each milestone's §5 Task Breakdown table stays in sync with the .task.md
// files on disk.
//
//   node check-task.mjs <NN-slug.task.md ...>      # check given task files
//   node check-task.mjs --milestone 13             # all tasks in a milestone + table sync
//   node check-task.mjs                            # every modern milestone's tasks + sync
//   node check-task.mjs --dir path                 # override the milestones dir
//
// Only files that opted into the modern standard are validated — those with a
// `**Team:**` metadata line. Legacy tasks (milestones 1–7, `## Metadata` block)
// predate it and are intentionally skipped, mirroring check-feature.mjs.
//
// ERRORS (exit 1):
//   - filename not `NN-<kebab-slug>.task.md`
//   - missing `# Task NN — <Team>: <Title>` heading, or NN ≠ filename order
//   - missing **Status:**, **Milestone:**, or **Team:** metadata
//   - **Team:** is neither "Backend API" nor "Frontend Web" (QA closeout exempt)
//   - missing a required `## ` section
//   - no **Scope guardrail** in Technical Constraints
//   - (folder mode) a task file with no matching §5 table row
// WARNINGS (exit 0): missing RFC link, no gate command in Acceptance Criteria,
//   no "No diff outside" line, no `git diff` in Verification, cross-layer path in
//   the guardrail (backend touching apps/web, or frontend touching apps/api/src),
//   leftover {{placeholders}}, or a §5 row pointing at a missing file. Stdlib only.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, relative, basename } from 'node:path';

const REQUIRED_SECTIONS = [
  ['Summary'],
  ['Dependencies'],
  ['Technical Constraints', 'Constraints'],
  ['Scope'],
  ['Acceptance Criteria'],
  ['Verification Plan', 'Verification'],
];

function parseArgs(argv) {
  const opts = { dir: 'docs/product/milestones', files: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') opts.dir = argv[++i];
    else if (argv[i] === '--milestone') opts.milestone = argv[++i];
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
const hasSection = (heads, names) => names.some((n) => heads.some((h) => h.includes(n.toLowerCase())));

// The Technical Constraints block: from its heading to the next `## `.
function constraintsBlock(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^##\s.*constraint/i.test(l));
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

function checkTaskFile(path) {
  const errs = [];
  const warns = [];
  const name = relative(process.cwd(), path).split('\\').join('/');
  const file = basename(path);
  const text = readFileSync(path, 'utf8');

  // Only the modern standard carries a **Team:** line. Skip legacy quietly.
  if (!/\*\*Team:\*\*/.test(text)) return { name, skip: true, errs, warns };

  const fnMatch = /^(\d{2,})-[a-z0-9]+(?:-[a-z0-9]+)*\.task\.md$/.exec(file);
  if (!fnMatch) errs.push('filename must be `NN-<kebab-slug>.task.md` (zero-padded order)');

  const titleMatch = /^#\s+Task\s+(\d{2,})\s*[—:-]\s*(Backend|Frontend|QA)?/m.exec(text);
  if (!titleMatch) {
    errs.push('missing `# Task NN — <Team>: <Title>` heading');
  } else if (fnMatch && titleMatch[1] !== fnMatch[1]) {
    errs.push(`heading order (${titleMatch[1]}) ≠ filename order (${fnMatch[1]})`);
  }

  if (!/\*\*Status:\*\*/.test(text)) errs.push('missing **Status:** metadata');
  if (!/\*\*Milestone:\*\*\s*\[/.test(text)) errs.push('missing **Milestone:** [link] metadata');

  const teamM = /\*\*Team:\*\*\s*(.+)/.exec(text);
  const team = teamM ? teamM[1].trim() : '';
  if (!/^(Backend API|Frontend Web|QA)\b/.test(team)) {
    errs.push(`**Team:** must be "Backend API" or "Frontend Web" (got "${team}")`);
  }

  const heads = headings(text);
  for (const group of REQUIRED_SECTIONS) {
    if (!hasSection(heads, group)) errs.push(`missing "## ${group[0]}" section`);
  }

  const constraints = constraintsBlock(text);
  if (!/scope guardrail/i.test(constraints)) {
    errs.push('Technical Constraints has no **Scope guardrail** (the fenced file list)');
  } else {
    // Separation of concerns: the guardrail must not cross layers.
    if (/^Backend API/.test(team) && /apps\/web\//.test(constraints)) {
      warns.push('Backend task guardrail references `apps/web/` — frontend work belongs in a separate Frontend task');
    }
    if (/^Frontend Web/.test(team) && /apps\/api\/src\//.test(constraints)) {
      warns.push('Frontend task guardrail references `apps/api/src/` — backend work belongs in a separate Backend task');
    }
  }

  if (!/\*\*RFC:\*\*/.test(text)) warns.push('no **RFC:** link (recommended — trace the task to its proposal)');
  const accept = text.slice(text.search(/^##\s.*acceptance/im));
  if (!/make (test|lint|test-api|test-web)/.test(accept)) {
    warns.push('Acceptance Criteria names no gate command (make lint / test-api / test-web)');
  }
  if (!/no diff outside/i.test(text)) warns.push('no "No diff outside the scope guardrail" acceptance line');
  if (!/git diff/i.test(text)) warns.push('Verification Plan does not end by confirming `git diff --stat`');
  if (/\{\{[A-Z_]+\}\}/.test(text)) warns.push('unfilled {{placeholders}} remain');

  return { name, errs, warns };
}

// Cross-check a milestone's §5 table against the .task.md files on disk.
function checkTableSync(folder) {
  const errs = [];
  const warns = [];
  const name = relative(process.cwd(), join(folder, 'milestone.md')).split('\\').join('/');
  const doc = join(folder, 'milestone.md');
  if (!existsSync(doc)) return { name, errs, warns };
  const mtext = readFileSync(doc, 'utf8');
  // Only modern, RFC-derived milestones carry a §5 table worth syncing.
  if (!/Derived from\s*\[RFC/i.test(mtext)) return { name, skip: true, errs, warns };

  const linked = new Set();
  for (const m of mtext.matchAll(/\]\(\.\/(\d{2,}-[a-z0-9-]+\.task\.md)\)/g)) linked.add(m[1]);

  const onDisk = readdirSync(folder).filter((f) => /^\d{2,}-[a-z0-9-]+\.task\.md$/.test(f));
  for (const f of onDisk) {
    // Only enforce for modern task files (those with **Team:**).
    if (!/\*\*Team:\*\*/.test(readFileSync(join(folder, f), 'utf8'))) continue;
    if (!linked.has(f)) errs.push(`task file not in §5 table: ${f}`);
  }
  for (const l of linked) {
    if (!existsSync(join(folder, l))) warns.push(`§5 table row links a missing file: ${l}`);
  }
  return { name, errs, warns };
}

const opts = parseArgs(process.argv.slice(2));
const dir = resolve(process.cwd(), opts.dir);

let taskFiles = [];
let folders = [];

if (opts.files.length) {
  taskFiles = opts.files.map((f) => resolve(process.cwd(), f));
} else if (opts.milestone) {
  if (!existsSync(dir)) { console.error(`Milestones directory not found: ${dir}`); process.exit(2); }
  const folder = readdirSync(dir)
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isDirectory())
    .find((p) => relative(dir, p) === opts.milestone || new RegExp(`^${opts.milestone}(?:-|$)`).test(relative(dir, p)) || relative(dir, p).includes(opts.milestone));
  if (!folder) { console.error(`Milestone not found for "${opts.milestone}"`); process.exit(2); }
  folders = [folder];
} else {
  if (!existsSync(dir)) { console.error(`Milestones directory not found: ${dir}`); process.exit(2); }
  folders = readdirSync(dir)
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isDirectory());
}

for (const folder of folders) {
  taskFiles.push(...readdirSync(folder)
    .filter((f) => /^\d{2,}-[a-z0-9-]+\.task\.md$/.test(f))
    .map((f) => join(folder, f)));
}

let hadError = false;
function report({ name, skip, errs, warns }) {
  if (skip) return;
  if (errs.length === 0 && warns.length === 0) { console.log(`✓ ${name}`); return; }
  console.log(`${errs.length ? '✗' : '⚠'} ${name}`);
  for (const e of errs) console.log(`    ERROR: ${e}`);
  for (const w of warns) console.log(`    warn:  ${w}`);
  if (errs.length) hadError = true;
}

for (const f of taskFiles) {
  if (!existsSync(f)) { console.log(`✗ ${relative(process.cwd(), f)}`); console.log('    ERROR: file not found'); hadError = true; continue; }
  report(checkTaskFile(f));
}
for (const folder of folders) report(checkTableSync(folder));

process.exit(hadError ? 1 : 0);
