#!/usr/bin/env node
// Scaffold a new ArenaQuest RFC from the canonical template.
//
//   node new-rfc.mjs "Title of the proposal" [--author NAME] [--status Draft]
//                    [--date YYYY-MM-DD] [--dir docs/product/RFCs]
//
// - Computes the next zero-padded 4-digit number from existing NNNN-*.md files.
// - Writes docs/product/RFCs/NNNN-<slug>.md from template.md.
// - Appends an index row to docs/product/RFCs/README.md (if a table is found).
// Prints the created path. Dependency-free (Node stdlib only).

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { status: 'Draft', dir: 'docs/product/RFCs' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--author') opts.author = argv[++i];
    else if (a === '--status') opts.status = argv[++i];
    else if (a === '--date') opts.date = argv[++i];
    else if (a === '--dir') opts.dir = argv[++i];
    else rest.push(a);
  }
  opts.title = rest.join(' ').trim();
  return opts;
}

function slugify(title) {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function nextNumber(dir) {
  let max = 0;
  for (const f of readdirSync(dir)) {
    const m = /^(\d{4})-.+\.md$/.exec(f);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return String(max + 1).padStart(4, '0');
}

function gitUser() {
  try {
    return execSync('git config user.name').toString().trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.title) {
  console.error('usage: node new-rfc.mjs "Title" [--author NAME] [--status S] [--date YYYY-MM-DD] [--dir PATH]');
  process.exit(2);
}

const dir = resolve(process.cwd(), opts.dir);
if (!existsSync(dir)) {
  console.error(`RFC directory not found: ${dir}\nRun from the repo root, or pass --dir.`);
  process.exit(2);
}

const num = nextNumber(dir);
const date = opts.date || new Date().toISOString().slice(0, 10);
const author = opts.author || gitUser();
const slug = slugify(opts.title);
const filename = `${num}-${slug}.md`;
const filepath = join(dir, filename);

if (existsSync(filepath)) {
  console.error(`Refusing to overwrite existing file: ${filepath}`);
  process.exit(2);
}

const body = readFileSync(join(HERE, 'template.md'), 'utf8')
  .replaceAll('{{NUM}}', num)
  .replaceAll('{{TITLE}}', opts.title)
  .replaceAll('{{DATE}}', date)
  .replaceAll('{{STATUS}}', opts.status)
  .replaceAll('{{AUTHOR}}', author);

writeFileSync(filepath, body);

// Append an index row to README.md, after the last existing table data row.
const readmePath = join(dir, 'README.md');
if (existsSync(readmePath)) {
  const lines = readFileSync(readmePath, 'utf8').split('\n');
  let lastRow = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\|\s*\[\d{4}\]/.test(lines[i])) lastRow = i;
  }
  if (lastRow !== -1) {
    const row = `| [${num}](./${filename}) | ${opts.title} | ${opts.status} | ${date} | ${author} |`;
    lines.splice(lastRow + 1, 0, row);
    writeFileSync(readmePath, lines.join('\n'));
    console.error(`Index row added to ${opts.dir}/README.md`);
  } else {
    console.error(`No RFC table rows found in README.md — add an index row manually.`);
  }
}

console.log(`${opts.dir}/${filename}`);
