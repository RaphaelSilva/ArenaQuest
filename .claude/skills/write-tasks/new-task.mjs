#!/usr/bin/env node
// Scaffold a new ArenaQuest task file inside a milestone folder.
//
//   node new-task.mjs --milestone 13 --team backend  --title "Brand config port and adapter" \
//                     [--phase 1] [--slug brand-config] [--depends 01,02] \
//                     [--rfc docs/product/RFCs/0006-...md] [--status "📝 Open"]
//
// - Resolves the milestone folder (by number, slug, or path) and reads its
//   `# Milestone N — Title` heading + `Derived from [RFC NNNN](rel)` link.
// - Computes the next NN by scanning existing NN-*.task.md files.
// - Picks template-backend.md or template-frontend.md by --team, builds the
//   header, and writes docs/product/milestones/<folder>/NN-<slug>.task.md.
// Prints the created path on stdout and the ready-to-paste §5 table row on
// stderr. Backend and frontend always land in SEPARATE files. Stdlib only.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { team: 'backend', status: '📝 Open', dir: 'docs/product/milestones' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--milestone') opts.milestone = argv[++i];
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

// Resolve a milestone folder from a number ("13"), a slug fragment
// ("white-label"), or a path. Match folders by leading integer or substring.
function resolveMilestone(dir, key) {
  if (existsSync(key) && statSync(key).isDirectory()) return resolve(key);
  const folders = readdirSync(dir)
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isDirectory());
  if (/^\d+$/.test(key)) {
    const hit = folders.filter((p) => new RegExp(`^${key}(?:-|$)`).test(relative(dir, p)));
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) die(`Ambiguous milestone "${key}": ${hit.map((p) => relative(dir, p)).join(', ')}`);
  }
  const sub = folders.filter((p) => relative(dir, p).includes(key));
  if (sub.length === 1) return sub[0];
  if (sub.length > 1) die(`Ambiguous milestone "${key}": ${sub.map((p) => relative(dir, p)).join(', ')}`);
  die(`Milestone not found for "${key}" under ${relative(process.cwd(), dir) || dir}.`);
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
if (!opts.milestone || !opts.title) {
  die('usage: node new-task.mjs --milestone <num|slug|path> --team backend|frontend --title "..." \\\n' +
      '         [--phase N] [--slug S] [--depends NN,NN] [--rfc path] [--status S] [--order NN] [--dir PATH]');
}

const team = opts.team.toLowerCase();
if (team !== 'backend' && team !== 'frontend') die(`--team must be "backend" or "frontend" (got "${opts.team}")`);

const dir = resolve(process.cwd(), opts.dir);
if (!existsSync(dir)) die(`Milestones directory not found: ${dir}\nRun from the repo root, or pass --dir.`);

const folder = resolveMilestone(dir, opts.milestone);
const milestoneDoc = join(folder, 'milestone.md');
if (!existsSync(milestoneDoc)) die(`No milestone.md in ${relative(process.cwd(), folder)}`);
const mtext = readFileSync(milestoneDoc, 'utf8');

const head = /^#\s+Milestone\s+(\d+)\s*[—:-]\s*(.+?)\s*$/m.exec(mtext);
if (!head) die(`Could not read "# Milestone N — Title" from ${relative(process.cwd(), milestoneDoc)}`);
const mileNum = head[1];
const mileTitle = head[2].trim();

// RFC link: explicit --rfc wins; else reuse the milestone's "Derived from" link.
let rfcLine = '';
if (opts.rfc) {
  const rfcRel = relative(folder, resolve(process.cwd(), opts.rfc)).split('\\').join('/');
  const num = (/(\d{4})/.exec(opts.rfc) || [])[1] || 'NNNN';
  rfcLine = `**RFC:** [RFC ${num}](${rfcRel})\n`;
} else {
  const m = /Derived from\s*(\[RFC\s*\d{4}\]\([^)]+\))/i.exec(mtext);
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
  `**Milestone:** [${mileNum} — ${mileTitle}](./milestone.md)\n` +
  rfcLine +
  `**Team:** ${teamLabel}\n` +
  dependsLine +
  `\n`;

const templateFile = team === 'backend' ? 'template-backend.md' : 'template-frontend.md';
const body = readFileSync(join(HERE, templateFile), 'utf8');

writeFileSync(filepath, header + body);

const phaseCol = opts.phase || '—';
const tableRow = `| ${order} | [${opts.title}](./${order}-${slug}.task.md) | ${phaseCol} | ${teamTag} | ☐ Open |`;

console.error(`Scaffolded ${teamTag} task ${order} in milestone ${mileNum} — "${mileTitle}".`);
console.error(`Add this row to the milestone's §5 Task Breakdown table (and update the graph + recommended order):`);
console.error(`  ${tableRow}`);
console.error(`Then fill every section by reading the milestone's Functional Requirements + the source RFC.`);
console.log(relative(process.cwd(), filepath).split('\\').join('/'));
