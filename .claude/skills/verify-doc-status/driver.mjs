#!/usr/bin/env node
// verify-doc-status — report-only status auditor for ArenaQuest product docs.
//
// It scans docs/product (RFCs, milestones, tasks), normalizes their declared
// status against a single canonical vocabulary, and cross-checks the status
// signals against each other (RFC header vs README index, milestone vs its
// tasks, §5 table token vs task header, acceptance checkboxes vs task status,
// RFC vs the milestone(s) derived from it).
//
// It NEVER edits a file and NEVER touches implementation code. It prints a
// worklist of findings, each naming the exact file + line to change, and exits
// non-zero when any finding exists. The human/agent applies the status edit in
// the named doc — see SKILL.md.
//
// Node stdlib only (matches the sibling write-*/check-*.mjs scripts).

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

// --------------------------------------------------------------------------
// Canonical vocabularies — the single source of truth this skill enforces.
// --------------------------------------------------------------------------

const RFC_STATUSES = ['Draft', 'Accepted', 'Implemented', 'Superseded', 'Rejected'];
const MILESTONE_STATUSES = ['📝 Draft', '🏗️ Planning', '🚧 In Progress', '✅ Implemented'];
const TASK_STATUSES = ['📝 Open', '🚧 In Progress', '✅ Done'];
const TABLE_TOKENS = ['☐ Open', '🚧 In Progress', '✅ Done'];

// Legacy spelling → canonical, so the report can suggest the exact replacement.
const MILESTONE_ALIASES = {
  'Planning': '🏗️ Planning',
  '✅ Completed': '✅ Implemented',
  '✅ Implemented (on candidate)': '✅ Implemented',
  'Draft': '📝 Draft',
  'In Progress': '🚧 In Progress',
};
const TASK_ALIASES = {
  '✅ Completed': '✅ Done',
  'Open': '📝 Open',
  'Done': '✅ Done',
  'In Progress': '🚧 In Progress',
};
const TABLE_ALIASES = {
  '📝 Draft': '☐ Open',
  '📝 Open': '☐ Open',
  '✅ Completed': '✅ Done',
};

const REPO = process.cwd();
const PRODUCT = join(REPO, 'docs', 'product');

// --------------------------------------------------------------------------
// Tiny helpers
// --------------------------------------------------------------------------

function read(file) {
  return readFileSync(file, 'utf8');
}
function rel(file) {
  return relative(REPO, file);
}
function lineOf(text, needleRe) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) if (needleRe.test(lines[i])) return i + 1;
  return null;
}
function statusFromHeader(text) {
  const m = text.match(/^\*\*Status:\*\*\s*(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

const findings = [];
function flag(type, file, message, suggestion, line) {
  findings.push({ type, file: rel(file), line: line ?? null, message, suggestion: suggestion ?? null });
}

// --------------------------------------------------------------------------
// RFCs
// --------------------------------------------------------------------------

function parseReadmeIndex(readmePath) {
  // Rows look like: | [0010](./0010-...md) | Title | Status | Date | Author |
  const out = new Map(); // num -> { status, rawLine, lineNo }
  if (!existsSync(readmePath)) return out;
  const lines = read(readmePath).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\|\s*\[(\d{4})\]\([^)]+\)\s*\|[^|]*\|\s*([^|]+?)\s*\|/);
    if (m) out.set(m[1], { status: m[2].trim(), lineNo: i + 1 });
  }
  return out;
}

