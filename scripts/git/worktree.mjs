#!/usr/bin/env node
/**
 * worktree.mjs — open and sweep the per-feature git worktrees.
 *
 * Subcommands:
 *   open  --kind <rfc|docs|milestone|chained|epic|backlog> [target flags] [--adopt]
 *         Open (or reuse) the worktree for one feature under .worktrees/, based on
 *         origin/main, and mark it as managed by this workflow.
 *   sweep [--dry-run] [--hook]
 *         Remove every *managed* worktree whose PR is merged into main, then delete
 *         its local branch (the branch keeps living on GitHub).
 *
 * Target flags per kind:
 *   rfc        --number <n> --slug <s>   → docs/rfc-<NNNN>-<s>           .worktrees/rfc-<NNNN>-<s>
 *   docs       --slug <s>                → docs/<s>                      .worktrees/docs-<s>
 *   milestone  --milestone <n>           → feature/m<n>/candidate        .worktrees/m<n>-candidate
 *   chained    --milestone <n> --slug <s>→ feature/m<n>/<s>              .worktrees/m<n>-<s>
 *   epic       --epic <e>                → feature/epic/<e>/candidate    .worktrees/epic-<e>-candidate
 *   backlog    --topic <t> --slug <s>    → feature/backlog/<t>/<s>.task  .worktrees/backlog-<t>-<s>
 *
 * Ownership: `open` writes a marker file (aq-worktree.json) into the worktree's
 * private git dir. `sweep` only ever considers worktrees carrying that marker, so
 * worktrees opened by another process — even ones that follow the same naming —
 * are never touched. `--adopt` marks an existing, hand-opened worktree on the
 * expected branch.
 *
 * Design: the derivation and decision logic are PURE, exported functions, unit
 * tested by scripts/git/worktree.test.mjs. The side-effecting CLI (git, gh) lives
 * at the bottom and only runs when the file is executed directly. In `--hook` mode
 * (the Claude Code SessionStart hook) the sweep never exits non-zero and stays
 * silent when there is nothing to do.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';

export const MARKER_FILE = 'aq-worktree.json';
export const WORKTREES_DIR = '.worktrees';
export const TRUNK = 'main';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INT = /^[0-9]+$/;

// ── Pure logic ────────────────────────────────────────────────────────────────

/** Derive the branch and worktree folder name for one feature. Throws on bad input. */
export function deriveTarget({ kind, number, slug, milestone, epic, topic } = {}) {
  const need = (value, flag, pattern = SLUG) => {
    if (value === undefined || value === '' || value === true) throw new Error(`--${flag} is required for --kind ${kind}`);
    const text = String(value);
    if (!pattern.test(text)) throw new Error(`--${flag} "${text}" is invalid (${pattern === INT ? 'digits only' : 'kebab-case'})`);
    return text;
  };
  switch (kind) {
    case 'rfc': {
      const n = need(number, 'number', INT).padStart(4, '0');
      const s = need(slug, 'slug');
      return { kind, branch: `docs/rfc-${n}-${s}`, name: `rfc-${n}-${s}` };
    }
    case 'docs': {
      const s = need(slug, 'slug');
      return { kind, branch: `docs/${s}`, name: `docs-${s}` };
    }
    case 'milestone': {
      const n = Number(need(milestone, 'milestone', INT));
      return { kind, branch: `feature/m${n}/candidate`, name: `m${n}-candidate`, taskPrefix: `feature/m${n}/` };
    }
    case 'chained': {
      const n = Number(need(milestone, 'milestone', INT));
      const s = need(slug, 'slug');
      return { kind, branch: `feature/m${n}/${s}`, name: `m${n}-${s}`, taskPrefix: `feature/m${n}/` };
    }
    case 'epic': {
      const e = need(epic, 'epic');
      return { kind, branch: `feature/epic/${e}/candidate`, name: `epic-${e}-candidate`, taskPrefix: `feature/epic/${e}/` };
    }
    case 'backlog': {
      const t = need(topic, 'topic');
      const s = need(slug, 'slug');
      return { kind, branch: `feature/backlog/${t}/${s}.task`, name: `backlog-${t}-${s}` };
    }
    default:
      throw new Error(`--kind must be one of rfc, docs, milestone, chained, epic, backlog (got "${kind ?? ''}")`);
  }
}

/** Parse `git worktree list --porcelain` into records with a short branch name. */
export function parseWorktreeList(text) {
  const records = [];
  for (const block of text.split(/\n\s*\n/)) {
    const wt = {};
    for (const line of block.split('\n')) {
      const [key, ...rest] = line.split(' ');
      const value = rest.join(' ');
      if (key === 'worktree') wt.path = value;
      else if (key === 'HEAD') wt.head = value;
      else if (key === 'branch') wt.branch = value.replace(/^refs\/heads\//, '');
      else if (key === 'detached') wt.detached = true;
      else if (key === 'bare') wt.bare = true;
      else if (key === 'locked') wt.locked = true;
      else if (key === 'prunable') wt.prunable = true;
    }
    if (wt.path) records.push(wt);
  }
  return records;
}

/** True when `child` is `parent` or lives below it. */
export function isInside(child, parent) {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p + sep);
}

