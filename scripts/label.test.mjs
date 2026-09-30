/**
 * Unit tests for scripts/label.mjs — pure logic only.
 * No network, no real `wrangler`, no real file mutation (scaffold runs
 * against an in-memory text + a temp copy). Run with: node --test scripts/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  stripJsonc,
  parseJsonc,
  deriveExpected,
  buildResolved,
  checkPresence,
  checkCoherence,
  checkPolicy,
  requiredWhenActive,
  mapExitCode,
  formatChecklist,
  scaffoldWranglerText,
  deriveCorsRules,
  renderCorsFile,
  workersDevHost,
  kvNamespaceName,
  derivePreviewsBlock,
  setPreviewsBlockText,
  checkPreviewsBlock,
  diffPaths,
} from './label.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures');
const ROOT = dirname(HERE);

function loadFixture(name) {
  return parseJsonc(readFileSync(join(FIX, name), 'utf8'));
}
const profile = () => loadFixture('good-profile.jsonc');
const schema = () => parseJsonc(readFileSync(join(ROOT, 'config', 'deployment.schema.jsonc'), 'utf8'));

// ── JSONC parsing ──────────────────────────────────────────────────────────
test('stripJsonc removes comments and trailing commas, keeps string content', () => {
  const src = `{
    // line comment
    "a": "http://x/y", /* block */
    "b": "has // not a comment and /* nor this */",
    "c": [1, 2,],
  }`;
  const obj = JSON.parse(stripJsonc(src));
  assert.equal(obj.a, 'http://x/y');
  assert.equal(obj.b, 'has // not a comment and /* nor this */');
  assert.deepEqual(obj.c, [1, 2]);
});

test('parseJsonc parses a profile fixture', () => {
  const p = profile();
  assert.equal(p.label, 'acme');
  assert.equal(p.environments.staging.apiHost, 'api-acme-staging.acme.workers.dev');
});

// ── derivation ───────────────────────────────────────────────────────────────
test('deriveExpected (staging) includes the single-label preview wildcard', () => {
  const d = deriveExpected(profile(), 'staging');
  assert.equal(d.NEXT_PUBLIC_API_URL, 'https://api-acme-staging.acme.workers.dev');
  assert.equal(d.GOOGLE_REDIRECT_URI, 'https://api-acme-staging.acme.workers.dev/auth/google/callback');
  assert.equal(d.WEB_BASE_URL, 'https://acme-web-staging.pages.dev');
  assert.equal(
    d.ALLOWED_ORIGINS,
    'https://acme-web-staging.pages.dev,https://*.acme-web-staging.pages.dev,http://localhost:3000',
  );
  assert.ok(d.ALLOWED_ORIGINS.includes('*'), 'staging carries the preview wildcard');
});

test('deriveExpected (production) is exact-origin only — no wildcard', () => {
  const d = deriveExpected(profile(), 'production');
  assert.equal(d.ALLOWED_ORIGINS, 'https://app.acme.app');
  assert.ok(!d.ALLOWED_ORIGINS.includes('*'), 'production has no wildcard');
  assert.equal(d.NEXT_PUBLIC_API_URL, 'https://api.acme.app');
});

// ── presence ─────────────────────────────────────────────────────────────────
test('checkPresence flags GOOGLE_CLIENT_ID when no wrangler block supplies it', () => {
  const p = profile();
  const expected = deriveExpected(p, 'staging');
  const resolved = buildResolved(p, 'staging', expected, null); // no env block
  const missing = checkPresence(schema()['api-vars'], resolved);
  assert.ok(missing.includes('GOOGLE_CLIENT_ID'), 'GOOGLE_CLIENT_ID is missing without a block');
  assert.ok(!missing.includes('WEB_BASE_URL'), 'derived keys are present');
});

test('checkPresence passes once the env block supplies GOOGLE_CLIENT_ID', () => {
  const p = profile();
  const expected = deriveExpected(p, 'staging');
  const resolved = buildResolved(p, 'staging', expected, { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com' });
  const missing = checkPresence(schema()['api-vars'], resolved);
  assert.ok(!missing.includes('GOOGLE_CLIENT_ID'));
});

// ── coherence ────────────────────────────────────────────────────────────────
test('checkCoherence catches a wrong WEB_BASE_URL as a named mismatch', () => {
  const p = profile();
  const expected = deriveExpected(p, 'staging');
  const actual = loadFixture('coherence-break.vars.jsonc');
  const mismatches = checkCoherence(expected, actual);
  const keys = mismatches.map((m) => m.key);
  assert.ok(keys.includes('WEB_BASE_URL'), 'WEB_BASE_URL mismatch reported');
  const m = mismatches.find((x) => x.key === 'WEB_BASE_URL');
  assert.equal(m.expected, 'https://acme-web-staging.pages.dev');
});

test('checkCoherence catches a wrong NEXT_PUBLIC_API_URL host', () => {
  const expected = deriveExpected(profile(), 'staging');
  const actual = { NEXT_PUBLIC_API_URL: 'https://api-WRONG.workers.dev' };
  const mismatches = checkCoherence(expected, actual);
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].key, 'NEXT_PUBLIC_API_URL');
});

test('checkCoherence is clean for derived-by-construction values', () => {
  const expected = deriveExpected(profile(), 'staging');
  assert.deepEqual(checkCoherence(expected, { ...expected }), []);
});

// ── policy ───────────────────────────────────────────────────────────────────
test('checkPolicy rejects a full wildcard in staging', () => {
  const vars = loadFixture('policy-break.vars.jsonc');
  const v = checkPolicy(vars.ALLOWED_ORIGINS, 'staging');
  assert.equal(v.length, 1);
  assert.match(v[0].reason, /full wildcard/);
});

test('checkPolicy allows the single-label preview wildcard in staging', () => {
  const d = deriveExpected(profile(), 'staging');
  assert.deepEqual(checkPolicy(d.ALLOWED_ORIGINS, 'staging'), []);
});

test('checkPolicy rejects any wildcard in production', () => {
  const v = checkPolicy('https://app.acme.app,https://*.app.acme.app', 'production');
  assert.equal(v.length, 1);
  assert.match(v[0].reason, /production/);
});

test('checkPolicy rejects a multi-label wildcard even in staging', () => {
  const v = checkPolicy('https://*.*.acme.app', 'staging');
  assert.equal(v.length, 1);
});

// ── requiredWhen ─────────────────────────────────────────────────────────────
test('requiredWhenActive gates RESEND_API_KEY on MAIL_DRIVER=resend', () => {
  assert.equal(requiredWhenActive('MAIL_DRIVER=resend', { MAIL_DRIVER: 'resend' }), true);
  assert.equal(requiredWhenActive('MAIL_DRIVER=resend', { MAIL_DRIVER: 'console' }), false);
  assert.equal(requiredWhenActive('MAIL_DRIVER=resend', {}), false);
});

test('checkPresence honours requiredWhen for api-secrets', () => {
  const sec = schema()['api-secrets'];
  // resend active → RESEND_API_KEY required and missing
  assert.ok(checkPresence(sec, { MAIL_DRIVER: 'resend' }).includes('RESEND_API_KEY'));
  // console driver → RESEND_API_KEY not required
  assert.ok(!checkPresence(sec, { MAIL_DRIVER: 'console', JWT_SECRET: 'x', R2_ACCESS_KEY_ID: 'x', R2_SECRET_ACCESS_KEY: 'x', GOOGLE_CLIENT_SECRET: 'x' }).includes('RESEND_API_KEY'));
});

// ── exit-code mapping ────────────────────────────────────────────────────────
test('mapExitCode → 0 when everything passes', () => {
  assert.equal(mapExitCode([{ status: 'pass' }, { status: 'pass' }]), 0);
});

test('mapExitCode → 1 when any hard gap exists', () => {
  assert.equal(mapExitCode([{ status: 'pass' }, { status: 'fail' }, { status: 'manual' }]), 1);
});

test('mapExitCode → 2 when only manual/skipped items remain', () => {
  assert.equal(mapExitCode([{ status: 'pass' }, { status: 'manual' }]), 2);
  assert.equal(mapExitCode([{ status: 'pass' }, { status: 'skip' }]), 2);
});

// ── checklist formatting (no secret values) ──────────────────────────────────
test('formatChecklist groups items and prints an exit-bearing summary', () => {
  const results = [
    { group: 'api-vars', key: 'WEB_BASE_URL', status: 'pass', detail: 'coherent with webOrigin' },
    { group: 'api-secrets', key: 'JWT_SECRET', status: 'skip', detail: 'skipped', fix: 'scripts/create-secrets.sh JWT_SECRET --env acme-staging' },
    { group: 'external', key: 'resend', status: 'manual', detail: 'verify sender domain' },
  ];
  const out = formatChecklist('acme', 'staging', 'Acme', results);
  assert.match(out, /Acme — staging/);
  assert.match(out, /api-secrets/);
  assert.match(out, /Exit 2\./);
  assert.ok(!/secret-value/i.test(out));
});

// ── scaffold: idempotent, ArenaQuest blocks untouched ────────────────────────
test('scaffoldWranglerText inserts a delimited block and is idempotent', () => {
  const realWrangler = readFileSync(join(ROOT, 'apps', 'api', 'wrangler.jsonc'), 'utf8');
  const p = profile();
  const once = scaffoldWranglerText(realWrangler, 'acme', p);
  assert.match(once, /label:acme \(generated\)/);
  assert.match(once, /"acme-staging":/);
  assert.match(once, /"acme":/);
  // existing ArenaQuest staging block survives
  assert.match(once, /"staging":\s*\{/);
  assert.match(once, /api-staging/);
  // resulting text is valid JSONC
  const parsed = parseJsonc(once);
  assert.ok(parsed.env['acme-staging']);
  assert.equal(parsed.env['acme-staging'].vars.WEB_BASE_URL, 'https://acme-web-staging.pages.dev');
  assert.equal(parsed.env['acme'].vars.ALLOWED_ORIGINS, 'https://app.acme.app');
  assert.ok(parsed.env.staging, 'ArenaQuest staging block preserved');
  // idempotency: a second pass yields identical output
  const twice = scaffoldWranglerText(once, 'acme', p);
  assert.equal(twice, once, 'second scaffold produces identical text');
  // and exactly one generated block exists
  assert.equal((twice.match(/label:acme \(generated\)/g) || []).length, 1);
});

test('scaffold to a TEMP copy never touches the real wrangler.jsonc', () => {
  const realPath = join(ROOT, 'apps', 'api', 'wrangler.jsonc');
  const original = readFileSync(realPath, 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'label-test-'));
  const tmp = join(dir, 'wrangler.jsonc');
  copyFileSync(realPath, tmp);
  const updated = scaffoldWranglerText(readFileSync(tmp, 'utf8'), 'acme', profile());
  writeFileSync(tmp, updated);
  // real file unchanged
  assert.equal(readFileSync(realPath, 'utf8'), original);
  // temp file got the block
  assert.match(readFileSync(tmp, 'utf8'), /label:acme \(generated\)/);
});

// ── scaffold derivation coherence (RFC success criterion) ─────────────────────
test('scaffolded vars agree by construction (redirect host == api url host)', () => {
  const real = readFileSync(join(ROOT, 'apps', 'api', 'wrangler.jsonc'), 'utf8');
  const parsed = parseJsonc(scaffoldWranglerText(real, 'acme', profile()));
  const v = parsed.env['acme-staging'].vars;
  const apiHost = profile().environments.staging.apiHost;
  assert.ok(v.GOOGLE_REDIRECT_URI.startsWith(`https://${apiHost}`));
  assert.ok(v.ALLOWED_ORIGINS.includes('acme-web-staging.pages.dev'));
});