function auditRFCs(index) {
  const dir = join(PRODUCT, 'RFCs');
  if (!existsSync(dir)) return index;
  const readmeIndex = parseReadmeIndex(join(dir, 'README.md'));
  const files = readdirSync(dir).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort();
  for (const f of files) {
    const path = join(dir, f);
    const text = read(path);
    const num = f.slice(0, 4);
    const status = statusFromHeader(text);
    const ln = lineOf(text, /^\*\*Status:\*\*/);
    index.rfcs.set(num, { num, path, status, title: (text.match(/^#\s*RFC\s*\d+:?\s*(.+)$/m) || [])[1] });

    if (!status) {
      flag('MISSING', path, 'RFC has no **Status:** header line.', `Add one of: ${RFC_STATUSES.join(', ')}.`);
    } else if (!RFC_STATUSES.includes(status)) {
      flag('DRIFT', path, `RFC status "${status}" is not canonical.`, `Use one of: ${RFC_STATUSES.join(', ')}.`, ln);
    }

    const idx = readmeIndex.get(num);
    if (!idx) {
      flag('MISMATCH', join(dir, 'README.md'), `RFC ${num} is missing from the README index table.`, `Add a row for RFC ${num}.`);
    } else if (status && idx.status !== status) {
      flag('MISMATCH', join(dir, 'README.md'),
        `README index says RFC ${num} is "${idx.status}" but the RFC header says "${status}".`,
        `Make the index row match the RFC header ("${status}").`, idx.lineNo);
    }
  }
  return index;
}

// --------------------------------------------------------------------------
// Tasks
// --------------------------------------------------------------------------

function auditTask(path) {
  const text = read(path);
  const status = statusFromHeader(text);
  const ln = lineOf(text, /^\*\*Status:\*\*/);
  const checked = (text.match(/^\s*-\s*\[x\]/gim) || []).length;
  const unchecked = (text.match(/^\s*-\s*\[ \]/gim) || []).length;

  if (!status) {
    flag('MISSING', path, 'Task has no **Status:** header line.', `Add one of: ${TASK_STATUSES.join(', ')}.`);
  } else if (!TASK_STATUSES.includes(status)) {
    const fix = TASK_ALIASES[status];
    flag('DRIFT', path, `Task status "${status}" is not canonical.`,
      fix ? `Replace with "${fix}".` : `Use one of: ${TASK_STATUSES.join(', ')}.`, ln);
  }

  const norm = TASK_ALIASES[status] || status;
  // Acceptance-checkbox vs status consistency (report only — do NOT auto-check).
  if (norm === '✅ Done' && unchecked > 0) {
    flag('STALE', path, `Task is "${status}" but has ${unchecked} unchecked acceptance box(es).`,
      'Verify each criterion against the implementation; check the box if met, otherwise change the status back — do not edit code to force it.', ln);
  }
  if (norm === '📝 Open' && checked > 0 && unchecked === 0 && (checked + unchecked) > 0) {
    flag('STALE', path, `Task is "${status}" but every acceptance box is already checked.`,
      'If the work is truly done and verified, set Status to "✅ Done".', ln);
  }
  return { status: norm, raw: status, checked, unchecked };
}

// --------------------------------------------------------------------------
// Milestones
// --------------------------------------------------------------------------

function parseSection5Table(text) {
  // Rows: | 01 | [Title](./01-slug.task.md) | Phase | Team | <token> |
  const rows = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\|\s*\d+\s*\|\s*\[[^\]]+\]\((\.\/[^)]+\.task\.md)\)\s*\|[^|]*\|[^|]*\|\s*([^|]+?)\s*\|/);
    if (m) rows.push({ target: m[1].replace(/^\.\//, ''), token: m[2].trim(), lineNo: i + 1 });
  }
  return rows;
}

function auditMilestone(dir, index) {
  const mPath = join(dir, 'milestone.md');
  if (!existsSync(mPath)) return; // legacy folders without milestone.md are skipped
  const text = read(mPath);
  const status = statusFromHeader(text);
  const ln = lineOf(text, /^\*\*Status:\*\*/);
  const derived = (text.match(/Derived from \[RFC (\d+)\]/) || [])[1] || null;

  if (!status) {
    flag('MISSING', mPath, 'Milestone has no **Status:** header line.', `Add one of: ${MILESTONE_STATUSES.join(', ')}.`);
  } else if (!MILESTONE_STATUSES.includes(status)) {
    const fix = MILESTONE_ALIASES[status];
    flag('DRIFT', mPath, `Milestone status "${status}" is not canonical.`,
      fix ? `Replace with "${fix}".` : `Use one of: ${MILESTONE_STATUSES.join(', ')}.`, ln);
  }
  const normStatus = MILESTONE_ALIASES[status] || status;

  // Task files in the folder.
  const taskFiles = readdirSync(dir).filter((f) => f.endsWith('.task.md')).sort();
  const tasks = new Map();
  for (const tf of taskFiles) tasks.set(tf, auditTask(join(dir, tf)));

  // §5 table token vs task header status.
  const rows = parseSection5Table(text);
  for (const row of rows) {
    const t = tasks.get(basename(row.target));
    if (!t) {
      flag('MISMATCH', mPath, `§5 table row points at "${row.target}" which has no task file.`,
        'Fix the link or remove the row.', row.lineNo);
      continue;
    }
    const wantToken = TABLE_ALIASES[t.raw] || (t.status === '✅ Done' ? '✅ Done' : t.status === '🚧 In Progress' ? '🚧 In Progress' : '☐ Open');
    if (!TABLE_TOKENS.includes(row.token)) {
      flag('DRIFT', mPath, `§5 table token "${row.token}" for ${row.target} is not canonical.`,
        `Use one of: ${TABLE_TOKENS.join(', ')} (here: "${wantToken}").`, row.lineNo);
    } else if (row.token !== wantToken) {
      flag('MISMATCH', mPath, `§5 table shows ${row.target} as "${row.token}" but the task header is "${t.raw}".`,
        `Set the table token to "${wantToken}".`, row.lineNo);
    }
  }

  // Milestone status vs aggregate task status.
  const taskStatuses = [...tasks.values()].map((t) => t.status);
  if (taskStatuses.length > 0) {
    const allDone = taskStatuses.every((s) => s === '✅ Done');
    const anyInProgress = taskStatuses.some((s) => s === '🚧 In Progress' || s === '✅ Done');
    if (allDone && normStatus !== '✅ Implemented') {
      flag('STALE', mPath, `All ${taskStatuses.length} task(s) are "✅ Done" but the milestone is "${status}".`,
        'If §3 acceptance + §7 DoD are met, set milestone Status to "✅ Implemented".', ln);
    }
    if (!allDone && normStatus === '✅ Implemented') {
      flag('MISMATCH', mPath, `Milestone is "${status}" but not all tasks are "✅ Done".`,
        'Lower the milestone status, or finish/verify the open tasks.', ln);
    }
    if (anyInProgress && normStatus === '📝 Draft') {
      flag('STALE', mPath, `Milestone is "📝 Draft" but task work has started/finished.`,
        'Advance the milestone to "🚧 In Progress" (or "✅ Implemented").', ln);
    }
  }

  // RFC ↔ derived milestone.
  if (derived) {
    const rfc = index.rfcs.get(derived.padStart(4, '0'));
    if (rfc && rfc.status && normStatus === '✅ Implemented' && rfc.status !== 'Implemented') {
      flag('STALE', rfc.path,
        `Milestone "${rel(mPath)}" is "✅ Implemented" but its source RFC ${derived} is still "${rfc.status}".`,
        `Verify the RFC's Success Criteria against the code; if met, set RFC ${derived} Status to "Implemented" (and its README index row).`);
    }
  }
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const jsonOut = args.includes('--json');
  const typeArg = (args.find((a) => a.startsWith('--type=')) || '').split('=')[1];
  const pathArg = args.find((a) => !a.startsWith('--'));

  const index = { rfcs: new Map() };

  // RFCs always parsed first so milestone→RFC checks can resolve.
  auditRFCs(index);

  if (pathArg) {
    // Scope to a single doc (still needs the RFC index, already built).
    const abs = join(REPO, pathArg);
    if (!existsSync(abs)) {
      console.error(`Path not found: ${pathArg}`);
      process.exit(2);
    }
    if (/\.task\.md$/.test(abs)) auditTask(abs);
    else if (/milestone\.md$/.test(abs)) auditMilestone(join(abs, '..'), index);
    // RFC findings for that file are already in `findings` from auditRFCs.
    // Filter to just this path's findings below.
    const only = findings.filter((f) => f.file === relative(REPO, abs) || f.file.endsWith('README.md'));
    return report(only, jsonOut);
  }

  if (!typeArg || typeArg === 'milestone' || typeArg === 'task') {
    const mDir = join(PRODUCT, 'milestones');
    if (existsSync(mDir)) {
      for (const entry of readdirSync(mDir).sort()) {
        const dir = join(mDir, entry);
        if (statSync(dir).isDirectory()) auditMilestone(dir, index);
      }
    }
  }

  let out = findings;
  if (typeArg === 'rfc') out = findings.filter((f) => f.file.includes('/RFCs/'));
  if (typeArg === 'milestone' || typeArg === 'task') out = findings.filter((f) => f.file.includes('/milestones/'));
  report(out, jsonOut);
}

function report(list, jsonOut) {
  if (jsonOut) {
    console.log(JSON.stringify({ findings: list, count: list.length }, null, 2));
    process.exit(list.length ? 1 : 0);
  }

  if (list.length === 0) {
    console.log('✓ All product-doc statuses are canonical and consistent.');
    process.exit(0);
  }

  const byFile = new Map();
  for (const f of list) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }

  console.log(`Found ${list.length} status finding(s) across ${byFile.size} file(s).`);
  console.log('Report-only: edit the STATUS in each named file. Do NOT change code to satisfy a criterion.\n');
  for (const [file, items] of byFile) {
    console.log(`▸ ${file}`);
    for (const it of items) {
      const where = it.line ? `:${it.line}` : '';
      console.log(`    [${it.type}]${where} ${it.message}`);
      if (it.suggestion) console.log(`        → ${it.suggestion}`);
    }
    console.log('');
  }
  console.log('Legend: DRIFT=non-canonical wording · MISMATCH=two sources disagree · STALE=status contradicts evidence · MISSING=no status line.');
  process.exit(1);
}

main();
