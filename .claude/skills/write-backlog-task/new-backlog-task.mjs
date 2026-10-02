#!/usr/bin/env node
// Scaffold a standalone backlog task — technical work that does not need an RFC.
//
//   node new-backlog-task.mjs --topic security --kind bug --team backend \
//        --title "Refresh token survives logout" \
//        [--priority high] [--found-in "Milestone 24, Task 03"] [--slug S] \
//        [--depends 03,04] [--order NN] [--new-topic] [--no-git] [--status S]
//
// - Writes docs/product/backlog/<topic>/NN-<slug>.task.md from the template
//   matching --kind (feature | bug | refactor | debt | chore).
// - --team both writes TWO files: the Backend task NN and a Frontend task NN+1
//   that depends on it. Backend and frontend never share a file.
// - NN is the next free number in the topic, counted across the folder on disk
//   AND every git ref that carries the topic (origin/main, in-flight docs/*
//   branches, feature/backlog/<topic>/* branches), so two open PRs do not pick
//   the same number. Run `git fetch origin` first; --no-git skips the git scan.
// Prints each created path on stdout. Stdlib only.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKLOG = 'docs/product/backlog';

const KINDS = {
  feature: { label: 'Feature', template: 'template-feature.md' },
  bug: { label: 'Bug', template: 'template-bug.md' },
  refactor: { label: 'Refactor', template: 'template-improvement.md' },
  debt: { label: 'Tech Debt', template: 'template-improvement.md' },
  chore: { label: 'Chore', template: 'template-improvement.md' },
};
const TEAMS = {
  backend: { tag: 'Backend', label: 'Backend API' },
  frontend: { tag: 'Frontend', label: 'Frontend Web' },
  tooling: { tag: 'Tooling', label: 'Tooling' },
};
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

function parseArgs(argv) {
  const opts = { status: '📝 Open', priority: 'medium', dir: BACKLOG, git: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--topic') opts.topic = argv[++i];
    else if (a === '--kind') opts.kind = argv[++i];
    else if (a === '--team') opts.team = argv[++i];
    else if (a === '--title') opts.title = argv[++i];
    else if (a === '--slug') opts.slug = argv[++i];
    else if (a === '--priority') opts.priority = argv[++i];
    else if (a === '--found-in') opts.foundIn = argv[++i];
    else if (a === '--depends') opts.depends = argv[++i];
    else if (a === '--order') opts.order = argv[++i];
    else if (a === '--status') opts.status = argv[++i];
    else if (a === '--dir') opts.dir = argv[++i];
    else if (a === '--new-topic') opts.newTopic = true;
    else if (a === '--no-git') opts.git = false;
    else die(`Unknown option: ${a}`);
  }
  return opts;
}

function die(msg, code = 2) { console.error(msg); process.exit(code); }

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

const orderOf = (name) => {
  const m = /^(\d+)-/.exec(name);
  return m ? parseInt(m[1], 10) : 0;
};

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

// Highest NN already claimed for this topic, on disk and on every relevant ref.
function highestOrder(folder, topic, useGit) {
  let max = 0;
  const claimedBy = new Map();
  const claim = (n, where) => {
    if (n > max) max = n;
    if (!claimedBy.has(n)) claimedBy.set(n, where);
  };

  if (existsSync(folder)) {
    for (const f of readdirSync(folder)) if (/^\d+-.*\.md$/.test(f)) claim(orderOf(f), 'disk');
  }
  if (!useGit) return { max, claimedBy };

  const refs = git(['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/main', 'refs/remotes/origin/docs', 'refs/heads/docs'])
    .split('\n').filter(Boolean);
  for (const ref of refs) {
    for (const path of git(['ls-tree', '--name-only', ref, `${BACKLOG}/${topic}/`]).split('\n')) {
      const f = path.split('/').pop();
      if (f && /^\d+-.*\.md$/.test(f)) claim(orderOf(f), ref.replace(/^refs\/(remotes\/)?/, ''));
    }
  }
  // Execution branches: feature/backlog/<topic>/NN-<slug>.task
  const branches = git(['for-each-ref', '--format=%(refname:short)',
    `refs/heads/feature/backlog/${topic}`, `refs/remotes/origin/feature/backlog/${topic}`]).split('\n');
  for (const b of branches) {
    const m = /\/(\d+)-[^/]+\.task$/.exec(b);
    if (m) claim(parseInt(m[1], 10), b);
  }
  return { max, claimedBy };
}

const pad = (n) => String(n).padStart(2, '0');