// ── R2 CORS derivation ───────────────────────────────────────────────────────
test('deriveCorsRules gives production exact origins only', () => {
  const rules = deriveCorsRules(profile(), 'production');
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].allowed.origins, ['https://app.acme.app']);
  assert.ok(!rules[0].allowed.origins.some((o) => o.includes('*')));
  // The bucket policy must satisfy the same rule the Worker policy does.
  assert.deepEqual(checkPolicy(rules[0].allowed.origins.join(','), 'production'), []);
});

test('deriveCorsRules gives staging the preview wildcard carve-out', () => {
  const rules = deriveCorsRules(profile(), 'staging');
  assert.deepEqual(rules[0].allowed.origins, [
    'https://acme-web-staging.pages.dev',
    'https://*.acme-web-staging.pages.dev',
    'http://localhost:3000',
  ]);
  assert.deepEqual(checkPolicy(rules[0].allowed.origins.join(','), 'staging'), []);
});

test('deriveCorsRules cannot drift from ALLOWED_ORIGINS', () => {
  // The bucket CORS and the Worker CORS are two consumers of ONE derivation.
  for (const env of ['staging', 'production']) {
    const p = profile();
    assert.equal(
      deriveCorsRules(p, env)[0].allowed.origins.join(','),
      deriveExpected(p, env).ALLOWED_ORIGINS,
      `${env} CORS origins diverged from ALLOWED_ORIGINS`,
    );
  }
});

