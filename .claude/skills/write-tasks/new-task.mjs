#!/usr/bin/env node
// Scaffold a new ArenaQuest task file inside a milestone or an epic folder.
//
//   node new-task.mjs --milestone 13 --team backend  --title "Brand config port and adapter" \
//                     [--phase 1] [--slug brand-config] [--depends 01,02] \
//                     [--rfc docs/product/RFCs/0006-...md] [--status "📝 Open"]
//   node new-task.mjs --epic 2026-09-29-e2e-test-phase --team frontend --title "..." [...]
//
// - Resolves the parent folder by number, slug fragment, or path:
//   --milestone under docs/product/milestones (reads `# Milestone N — Title`),
//   --epic under docs/product/epics (reads the folder's `*.epic.md`, `# Epic: Title`).
//   Exactly one of the two is required.
// - Carries the parent's RFC link over: the milestone's `Derived from [RFC NNNN](rel)`
//   or the first RFC link on the epic's `**Derived from:**` line (--rfc wins).
// - Computes the next NN by scanning existing NN-*.task.md files.
// - Picks template-backend.md or template-frontend.md by --team, builds the
//   header, and writes <parent folder>/NN-<slug>.task.md.
// Prints the created path on stdout and the ready-to-paste table row (milestone
// §5 or epic Task Breakdown shape) on stderr. Backend and frontend always land
// in SEPARATE files. Stdlib only.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { team: 'backend', status: '📝 Open', dir: 'docs/product/milestones', epicDir: 'docs/product/epics' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--milestone') opts.milestone = argv[++i];
    else if (a === '--epic') opts.epic = argv[++i];
    else if (a === '--epic-dir') opts.epicDir = argv[++i];
    else if (a === '--team') opts.team = argv[++i];
    else if (a === '--title') opts.title = argv[++i];
    else if (a === '--slug') opts.slug = argv[++i];
    else if (a === '--phase') opts.phase = argv[++i];
    else if (a === '--depends') opts.depends = argv[++i];
    else if (a === '--rfc') opts.rfc = argv[++i];
    else if (a === '--status') opts.status = argv[++i];
    else if (a === '--order') opts.order = argv[++i];
    else if (a === '--dir') opts.dir = argv[++i];
  }
  return opts;
}

function die(msg, code = 2) { console.error(msg); process.exit(code); }

function slugify(title) {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

// Resolve a parent folder from a number ("13"), a slug fragment
// ("white-label", "e2e-test-phase"), or a path. Match folders by leading
// integer or substring. `kind` only shapes the error messages.
function resolveFolder(dir, key, kind = 'milestone') {
  if (existsSync(key) && statSync(key).isDirectory()) return resolve(key);
  const folders = readdirSync(dir)
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isDirectory());
  if (/^\d+$/.test(key)) {
    const hit = folders.filter((p) => new RegExp(`^${key}(?:-|$)`).test(relative(dir, p)));
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) die(`Ambiguous ${kind} "${key}": ${hit.map((p) => relative(dir, p)).join(', ')}`);
  }
  const sub = folders.filter((p) => relative(dir, p).includes(key));
  if (sub.length === 1) return sub[0];
  if (sub.length > 1) die(`Ambiguous ${kind} "${key}": ${sub.map((p) => relative(dir, p)).join(', ')}`);
  die(`No ${kind} folder found for "${key}" under ${relative(process.cwd(), dir) || dir}.`);
}

