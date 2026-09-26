/**
 * Unit tests for scripts/git/worktree.mjs — pure logic only.
 * No git, no gh, no network. Run with: node --test scripts/git/worktree.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deriveTarget, parseWorktreeList, isInside, planOpen, decideSweep, parseArgs } from './worktree.mjs';

test('deriveTarget maps every kind to its branch and folder', () => {
  assert.deepEqual(deriveTarget({ kind: 'rfc', number: '16', slug: 'events-board' }),
    { kind: 'rfc', branch: 'docs/rfc-0016-events-board', name: 'rfc-0016-events-board' });
  assert.deepEqual(deriveTarget({ kind: 'docs', slug: 'cors-backlog' }),
    { kind: 'docs', branch: 'docs/cors-backlog', name: 'docs-cors-backlog' });
  assert.deepEqual(deriveTarget({ kind: 'milestone', milestone: '21' }),
    { kind: 'milestone', branch: 'feature/m21/candidate', name: 'm21-candidate', taskPrefix: 'feature/m21/' });
  assert.deepEqual(deriveTarget({ kind: 'chained', milestone: '8', slug: 'api-test-optimization' }),
    { kind: 'chained', branch: 'feature/m8/api-test-optimization', name: 'm8-api-test-optimization', taskPrefix: 'feature/m8/' });
  assert.deepEqual(deriveTarget({ kind: 'epic', epic: 'gamification' }),
    { kind: 'epic', branch: 'feature/epic/gamification/candidate', name: 'epic-gamification-candidate', taskPrefix: 'feature/epic/gamification/' });
  assert.deepEqual(deriveTarget({ kind: 'backlog', topic: 'cors', slug: '01-tighten-origins' }),
    { kind: 'backlog', branch: 'feature/backlog/cors/01-tighten-origins.task', name: 'backlog-cors-01-tighten-origins' });
});

test('deriveTarget rejects missing or malformed input', () => {
  assert.throws(() => deriveTarget({ kind: 'rfc', slug: 'x' }), /--number is required/);
  assert.throws(() => deriveTarget({ kind: 'rfc', number: '1', slug: 'Bad Slug' }), /kebab-case/);
  assert.throws(() => deriveTarget({ kind: 'milestone', milestone: 'x1' }), /digits only/);
  assert.throws(() => deriveTarget({ kind: 'nope' }), /--kind must be one of/);
  assert.throws(() => deriveTarget({ kind: 'epic', epic: true }), /--epic is required/);
});

test('parseWorktreeList reads porcelain records', () => {
  const text = [
    'worktree /repo', 'HEAD aaa', 'branch refs/heads/main', '',
    'worktree /repo/.worktrees/m21-candidate', 'HEAD bbb', 'branch refs/heads/feature/m21/candidate', 'locked', '',
    'worktree /repo/.worktrees/t_1', 'HEAD ccc', 'detached', '',
  ].join('\n');
  assert.deepEqual(parseWorktreeList(text), [
    { path: '/repo', head: 'aaa', branch: 'main' },
    { path: '/repo/.worktrees/m21-candidate', head: 'bbb', branch: 'feature/m21/candidate', locked: true },
    { path: '/repo/.worktrees/t_1', head: 'ccc', detached: true },
  ]);
});

test('isInside matches the folder and its children only', () => {
  assert.equal(isInside('/repo/.worktrees/m1', '/repo/.worktrees/m1'), true);
  assert.equal(isInside('/repo/.worktrees/m1/apps/api', '/repo/.worktrees/m1'), true);
  assert.equal(isInside('/repo/.worktrees/m10', '/repo/.worktrees/m1'), false);
});

test('planOpen creates, reuses, adopts or refuses', () => {
  const free = join(mkdtempSync(join(tmpdir(), 'aq-wt-')), 'missing');
  const target = { branch: 'feature/m21/candidate' };
  const root = { path: '/repo', branch: 'main' };

  assert.deepEqual(planOpen({ target, path: free, worktrees: [root], markedPaths: new Set() }), { action: 'create' });

  const mine = { path: '/repo/.worktrees/m21-candidate', branch: 'feature/m21/candidate' };
  assert.deepEqual(planOpen({ target, path: mine.path, worktrees: [root, mine], markedPaths: new Set([mine.path]) }), { action: 'reuse' });
  assert.throws(() => planOpen({ target, path: mine.path, worktrees: [root, mine], markedPaths: new Set() }), /not opened by this workflow/);
  assert.deepEqual(planOpen({ target, path: mine.path, worktrees: [root, mine], markedPaths: new Set(), adopt: true }), { action: 'adopt' });

  const wrong = { path: mine.path, branch: 'feature/m21/01-x.task' };
  assert.throws(() => planOpen({ target, path: mine.path, worktrees: [root, wrong], markedPaths: new Set([mine.path]) }), /not feature\/m21\/candidate/);

  const other = { path: '/elsewhere', branch: 'feature/m21/candidate' };
  assert.throws(() => planOpen({ target, path: free, worktrees: [root, other], markedPaths: new Set() }), /already checked out in \/elsewhere/);
});

test('decideSweep removes only a clean worktree whose PR merged', () => {
  const pr = { number: 57, headRefOid: 'abc' };
  const ok = { locked: false, cwdInside: false, pr, dirty: false, headInPr: true };
  assert.deepEqual(decideSweep(ok), { remove: true, reason: 'PR #57 merged', warn: false });
  assert.equal(decideSweep({ ...ok, pr: null }).remove, false);
  assert.equal(decideSweep({ ...ok, pr: null }).warn, false);
  for (const blocker of [{ locked: true }, { cwdInside: true }, { dirty: true }, { headInPr: false }]) {
    const decision = decideSweep({ ...ok, ...blocker });
    assert.equal(decision.remove, false, JSON.stringify(blocker));
    assert.equal(decision.warn, true, JSON.stringify(blocker));
  }
});

test('parseArgs reads flags and switches', () => {
  assert.deepEqual(parseArgs(['open', '--kind', 'rfc', '--number', '16', '--slug', 'x', '--adopt']),
    { command: 'open', opts: { kind: 'rfc', number: '16', slug: 'x', adopt: true } });
  assert.deepEqual(parseArgs(['sweep', '--dry-run', '--hook']), { command: 'sweep', opts: { dryRun: true, hook: true } });
  assert.throws(() => parseArgs(['open', 'stray']), /unexpected argument/);
});
