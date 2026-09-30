/**
 * Pure tests for the label provisioning helpers.
 * No Cloudflare commands are executed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseArgs,
  pagesProductionBranch,
  updateProfileResourceIds,
  setProfileCustomDomain,
  buildProvisionPlan,
  generateSecretValue,
  renderCommand,
  isPlaceholder,
  wranglerEnvName,
  externalSecretNames,
  secretAction,
  previewSecretFixCommand,
} from './provision-label.mjs';

const profileText = `/** profile comment */
{
  "label": "acme",
  "environments": {
    "staging": {
      "apiHost": "api-acme-staging.<acct>.workers.dev",
      "d1": { "name": "acme-db-staging", "id": "<fill after create>" },
      "kv": { "binding": "RATE_LIMIT_KV", "id": "<fill after create>" },
      "r2": { "bucket": "acme-media-staging", "s3Endpoint": "https://<acct>.r2.cloudflarestorage.com" }
    },
    "production": {
      "apiHost": "api.acme.app",
      "d1": { "name": "acme-db", "id": "<fill after create>" },
      "kv": { "binding": "RATE_LIMIT_KV", "id": "<fill after create>" },
      "r2": { "bucket": "acme-media", "s3Endpoint": "https://<acct>.r2.cloudflarestorage.com" }
    }
  }
}`;

/** A profile complete enough for buildProvisionPlan (which derives CORS origins). */
const planProfile = {
  label: 'acme',
  brand: {},
  environments: {
    staging: {
      apiHost: 'api-acme-staging.sub.workers.dev',
      webOrigin: 'acme-web-staging.pages.dev',
      worker: 'api-acme-staging',
      pagesProject: 'acme-web-staging',
      d1: { name: 'acme-db-staging', id: 'id-1' },
      kv: { binding: 'RATE_LIMIT_KV', id: 'id-2' },
      r2: { bucket: 'acme-media-staging', s3Endpoint: 'https://acct.r2.cloudflarestorage.com' },
      cookieSameSite: 'None',
      mail: { driver: 'resend', from: 'Acme <no@acme.app>' },
    },
    production: {
      apiHost: 'api.acme.app',
      webOrigin: 'app.acme.app',
      worker: 'api-acme',
      pagesProject: 'acme-web',
      d1: { name: 'acme-db', id: 'id-3' },
      kv: { binding: 'RATE_LIMIT_KV', id: 'id-4' },
      r2: { bucket: 'acme-media', s3Endpoint: 'https://acct.r2.cloudflarestorage.com' },
      cookieSameSite: 'Strict',
      mail: { driver: 'resend', from: 'Acme <no@acme.app>' },
    },
  },
};

const planIds = (env, options) => buildProvisionPlan(planProfile, env, options).map((s) => s.id);

// ── parseArgs ────────────────────────────────────────────────────────────────

test('parseArgs defaults to staging-only provisioning with no opt-ins', () => {
  assert.deepEqual(parseArgs(['acme']), {
    label: 'acme',
    production: false,
    yes: false,
    dryRun: false,
    withDomain: false,
    only: 'all',
  });
});

test('parseArgs requires an explicit production flag', () => {
  assert.equal(parseArgs(['acme', '--production', '--yes']).production, true);
  assert.equal(parseArgs(['acme', '--production', '--yes']).yes, true);
});

test('parseArgs reads --with-domain and --only', () => {
  assert.equal(parseArgs(['acme', '--with-domain']).withDomain, true);
  assert.equal(parseArgs(['acme', '--only', 'cors']).only, 'cors');
});

test('parseArgs rejects an unknown --only step', () => {
  assert.throws(() => parseArgs(['acme', '--only', 'bogus']), /--only must be one of/);
});

test('Pages projects use the repository branch convention', () => {
  assert.equal(pagesProductionBranch('staging'), 'develop');
  assert.equal(pagesProductionBranch('production'), 'main');
});

test('wranglerEnvName mirrors the deploy core convention', () => {
  assert.equal(wranglerEnvName('acme', 'staging'), 'acme-staging');
  assert.equal(wranglerEnvName('acme', 'production'), 'acme');
});

// ── profile text surgery ─────────────────────────────────────────────────────

test('updateProfileResourceIds changes only the selected environment', () => {
  const next = updateProfileResourceIds(profileText, 'staging', {
    d1Id: '11111111-1111-4111-8111-111111111111',
    kvId: '22222222222222222222222222222222',
    s3Endpoint: 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.r2.cloudflarestorage.com',
  });

  assert.match(next, /"staging"[\s\S]*11111111-1111-4111-8111-111111111111/);
  assert.match(next, /"staging"[\s\S]*22222222222222222222222222222222/);
  assert.match(next, /https:\/\/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\.r2\.cloudflarestorage\.com/);
  assert.match(next, /"production"[\s\S]*<fill after create>/);
  assert.match(next, /profile comment/);
});

test('updateProfileResourceIds resolves the <acct> apiHost placeholder in one env only', () => {
  const next = updateProfileResourceIds(profileText, 'staging', {
    apiHost: 'api-acme-staging.sub.workers.dev',
  });

  assert.match(next, /"apiHost": "api-acme-staging\.sub\.workers\.dev"/);
  assert.doesNotMatch(next, /api-acme-staging\.<acct>\.workers\.dev/);
  // The production host is operator-chosen and must survive untouched.
  assert.match(next, /"apiHost": "api\.acme\.app"/);
  assert.match(next, /profile comment/);
});

test('setProfileCustomDomain inserts the flag under apiHost, then updates in place', () => {
  const once = setProfileCustomDomain(profileText, 'production', true);
  assert.match(once, /"apiHost": "api\.acme\.app",\s*\n\s*"customDomain": true,/);
  // Staging must not gain the flag.
  assert.doesNotMatch(once.split('"production"')[0], /customDomain/);

  const twice = setProfileCustomDomain(once, 'production', true);
  assert.equal((twice.match(/customDomain/g) || []).length, 1);
});

// ── secrets ──────────────────────────────────────────────────────────────────

test('generateSecretValue returns 32 random bytes as hex', () => {
  const value = generateSecretValue();
  assert.match(value, /^[0-9a-f]{64}$/);
  // JwtAuthAdapter refuses a secret shorter than 32 characters.
  assert.ok(value.length >= 32);
  assert.notEqual(value, generateSecretValue());
});

// ── the plan ─────────────────────────────────────────────────────────────────

test('buildProvisionPlan orders data plane before backend', () => {
  const ids = planIds('staging');
  assert.deepEqual(ids, [
    'd1', 'kv', 'r2', 'subdomain', 'profile', 'cors', 'pages', 'secrets', 'worker',
  ]);
});

test('buildProvisionPlan writes the profile before any --env command', () => {
  const ids = planIds('staging');
  // wrangler resolves the target script name from the generated env block.
  assert.ok(ids.indexOf('profile') < ids.indexOf('secrets'));
  assert.ok(ids.indexOf('profile') < ids.indexOf('worker'));
});

test('buildProvisionPlan sets secrets before the first deploy', () => {
  // Reverse order would leave a live Worker 500ing without a JWT_SECRET.
  const ids = planIds('staging');
  assert.ok(ids.indexOf('secrets') < ids.indexOf('worker'));
});

test('buildProvisionPlan omits the domain step unless it is opted into', () => {
  assert.ok(!planIds('production').includes('domain'));
  assert.ok(planIds('production', { withDomain: true }).includes('domain'));
});

test('buildProvisionPlan --only narrows to a single step', () => {
  assert.deepEqual(planIds('staging', { only: 'cors' }), ['cors']);
  assert.deepEqual(planIds('staging', { only: 'worker' }), ['worker']);
});

test('the plan never passes --name together with --env', () => {
  // wrangler derives `<name>-<env>` when both are present, which would target
  // a Worker that does not exist.
  for (const step of buildProvisionPlan(planProfile, 'staging', { withDomain: true })) {
    for (const argv of step.commands) {
      if (argv.includes('--env')) assert.ok(!argv.includes('--name'), renderCommand(argv));
    }
  }
});

test('the plan CORS command carries the origins derived from webOrigin', () => {
  const cors = buildProvisionPlan(planProfile, 'production').find((s) => s.id === 'cors');
  assert.match(cors.note, /https:\/\/app\.acme\.app/);
  assert.doesNotMatch(cors.note, /\*/); // production is exact-origin only
});

test('no planned command line can carry a secret value', () => {
  for (const env of ['staging', 'production']) {
    for (const step of buildProvisionPlan(planProfile, env, { withDomain: true })) {
      for (const argv of step.commands) {
        const line = renderCommand(argv);
        assert.doesNotMatch(line, /[0-9a-f]{64}/, `secret-shaped token in: ${line}`);
      }
    }
  }
});

test('the secret list command uses --format json, never --json', () => {
  const secrets = buildProvisionPlan(planProfile, 'staging').find((s) => s.id === 'secrets');
  const list = secrets.commands.find((argv) => argv.includes('list'));
  assert.ok(list.includes('--format'));
  assert.ok(list.includes('json'));
  assert.ok(!list.includes('--json'), 'wrangler secret list has no --json flag');
});

test('the worker step goes through the deploy CLI, not a bare wrangler deploy', () => {
  const worker = buildProvisionPlan(planProfile, 'staging').find((s) => s.id === 'worker');
  const line = renderCommand(worker.commands[0]);
  assert.match(line, /scripts\/cloudflare\/deploy\.mjs/);
  assert.match(line, /--scope api/);
});

// ── Preview base-config secrets (RFC 0021) ──────────────────────────────────

const schema = {
  'api-secrets': {
    JWT_SECRET: { required: true },
    R2_ACCESS_KEY_ID: { required: true },
    R2_SECRET_ACCESS_KEY: { required: true },
    GOOGLE_CLIENT_SECRET: { required: true },
    RESEND_API_KEY: { required: false, requiredWhen: 'MAIL_DRIVER=resend' },
  },
};
const previewCommands = (env) => buildProvisionPlan(planProfile, env)
  .find((s) => s.id === 'secrets').commands
  .filter((argv) => argv.includes('preview'));

test('the staging secrets group lists, then sets, JWT_SECRET on the Preview base config', () => {
  const lines = previewCommands('staging').map(renderCommand);
  assert.deepEqual(lines, [
    'pnpm --filter api exec wrangler preview base-config secret list --env acme-staging --json',
    'pnpm --filter api exec wrangler preview base-config secret put JWT_SECRET --env acme-staging',
  ]);
});

test('production never touches the Preview base config', () => {
  assert.deepEqual(previewCommands('production'), []);
});

test('--only secrets carries the preview commands and nothing else', () => {
  const plan = buildProvisionPlan(planProfile, 'staging', { only: 'secrets' });
  assert.deepEqual(plan.map((s) => s.id), ['secrets']);
  assert.ok(plan[0].commands.some((argv) => argv.includes('base-config')));
});

test('the preview put command carries no value — it is read from stdin', () => {
  const put = previewCommands('staging').find((argv) => argv.includes('put'));
  assert.equal(put[put.length - 3], 'JWT_SECRET', 'the key is the last positional before --env');
  assert.deepEqual(put.slice(-2), ['--env', 'acme-staging']);
});

test('the dry-run note names the external secrets for the Worker and the Preview base config', () => {
  const step = buildProvisionPlan(planProfile, 'staging', { schema }).find((s) => s.id === 'secrets');
  assert.match(step.note, /R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, GOOGLE_CLIENT_SECRET, RESEND_API_KEY/);
  assert.match(step.note, /Preview base config/);
  assert.doesNotMatch(step.note, /[0-9a-f]{64}/);
});

test('externalSecretNames excludes JWT_SECRET and gates RESEND_API_KEY on the mail driver', () => {
  assert.deepEqual(externalSecretNames(schema, planProfile, 'staging'),
    ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'GOOGLE_CLIENT_SECRET', 'RESEND_API_KEY']);
  const consoleMail = structuredClone(planProfile);
  consoleMail.environments.staging.mail.driver = 'console';
  assert.ok(!externalSecretNames(schema, consoleMail, 'staging').includes('RESEND_API_KEY'));
});

test('secretAction never overwrites an existing secret and never reads a failed list as absent', () => {
  assert.equal(secretAction(['JWT_SECRET', 'R2_ACCESS_KEY_ID'], 'JWT_SECRET'), 'keep');
  assert.equal(secretAction([], 'JWT_SECRET'), 'put');
  assert.equal(secretAction(null, 'JWT_SECRET'), 'unknown');
});

test('previewSecretFixCommand points at the Preview base config, not the Worker', () => {
  assert.equal(
    previewSecretFixCommand('GOOGLE_CLIENT_SECRET', 'acme-staging'),
    'pnpm --filter api exec wrangler preview base-config secret put GOOGLE_CLIENT_SECRET --env acme-staging',
  );
});

// ── misc ─────────────────────────────────────────────────────────────────────

test('isPlaceholder recognises the <fill …> convention', () => {
  assert.ok(isPlaceholder('<fill after create>'));
  assert.ok(isPlaceholder('https://<acct>.r2.cloudflarestorage.com'));
  assert.ok(isPlaceholder(''));
  assert.ok(!isPlaceholder('api.acme.app'));
});
