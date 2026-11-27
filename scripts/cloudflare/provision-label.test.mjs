/**
 * Pure tests for the label provisioning helpers.
 * No Cloudflare commands are executed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  backupLifecycleRules,
  renderLifecycleFile,
  parseLifecycleList,
  lifecycleMatches,
  ensureBackupBucket,
  ensureBackupLifecycle,
  buildCheckPlan,
  checkProbes,
  runCheck,
  checkResults,
  committedEnvVars,
  paymentWebhookReminders,
  formatReminders,
  formatKeyMode,
  declaredPaymentsKeyMode,
} from './provision-label.mjs';
import { mapExitCode, formatChecklist, parseJsonc, PATHS } from '../label.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

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
      backup: { bucket: 'acme-backups', retention: { dailyDays: 35, monthlyMonths: 12, tombstoneDays: 90 } },
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
    env: null,
    check: false,
    json: false,
  });
});

test('parseArgs takes --label as an alias of the positional label', () => {
  assert.equal(parseArgs(['--label', 'acme']).label, 'acme');
  assert.throws(() => parseArgs(['acme', '--label', 'other']), /unexpected argument: other/);
  assert.throws(() => parseArgs(['--label', '--check']), /--label needs a value/);
});

test('parseArgs reads -e/--env as a single target environment', () => {
  assert.equal(parseArgs(['acme', '-e', 'production']).env, 'production');
  assert.equal(parseArgs(['acme', '--env', 'staging']).env, 'staging');
  assert.throws(() => parseArgs(['acme', '-e', 'dev']), /-e must be one of: staging, production/);
  assert.throws(() => parseArgs(['acme', '-e', 'production', '--production']), /mutually exclusive/);
});

test('parseArgs accepts --check with --json and refuses every provisioning knob next to it', () => {
  const args = parseArgs(['--label', 'acme', '-e', 'production', '--check', '--json']);
  assert.equal(args.check, true);
  assert.equal(args.json, true);
  assert.equal(args.env, 'production');
  for (const flag of [['--dry-run'], ['--only', 'cors'], ['--with-domain'], ['--yes'], ['--production']]) {
    assert.throws(() => parseArgs(['acme', '--check', ...flag]), /--check is read-only and cannot be combined with/, flag.join(' '));
  }
  assert.throws(() => parseArgs(['acme', '--json']), /--json is only valid together with --check/);
});

test('parseArgs accepts --only backup', () => {
  assert.equal(parseArgs(['acme', '--only', 'backup']).only, 'backup');
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

// ── backup bucket (RFC 0025, M28 Task 01) ───────────────────────────────────

test('the plan carries a backup step for production, right after the media bucket', () => {
  const ids = planIds('production');
  assert.ok(ids.includes('backup'));
  assert.equal(ids.indexOf('backup'), ids.indexOf('r2') + 1);
  assert.ok(ids.indexOf('backup') < ids.indexOf('profile'));
});

test('the plan carries no backup step for staging (disposable)', () => {
  assert.ok(!planIds('staging').includes('backup'));
  assert.deepEqual(planIds('staging', { only: 'backup' }), []);
});

test('the backup step lists, creates, then lists and sets the lifecycle rules of <label>-backups', () => {
  const step = buildProvisionPlan(planProfile, 'production').find((s) => s.id === 'backup');
  assert.match(step.title, /acme-backups/);
  const lines = step.commands.map(renderCommand);
  assert.equal(lines[0], 'pnpm --filter api exec wrangler r2 bucket list');
  assert.equal(lines[1], 'pnpm --filter api exec wrangler r2 bucket create acme-backups');
  assert.equal(lines[2], 'pnpm --filter api exec wrangler r2 bucket lifecycle list acme-backups');
  assert.match(lines[3], /^pnpm --filter api exec wrangler r2 bucket lifecycle set acme-backups --file \S+aq-backup-lifecycle-acme-production\.json -y$/);
  assert.match(step.note, /production only/);
  assert.match(step.note, /d1-daily: d1\/production\/daily\/ expires after 35 days/);
  assert.match(step.note, /d1-monthly: d1\/production\/monthly\/ expires after 365 days/);
});

test('--only backup narrows the production plan to the backup step', () => {
  assert.deepEqual(planIds('production', { only: 'backup' }), ['backup']);
});

test('backupLifecycleRules derives two disjoint-prefix expiry rules from backup.retention', () => {
  const rules = backupLifecycleRules(planProfile, 'production');
  assert.deepEqual(rules.map((r) => [r.id, r.conditions.prefix, r.deleteObjectsTransition.condition.maxAge / 86400]), [
    ['d1-daily', 'd1/production/daily/', 35],
    ['d1-monthly', 'd1/production/monthly/', 365],
  ]);
  for (const r of rules) {
    assert.equal(r.enabled, true);
    assert.equal(r.deleteObjectsTransition.condition.type, 'Age');
  }
  assert.deepEqual(backupLifecycleRules(planProfile, 'staging'), []);
});

test('renderLifecycleFile emits the { rules } document wrangler lifecycle set expects', () => {
  const doc = JSON.parse(renderLifecycleFile(backupLifecycleRules(planProfile, 'production')));
  assert.ok(Array.isArray(doc.rules));
  assert.equal(doc.rules.length, 2);
  assert.equal(doc.rules[0].deleteObjectsTransition.condition.maxAge, 35 * 86400);
});

const LIFECYCLE_LIST_OUTPUT = `Listing lifecycle rules for bucket 'acme-backups'...

name:     d1-daily
enabled:  Yes
prefix:   d1/production/daily/
action:   Expire objects after 35 days

name:     d1-monthly
enabled:  Yes
prefix:   d1/production/monthly/
action:   Expire objects after 365 days
`;

test('parseLifecycleList reads wrangler\'s labelled blocks back into rules', () => {
  const rules = parseLifecycleList(LIFECYCLE_LIST_OUTPUT);
  assert.deepEqual(rules.map((r) => [r.id, r.enabled, r.conditions.prefix, r.deleteObjectsTransition.condition.maxAge]), [
    ['d1-daily', true, 'd1/production/daily/', 35 * 86400],
    ['d1-monthly', true, 'd1/production/monthly/', 365 * 86400],
  ]);
  assert.deepEqual(parseLifecycleList("There are no lifecycle rules for bucket 'acme-backups'."), []);
  assert.deepEqual(parseLifecycleList('{"rules":[{"id":"x"}]}'), [{ id: 'x' }]);
});

test('lifecycleMatches is true only when the listed rules equal the derived set', () => {
  const rules = backupLifecycleRules(planProfile, 'production');
  assert.equal(lifecycleMatches(LIFECYCLE_LIST_OUTPUT, rules), true);
  assert.equal(lifecycleMatches(LIFECYCLE_LIST_OUTPUT.replace('35 days', '30 days'), rules), false);
  assert.equal(lifecycleMatches(LIFECYCLE_LIST_OUTPUT.split('\n\nname:     d1-monthly')[0], rules), false);
  assert.equal(lifecycleMatches('There are no lifecycle rules for bucket', rules), false);
});

/** A command runner stub: answers from a table keyed by the rendered argv, records every call. */
function stubRunner(answers) {
  const calls = [];
  const run = (argv) => {
    calls.push(argv);
    const line = renderCommand(argv);
    const key = Object.keys(answers).find((k) => line.startsWith(k));
    const answer = key ? answers[key] : { status: 1, stdout: '', output: 'stub: no answer' };
    return { status: 0, stdout: '', stderr: '', ...answer, output: answer.output ?? answer.stdout ?? '' };
  };
  return { run, calls };
}

