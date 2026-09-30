/**
 * Unit tests for the Cloudflare adapter of the deploy CLI — the wrangler
 * command mapping, the ONE place each wrangler output shape is parsed, and the
 * preview execution order. Wrangler is stubbed: no network, no credentials.
 * Run with: node --test scripts/cloudflare/deploy.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseJsonc, derivePreview } from '../label.mjs';
import { resolve, buildPreviewPlan, buildPreviewDeletePlan } from '../deploy/core.mjs';
import {
  PLACEHOLDER,
  branchDeploymentIds,
  executePlan,
  parsePreviewUrl,
  previewSecretValues,
  reportLines,
  stepToCommand,
  summaryMarkdown,
} from './deploy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const profile = () => parseJsonc(readFileSync(join(HERE, '..', 'fixtures', 'good-profile.jsonc'), 'utf8'));

/**
 * `wrangler preview --json` as wrangler 4.144 prints it: `runPreview`
 * (src/preview/preview.ts, bundled in wrangler-dist/cli.js) logs
 * `JSON.stringify({ preview, deployment }, null, 2)` — no banner under --json.
 * Field values are illustrative; the shape is what the parser relies on.
 */
const PREVIEW_JSON = `{
  "preview": {
    "id": "2f1c7a0e-6b1d-4c55-9c0a-3f1b2d4e5a6b",
    "name": "m21",
    "slug": "m21",
    "urls": [
      "https://m21-api-acme-staging.acct.workers.dev"
    ],
    "created_on": "2026-09-30T12:00:00.000Z"
  },
  "deployment": {
    "id": "8d3e2c1b-0a9f-4e8d-7c6b-5a4f3e2d1c0b",
    "urls": [
      "https://8d3e2c1b-api-acme-staging.acct.workers.dev"
    ],
    "env": {
      "DB": { "type": "d1", "id": "aaaa-staging" }
    }
  }
}
`;

/** `wrangler pages deployment list --json` (src/pages/deployments.ts): an array of display rows. */
const PAGES_LIST_JSON = JSON.stringify([
  { Id: 'd-1', Environment: 'Preview', Branch: 'm21', Source: 'abc1234', Deployment: 'https://d-1.acme-web-staging.pages.dev', Status: '1 hour ago', Build: 'x' },
  { Id: 'd-2', Environment: 'Preview', Branch: 'm22', Source: 'abc1234', Deployment: 'https://d-2.acme-web-staging.pages.dev', Status: '1 hour ago', Build: 'x' },
  { Id: 'd-3', Environment: 'Preview', Branch: 'm21', Source: 'def5678', Deployment: 'https://d-3.acme-web-staging.pages.dev', Status: '2 hours ago', Build: 'x' },
  { Id: 'd-4', Environment: 'Production', Branch: 'm21', Source: 'def5678', Deployment: 'https://d-4.acme-web-staging.pages.dev', Status: '2 hours ago', Build: 'x' },
], null, 2);

const BOOKMARK_JSON = '{\n  "bookmark": "0000007b-00000002-00004f6d-a3c2c1f7a0b5e3f2",\n  "timestamp": "2026-09-30T12:00:00Z"\n}\n';

// ── parsePreviewUrl ───────────────────────────────────────────────────────────
test('parsePreviewUrl takes preview.urls[0] (the stable preview URL), not the deployment URL', () => {
  assert.equal(parsePreviewUrl(PREVIEW_JSON), 'https://m21-api-acme-staging.acct.workers.dev');
});

test('parsePreviewUrl tolerates lines before and after the JSON', () => {
  const noisy = `▲ [WARNING] something on stdout\n${PREVIEW_JSON}\nsuggested next steps…\n`;
  assert.equal(parsePreviewUrl(noisy), 'https://m21-api-acme-staging.acct.workers.dev');
});

test('parsePreviewUrl fails loudly, with the raw output, on anything else', () => {
  assert.throws(() => parsePreviewUrl('Preview: m21 (new)\nPreview URL: https://x.workers.dev'), /printed no JSON[\s\S]*Preview URL/);
  assert.throws(() => parsePreviewUrl('{ "preview": { "urls": [] }, "deployment": {} }'), /no preview\.urls\[0\]/);
  assert.throws(() => parsePreviewUrl('{ "preview": { "urls": ["http://x.dev"] } }'), /no preview\.urls\[0\] https URL/);
  assert.throws(() => parsePreviewUrl('{ "urls": ["https://x.dev"] }'), /no preview\.urls\[0\]/);
  assert.throws(() => parsePreviewUrl('{ not json'), /invalid JSON/);
});

