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

import { parseJsonc, derivePreview, originAllowed } from '../label.mjs';
import {
  parseArgs,
  run,
  buildPreviewPlan,
  buildPreviewDeletePlan,
  previewNameFromBranch,
  resolvePreviewName,
  MIGRATIONS_BASE,
  PREVIEW_GENERATED_SECRETS,
  previewSecretSpec,
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
  assert.deepEqual(a, {
    label: 'acme', env: 'staging', scope: 'all', yes: false, dryRun: false, skipSecretCheck: false,
    preview: null, delete: false, apiUrl: null, summaryFile: null,
  });
});

test('parseArgs honours --scope, --yes and --dry-run', () => {
  const a = parseArgs(['--label', 'acme', '--env', 'production', '--scope', 'api', '--yes', '--dry-run']);
  assert.deepEqual(a, {
    label: 'acme', env: 'production', scope: 'api', yes: true, dryRun: true, skipSecretCheck: false,
    preview: null, delete: false, apiUrl: null, summaryFile: null,
  });
});

test('parseArgs defaults skipSecretCheck to false and honours the flag', () => {
  assert.equal(parseArgs(['--label', 'acme', '-e', 'staging']).skipSecretCheck, false);
  const a = parseArgs(['--label', 'acme', '-e', 'staging', '--skip-secret-check']);
  assert.equal(a.skipSecretCheck, true);
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

// The fixture profile uses MAIL_DRIVER=resend, so RESEND_API_KEY is actively
// required alongside the four unconditional secrets.
const ALL_SECRETS = [
  'JWT_SECRET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'GOOGLE_CLIENT_SECRET',
  'RESEND_API_KEY',
];

// ── preflight: clean profile passes (exit 0) ──────────────────────────────────
test('preflight passes a complete profile (exit 0) — GOOGLE_CLIENT_ID is out of scope', () => {
  const p = goodProfile();
  const { expected, resolved } = resolve(p, 'production');
  const pf = preflight(schema(), resolved, expected, 'production', {
    secretNames: ALL_SECRETS,
    label: 'acme',
  });
  assert.equal(pf.exitCode, 0, JSON.stringify(pf.failedKeys));
  assert.deepEqual(pf.failedKeys, []);
});

// ── preflight: api-secrets presence (by NAME only) ────────────────────────────
test('preflight hard-gaps (exit 1) on a missing required secret and names the fix', () => {
  const p = goodProfile();
  const { expected, resolved } = resolve(p, 'production');
  const present = ALL_SECRETS.filter((k) => k !== 'R2_ACCESS_KEY_ID');
  const pf = preflight(schema(), resolved, expected, 'production', {
    secretNames: present,
    label: 'acme',
  });
  assert.equal(pf.exitCode, 1);
  assert.ok(pf.failedKeys.includes('R2_ACCESS_KEY_ID'), 'names the offending secret');
  const row = pf.results.find((r) => r.group === 'api-secrets' && r.key === 'R2_ACCESS_KEY_ID');
  assert.equal(row.status, 'fail');
  // The operator gets the exact remedy, with the production env convention.
  assert.match(row.detail, /create-secrets\.sh R2_ACCESS_KEY_ID --env acme/);
});

test('preflight skips (never fails) api-secrets when the names cannot be listed', () => {
  const p = goodProfile();
  const { expected, resolved } = resolve(p, 'production');
  const pf = preflight(schema(), resolved, expected, 'production'); // no secretNames
  const rows = pf.results.filter((r) => r.group === 'api-secrets');
  assert.equal(rows.length, ALL_SECRETS.length);
  assert.ok(rows.every((r) => r.status === 'skip'), 'unverified must never be a false pass');
  // Soft gap (2), not a hard gap — an unverifiable secret must not block a deploy.
  assert.equal(pf.exitCode, 2);
  assert.deepEqual(pf.failedKeys, []);
});

test('preflight leaves RESEND_API_KEY out of scope when MAIL_DRIVER is not resend', () => {
  const p = goodProfile();
  p.environments.production.mail.driver = 'console';
  const { expected, resolved } = resolve(p, 'production');
  const pf = preflight(schema(), resolved, expected, 'production', {
    secretNames: ALL_SECRETS.filter((k) => k !== 'RESEND_API_KEY'),
    label: 'acme',
  });
  const reported = pf.results.some((r) => r.group === 'api-secrets' && r.key === 'RESEND_API_KEY');
  assert.ok(!reported, 'RESEND_API_KEY is gated on MAIL_DRIVER=resend');
  assert.ok(!pf.failedKeys.includes('RESEND_API_KEY'));
});

test('preflight renders the staging env convention in the secret fix hint', () => {
  const p = goodProfile();
  const { expected, resolved } = resolve(p, 'staging');
  const pf = preflight(schema(), resolved, expected, 'staging', { secretNames: [], label: 'acme' });
  const row = pf.results.find((r) => r.group === 'api-secrets' && r.key === 'JWT_SECRET');
  assert.match(row.detail, /--env acme-staging/);
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

// ── candidate previews (RFC 0021 §1) ──────────────────────────────────────────
const STG = ['--label', 'acme', '-e', 'staging'];

test('previewNameFromBranch maps feature/m<N>/candidate → m<N> and nothing else', () => {
  assert.equal(previewNameFromBranch('feature/m21/candidate'), 'm21');
  assert.equal(previewNameFromBranch('feature/m26/12-deploy-cli-preview-mode.task'), null);
  assert.equal(previewNameFromBranch('main'), null);
  assert.equal(previewNameFromBranch(''), null);
  assert.equal(previewNameFromBranch(undefined), null);
});

test('parseArgs --preview <name> sets the preview; an empty value defaults from the candidate branch', () => {
  assert.equal(parseArgs([...STG, '--preview', 'm21']).preview, 'm21');
  assert.equal(parseArgs([...STG, '--preview', ''], { branch: 'feature/m21/candidate' }).preview, 'm21');
  assert.throws(() => parseArgs([...STG, '--preview', ''], { branch: 'main' }), /needs a name/);
});

test('parseArgs refuses --preview with -e production before anything else', () => {
  assert.throws(() => parseArgs(['--label', 'acme', '-e', 'production', '--preview', 'x']), /only valid with -e staging/);
  assert.throws(() => parseArgs(['--label', 'acme', '-e', 'production', '--preview', 'Feature/M21']), /only valid with -e staging/);
});

test('parseArgs refuses a preview name outside [a-z0-9-]{1,20}', () => {
  for (const bad of ['Feature/M21', 'M21', 'a'.repeat(21), 'm_21', 'm21.x', '-m21', 'm21-']) {
    assert.throws(() => resolvePreviewName(bad, ''), /must match/, bad);
    assert.throws(() => parseArgs([...STG, `--preview=${bad}`]), /must match/, bad);
  }
  assert.equal(resolvePreviewName('a'.repeat(20), ''), 'a'.repeat(20));
});

test('parseArgs: --delete / --api-url / --summary-file need --preview', () => {
  assert.throws(() => parseArgs([...STG, '--delete']), /--delete is only valid with --preview/);
  assert.throws(() => parseArgs([...STG, '--api-url', 'https://x.dev']), /--api-url is only valid with --preview/);
  assert.throws(() => parseArgs([...STG, '--summary-file', '/tmp/s']), /--summary-file is only valid with --preview/);
  const a = parseArgs([...STG, '--preview', 'm21', '--delete', '--summary-file', '/tmp/s']);
  assert.equal(a.delete, true);
  assert.equal(a.summaryFile, '/tmp/s');
});

test('parseArgs: a web-only preview requires an https --api-url; other scopes refuse it', () => {
  assert.throws(() => parseArgs([...STG, '--preview', 'm21', '--scope', 'web']), /needs --api-url/);
  assert.throws(() => parseArgs([...STG, '--preview', 'm21', '--scope', 'web', '--api-url', 'http://x.dev']), /https/);
  assert.throws(() => parseArgs([...STG, '--preview', 'm21', '--api-url', 'https://x.dev']), /only valid for a web-only preview/);
  const a = parseArgs([...STG, '--preview', 'm21', '--scope', 'web', '--api-url', 'https://m21-api.acct.workers.dev/']);
  assert.equal(a.apiUrl, 'https://m21-api.acct.workers.dev');
  // deleting a web branch needs no API URL
  assert.equal(parseArgs([...STG, '--preview', 'm21', '--scope', 'web', '--delete']).apiUrl, null);
});

test('originAllowed mirrors the API matcher: exact, one-label wildcard, scheme, full wildcard', () => {
  const list = 'https://w.pages.dev,https://*.w.pages.dev,http://localhost:3000';
  assert.equal(originAllowed(list, 'https://w.pages.dev'), true);
  assert.equal(originAllowed(list, 'https://m21.w.pages.dev'), true);
  assert.equal(originAllowed(list, 'https://M21.W.pages.dev'), true);
  assert.equal(originAllowed(list, 'https://a.b.w.pages.dev'), false, 'deep subdomain');
  assert.equal(originAllowed(list, 'http://m21.w.pages.dev'), false, 'scheme mismatch');
  assert.equal(originAllowed(list, 'https://m21.other.pages.dev'), false);
  assert.equal(originAllowed(list, 'https://m21.w.pages.dev/path'), false, 'not an origin');
  assert.equal(originAllowed('*', 'https://anything.example'), true);
});

test('derivePreview: the web preview is the Pages branch alias, covered by the staging ALLOWED_ORIGINS', () => {
  const p = derivePreview(goodProfile(), 'm21');
  assert.equal(p.webUrl, 'https://m21.acme-web-staging.pages.dev');
  assert.equal(p.siteUrl, p.webUrl);
  assert.equal(p.pagesProject, 'acme-web-staging');
  assert.equal(p.d1Name, 'acme-db-staging');
  assert.ok(originAllowed(p.allowedOrigins, p.webUrl));
});

test('derivePreview refuses a staging webOrigin that is not the Pages host (CORS would fail)', () => {
  const p = goodProfile();
  p.environments.staging.webOrigin = 'staging.acme.app';
  assert.throws(() => derivePreview(p, 'm21'), /not admitted by the staging ALLOWED_ORIGINS/);
});

test('derivePreview refuses a name whose Worker preview host exceeds one DNS label', () => {
  const p = goodProfile();
  p.environments.staging.worker = 'w'.repeat(50);
  assert.throws(() => derivePreview(p, 'a'.repeat(13)), /63-character DNS label/);
  assert.doesNotThrow(() => derivePreview(p, 'a'.repeat(12)));
});

test('derivePreview holds for every committed label (their staging webOrigin is the Pages host)', () => {
  for (const label of ['arenaquest', 'spaziord', 'budo']) {
    const p = derivePreview(loadProfile(label), 'm21');
    assert.equal(p.webUrl, `https://m21.${loadProfile(label).environments.staging.webOrigin}`, label);
  }
});

function previewPlan(scope, extra = {}) {
  const p = goodProfile();
  const { resolved, envConfig } = resolve(p, 'staging');
  return buildPreviewPlan({
    label: p.label, scope, resolved, envConfig, preview: derivePreview(p, 'm21'), commitSha: 'abc1234', ...extra,
  });
}

test('buildPreviewPlan (all): lint → build-shared → bookmark → migrate → worker preview → web → pages branch → report', () => {
  assert.deepEqual(previewPlan('all').map((s) => s.kind), [
    'lint-migrations', 'build-shared', 'bookmark', 'migrate', 'deploy-worker-preview',
    'build-web', 'deploy-pages-branch', 'report',
  ]);
});

test('buildPreviewPlan: the lint precedes the bookmark, which precedes the migrate', () => {
  const kinds = previewPlan('all').map((s) => s.kind);
  assert.ok(kinds.indexOf('lint-migrations') < kinds.indexOf('bookmark'));
  assert.ok(kinds.indexOf('bookmark') < kinds.indexOf('migrate'));
  assert.equal(previewPlan('all')[0].base, MIGRATIONS_BASE);
});

test('buildPreviewPlan never targets the live staging Worker or the Pages production branch', () => {
  const kinds = previewPlan('all').map((s) => s.kind);
  assert.ok(!kinds.includes('deploy-worker'));
  assert.ok(!kinds.includes('deploy-pages'));
  const pages = previewPlan('all').find((s) => s.kind === 'deploy-pages-branch');
  assert.equal(pages.branch, 'm21');
  assert.equal(pages.pagesProject, 'acme-web-staging');
  const worker = previewPlan('all').find((s) => s.kind === 'deploy-worker-preview');
  assert.equal(worker.previewName, 'm21');
  assert.equal(worker.wranglerEnv, 'acme-staging');
  assert.equal(worker.message, 'abc1234');
});

test('buildPreviewPlan scope filtering', () => {
  assert.deepEqual(previewPlan('api').map((s) => s.kind), [
    'lint-migrations', 'build-shared', 'bookmark', 'migrate', 'deploy-worker-preview', 'report',
  ]);
  assert.deepEqual(previewPlan('web', { apiUrl: 'https://x.dev' }).map((s) => s.kind), [
    'build-shared', 'build-web', 'deploy-pages-branch', 'report',
  ]);
});

test('buildPreviewPlan build-web vars: captured API URL, preview site URL, name and sha over the brand', () => {
  const web = previewPlan('all').find((s) => s.kind === 'build-web');
  assert.equal(web.apiUrlFrom, 'deploy-worker-preview');
  assert.equal(web.brandVars.NEXT_PUBLIC_API_URL, null);
  assert.equal(web.brandVars.NEXT_PUBLIC_SITE_URL, 'https://m21.acme-web-staging.pages.dev');
  assert.equal(web.brandVars.NEXT_PUBLIC_PREVIEW_NAME, 'm21');
  assert.equal(web.brandVars.NEXT_PUBLIC_PREVIEW_SHA, 'abc1234');
  assert.equal(web.brandVars.NEXT_PUBLIC_BRAND_SIGLA, 'ACM');

  const webOnly = previewPlan('web', { apiUrl: 'https://x.dev' }).find((s) => s.kind === 'build-web');
  assert.equal(webOnly.apiUrlFrom, null);
  assert.equal(webOnly.brandVars.NEXT_PUBLIC_API_URL, 'https://x.dev');
});

test('buildPreviewPlan report carries both URLs and the bookmark source', () => {
  const report = previewPlan('all').at(-1);
  assert.equal(report.kind, 'report');
  assert.equal(report.webUrl, 'https://m21.acme-web-staging.pages.dev');
  assert.equal(report.apiUrlFrom, 'deploy-worker-preview');
  assert.equal(report.bookmarkFrom, 'bookmark');
  assert.equal(report.d1Name, 'acme-db-staging');
});

test('buildPreviewDeletePlan removes the worker preview and the pages branch, per scope', () => {
  const p = goodProfile();
  const { envConfig } = resolve(p, 'staging');
  const preview = derivePreview(p, 'm21');
  const all = buildPreviewDeletePlan({ label: 'acme', scope: 'all', envConfig, preview });
  assert.deepEqual(all.map((s) => s.kind), ['delete-worker-preview', 'delete-pages-branch']);
  assert.equal(all[0].wranglerEnv, 'acme-staging');
  assert.equal(all[1].branch, 'm21');
  assert.deepEqual(buildPreviewDeletePlan({ label: 'acme', scope: 'api', envConfig, preview }).map((s) => s.kind), ['delete-worker-preview']);
  assert.deepEqual(buildPreviewDeletePlan({ label: 'acme', scope: 'web', envConfig, preview }).map((s) => s.kind), ['delete-pages-branch']);
});

test('run() builds the preview plan for a real label and threads the commit sha', () => {
  const r = run(['--label', 'budo', '-e', 'staging', '--preview', 'm21', '--dry-run'], { commitSha: 'abc1234' });
  assert.equal(r.ok, true);
  assert.equal(r.preview.webUrl, 'https://m21.budo-web-staging.pages.dev');
  assert.equal(r.plan[0].kind, 'lint-migrations');
  assert.equal(r.plan.find((s) => s.kind === 'build-web').brandVars.NEXT_PUBLIC_PREVIEW_SHA, 'abc1234');
});

test('previewSecretSpec: JWT_SECRET is generated, the other active secrets are external', () => {
  const p = goodProfile();
  const { resolved } = resolve(p, 'staging');
  const spec = previewSecretSpec(schema(), resolved);
  assert.deepEqual(spec.generated, PREVIEW_GENERATED_SECRETS);
  assert.deepEqual(spec.generated, ['JWT_SECRET']);
  assert.ok(!spec.external.includes('JWT_SECRET'));
  assert.ok(spec.external.includes('R2_ACCESS_KEY_ID'));
});

test('preflight of a preview never checks (or blocks on) the Worker secrets', () => {
  const p = goodProfile();
  const { expected, resolved } = resolve(p, 'staging');
  const pf = preflight(schema(), resolved, expected, 'staging', { secretNames: [], label: 'acme', previewSecrets: true });
  assert.equal(pf.results.filter((r) => r.group === 'api-secrets').length, 0);
  assert.equal(pf.exitCode, 0);
});

test('run() of a preview skips the secret lookup and hands the secret NAMES to the worker step', () => {
  let asked = 0;
  const fetchSecretNames = () => { asked++; return { ok: true, names: [] }; };
  const r = run(['--label', 'budo', '-e', 'staging', '--preview', 'm21'], { fetchSecretNames });
  assert.equal(r.ok, true, 'a preview is not blocked by secrets missing on the staging Worker');
  assert.equal(asked, 0);
  const worker = r.plan.find((s) => s.kind === 'deploy-worker-preview');
  assert.deepEqual(worker.secrets.generated, ['JWT_SECRET']);
  assert.ok(worker.secrets.external.includes('R2_SECRET_ACCESS_KEY'));
  assert.ok(!run(['--label', 'budo', '-e', 'staging'], { fetchSecretNames }).ok, 'a plain deploy still hard-gaps');
});

test('run() --delete skips the preflight and returns the delete plan', () => {
  const r = run(['--label', 'budo', '-e', 'staging', '--preview', 'm21', '--delete', '--dry-run']);
  assert.equal(r.preflight, null);
  assert.deepEqual(r.plan.map((s) => s.kind), ['delete-worker-preview', 'delete-pages-branch']);
});

test('run() without --preview still builds the plain deploy plan', () => {
  const r = run(['--label', 'budo', '-e', 'staging', '--dry-run']);
  assert.equal(r.preview, null);
  assert.deepEqual(r.plan.map((s) => s.kind), ['build-shared', 'migrate', 'deploy-worker', 'build-web', 'deploy-pages']);
});