/**
 * Decide what `open` must do given the worktree that may already sit at the path.
 * Returns { action: 'create' | 'reuse' | 'adopt' } or throws with the reason.
 */
export function planOpen({ target, path, worktrees, markedPaths, adopt = false }) {
  const atPath = worktrees.find((wt) => resolve(wt.path) === resolve(path));
  const elsewhere = worktrees.find((wt) => wt.branch === target.branch && resolve(wt.path) !== resolve(path));
  if (elsewhere) {
    throw new Error(`${target.branch} is already checked out in ${elsewhere.path} — not opening a second copy`);
  }
  if (!atPath) {
    if (existsSync(path)) throw new Error(`${path} exists but is not a registered worktree — move it away first`);
    return { action: 'create' };
  }
  if (atPath.branch !== target.branch) {
    throw new Error(`${path} is a worktree on ${atPath.branch ?? 'a detached HEAD'}, not ${target.branch}`);
  }
  if (markedPaths.has(resolve(path))) return { action: 'reuse' };
  if (adopt) return { action: 'adopt' };
  throw new Error(`${path} exists but was not opened by this workflow (no marker) — pass --adopt only if it is yours`);
}

/**
 * Decide whether one managed worktree can be removed.
 * facts: { locked, cwdInside, pr (null | {number, headRefOid}), dirty, headInPr }
 * Returns { remove: boolean, reason, warn: boolean }.
 */
export function decideSweep(facts) {
  if (facts.locked) return { remove: false, reason: 'locked', warn: true };
  if (!facts.pr) return { remove: false, reason: 'PR not merged yet', warn: false };
  if (facts.cwdInside) return { remove: false, reason: `PR #${facts.pr.number} merged, but this session is inside it`, warn: true };
  if (facts.dirty) return { remove: false, reason: `PR #${facts.pr.number} merged, but the tree has uncommitted changes`, warn: true };
  if (!facts.headInPr) return { remove: false, reason: `PR #${facts.pr.number} merged, but HEAD has commits the PR does not`, warn: true };
  return { remove: true, reason: `PR #${facts.pr.number} merged`, warn: false };
}

