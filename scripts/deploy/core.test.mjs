/**
 * Unit tests for scripts/deploy/core.mjs — pure logic only (node:test).
 * No network, no real `wrangler`, no file mutation. Mirrors the style of
 * scripts/label.test.mjs. Run with: node --test scripts/deploy/core.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseJsonc } from '../label.mjs';
import {
  parseArgs,
  loadProfile,
  loadSchema,
  resolve,
  preflight,
  buildPlan,
  confirmProduction,
} from './core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, '..', 'fixtures');
const CORE_SRC = readFileSync(join(HERE, 'core.mjs'), 'utf8');

function goodProfile() {
  return parseJsonc(readFileSync(join(FIX, 'good-profile.jsonc'), 'utf8'));
}
const schema = () => loadSchema();

// ── parseArgs: valid combinations ─────────────────────────────────────────────
test('parseArgs returns normalised defaults (scope=all, booleans false)', () => {
  const a = parseArgs(['--label', 'acme', '-e', 'staging']);
  assert.deepEqual(a, { label: 'acme', env: 'staging', scope: 'all', yes: false, dryRun: false });
});

test('parseArgs honours --scope, --yes and --dry-run', () => {
  const a = parseArgs(['--label', 'acme', '--env', 'production', '--scope', 'api', '--yes', '--dry-run']);
  assert.deepEqual(a, { label: 'acme', env: 'production', scope: 'api', yes: true, dryRun: true });
});

test('parseArgs accepts the -e short form for --env', () => {
  assert.equal(parseArgs(['--label', 'acme', '-e', 'production']).env, 'production');
});

// ── parseArgs: rejection cases ────────────────────────────────────────────────
test('parseArgs rejects a missing --label', () => {
  assert.throws(() => parseArgs(['-e', 'staging']), /--label/);
});

test('parseArgs rejects a missing --env', () => {
  assert.throws(() => parseArgs(['--label', 'acme']), /--env/);
});

test('parseArgs rejects an invalid --env', () => {
  assert.throws(() => parseArgs(['--label', 'acme', '-e', 'prod']), /staging\|production/);
});

test('parseArgs rejects an invalid --scope', () => {
  assert.throws(() => parseArgs(['--label', 'acme', '-e', 'staging', '--scope', 'both']), /api\|web\|all/);
});

// ── loadProfile ───────────────────────────────────────────────────────────────
test('loadProfile throws a clear error for an absent label', () => {
  assert.throws(() => loadProfile('does-not-exist-xyz'), /profile not found/);
});

// ── buildPlan: ordering per scope ─────────────────────────────────────────────
function planKinds(scope, env = 'production') {
  const p = goodProfile();
  const { resolved, envConfig } = resolve(p, env);
  const plan = buildPlan({ label: p.label, env, scope, resolved, envConfig });
  return { plan, kinds: plan.map((s) => s.kind) };
}

test('buildPlan (scope=all) emits build-shared → migrate → deploy-worker → build-web → deploy-pages', () => {
  const { kinds } = planKinds('all');
  assert.deepEqual(kinds, ['build-shared', 'migrate', 'deploy-worker', 'build-web', 'deploy-pages']);
});

test('buildPlan (scope=api) emits only build-shared + api steps', () => {
  const { kinds } = planKinds('api');
  assert.deepEqual(kinds, ['build-shared', 'migrate', 'deploy-worker']);
});

test('buildPlan (scope=web) emits only build-shared + web steps', () => {
  const { kinds } = planKinds('web');
  assert.deepEqual(kinds, ['build-shared', 'build-web', 'deploy-pages']);
});

test('buildPlan carries neutral params (d1Name, wranglerEnv, pagesProject, brandVars)', () => {
  const { plan } = planKinds('all', 'production');
  const migrate = plan.find((s) => s.kind === 'migrate');
  const worker = plan.find((s) => s.kind === 'deploy-worker');
  const pages = plan.find((s) => s.kind === 'deploy-pages');
  const web = plan.find((s) => s.kind === 'build-web');
  assert.equal(migrate.d1Name, 'acme-db');
  assert.equal(migrate.wranglerEnv, 'acme'); // production convention: `<label>`
  assert.equal(worker.wranglerEnv, 'acme');
  assert.equal(pages.pagesProject, 'acme-web');
  assert.equal(web.brandVars.NEXT_PUBLIC_BRAND_SIGLA, 'ACM');
  assert.ok(web.brandVars.NEXT_PUBLIC_API_URL.startsWith('https://api.acme.app'));
});

test('buildPlan derives the staging wranglerEnv as `<label>-staging`', () => {
  const { plan } = planKinds('api', 'staging');
  assert.equal(plan.find((s) => s.kind === 'migrate').wranglerEnv, 'acme-staging');
});

// ── preflight: clean profile passes (exit 0) ──────────────────────────────────
test('preflight passes a complete profile (exit 0) — GOOGLE_CLIENT_ID is out of scope', () => {
  const p = goodProfile();
  const { expected, resolved } = resolve(p, 'production');
  const pf = preflight(schema(), resolved, expected, 'production');
  assert.equal(pf.exitCode, 0, JSON.stringify(pf.failedKeys));
  assert.deepEqual(pf.failedKeys, []);
});

// ── preflight: hard gap on a missing required key (names the key) ──────────────
test('preflight hard-gaps (exit 1) on a missing required build key and names it', () => {
  const p = goodProfile();
  delete p.brand.NEXT_PUBLIC_BRAND_SIGLA; // required build value
  const { expected, resolved } = resolve(p, 'production');
  const pf = preflight(schema(), resolved, expected, 'production');
  assert.equal(pf.exitCode, 1);
  assert.ok(pf.failedKeys.includes('NEXT_PUBLIC_BRAND_SIGLA'), 'names the offending key');
  const named = pf.results.some((r) => r.status === 'fail' && r.detail.includes('NEXT_PUBLIC_BRAND_SIGLA'));
  assert.ok(named, 'a result detail names the offending key');
});

// ── preflight: hard gap on a wildcard ALLOWED_ORIGINS (names the key) ──────────
test('preflight hard-gaps (exit 1) on a wildcard ALLOWED_ORIGINS in production', () => {
  const p = goodProfile();
  const { expected, resolved } = resolve(p, 'production');
  // Force a wildcard origin; keep expected == resolved so ONLY policy trips.
  resolved.ALLOWED_ORIGINS = 'https://app.acme.app,https://*.acme.app';
  expected.ALLOWED_ORIGINS = resolved.ALLOWED_ORIGINS;
  const pf = preflight(schema(), resolved, expected, 'production');
  assert.equal(pf.exitCode, 1);
  assert.ok(pf.failedKeys.includes('ALLOWED_ORIGINS'), 'names ALLOWED_ORIGINS');
  const named = pf.results.some((r) => r.group === 'policy' && r.key === 'ALLOWED_ORIGINS');
  assert.ok(named, 'the policy violation names ALLOWED_ORIGINS');
});

test('preflight hard-gaps on a full "*" ALLOWED_ORIGINS in staging', () => {
  const p = goodProfile();
  const { expected, resolved } = resolve(p, 'staging');
  resolved.ALLOWED_ORIGINS = '*';
  expected.ALLOWED_ORIGINS = '*';
  const pf = preflight(schema(), resolved, expected, 'staging');
  assert.equal(pf.exitCode, 1);
  assert.ok(pf.failedKeys.includes('ALLOWED_ORIGINS'));
});

// ── confirmProduction: the production safety gate ─────────────────────────────

/** A prompt fake that records invocation and returns a canned answer. */
function fakePrompt(answer) {
  const calls = [];
  const fn = async (question) => {
    calls.push(question);
    return answer;
  };
  fn.calls = calls;
  return fn;
}

