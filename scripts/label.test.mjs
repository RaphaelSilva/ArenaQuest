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