test('deriveCorsRules allows the presigned-upload lifecycle', () => {
  const allowed = deriveCorsRules(profile(), 'staging')[0].allowed;
  assert.deepEqual(allowed.methods, ['PUT', 'GET']);
  assert.deepEqual(allowed.headers, ['Content-Type', 'Content-Length']);
});

test('renderCorsFile emits the document wrangler expects', () => {
  const text = renderCorsFile(deriveCorsRules(profile(), 'production'));
  const parsed = JSON.parse(text);
  assert.ok(Array.isArray(parsed.rules));
  assert.ok(parsed.rules[0].allowed.origins.length > 0);
  assert.equal(typeof parsed.rules[0].maxAgeSeconds, 'number');
  assert.ok(text.endsWith('\n'));
});

// ── naming helpers ───────────────────────────────────────────────────────────
test('workersDevHost assembles the account subdomain host', () => {
  assert.equal(
    workersDevHost('api-budo-staging', 'raphael-1d2'),
    'api-budo-staging.raphael-1d2.workers.dev',
  );
});

test('kvNamespaceName is per label and env, never the shared binding name', () => {
  assert.equal(kvNamespaceName('budo', 'staging'), 'budo-rate-limit-staging');
  assert.equal(kvNamespaceName('budo', 'production'), 'budo-rate-limit-production');
  assert.notEqual(kvNamespaceName('budo', 'staging'), 'RATE_LIMIT_KV');
});