// Next NN: highest leading integer across NN-*.task.md files + 1, zero-padded.
function nextOrder(folder) {
  let max = 0;
  for (const f of readdirSync(folder)) {
    const m = /^(\d+)-.*\.task\.md$/.exec(f);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return String(max + 1).padStart(2, '0');
}

const opts = parseArgs(process.argv.slice(2));
if (!(opts.milestone || opts.epic) || !opts.title) {
  die('usage: node new-task.mjs (--milestone <num|slug|path> | --epic <stem|slug|path>) \\\n' +
      '         --team backend|frontend --title "..." [--phase N] [--slug S] [--depends NN,NN] \\\n' +
      '         [--rfc path] [--status S] [--order NN] [--dir PATH] [--epic-dir PATH]');
}
if (opts.milestone && opts.epic) die('Pass either --milestone or --epic, not both.');

const team = opts.team.toLowerCase();
if (team !== 'backend' && team !== 'frontend') die(`--team must be "backend" or "frontend" (got "${opts.team}")`);

// The parent is either a milestone (milestone.md) or an epic (<stem>.epic.md).
// Everything below only needs: its folder, its text, the header link line, and
// a label for the summary messages.
let folder, ptext, parentLine, parentLabel;
if (opts.epic) {
  const edir = resolve(process.cwd(), opts.epicDir);
  if (!existsSync(edir)) die(`Epics directory not found: ${edir}\nRun from the repo root, or pass --epic-dir.`);
  folder = resolveFolder(edir, opts.epic, 'epic');
  const epicFile = readdirSync(folder).find((f) => f.endsWith('.epic.md'));
  if (!epicFile) die(`No *.epic.md in ${relative(process.cwd(), folder)} (legacy epic folder? scaffold one with write-epic)`);
  ptext = readFileSync(join(folder, epicFile), 'utf8');
  const head = /^#\s+Epic:\s*(.+?)\s*$/m.exec(ptext);
  if (!head) die(`Could not read "# Epic: Title" from ${relative(process.cwd(), join(folder, epicFile))}`);
  parentLine = `**Epic:** [${head[1]}](./${epicFile})\n`;
  parentLabel = `epic ${basename(folder)} — "${head[1]}"`;
} else {
  const dir = resolve(process.cwd(), opts.dir);
  if (!existsSync(dir)) die(`Milestones directory not found: ${dir}\nRun from the repo root, or pass --dir.`);
  folder = resolveFolder(dir, opts.milestone, 'milestone');
  const milestoneDoc = join(folder, 'milestone.md');
  if (!existsSync(milestoneDoc)) die(`No milestone.md in ${relative(process.cwd(), folder)}`);
  ptext = readFileSync(milestoneDoc, 'utf8');
  const head = /^#\s+Milestone\s+(\d+)\s*[—:-]\s*(.+?)\s*$/m.exec(ptext);
  if (!head) die(`Could not read "# Milestone N — Title" from ${relative(process.cwd(), milestoneDoc)}`);
  parentLine = `**Milestone:** [${head[1]} — ${head[2].trim()}](./milestone.md)\n`;
  parentLabel = `milestone ${head[1]} — "${head[2].trim()}"`;
}

// RFC link: explicit --rfc wins; else reuse the parent's "Derived from" link
// (milestone: `Derived from [RFC NNNN](…)`; epic: `**Derived from:** [RFC NNNN](…)`,
// relative to the same folder, so it is copied verbatim). A standalone epic
// ("—") yields no RFC line.
let rfcLine = '';
if (opts.rfc) {
  const rfcRel = relative(folder, resolve(process.cwd(), opts.rfc)).split('\\').join('/');
  const num = (/(\d{4})/.exec(opts.rfc) || [])[1] || 'NNNN';
  rfcLine = `**RFC:** [RFC ${num}](${rfcRel})\n`;
} else {
  const m = /Derived from:?\**\s*(\[RFC\s*\d{4}\]\([^)]+\))/i.exec(ptext);
  if (m) rfcLine = `**RFC:** ${m[1]}\n`;
}

const order = opts.order ? String(opts.order).padStart(2, '0') : nextOrder(folder);
const slug = slugify(opts.slug || opts.title);
const filepath = join(folder, `${order}-${slug}.task.md`);
if (existsSync(filepath)) die(`Refusing to overwrite existing file: ${relative(process.cwd(), filepath)}`);

const teamTag = team === 'backend' ? 'Backend' : 'Frontend';
const teamLabel = team === 'backend' ? 'Backend API' : 'Frontend Web';
const phaseTitle = opts.phase ? ` (Phase ${opts.phase})` : '';

let dependsLine = '';
if (opts.depends) {
  const refs = opts.depends.split(',').map((s) => s.trim()).filter(Boolean);
  const links = refs.map((nn) => {
    const pad = String(nn).padStart(2, '0');
    const match = readdirSync(folder).find((f) => f.startsWith(`${pad}-`) && f.endsWith('.task.md'));
    return match ? `[Task ${pad}](./${match})` : `Task ${pad}`;
  });
  dependsLine = `**Depends On:** ${links.join(', ')}\n`;
}

const header =
  `# Task ${order} — ${teamTag}: ${opts.title}${phaseTitle}\n\n` +
  `**Status:** ${opts.status}\n` +
  parentLine +
  rfcLine +
  `**Team:** ${teamLabel}\n` +
  dependsLine +
  `\n`;

const templateFile = team === 'backend' ? 'template-backend.md' : 'template-frontend.md';
const body = readFileSync(join(HERE, templateFile), 'utf8');

writeFileSync(filepath, header + body);

const link = `[${opts.title}](./${order}-${slug}.task.md)`;
console.error(`Scaffolded ${teamTag} task ${order} in ${parentLabel}.`);
if (opts.epic) {
  // Epic Task Breakdown shape: | # | Task | Team | Depends on | Status |
  const deps = opts.depends ? opts.depends.split(',').map((s) => s.trim().padStart(2, '0')).join(', ') : '—';
  console.error(`Replace or add this row in the epic's Task Breakdown table (and update the waves):`);
  console.error(`  | ${order} | ${link} | ${team} | ${deps} | ${opts.status} |`);
  console.error(`Then fill every section by reading the epic's Goals, Proposed Approach + Acceptance Criteria.`);
} else {
  const phaseCol = opts.phase || '—';
  console.error(`Add this row to the milestone's §5 Task Breakdown table (and update the graph + recommended order):`);
  console.error(`  | ${order} | ${link} | ${phaseCol} | ${teamTag} | ☐ Open |`);
  console.error(`Then fill every section by reading the milestone's Functional Requirements + the source RFC.`);
}
console.log(relative(process.cwd(), filepath).split('\\').join('/'));