test('confirmProduction proceeds when the operator types the exact label', async () => {
  const prompt = fakePrompt('acme');
  await confirmProduction({ env: 'production', label: 'acme', yes: false, promptFn: prompt, isTTY: true });
  assert.equal(prompt.calls.length, 1, 'the operator was prompted once');
});

test('confirmProduction aborts (throws) on a wrong entry', async () => {
  const prompt = fakePrompt('nope');
  await assert.rejects(
    () => confirmProduction({ env: 'production', label: 'acme', yes: false, promptFn: prompt, isTTY: true }),
    /expected to type "acme"/,
  );
});

test('confirmProduction is bypassed by --yes (no prompt)', async () => {
  const prompt = fakePrompt('anything');
  await confirmProduction({ env: 'production', label: 'acme', yes: true, promptFn: prompt, isTTY: true });
  assert.equal(prompt.calls.length, 0, '--yes must not prompt');
});

test('confirmProduction is bypassed by CONFIRM=1 (no prompt)', async () => {
  const prev = process.env.CONFIRM;
  process.env.CONFIRM = '1';
  try {
    const prompt = fakePrompt('anything');
    await confirmProduction({ env: 'production', label: 'acme', yes: false, promptFn: prompt, isTTY: true });
    assert.equal(prompt.calls.length, 0, 'CONFIRM=1 must not prompt');
  } finally {
    if (prev === undefined) delete process.env.CONFIRM;
    else process.env.CONFIRM = prev;
  }
});