// ── branchDeploymentIds ──────────────────────────────────────────────────────
test('branchDeploymentIds returns only PREVIEW deployments of the branch', () => {
  assert.deepEqual(branchDeploymentIds(PAGES_LIST_JSON, 'm21'), ['d-1', 'd-3']);
  assert.deepEqual(branchDeploymentIds(PAGES_LIST_JSON, 'm99'), []);
  assert.deepEqual(branchDeploymentIds('[]', 'm21'), []);
  assert.throws(() => branchDeploymentIds('nothing', 'm21'), /printed no JSON/);
});

// ── command mapping ──────────────────────────────────────────────────────────
function plan(scope = 'all', extra = {}) {
  const p = profile();
  const { resolved, envConfig } = resolve(p, 'staging');
  return buildPreviewPlan({
    label: 'acme', scope, resolved, envConfig, preview: derivePreview(p, 'm21'), commitSha: 'abc1234', ...extra,
  });
}
const cmdOf = (kind, ctx) => stepToCommand(plan().find((s) => s.kind === kind), ctx);

test('stepToCommand maps the preview steps to wrangler preview / pages deploy --branch', () => {
  assert.deepEqual(cmdOf('lint-migrations').argv, ['node', 'scripts/db/check-migrations.mjs', '--base', 'origin/main']);
  assert.deepEqual(cmdOf('bookmark').argv.slice(5), ['d1', 'time-travel', 'info', 'acme-db-staging', '--env', 'acme-staging', '--json']);
  assert.deepEqual(cmdOf('deploy-worker-preview').argv.slice(5), [
    'preview', '--env', 'acme-staging', '--name', 'm21', '--message', 'abc1234', '--json',
    '--secrets-file', PLACEHOLDER.secretsFile,
  ]);
  const pages = cmdOf('deploy-pages-branch').argv;
  assert.ok(pages.includes('--project-name=acme-web-staging'));
  assert.ok(pages.includes('--branch=m21'));
  assert.equal(stepToCommand(plan().at(-1)), null, 'report is not a command');
});

test('stepToCommand never maps a preview plan to `wrangler deploy` or a branch-less pages deploy', () => {
  for (const step of plan()) {
    const c = stepToCommand(step);
    if (!c) continue;
    const line = c.argv.join(' ');
    assert.ok(!/wrangler deploy\b/.test(line), line);
    if (/pages deploy/.test(line)) assert.ok(/--branch=m21/.test(line), line);
  }
});

test('build-web gets the captured API URL, or a placeholder in a dry run', () => {
  assert.equal(cmdOf('build-web').env.NEXT_PUBLIC_API_URL, PLACEHOLDER.apiUrl);
  const c = cmdOf('build-web', { apiUrl: 'https://m21-api.acct.workers.dev' });
  assert.equal(c.env.NEXT_PUBLIC_API_URL, 'https://m21-api.acct.workers.dev');
  assert.equal(c.env.NEXT_PUBLIC_SITE_URL, 'https://m21.acme-web-staging.pages.dev');
  assert.equal(c.env.NEXT_PUBLIC_PREVIEW_NAME, 'm21');
  assert.equal(c.env.NEXT_PUBLIC_PREVIEW_SHA, 'abc1234');
  const webOnly = stepToCommand(plan('web', { apiUrl: 'https://given.dev' }).find((s) => s.kind === 'build-web'));
  assert.equal(webOnly.env.NEXT_PUBLIC_API_URL, 'https://given.dev');
});

test('delete steps map to wrangler preview delete and a pages deployment listing', () => {
  const p = profile();
  const { envConfig } = resolve(p, 'staging');
  const [worker, pages] = buildPreviewDeletePlan({ label: 'acme', scope: 'all', envConfig, preview: derivePreview(p, 'm21') });
  assert.deepEqual(stepToCommand(worker).argv.slice(5), ['preview', 'delete', '--env', 'acme-staging', '--name', 'm21', '--skip-confirmation']);
  assert.deepEqual(stepToCommand(pages).argv.slice(5), [
    'pages', 'deployment', 'list', '--project-name=acme-web-staging', '--environment=preview', '--json',
  ]);
});