// ── custom domain routes ─────────────────────────────────────────────────────
test('scaffoldWranglerText emits routes only when the profile records a custom domain', () => {
  const real = readFileSync(join(ROOT, 'apps', 'api', 'wrangler.jsonc'), 'utf8');

  const without = parseJsonc(scaffoldWranglerText(real, 'acme', profile()));
  assert.equal(without.env['acme'].routes, undefined);

  const p = profile();
  p.environments.production.customDomain = true;
  const withDomain = parseJsonc(scaffoldWranglerText(real, 'acme', p));
  assert.deepEqual(withDomain.env['acme'].routes, [
    { pattern: 'api.acme.app', custom_domain: true },
  ]);
  // staging did not opt in, so it stays route-less
  assert.equal(withDomain.env['acme-staging'].routes, undefined);
});

test('scaffoldWranglerText stays idempotent once routes are emitted', () => {
  const real = readFileSync(join(ROOT, 'apps', 'api', 'wrangler.jsonc'), 'utf8');
  const p = profile();
  p.environments.production.customDomain = true;
  const once = scaffoldWranglerText(real, 'acme', p);
  assert.equal(scaffoldWranglerText(once, 'acme', p), once);
});

// ── Workers Previews (RFC 0021) ─────────────────────────────────────────────
const previewsWranglerText = () => readFileSync(join(FIX, 'previews-wrangler.jsonc'), 'utf8');

test('derivePreviewsBlock re-binds the staging D1/KV/R2 with the staging vars + APP_PREVIEW', () => {
  const p = profile();
  const b = derivePreviewsBlock(p, 'staging');
  assert.deepEqual(b.d1_databases, [{ binding: 'DB', database_name: 'acme-db-staging', database_id: 'aaaa-staging' }]);
  assert.deepEqual(b.kv_namespaces, [{ binding: 'RATE_LIMIT_KV', id: 'kv-staging' }]);
  assert.deepEqual(b.r2_buckets, [{ binding: 'R2', bucket_name: 'acme-media-staging' }]);
  assert.equal(b.vars.APP_PREVIEW, '1');
  assert.equal(b.vars.WEB_BASE_URL, 'https://acme-web-staging.pages.dev', 'WEB_BASE_URL stays the staging web origin');
  assert.equal(b.vars.ALLOWED_ORIGINS, deriveExpected(p, 'staging').ALLOWED_ORIGINS);
  assert.equal(b.vars.GOOGLE_CLIENT_ID, undefined, 'no placeholder client id in a preview');
  for (const k of ['triggers', 'routes', 'crons', 'name']) assert.ok(!(k in b), `no ${k} in previews`);
});

test('derivePreviewsBlock carries GOOGLE_CLIENT_ID only when the profile records one', () => {
  const p = profile();
  p.environments.staging.googleClientId = 'x.apps.googleusercontent.com';
  assert.equal(derivePreviewsBlock(p, 'staging').vars.GOOGLE_CLIENT_ID, 'x.apps.googleusercontent.com');
});

test('derivePreviewsBlock refuses production', () => {
  assert.throws(() => derivePreviewsBlock(profile(), 'production'), /staging only/);
});