test('confirmProduction fails closed without a TTY and no bypass (never prompts)', async () => {
  const prev = process.env.CONFIRM;
  delete process.env.CONFIRM;
  try {
    const prompt = fakePrompt('acme');
    await assert.rejects(
      () => confirmProduction({ env: 'production', label: 'acme', yes: false, promptFn: prompt, isTTY: false }),
      /requires confirmation/,
    );
    assert.equal(prompt.calls.length, 0, 'no prompt is issued when there is no TTY');
  } finally {
    if (prev !== undefined) process.env.CONFIRM = prev;
  }
});

test('confirmProduction is a no-op for non-production environments', async () => {
  const prompt = fakePrompt('anything');
  await confirmProduction({ env: 'staging', label: 'acme', yes: false, promptFn: prompt, isTTY: false });
  assert.equal(prompt.calls.length, 0, 'staging is never gated');
});

// ── structural invariant: core imports NO wrangler and NO cloud SDK ───────────
test('core.mjs imports only node builtins + ../label.mjs (no wrangler, no cloud SDK)', () => {
  const specifiers = [];
  const importRe = /(?:from|import)\s+['"]([^'"]+)['"]/g;
  const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = importRe.exec(CORE_SRC)) !== null) specifiers.push(m[1]);
  while ((m = requireRe.exec(CORE_SRC)) !== null) specifiers.push(m[1]);

  const allowed = new Set(['node:util', 'node:fs', 'node:path', '../label.mjs']);
  for (const spec of specifiers) {
    assert.ok(
      spec.startsWith('node:') || allowed.has(spec),
      `unexpected import in core.mjs: "${spec}" (core must stay cloud-agnostic, stdlib + label.mjs only)`,
    );
  }

  // No provider/cloud module is imported, and core never spawns a subprocess.
  const forbidden = ['wrangler', 'child_process', '@aws-sdk', 'aws-sdk', '@cloudflare/', 'spawnSync', 'spawn('];
  for (const token of forbidden) {
    const importedForbidden = specifiers.some((s) => s.includes(token));
    assert.ok(!importedForbidden, `core.mjs must not import "${token}"`);
  }
  assert.ok(!/\bchild_process\b/.test(CORE_SRC), 'core.mjs must not use node:child_process');
  assert.ok(!/spawnSync\s*\(/.test(CORE_SRC), 'core.mjs must not spawn a subprocess');
});