test('report lines and summary carry both URLs, the bookmark and its restore command', () => {
  const report = plan().at(-1);
  const ctx = { apiUrl: 'https://m21-api.acct.workers.dev', bookmark: 'bm-1' };
  const lines = Object.fromEntries(reportLines(report, ctx));
  assert.equal(lines['Web preview'], 'https://m21.acme-web-staging.pages.dev');
  assert.equal(lines['API preview'], 'https://m21-api.acct.workers.dev');
  assert.match(lines['D1 bookmark'], /^bm-1 /);
  assert.equal(lines.Restore, 'pnpm --filter api exec wrangler d1 time-travel restore acme-db-staging --bookmark=bm-1 --env acme-staging');
  const md = summaryMarkdown(report, ctx);
  assert.match(md, /### Preview `m21` — acme/);
  assert.match(md, /\| Web preview \| https:\/\/m21\.acme-web-staging\.pages\.dev \|/);
  assert.match(md, /\| API preview \| https:\/\/m21-api\.acct\.workers\.dev \|/);
});

// ── execution (stubbed wrangler) ─────────────────────────────────────────────
function stubRunner(outputs = {}) {
  const calls = [];
  const runner = (c, env) => {
    calls.push({ argv: c.argv, env });
    const line = c.argv.join(' ');
    for (const [pattern, result] of Object.entries(outputs)) {
      if (line.includes(pattern)) return typeof result === 'function' ? result(calls) : result;
    }
    return { status: 0, stdout: '' };
  };
  return { runner, calls };
}

const quiet = async (fn) => {
  const log = console.log;
  const error = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.error = error;
  }
};

test('executePlan runs the preview in order, captures bookmark + URL, builds the web with that URL', async () => {
  const { runner, calls } = stubRunner({
    'time-travel info': { status: 0, stdout: BOOKMARK_JSON },
    'wrangler preview': { status: 0, stdout: PREVIEW_JSON },
  });
  const summary = [];
  const ctx = await quiet(() =>
    executePlan(plan(), { runner, baseEnv: {}, summaryFile: 'S', append: (f, text) => summary.push([f, text]) }),
  );
  assert.equal(ctx.apiUrl, 'https://m21-api-acme-staging.acct.workers.dev');
  assert.equal(ctx.bookmark, '0000007b-00000002-00004f6d-a3c2c1f7a0b5e3f2');
  const order = calls.map((c) => c.argv.join(' '));
  const at = (s) => order.findIndex((l) => l.includes(s));
  assert.ok(at('check-migrations') < at('time-travel info'));
  assert.ok(at('time-travel info') < at('migrations apply'));
  assert.ok(at('migrations apply') < at('wrangler preview'));
  assert.ok(at('wrangler preview') < at('pages:build'));
  assert.ok(at('pages:build') < at('pages deploy'));
  const build = calls.find((c) => c.argv.includes('pages:build'));
  assert.equal(build.env.NEXT_PUBLIC_API_URL, 'https://m21-api-acme-staging.acct.workers.dev');
  assert.equal(summary.length, 1);
  assert.equal(summary[0][0], 'S');
  assert.match(summary[0][1], /time-travel restore acme-db-staging --bookmark=0000007b/);
});

test('previewSecretValues: generated names get a fresh value, external ones come from AQ_PREVIEW_<NAME>', () => {
  const spec = { generated: ['JWT_SECRET'], external: ['R2_ACCESS_KEY_ID', 'GOOGLE_CLIENT_SECRET'] };
  const { values, missing } = previewSecretValues(spec, { AQ_PREVIEW_R2_ACCESS_KEY_ID: 'rk', R2_ACCESS_KEY_ID: 'not-this' }, () => 'g');
  assert.deepEqual(values, { JWT_SECRET: 'g', R2_ACCESS_KEY_ID: 'rk' });
  assert.deepEqual(missing, ['GOOGLE_CLIENT_SECRET']);
  const real = previewSecretValues(spec, {}).values.JWT_SECRET;
  assert.match(real, /^[0-9a-f]{64}$/);
});

