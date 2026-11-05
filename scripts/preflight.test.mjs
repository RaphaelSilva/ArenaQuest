import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluatePresence,
  parseArgs,
  parseDotEnv,
  formatChecklist,
  mapExitCode,
  parseJsonc,
  parseSecretNames,
  resolveWorkflowWebBuild,
  resolveWranglerVars,
} from './preflight.mjs';

test('resolveWranglerVars selects top-level production and env.staging vars from JSONC', () => {
  const wrangler = parseJsonc(`{
    // production lives at top level
    "vars": { "MODE": "production", "URL": "https://example.com/a//b", },
    "env": {
      "staging": {
        /* comments and trailing commas are accepted */
        "vars": { "MODE": "staging", },
      },
    },
  }`);

  assert.deepEqual(resolveWranglerVars(wrangler, 'production'), {
    MODE: 'production',
    URL: 'https://example.com/a//b',
  });
  assert.deepEqual(resolveWranglerVars(wrangler, 'staging'), { MODE: 'staging' });
  assert.deepEqual(resolveWranglerVars(wrangler, 'local'), {});
});

test('evaluatePresence reports required, conditional, and enum failures by key', () => {
  const manifest = {
    'web-build': {
      NEXT_PUBLIC_API_URL: { required: true },
      NEXT_PUBLIC_LANGUAGE: { required: false, enum: ['pt', 'en'] },
    },
    'api-vars': {
      MAIL_DRIVER: { required: true, enum: ['resend', 'console', ''] },
    },
    'api-secrets': {
      JWT_SECRET: { required: true },
      RESEND_API_KEY: { required: false, requiredWhen: 'MAIL_DRIVER=resend' },
    },
    'ci-secrets': {},
  };

  const results = evaluatePresence(manifest, {
    environment: 'staging',
    webBuild: { NEXT_PUBLIC_LANGUAGE: 'fr' },
    apiVars: { MAIL_DRIVER: 'resend' },
    apiSecretNames: new Set(['JWT_SECRET']),
    ciSecretNames: new Set(),
  });

  assert.equal(results.find((item) => item.key === 'NEXT_PUBLIC_API_URL').status, 'fail');
  assert.match(results.find((item) => item.key === 'NEXT_PUBLIC_LANGUAGE').detail, /expected one of/);
  assert.equal(results.find((item) => item.key === 'RESEND_API_KEY').status, 'fail');
  assert.equal(mapExitCode(results), 1);
});

test('unavailable secret-name lookup is skipped and maps to exit 2', () => {
  const results = evaluatePresence(
    { 'web-build': {}, 'api-vars': {}, 'api-secrets': { JWT_SECRET: { required: true } }, 'ci-secrets': {} },
    {
      environment: 'production',
      webBuild: {},
      apiVars: {},
      apiSecretNames: null,
      ciSecretNames: new Set(),
    },
  );

  assert.deepEqual(results.map(({ key, status }) => ({ key, status })), [
    { key: 'JWT_SECRET', status: 'skip' },
  ]);
  assert.equal(mapExitCode(results), 2);
});

test('all present values pass and map to exit 0', () => {
  const results = evaluatePresence(
    {
      'web-build': { NEXT_PUBLIC_API_URL: { required: true } },
      'api-vars': { MAIL_DRIVER: { required: true, enum: ['console', 'resend'] } },
      'api-secrets': { JWT_SECRET: { required: true } },
      'ci-secrets': { CF_API_TOKEN: { required: true } },
    },
    {
      environment: 'production',
      webBuild: { NEXT_PUBLIC_API_URL: 'https://api.example.test' },
      apiVars: { MAIL_DRIVER: 'console' },
      apiSecretNames: new Set(['JWT_SECRET']),
      ciSecretNames: new Set(['CF_API_TOKEN']),
    },
  );

  assert.ok(results.every((item) => item.status === 'pass'));
  assert.equal(mapExitCode(results), 0);
});

test('formatChecklist groups scopes and never renders secret values', () => {
  const secretValue = 'do-not-print-this-secret';
  const output = formatChecklist('staging', [
    { scope: 'api-vars', key: 'MAIL_DRIVER', status: 'pass', detail: 'present' },
    { scope: 'api-secrets', key: 'JWT_SECRET', status: 'pass', detail: 'present by name', value: secretValue },
  ]);

  assert.match(output, /api-vars/);
  assert.match(output, /api-secrets/);
  assert.match(output, /✅ JWT_SECRET/);
  assert.doesNotMatch(output, new RegExp(secretValue));
  assert.match(output, /Exit 0/);
});

test('resolveWorkflowWebBuild reads only NEXT_PUBLIC keys from the selected job env blocks', () => {
  const workflow = `jobs:
  deploy-staging:
    steps:
      - name: Build
        env:
          NEXT_PUBLIC_API_URL: https://api-staging.example.test
          NEXT_PUBLIC_BRAND_SIGLA: \${{ vars.NEXT_PUBLIC_BRAND_SIGLA }}
          PRIVATE_VALUE: ignored
  deploy-production:
    steps:
      - name: Build
        env:
          NEXT_PUBLIC_API_URL: https://api.example.test
`;

  assert.deepEqual(resolveWorkflowWebBuild(workflow, 'staging'), {
    NEXT_PUBLIC_API_URL: 'https://api-staging.example.test',
    NEXT_PUBLIC_BRAND_SIGLA: '${{ vars.NEXT_PUBLIC_BRAND_SIGLA }}',
  });
  assert.deepEqual(resolveWorkflowWebBuild(workflow, 'production'), {
    NEXT_PUBLIC_API_URL: 'https://api.example.test',
  });
});

test('parseDotEnv handles exported values, quotes, comments, and equals signs', () => {
  assert.deepEqual(
    parseDotEnv('NEXT_PUBLIC_API_URL="http://localhost:8787/v1?a=b"\nexport NEXT_PUBLIC_LANGUAGE=pt # comment\n'),
    {
      NEXT_PUBLIC_API_URL: 'http://localhost:8787/v1?a=b',
      NEXT_PUBLIC_LANGUAGE: 'pt',
    },
  );
});

test('parseSecretNames accepts Wrangler name-only JSON and discards all other fields', () => {
  assert.deepEqual(
    parseSecretNames('[{"name":"JWT_SECRET","type":"secret_text"},{"name":"RESEND_API_KEY"}]'),
    new Set(['JWT_SECRET', 'RESEND_API_KEY']),
  );
});

test('parseArgs accepts exactly one supported environment', () => {
  assert.deepEqual(parseArgs(['--env', 'staging']), { environment: 'staging' });
  assert.throws(() => parseArgs([]), /Usage/);
  assert.throws(() => parseArgs(['--env', 'preview']), /local, staging, or production/);
  assert.throws(() => parseArgs(['--env', 'staging', '--write']), /Usage/);
});
