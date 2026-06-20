#!/usr/bin/env node
// Scaffold a new ArenaQuest milestone ("feature") from an input RFC.
//
//   node new-feature.mjs --rfc docs/product/RFCs/0006-white-label-branding.md \
//                        [--title "Override title"] [--status "📝 Draft"] \
//                        [--slug custom-slug] [--dir docs/product/milestones]
//
// - Reads the RFC to recover its 4-digit number and title (header or filename).
// - Computes the next milestone number from existing NN-*/ and NN/ folders.
// - Creates docs/product/milestones/NN-<slug>/milestone.md from template.md,
//   pre-wiring the "Derived from [RFC NNNN](../../RFCs/...)" link.
// Prints the created path. Dependency-free (Node stdlib only).

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { status: '📝 Draft', dir: 'docs/product/milestones' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rfc') opts.rfc = argv[++i];
    else if (a === '--title') opts.title = argv[++i];
    else if (a === '--status') opts.status = argv[++i];
    else if (a === '--slug') opts.slug = argv[++i];
    else if (a === '--dir') opts.dir = argv[++i];
  }
  return opts;
}

function slugify(title) {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

// Next milestone number: scan for folders whose name starts with NN (any of
// "12", "12-foo", "3-extends" forms), take the max leading integer + 1.
function nextNumber(dir) {
  let max = 0;
  for (const f of readdirSync(dir)) {
    if (!statSync(join(dir, f)).isDirectory()) continue;
    const m = /^(\d+)/.exec(f);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return String(max + 1);
}

function readRfc(rfcPath) {
  const text = readFileSync(rfcPath, 'utf8');
  const name = basename(rfcPath);
  // Number: prefer the `# RFC NNNN` heading, fall back to the filename.
  const titleHead = /^#\s+RFC\s+(\d{4})\s*[:—-]\s*(.+)\s*$/m.exec(text);
  const fnMatch = /^(\d{4})-(.+)\.md$/.exec(name);
  const num = (titleHead && titleHead[1]) || (fnMatch && fnMatch[1]);
  if (!num) {
    console.error(`Could not determine an RFC number from "${rfcPath}". Expected a "# RFC NNNN: …" heading or an NNNN-*.md filename.`);
    process.exit(2);
  }
  const title = (titleHead && titleHead[2].trim())
    || (fnMatch && fnMatch[2].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
    || 'Untitled';
  return { num, title };
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.rfc) {
  console.error('usage: node new-feature.mjs --rfc <path/to/NNNN-*.md> [--title T] [--status S] [--slug S] [--dir PATH]');
  process.exit(2);
}

const rfcPath = resolve(process.cwd(), opts.rfc);
if (!existsSync(rfcPath)) {
  console.error(`RFC file not found: ${rfcPath}`);
  process.exit(2);
}

const dir = resolve(process.cwd(), opts.dir);
if (!existsSync(dir)) {
  console.error(`Milestones directory not found: ${dir}\nRun from the repo root, or pass --dir.`);
  process.exit(2);
}

const { num: rfcNum, title: rfcTitle } = readRfc(rfcPath);
const title = (opts.title || rfcTitle).trim();
const slug = opts.slug ? slugify(opts.slug) : slugify(title);
const num = nextNumber(dir);
const folder = join(dir, `${num}-${slug}`);
const filepath = join(folder, 'milestone.md');

if (existsSync(filepath)) {
  console.error(`Refusing to overwrite existing file: ${filepath}`);
  process.exit(2);
}

// Relative link from the milestone folder to the RFC file.
const rfcRel = relative(folder, rfcPath).split('\\').join('/');

const body = readFileSync(join(HERE, 'template.md'), 'utf8')
  .replaceAll('{{NUM}}', num)
  .replaceAll('{{TITLE}}', title)
  .replaceAll('{{STATUS}}', opts.status)
  .replaceAll('{{RFC_NUM}}', rfcNum)
  .replaceAll('{{RFC_REL}}', rfcRel);

mkdirSync(folder, { recursive: true });
writeFileSync(filepath, body);

console.error(`Derived from RFC ${rfcNum} — "${rfcTitle}"`);
console.error(`Next: fill each ## section, then author task files with task-writer and update §5.`);
console.log(`${relative(process.cwd(), filepath).split('\\').join('/')}`);