test('re-provisioning an existing backup bucket with matching rules plans no write', () => {
  const { run, calls } = stubRunner({
    'pnpm --filter api exec wrangler r2 bucket list': { status: 0, stdout: '[{"name":"acme-media"},{"name":"acme-backups"}]' },
    'pnpm --filter api exec wrangler r2 bucket lifecycle list acme-backups': { status: 0, stdout: LIFECYCLE_LIST_OUTPUT },
  });
  ensureBackupBucket(planProfile, 'production', { run });
  ensureBackupLifecycle(planProfile, 'production', { run });
  const lines = calls.map(renderCommand);
  assert.deepEqual(lines, [
    'pnpm --filter api exec wrangler r2 bucket list',
    'pnpm --filter api exec wrangler r2 bucket lifecycle list acme-backups',
  ]);
});

test('a missing backup bucket is created and drifted rules are set from the derived file', () => {
  const { run, calls } = stubRunner({
    'pnpm --filter api exec wrangler r2 bucket list': { status: 0, stdout: '[{"name":"acme-media"}]' },
    'pnpm --filter api exec wrangler r2 bucket create acme-backups': { status: 0, stdout: 'Created bucket' },
    'pnpm --filter api exec wrangler r2 bucket lifecycle list acme-backups': { status: 0, stdout: "There are no lifecycle rules for bucket 'acme-backups'." },
    'pnpm --filter api exec wrangler r2 bucket lifecycle set acme-backups': { status: 0, stdout: 'ok' },
  });
  ensureBackupBucket(planProfile, 'production', { run });
  ensureBackupLifecycle(planProfile, 'production', { run });
  const lines = calls.map(renderCommand);
  assert.equal(lines[1], 'pnpm --filter api exec wrangler r2 bucket create acme-backups');
  assert.match(lines[3], /lifecycle set acme-backups --file \S+ -y$/);
});