test('scaffoldWranglerText gives the staging block a previews member and production none', () => {
  const p = profile();
  p.environments.staging.customDomain = true;
  const out = parseJsonc(scaffoldWranglerText('{\n\t"env": {\n\t}\n}\n', 'acme', p));
  const staging = out.env['acme-staging'];
  assert.deepEqual(staging.previews, derivePreviewsBlock(p, 'staging'));
  assert.ok(!('routes' in staging.previews), 'no custom domain inside previews');
  // Bindings equal the env's own (bar migrations_dir, which previews never use).
  assert.equal(staging.previews.d1_databases[0].database_id, staging.d1_databases[0].database_id);
  assert.equal(staging.previews.kv_namespaces[0].id, staging.kv_namespaces[0].id);
  assert.equal(staging.previews.r2_buckets[0].bucket_name, staging.r2_buckets[0].bucket_name);
  assert.ok(!('previews' in out.env.acme), 'production has no previews block');
});

test('setPreviewsBlockText inserts only the previews member and preserves every other byte', () => {
  const before = previewsWranglerText();
  const { text, changed, existed } = setPreviewsBlockText(before, 'acme', profile());
  assert.ok(changed);
  assert.ok(!existed);
  // Removing the inserted member gives back the original text exactly.
  const start = text.indexOf(',\n\t\t\t"previews": {');
  assert.ok(start > 0, 'inserted after the last member, at member indentation');
  const end = text.indexOf('\n\t\t\t}', start) + '\n\t\t\t}'.length;
  assert.equal(text.slice(0, start) + text.slice(end), before);
  assert.match(text, /this comment must survive/);
  const cfg = parseJsonc(text);
  assert.deepEqual(cfg.env['acme-staging'].previews, derivePreviewsBlock(profile(), 'staging'));
  assert.ok(!('previews' in cfg.env.acme), 'production untouched');
  assert.ok(!('previews' in cfg.env.staging), 'legacy staging untouched');
});

test('setPreviewsBlockText is idempotent and repairs a drifted block in place', () => {
  const once = setPreviewsBlockText(previewsWranglerText(), 'acme', profile()).text;
  const twice = setPreviewsBlockText(once, 'acme', profile());
  assert.equal(twice.changed, false);
  assert.equal(twice.text, once);
  const drifted = once.replace('"database_id": "aaaa-staging"\n', '"database_id": "WRONG"\n');
  assert.notEqual(drifted, once);
  const repaired = setPreviewsBlockText(drifted, 'acme', profile());
  assert.ok(repaired.existed);
  assert.equal(repaired.text, once);
});

test('setPreviewsBlockText refuses a label with no staging block', () => {
  assert.throws(() => setPreviewsBlockText(previewsWranglerText(), 'nope', profile()), /env\.nope-staging not found/);
});

test('checkPreviewsBlock is clean for a freshly written block', () => {
  const cfg = parseJsonc(setPreviewsBlockText(previewsWranglerText(), 'acme', profile()).text);
  assert.deepEqual(checkPreviewsBlock(profile(), 'staging', cfg.env['acme-staging'].previews), []);
  assert.deepEqual(checkPreviewsBlock(profile(), 'production', cfg.env.acme.previews), []);
});

test('checkPreviewsBlock fails naming the previews field when a profile binding changes', () => {
  const cfg = parseJsonc(setPreviewsBlockText(previewsWranglerText(), 'acme', profile()).text);
  const p = profile();
  p.environments.staging.d1.id = 'bbbb-new-staging'; // changed, not regenerated
  const problems = checkPreviewsBlock(p, 'staging', cfg.env['acme-staging'].previews);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].path, 'previews.d1_databases[0].database_id');
  assert.equal(problems[0].expected, 'bbbb-new-staging');
  assert.equal(problems[0].actual, 'aaaa-staging');
});

test('checkPreviewsBlock flags a missing staging block, a stray cron, and any production block', () => {
  assert.equal(checkPreviewsBlock(profile(), 'staging', undefined)[0].reason, 'missing previews block');
  const withCron = { ...derivePreviewsBlock(profile(), 'staging'), triggers: { crons: ['0 6 * * *'] } };
  const stray = checkPreviewsBlock(profile(), 'staging', withCron);
  assert.equal(stray.length, 1);
  assert.equal(stray[0].path, 'previews.triggers');
  assert.equal(stray[0].reason, 'unexpected field');
  const prod = checkPreviewsBlock(profile(), 'production', {});
  assert.equal(prod.length, 1);
  assert.match(prod[0].reason, /production/);
});

test('diffPaths reports array length and nested value drift by path', () => {
  assert.deepEqual(diffPaths({ a: [1, 2] }, { a: [1] }, 'x'), [{ path: 'x.a[1]', expected: 2, actual: undefined }]);
  assert.deepEqual(diffPaths({ a: { b: 'c' } }, { a: { b: 'c' } }), []);
});