test('the worker preview gets a 0600 secrets file that holds the values and is removed afterwards', async () => {
  const p = profile();
  const { resolved, envConfig } = resolve(p, 'staging');
  const withSecrets = buildPreviewPlan({
    label: 'acme', scope: 'api', resolved, envConfig, preview: derivePreview(p, 'm21'),
    secrets: { generated: ['JWT_SECRET'], external: ['R2_ACCESS_KEY_ID', 'GOOGLE_CLIENT_SECRET'] },
  });
  let seen = null;
  const { runner, calls } = stubRunner({
    'time-travel info': { status: 0, stdout: BOOKMARK_JSON },
    'wrangler preview': (all) => {
      const argv = all.at(-1).argv;
      const path = argv[argv.indexOf('--secrets-file') + 1];
      seen = { path, mode: statSync(path).mode & 0o777, content: JSON.parse(readFileSync(path, 'utf8')) };
      return { status: 0, stdout: PREVIEW_JSON };
    },
  });
  const printed = [];
  const log = console.log;
  console.log = (...a) => printed.push(a.join(' '));
  try {
    executePlan(withSecrets, { runner, baseEnv: { AQ_PREVIEW_R2_ACCESS_KEY_ID: 'r2-key-value' } });
  } finally {
    console.log = log;
  }
  assert.equal(seen.mode, 0o600);
  assert.match(seen.content.JWT_SECRET, /^[0-9a-f]{64}$/);
  assert.equal(seen.content.R2_ACCESS_KEY_ID, 'r2-key-value');
  assert.ok(!('GOOGLE_CLIENT_SECRET' in seen.content));
  assert.ok(!existsSync(seen.path), 'removed once wrangler is done');
  const output = printed.join('\n');
  assert.ok(!output.includes(seen.content.JWT_SECRET) && !output.includes('r2-key-value'), 'no value is logged');
  assert.match(output, /GOOGLE_CLIENT_SECRET not passed to the preview .*Google sign-in is off/);
  const argv = calls.find((c) => c.argv.includes('--secrets-file')).argv.join(' ');
  assert.ok(!argv.includes('r2-key-value'), 'no value in argv');
});

test('the secrets file is removed even when wrangler preview fails', async () => {
  let path = null;
  const { runner } = stubRunner({
    'time-travel info': { status: 0, stdout: BOOKMARK_JSON },
    'wrangler preview': (all) => {
      const argv = all.at(-1).argv;
      path = argv[argv.indexOf('--secrets-file') + 1];
      return { status: 1, stdout: '' };
    },
  });
  const p = profile();
  const { resolved, envConfig } = resolve(p, 'staging');
  const withSecrets = buildPreviewPlan({
    label: 'acme', scope: 'api', resolved, envConfig, preview: derivePreview(p, 'm21'),
    secrets: { generated: ['JWT_SECRET'], external: [] },
  });
  await quiet(() => assert.throws(() => executePlan(withSecrets, { runner, baseEnv: {} })));
  assert.ok(path && !existsSync(path));
});

test('a failing migration lint stops the run before the bookmark and the migrate', async () => {
  const { runner, calls } = stubRunner({ 'check-migrations': { status: 1, stdout: '' } });
  await quiet(() =>
    assert.throws(() => executePlan(plan(), { runner, baseEnv: {} }), /Lint new migrations[\s\S]*failed \(exit 1\)/),
  );
  assert.equal(calls.length, 1);
});

test('no bookmark → nothing is migrated', async () => {
  const { runner, calls } = stubRunner({ 'time-travel info': { status: 0, stdout: 'no json here' } });
  await quiet(() => assert.throws(() => executePlan(plan(), { runner, baseEnv: {} }), /aborted before migrating/));
  assert.ok(!calls.some((c) => c.argv.includes('apply')));
});

test('a failure after the bookmark names the restore command', async () => {
  const { runner } = stubRunner({
    'time-travel info': { status: 0, stdout: BOOKMARK_JSON },
    'wrangler preview': { status: 0, stdout: 'not json' },
  });
  await quiet(() =>
    assert.throws(
      () => executePlan(plan(), { runner, baseEnv: {} }),
      /printed no JSON[\s\S]*restore the pre-preview data with: .*time-travel restore acme-db-staging --bookmark=0000007b/,
    ),
  );
});

test('delete: removes the worker preview, then every preview deployment of the branch until none is listed', async () => {
  const p = profile();
  const { envConfig } = resolve(p, 'staging');
  const deletePlan = buildPreviewDeletePlan({ label: 'acme', scope: 'all', envConfig, preview: derivePreview(p, 'm21') });
  let listings = 0;
  const { runner, calls } = stubRunner({
    'deployment list': () => ({ status: 0, stdout: listings++ === 0 ? PAGES_LIST_JSON : '[]' }),
  });
  await quiet(() => executePlan(deletePlan, { runner, baseEnv: {} }));
  const lines = calls.map((c) => c.argv.join(' '));
  assert.match(lines[0], /wrangler preview delete --env acme-staging --name m21 --skip-confirmation/);
  const deleted = lines.filter((l) => l.includes('deployment delete')).map((l) => l.split(' ')[8]);
  assert.deepEqual(deleted, ['d-1', 'd-3'], 'only m21 preview deployments, never Production');
  assert.ok(lines.every((l) => !l.includes('deployment delete') || l.endsWith('--force')));
  assert.equal(listings, 2);
});