const opts = parseArgs(process.argv.slice(2));
if (!opts.topic || !opts.kind || !opts.team || !opts.title) {
  die('usage: node new-backlog-task.mjs --topic <folder> --kind feature|bug|refactor|debt|chore \\\n' +
      '         --team backend|frontend|tooling|both --title "..." \\\n' +
      '         [--priority low|medium|high|critical] [--found-in "..."] [--slug S] [--depends NN,NN] \\\n' +
      '         [--order NN] [--status S] [--new-topic] [--no-git] [--dir PATH]');
}

const kind = KINDS[opts.kind.toLowerCase()];
if (!kind) die(`--kind must be one of ${Object.keys(KINDS).join(', ')} (got "${opts.kind}")`);

const teamKey = opts.team.toLowerCase();
if (teamKey !== 'both' && !TEAMS[teamKey]) die(`--team must be backend, frontend, tooling or both (got "${opts.team}")`);

const priority = opts.priority.toLowerCase();
if (!PRIORITIES.includes(priority)) die(`--priority must be one of ${PRIORITIES.join(', ')} (got "${opts.priority}")`);

const topic = slugify(opts.topic);
if (topic !== opts.topic) die(`--topic must be a kebab-case folder name (did you mean "${topic}"?)`);

const root = resolve(process.cwd(), opts.dir);
if (!existsSync(root)) die(`Backlog directory not found: ${root}\nRun from the repo root, or pass --dir.`);
const folder = join(root, topic);
if (!existsSync(folder)) {
  const topics = readdirSync(root).filter((f) => statSync(join(root, f)).isDirectory());
  if (!opts.newTopic) {
    die(`Topic "${topic}" does not exist. Existing topics: ${topics.join(', ')}.\n` +
        'Reuse one, or pass --new-topic to create the folder deliberately.');
  }
  mkdirSync(folder, { recursive: true });
}

const { max, claimedBy } = highestOrder(folder, topic, opts.git);
let first;
if (opts.order) {
  first = parseInt(opts.order, 10);
  if (claimedBy.has(first)) die(`Order ${pad(first)} is already taken in "${topic}" (${claimedBy.get(first)}). Pick another --order.`);
} else {
  first = max + 1;
}

const today = new Date().toISOString().slice(0, 10);
const foundIn = `${opts.foundIn || '{{where this was noticed — milestone/task, incident, review}}'}, ${today}`;
const baseSlug = slugify(opts.slug || opts.title);

function dependsLinks(refs) {
  return refs.map((r) => {
    const p = pad(r);
    const match = existsSync(folder) && readdirSync(folder).find((f) => f.startsWith(`${p}-`) && f.endsWith('.task.md'));
    return match ? `[Task ${p}](./${match})` : `Task ${p}`;
  });
}

function writeTask(order, team, extraDepends = []) {
  const slug = teamKey === 'both' ? `${baseSlug}--${team.tag.toLowerCase()}` : baseSlug;
  const file = `${pad(order)}-${slug}.task.md`;
  const path = join(folder, file);
  if (existsSync(path)) die(`Refusing to overwrite existing file: ${relative(process.cwd(), path)}`);

  const refs = (opts.depends ? opts.depends.split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean) : []);
  const links = [...dependsLinks(refs), ...extraDepends];

  const header =
    `# Task ${pad(order)} — ${team.tag}: ${opts.title}\n\n` +
    `**Status:** ${opts.status}\n` +
    `**Kind:** ${kind.label}\n` +
    `**Team:** ${team.label}\n` +
    `**Priority:** ${priority[0].toUpperCase()}${priority.slice(1)}\n` +
    `**Found in:** ${foundIn}\n` +
    (links.length ? `**Depends On:** ${links.join(', ')}\n` : '') +
    '\n';

  writeFileSync(path, header + readFileSync(join(HERE, kind.template), 'utf8'));
  console.log(relative(process.cwd(), path).split('\\').join('/'));
  return file;
}

if (teamKey === 'both') {
  const backendFile = writeTask(first, TEAMS.backend);
  writeTask(first + 1, TEAMS.frontend, [`[Task ${pad(first)}](./${backendFile})`]);
} else {
  writeTask(first, TEAMS[teamKey]);
}

console.error(`Scaffolded ${kind.label} task(s) in backlog/${topic}. Fill every section, then validate:`);
console.error(`  node .claude/skills/write-backlog-task/check-backlog-task.mjs --topic ${topic}`);
console.error(`Execute later with the developer skill — branch feature/backlog/${topic}/<NN-slug>.task.`);