/** Minimal `--flag value` / `--switch` parser. */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument "${arg}"`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) opts[key] = true;
    else { opts[key] = next; i++; }
  }
  return { command, opts };
}

// ── Side-effecting CLI ────────────────────────────────────────────────────────

function run(cmd, args, { cwd, allowFail = false } = {}) {
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (res.error) {
    if (allowFail) return { ok: false, stdout: '', stderr: String(res.error.message) };
    throw res.error;
  }
  const out = { ok: res.status === 0, stdout: (res.stdout ?? '').trim(), stderr: (res.stderr ?? '').trim() };
  if (!out.ok && !allowFail) throw new Error(`${cmd} ${args.join(' ')} failed: ${out.stderr || out.stdout}`);
  return out;
}

const git = (args, opts) => run('git', args, opts);

function repoRoot() {
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir']).stdout;
  return dirname(common);
}

function gitDirOf(path) {
  return git(['-C', path, 'rev-parse', '--absolute-git-dir']).stdout;
}

function readMarker(path) {
  try {
    return JSON.parse(readFileSync(join(gitDirOf(path), MARKER_FILE), 'utf8'));
  } catch {
    return null;
  }
}

function writeMarker(path, target) {
  const marker = { branch: target.branch, kind: target.kind, taskPrefix: target.taskPrefix ?? null, openedAt: new Date().toISOString() };
  writeFileSync(join(gitDirOf(path), MARKER_FILE), JSON.stringify(marker, null, 2) + '\n');
}

function listWorktrees(root) {
  return parseWorktreeList(git(['-C', root, 'worktree', 'list', '--porcelain']).stdout);
}

function refExists(root, ref) {
  return git(['-C', root, 'show-ref', '--verify', '--quiet', ref], { allowFail: true }).ok;
}

function cmdOpen(opts) {
  const target = deriveTarget(opts);
  const root = repoRoot();
  const path = join(root, WORKTREES_DIR, target.name);
  const worktrees = listWorktrees(root);
  const markedPaths = new Set(worktrees.filter((wt) => existsSync(wt.path) && readMarker(wt.path)).map((wt) => resolve(wt.path)));

  const rootWt = worktrees[0];
  if (rootWt?.branch !== TRUNK) console.warn(`⚠  the root checkout is on ${rootWt?.branch ?? 'a detached HEAD'}, not ${TRUNK}`);

  const { action } = planOpen({ target, path, worktrees, markedPaths, adopt: Boolean(opts.adopt) });
  if (action === 'create') {
    git(['-C', root, 'fetch', 'origin', '--quiet']);
    if (refExists(root, `refs/heads/${target.branch}`)) {
      git(['-C', root, 'worktree', 'add', path, target.branch]);
    } else if (refExists(root, `refs/remotes/origin/${target.branch}`)) {
      git(['-C', root, 'worktree', 'add', '--track', '-b', target.branch, path, `origin/${target.branch}`]);
    } else {
      git(['-C', root, 'worktree', 'add', '--no-track', '-b', target.branch, path, `origin/${TRUNK}`]);
    }
  }
  if (action !== 'reuse') writeMarker(path, target);

  const verb = { create: 'opened', reuse: 'reusing', adopt: 'adopted' }[action];
  console.log(`✔ ${verb} ${path}  [${target.branch}]`);
  console.log(`  next: cd ${path}${target.kind === 'rfc' || target.kind === 'docs' ? '' : ' && make setup'}`);
}

function findMergedPr(branch) {
  const res = run('gh', ['pr', 'list', '--head', branch, '--base', TRUNK, '--state', 'merged',
    '--json', 'number,headRefOid', '--limit', '1'], { allowFail: true });
  if (!res.ok) throw new Error(res.stderr || 'gh pr list failed');
  const [pr] = JSON.parse(res.stdout || '[]');
  return pr ?? null;
}

function headInPr(path, head, prOid) {
  if (head === prOid) return true;
  if (!git(['-C', path, 'cat-file', '-e', `${prOid}^{commit}`], { allowFail: true }).ok) return false;
  return git(['-C', path, 'merge-base', '--is-ancestor', head, prOid], { allowFail: true }).ok;
}

function cmdSweep(opts) {
  const hook = Boolean(opts.hook);
  const dryRun = Boolean(opts.dryRun);
  const root = repoRoot();
  const managed = listWorktrees(root)
    .filter((wt) => isInside(wt.path, join(root, WORKTREES_DIR)) && existsSync(wt.path))
    .map((wt) => ({ ...wt, marker: readMarker(wt.path) }))
    .filter((wt) => wt.marker);

  if (managed.length === 0) {
    if (!hook) console.log('No managed worktrees to sweep.');
    return;
  }
  if (!run('gh', ['auth', 'status'], { allowFail: true }).ok) {
    console.log('⚠  worktree sweep skipped: gh is not authenticated (run `gh auth login`).');
    return;
  }

  const lines = [];
  for (const wt of managed) {
    const branch = wt.marker.branch;
    let pr;
    try {
      pr = findMergedPr(branch);
    } catch (err) {
      lines.push(`⚠  ${wt.path}: could not query the PR for ${branch} (${err.message})`);
      continue;
    }
    const facts = {
      locked: Boolean(wt.locked),
      cwdInside: isInside(process.cwd(), wt.path),
      pr,
      dirty: pr ? git(['-C', wt.path, 'status', '--porcelain']).stdout !== '' : false,
      headInPr: pr ? headInPr(wt.path, wt.head, pr.headRefOid) : false,
    };
    const decision = decideSweep(facts);
    if (!decision.remove) {
      if (decision.warn || !hook) lines.push(`${decision.warn ? '⚠ ' : '· '} ${wt.path}: ${decision.reason}`);
      continue;
    }
    if (dryRun) {
      lines.push(`○  would remove ${wt.path} [${branch}] — ${decision.reason}`);
      continue;
    }
    git(['-C', root, 'worktree', 'remove', wt.path]);
    const deleted = [];
    const branches = new Set([branch]);
    if (wt.branch) branches.add(wt.branch);
    if (wt.marker.taskPrefix && refExists(root, `refs/heads/${branch}`)) {
      // Task branches already contained in the merged candidate go with it.
      const merged = git(['-C', root, 'branch', '--format=%(refname:short)', '--merged', branch]).stdout;
      for (const name of merged.split('\n')) if (name.startsWith(wt.marker.taskPrefix) && name.endsWith('.task')) branches.add(name);
    }
    for (const name of branches) {
      if (git(['-C', root, 'branch', '-D', name], { allowFail: true }).ok) deleted.push(name);
    }
    lines.push(`✔  removed ${wt.path} — ${decision.reason}; deleted local ${deleted.join(', ') || 'no branches'}`);
  }
  if (lines.length) console.log(['Worktree sweep:', ...lines].join('\n'));
}

function main(argv) {
  const { command, opts } = parseArgs(argv);
  if (command === 'open') return cmdOpen(opts);
  if (command === 'sweep') return cmdSweep(opts);
  throw new Error('usage: worktree.mjs open --kind <kind> [target flags] [--adopt] | sweep [--dry-run] [--hook]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hookMode = process.argv.includes('--hook');
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`✖ ${err.message}`);
    // The SessionStart hook must never fail a session start.
    process.exit(hookMode ? 0 : 1);
  }
}