test('the backup steps refuse an environment with no declared bucket', () => {
  const { run } = stubRunner({});
  assert.throws(() => ensureBackupBucket(planProfile, 'staging', { run }), /no backup bucket is declared/);
  assert.throws(() => ensureBackupLifecycle(planProfile, 'staging', { run }), /no backup bucket is declared/);
});

// ── --check (read-only) ─────────────────────────────────────────────────────

const WRITE_VERBS = ['create', 'put', 'delete', 'deploy', 'set', 'secret put', 'cors set', 'lifecycle set'];

test('buildCheckPlan probes carry no create, put, delete, deploy or set — for either environment', () => {
  for (const env of ['staging', 'production']) {
    const plan = buildCheckPlan(planProfile, env, schema);
    const probes = checkProbes(plan);
    assert.ok(probes.length >= 7, `${env}: ${probes.length} probes`);
    for (const argv of probes) {
      const line = renderCommand(argv);
      assert.ok(argv.includes('list'), `not a list: ${line}`);
      for (const verb of WRITE_VERBS) assert.ok(!line.includes(` ${verb} `) && !line.endsWith(` ${verb}`), `${verb} in: ${line}`);
    }
  }
});

test('buildCheckPlan derives its resources and fixes from the provisioning plan', () => {
  const plan = buildCheckPlan(planProfile, 'production', schema);
  assert.deepEqual(plan.resources.map((r) => [r.id, r.name]), [
    ['d1', 'acme-db'], ['kv', 'acme-rate-limit-production'], ['r2', 'acme-media'],
    ['backup', 'acme-backups'], ['pages', 'acme-web'], ['worker', 'api-acme'],
  ]);
  assert.equal(plan.fixes.d1, 'pnpm --filter api exec wrangler d1 create acme-db');
  assert.equal(plan.fixes.backup, 'pnpm --filter api exec wrangler r2 bucket create acme-backups');
  assert.match(plan.fixes.worker, /scripts\/cloudflare\/deploy\.mjs --label acme -e production --scope api/);
  assert.deepEqual(plan.secrets.worker, ['JWT_SECRET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'GOOGLE_CLIENT_SECRET', 'RESEND_API_KEY']);
  assert.deepEqual(plan.secrets.preview, []);
  assert.equal(plan.probes.preview, null);
  assert.equal(plan.fixes.JWT_SECRET, 'make set-new-label LABEL=acme ONLY=secrets PRODUCTION=1');
  assert.equal(plan.fixes.GOOGLE_CLIENT_SECRET, 'bash scripts/create-secrets.sh GOOGLE_CLIENT_SECRET --env acme');
});

test('buildCheckPlan for staging has no backup bucket and adds the Preview base-config secrets', () => {
  const plan = buildCheckPlan(planProfile, 'staging', schema);
  assert.ok(!plan.resources.some((r) => r.id === 'backup'));
  assert.deepEqual(plan.secrets.preview, plan.secrets.worker);
  assert.equal(renderCommand(plan.probes.preview), 'pnpm --filter api exec wrangler preview base-config secret list --env acme-staging --json');
  assert.equal(plan.fixes['preview:GOOGLE_CLIENT_SECRET'], previewSecretFixCommand('GOOGLE_CLIENT_SECRET', 'acme-staging'));
  assert.equal(plan.fixes['preview:JWT_SECRET'], 'make set-new-label LABEL=acme ONLY=secrets');
});

const CHECK_ANSWERS = {
  'pnpm --filter api exec wrangler d1 list --json': { status: 0, stdout: '[{"name":"acme-db","uuid":"11111111-1111-4111-8111-111111111111"}]' },
  'pnpm --filter api exec wrangler kv namespace list': { status: 0, stdout: '[{"title":"acme-rate-limit-production","id":"22222222222222222222222222222222"}]' },
  'pnpm --filter api exec wrangler r2 bucket list': { status: 0, stdout: '[{"name":"acme-media"}]' },
  'pnpm --filter web exec wrangler pages project list --json': { status: 1, stdout: '', output: 'Authentication error' },
  'pnpm --filter api exec wrangler deployments list --env acme': { status: 1, stdout: '', output: '[code: 10007] workers.api.error.script_not_found' },
  'pnpm --filter api exec wrangler secret list --env acme --format json': { status: 0, stdout: '[{"name":"JWT_SECRET","type":"secret_text"},{"name":"R2_ACCESS_KEY_ID","type":"secret_text"}]' },
};

test('runCheck executes only list commands and reports present / missing / unknown with a fix per gap', () => {
  const { run, calls } = stubRunner(CHECK_ANSWERS);
  const report = runCheck(planProfile, 'production', schema, { run });

  for (const argv of calls) assert.ok(argv.includes('list'), `--check spawned a non-list command: ${renderCommand(argv)}`);
  assert.equal(calls.length, 7);

  const byId = Object.fromEntries(report.resources.map((r) => [r.id, r]));
  assert.equal(byId.d1.present, true);
  assert.equal(byId.d1.fix, null);
  assert.equal(byId.kv.present, true);
  assert.equal(byId.r2.present, true);
  assert.equal(byId.backup.present, false);
  assert.equal(byId.backup.fix, 'pnpm --filter api exec wrangler r2 bucket create acme-backups');
  assert.equal(byId.pages.present, null, 'a failed probe is unknown, never missing');
  assert.equal(byId.pages.fix, 'pnpm --filter web exec wrangler pages project create acme-web --production-branch main');
  assert.equal(byId.worker.present, false, 'script_not_found is a definite miss');

  const byName = Object.fromEntries(report.secrets.map((s) => [s.name, s]));
  assert.equal(byName.JWT_SECRET.present, true);
  assert.equal(byName.R2_SECRET_ACCESS_KEY.present, false);
  assert.equal(byName.R2_SECRET_ACCESS_KEY.fix, 'bash scripts/create-secrets.sh R2_SECRET_ACCESS_KEY --env acme');
  assert.ok(report.secrets.every((s) => s.scope === 'worker'));
});

test('runCheck JSON shape carries names only — never a secret-shaped value', () => {
  const { run } = stubRunner(CHECK_ANSWERS);
  const report = runCheck(planProfile, 'production', schema, { run });
  assert.deepEqual(Object.keys(report), ['label', 'env', 'resources', 'secrets', 'reminders', 'keyMode']);
  assert.deepEqual(report.reminders, []);
  assert.equal(report.keyMode, null);
  assert.deepEqual(Object.keys(report.resources[0]), ['id', 'kind', 'name', 'present', 'fix']);
  assert.deepEqual(Object.keys(report.secrets[0]), ['name', 'scope', 'present', 'fix']);
  assert.doesNotMatch(JSON.stringify(report), /[0-9a-f]{64}/);
});

test('runCheck reads a failed secret list as unknown for every name', () => {
  const { run } = stubRunner({ ...CHECK_ANSWERS, 'pnpm --filter api exec wrangler secret list --env acme --format json': { status: 1, output: 'no creds' } });
  const report = runCheck(planProfile, 'production', schema, { run });
  assert.ok(report.secrets.every((s) => s.present === null));
  assert.equal(report.secrets[0].fix, 'make set-new-label LABEL=acme ONLY=secrets PRODUCTION=1');
});

test('checkResults maps the report onto the checklist exit codes: 0 present, 1 missing, 2 unknown', () => {
  const allGood = Object.fromEntries(Object.entries(CHECK_ANSWERS).map(([k, v]) => [k, v]));
  allGood['pnpm --filter api exec wrangler r2 bucket list'] = { status: 0, stdout: '[{"name":"acme-media"},{"name":"acme-backups"}]' };
  allGood['pnpm --filter web exec wrangler pages project list --json'] = { status: 0, stdout: '[{"name":"acme-web"}]' };
  allGood['pnpm --filter api exec wrangler deployments list --env acme'] = { status: 0, stdout: 'Created: ...' };
  allGood['pnpm --filter api exec wrangler secret list --env acme --format json'] = {
    status: 0,
    stdout: JSON.stringify(['JWT_SECRET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'GOOGLE_CLIENT_SECRET', 'RESEND_API_KEY'].map((name) => ({ name, type: 'secret_text' }))),
  };
  assert.equal(mapExitCode(checkResults(runCheck(planProfile, 'production', schema, { run: stubRunner(allGood).run }))), 0);

  const missing = { ...allGood, 'pnpm --filter api exec wrangler r2 bucket list': { status: 0, stdout: '[{"name":"acme-media"}]' } };
  assert.equal(mapExitCode(checkResults(runCheck(planProfile, 'production', schema, { run: stubRunner(missing).run }))), 1);

  const unknown = { ...allGood, 'pnpm --filter web exec wrangler pages project list --json': { status: 1, output: 'Authentication error' } };
  const results = checkResults(runCheck(planProfile, 'production', schema, { run: stubRunner(unknown).run }));
  assert.equal(mapExitCode(results), 2);
  assert.equal(results.find((r) => r.key === 'pages acme-web').status, 'skip');
  assert.ok(results.every((r) => ['cf-resources', 'api-secrets', 'previews'].includes(r.group)));
});

// ── payment gateway secrets (RFC 0026 section 8, R13) ───────────────────────
// The REAL deployment schema: these tests pin what the committed contract says.
const realSchema = parseJsonc(readFileSync(PATHS.schema, 'utf8'));
const BASE_EXTERNAL = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'GOOGLE_CLIENT_SECRET', 'RESEND_API_KEY'];
const MP_SECRETS = ['PAYMENTS_MERCADOPAGO_SECRET_KEY', 'PAYMENTS_MERCADOPAGO_WEBHOOK_SECRET'];
const paymentNames = (names) => names.filter((n) => n.startsWith('PAYMENTS_'));

test('externalSecretNames names no payment secret for none, an absent list or no Worker block', () => {
  assert.deepEqual(externalSecretNames(realSchema, planProfile, 'staging'), BASE_EXTERNAL);
  assert.deepEqual(externalSecretNames(realSchema, planProfile, 'staging', {}), BASE_EXTERNAL);
  assert.deepEqual(externalSecretNames(realSchema, planProfile, 'staging', { PAYMENTS_PROVIDERS: 'none', PAYMENTS_KEY_MODE: 'test' }), BASE_EXTERNAL);
});

test('externalSecretNames names exactly the two secrets of one bound provider', () => {
  const names = externalSecretNames(realSchema, planProfile, 'staging', { PAYMENTS_PROVIDERS: 'mercadopago:pix+card' });
  assert.deepEqual(names, [...BASE_EXTERNAL, ...MP_SECRETS]);
  // a retired entry still needs both (config.ts rule 4)
  assert.deepEqual(paymentNames(externalSecretNames(realSchema, planProfile, 'production', { PAYMENTS_PROVIDERS: 'mercadopago:' })), MP_SECRETS);
});

test('externalSecretNames names both pairs for two bound providers and nothing for the others', () => {
  const names = externalSecretNames(realSchema, planProfile, 'production', { PAYMENTS_PROVIDERS: 'mercadopago:pix,stripe:card' });
  assert.deepEqual(paymentNames(names).sort(), [
    'PAYMENTS_MERCADOPAGO_SECRET_KEY', 'PAYMENTS_MERCADOPAGO_WEBHOOK_SECRET',
    'PAYMENTS_STRIPE_SECRET_KEY', 'PAYMENTS_STRIPE_WEBHOOK_SECRET',
  ]);
  assert.ok(!names.includes('JWT_SECRET'));
});

test('externalSecretNames reads the mail driver from the resolved vars too', () => {
  // The committed Worker block wins over the profile, as in `label.mjs check`.
  assert.ok(!externalSecretNames(realSchema, planProfile, 'staging', { MAIL_DRIVER: 'console' }).includes('RESEND_API_KEY'));
});

test('committedEnvVars reads the Worker vars and the previews vars of one env block', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aq-provision-test-'));
  const path = join(dir, 'wrangler.jsonc');
  writeFileSync(path, `{
    // a comment, as in the real file
    "env": {
      "acme-staging": {
        "vars": { "PAYMENTS_PROVIDERS": "mercadopago:pix", "PAYMENTS_KEY_MODE": "test" },
        "previews": { "vars": { "APP_PREVIEW": "1" } }
      },
      "acme": { "vars": { "PAYMENTS_PROVIDERS": "none" } }
    }
  }`);
  try {
    assert.deepEqual(committedEnvVars('acme', 'staging', path), {
      worker: { PAYMENTS_PROVIDERS: 'mercadopago:pix', PAYMENTS_KEY_MODE: 'test' },
      preview: { APP_PREVIEW: '1' },
    });
    assert.deepEqual(committedEnvVars('acme', 'production', path), { worker: { PAYMENTS_PROVIDERS: 'none' }, preview: null });
    assert.deepEqual(committedEnvVars('other', 'staging', path), { worker: null, preview: null });
    assert.deepEqual(committedEnvVars('acme', 'staging', join(dir, 'missing.jsonc')), { worker: null, preview: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every committed label is on none: its check plan names no payment secret and no reminder', () => {
  for (const label of ['arenaquest', 'spaziord', 'budo']) {
    const profile = parseJsonc(readFileSync(join(HERE, '..', '..', 'config', 'labels', `${label}.jsonc`), 'utf8'));
    for (const env of ['staging', 'production']) {
      const vars = committedEnvVars(label, env);
      assert.equal(vars.worker?.PAYMENTS_PROVIDERS, 'none', `${label}/${env}`);
      const plan = buildCheckPlan(profile, env, realSchema, vars);
      assert.deepEqual(paymentNames([...plan.secrets.worker, ...plan.secrets.preview]), [], `${label}/${env}`);
      assert.deepEqual(plan.reminders, [], `${label}/${env}`);
      assert.ok(!Object.keys(plan.fixes).some((k) => k.includes('PAYMENTS_')), `${label}/${env}`);
    }
  }
});

const MP_VARS = { worker: { PAYMENTS_PROVIDERS: 'mercadopago:pix+card', PAYMENTS_KEY_MODE: 'test' }, preview: { APP_PREVIEW: '1' } };

test('buildCheckPlan expects a bound provider\'s two secrets on the Worker, never on the Preview base config', () => {
  const plan = buildCheckPlan(planProfile, 'staging', realSchema, MP_VARS);
  assert.deepEqual(plan.secrets.worker, ['JWT_SECRET', ...BASE_EXTERNAL, ...MP_SECRETS]);
  assert.deepEqual(plan.secrets.preview, ['JWT_SECRET', ...BASE_EXTERNAL]);
  assert.equal(plan.fixes.PAYMENTS_MERCADOPAGO_SECRET_KEY, 'bash scripts/create-secrets.sh PAYMENTS_MERCADOPAGO_SECRET_KEY --env acme-staging');
  assert.equal(plan.fixes.PAYMENTS_MERCADOPAGO_WEBHOOK_SECRET, 'bash scripts/create-secrets.sh PAYMENTS_MERCADOPAGO_WEBHOOK_SECRET --env acme-staging');
  assert.ok(!Object.keys(plan.fixes).some((k) => k.startsWith('preview:PAYMENTS_')));
  assert.deepEqual(plan.reminders, [{
    key: 'payments-webhook-mercadopago',
    detail: 'Mercado Pago webhook signing secret set as PAYMENTS_MERCADOPAGO_WEBHOOK_SECRET; every checkout sends its own notification URL (https://api-acme-staging.sub.workers.dev/v1/webhooks/payments/mercadopago), so registering it in the dashboard is optional',
  }]);
  assert.equal(plan.keyMode, 'test');
});

test('paymentWebhookReminders gives one URL per bound provider and none for a label on none', () => {
  assert.deepEqual(paymentWebhookReminders(realSchema, planProfile, 'production'), []);
  assert.deepEqual(paymentWebhookReminders(realSchema, planProfile, 'production', { PAYMENTS_PROVIDERS: 'none' }), []);
  const two = paymentWebhookReminders(realSchema, planProfile, 'production', { PAYMENTS_PROVIDERS: 'stripe:card,asaas:' });
  assert.deepEqual(two.map((r) => r.detail), [
    'Webhook registered in the Stripe dashboard: https://api.acme.app/v1/webhooks/payments/stripe',
    'Webhook registered in the Asaas dashboard: https://api.acme.app/v1/webhooks/payments/asaas',
  ]);
});

/** Secret names as `wrangler secret list --format json` prints them. */
const secretList = (names) => ({ status: 0, stdout: JSON.stringify(names.map((name) => ({ name, type: 'secret_text' }))) });

test('runCheck lists exactly the bound provider\'s two secrets, each missing one with its fix command, and no value', () => {
  const { run, calls } = stubRunner({
    ...CHECK_ANSWERS,
    // One of the two is set; a secret of an unbound provider is set too and must not be reported.
    'pnpm --filter api exec wrangler secret list --env acme --format json':
      secretList(['JWT_SECRET', 'PAYMENTS_MERCADOPAGO_SECRET_KEY', 'PAYMENTS_STRIPE_SECRET_KEY']),
  });
  const vars = { worker: { PAYMENTS_PROVIDERS: 'mercadopago:pix+card', PAYMENTS_KEY_MODE: 'live' }, preview: null };
  const report = runCheck(planProfile, 'production', realSchema, { run, vars });

  for (const argv of calls) assert.ok(argv.includes('list'), `--check spawned a non-list command: ${renderCommand(argv)}`);
  const payments = report.secrets.filter((s) => s.name.startsWith('PAYMENTS_'));
  assert.deepEqual(payments, [
    { name: 'PAYMENTS_MERCADOPAGO_SECRET_KEY', scope: 'worker', present: true, fix: null },
    {
      name: 'PAYMENTS_MERCADOPAGO_WEBHOOK_SECRET',
      scope: 'worker',
      present: false,
      fix: 'bash scripts/create-secrets.sh PAYMENTS_MERCADOPAGO_WEBHOOK_SECRET --env acme',
    },
  ]);
  assert.deepEqual(report.reminders.map((r) => r.key), ['payments-webhook-mercadopago']);

  // Names, states and commands only: the report has no field a value could sit in.
  for (const s of report.secrets) assert.deepEqual(Object.keys(s), ['name', 'scope', 'present', 'fix']);
  const printed = JSON.stringify(report) + formatChecklist('acme', 'production', 'Acme', checkResults(report));
  assert.doesNotMatch(printed, /secret_text|[0-9a-f]{64}|APP_USR-|TEST-/);
  assert.match(printed, /PAYMENTS_MERCADOPAGO_WEBHOOK_SECRET\s+not set for env\.acme/);
  assert.match(printed, /→ bash scripts\/create-secrets\.sh PAYMENTS_MERCADOPAGO_WEBHOOK_SECRET --env acme/);
});

test('runCheck reports a bound provider\'s secrets as unknown, with the fix, when the list fails', () => {
  const { run } = stubRunner({ ...CHECK_ANSWERS, 'pnpm --filter api exec wrangler secret list --env acme --format json': { status: 1, output: 'no creds' } });
  const vars = { worker: { PAYMENTS_PROVIDERS: 'mercadopago:pix' }, preview: null };
  const report = runCheck(planProfile, 'production', realSchema, { run, vars });
  const payments = report.secrets.filter((s) => s.name.startsWith('PAYMENTS_'));
  assert.deepEqual(payments.map((s) => s.name), MP_SECRETS);
  assert.ok(payments.every((s) => s.present === null && s.fix.includes('create-secrets.sh')));
});

test('runCheck on staging probes the Preview base config for no payment secret', () => {
  const answers = {
    'pnpm --filter api exec wrangler secret list --env acme-staging --format json': secretList(['JWT_SECRET', ...BASE_EXTERNAL]),
    'pnpm --filter api exec wrangler preview base-config secret list --env acme-staging --json': secretList(['JWT_SECRET', ...BASE_EXTERNAL]),
  };
  const report = runCheck(planProfile, 'staging', realSchema, { run: stubRunner(answers).run, vars: MP_VARS });
  const payments = report.secrets.filter((s) => s.name.startsWith('PAYMENTS_'));
  assert.deepEqual(payments.map((s) => [s.name, s.scope, s.present]), MP_SECRETS.map((name) => [name, 'worker', false]));
  assert.ok(report.secrets.filter((s) => s.scope === 'preview').every((s) => s.present === true));
});

test('a webhook reminder is printed under the checklist and never changes the exit code', () => {
  const answers = { ...CHECK_ANSWERS };
  answers['pnpm --filter api exec wrangler r2 bucket list'] = { status: 0, stdout: '[{"name":"acme-media"},{"name":"acme-backups"}]' };
  answers['pnpm --filter web exec wrangler pages project list --json'] = { status: 0, stdout: '[{"name":"acme-web"}]' };
  answers['pnpm --filter api exec wrangler deployments list --env acme'] = { status: 0, stdout: 'Created: ...' };
  answers['pnpm --filter api exec wrangler secret list --env acme --format json'] = secretList(['JWT_SECRET', ...BASE_EXTERNAL, ...MP_SECRETS]);
  const vars = { worker: { PAYMENTS_PROVIDERS: 'mercadopago:pix+card' }, preview: null };
  const report = runCheck(planProfile, 'production', realSchema, { run: stubRunner(answers).run, vars });

  assert.equal(mapExitCode(checkResults(report)), 0, 'every secret present: the reminder is not a gap');
  assert.ok(checkResults(report).every((r) => ['cf-resources', 'api-secrets', 'previews'].includes(r.group)));
  assert.deepEqual(formatReminders(report), [
    'Not verifiable from here — confirm at each bound provider:',
    '  - Mercado Pago webhook signing secret set as PAYMENTS_MERCADOPAGO_WEBHOOK_SECRET; every checkout sends its own notification URL (https://api.acme.app/v1/webhooks/payments/mercadopago), so registering it in the dashboard is optional',
  ]);
  assert.deepEqual(formatReminders(runCheck(planProfile, 'production', realSchema, { run: stubRunner(answers).run })), []);
});

test('the declared key mode is reported as written, defaults to test, and is never a gap', () => {
  const declared = (vars) => declaredPaymentsKeyMode(realSchema, planProfile, 'production', vars);
  assert.equal(declared(null), null, 'no committed block: nothing bound, nothing reported');
  assert.equal(declared({ PAYMENTS_PROVIDERS: 'none', PAYMENTS_KEY_MODE: 'live' }), null, 'a label on none reports no key mode');
  assert.equal(declared({ PAYMENTS_PROVIDERS: 'mercadopago:card' }), 'test', 'absent means test, as in the Worker');
  assert.equal(declared({ PAYMENTS_PROVIDERS: 'mercadopago:card', PAYMENTS_KEY_MODE: 'live' }), 'live');
  // Reported as written: the Worker is what refuses an invalid value (PAYMENTS_CONFIG_INVALID).
  assert.equal(declared({ PAYMENTS_PROVIDERS: 'mercadopago:card', PAYMENTS_KEY_MODE: 'banana' }), 'banana');

  const answers = { ...CHECK_ANSWERS };
  answers['pnpm --filter api exec wrangler r2 bucket list'] = { status: 0, stdout: '[{"name":"acme-media"},{"name":"acme-backups"}]' };
  answers['pnpm --filter web exec wrangler pages project list --json'] = { status: 0, stdout: '[{"name":"acme-web"}]' };
  answers['pnpm --filter api exec wrangler deployments list --env acme'] = { status: 0, stdout: 'Created: ...' };
  answers['pnpm --filter api exec wrangler secret list --env acme --format json'] = secretList(['JWT_SECRET', ...BASE_EXTERNAL, ...MP_SECRETS]);
  const vars = { worker: { PAYMENTS_PROVIDERS: 'mercadopago:pix+card', PAYMENTS_KEY_MODE: 'live' }, preview: null };
  const report = runCheck(planProfile, 'production', realSchema, { run: stubRunner(answers).run, vars });
  assert.equal(report.keyMode, 'live');
  assert.equal(mapExitCode(checkResults(report)), 0, 'the key mode is information, not a check');
  assert.ok(!checkResults(report).some((r) => /KEY_MODE/.test(JSON.stringify(r))), 'it is not a checklist row');
  assert.deepEqual(formatKeyMode(report), [
    "Declared, not verified: PAYMENTS_KEY_MODE = live — installing the matching provider credentials in this environment is the integrator's responsibility.",
  ]);
  assert.deepEqual(formatKeyMode(runCheck(planProfile, 'production', realSchema, { run: stubRunner(answers).run })), []);
});

test('a provisioning plan writes no payment secret: JWT_SECRET is the only secret put', () => {
  for (const env of ['staging', 'production']) {
    const plan = buildProvisionPlan(planProfile, env, {
      schema: realSchema,
      withDomain: true,
      vars: { worker: { PAYMENTS_PROVIDERS: 'mercadopago:pix,stripe:card' }, preview: { APP_PREVIEW: '1' } },
    });
    const commands = plan.flatMap((step) => step.commands);
    const puts = commands.filter((argv) => argv.includes('put'));
    assert.ok(puts.length > 0);
    for (const argv of puts) assert.ok(argv.includes('JWT_SECRET'), renderCommand(argv));
    for (const argv of commands) assert.doesNotMatch(renderCommand(argv), /PAYMENTS_/, renderCommand(argv));
    // …and the dry run still tells the operator which ones it will only report.
    const note = plan.find((s) => s.id === 'secrets').note;
    assert.match(note, /never written: .*PAYMENTS_STRIPE_SECRET_KEY, PAYMENTS_STRIPE_WEBHOOK_SECRET, PAYMENTS_MERCADOPAGO_SECRET_KEY, PAYMENTS_MERCADOPAGO_WEBHOOK_SECRET/);
    if (env === 'staging') assert.match(note, /on the Preview base config only: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, GOOGLE_CLIENT_SECRET, RESEND_API_KEY\)/);
  }
});
