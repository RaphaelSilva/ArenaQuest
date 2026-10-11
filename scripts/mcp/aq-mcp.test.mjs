/**
 * scripts/mcp/aq-mcp.test.mjs — the server bootstrap: argument parsing, the
 * environment-only credential rule, the loopback-only base URL, the server
 * factory, and ONE stdio round-trip through the real MCP SDK client.
 *
 * The round-trip spawns the server with dummy credentials and a loopback base
 * URL nobody listens on (`http://127.0.0.1:1`): login is lazy, so `listTools`
 * must succeed without any network call. No real API is ever contacted.
 *
 * Run: node --test scripts/mcp/aq-mcp.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

import { ENV_VARS, REPO_ROOT, SERVER_NAME, TOOL_NAMES, createServer, loadConfig, parseArgs, readVersion, usage } from './aq-mcp.mjs';
import { AUTHORING_TOOL_NAMES } from './tools/authoring.mjs';
import { OPS_TOOL_NAMES, TIER_1_TOOL_NAMES, TIER_2_TOOL_NAMES, TIER_3_TOOL_NAMES } from './tools/ops.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(HERE, 'aq-mcp.mjs');

const PROFILE = {
  label: 'budo',
  environments: {
    staging: {
      apiHost: 'api-budo-staging.example',
      webOrigin: 'budo-web-staging.pages.dev',
      d1: { name: 'budo-db-staging' },
      r2: { bucket: 'budo-media-staging' },
    },
    production: {
      apiHost: 'api-budo.example',
      webOrigin: 'budo.example',
      d1: { name: 'budo-db' },
      r2: { bucket: 'budo-media' },
      backup: { bucket: 'budo-backups' },
    },
  },
};
const fakeLoadProfile = () => PROFILE;
const fakeResolveBaseUrl = (label, env, { override } = {}) => {
  if (override) {
    const { hostname } = new URL(override);
    if (hostname !== '127.0.0.1' && hostname !== 'localhost') throw new Error('AQ_API_BASE_URL may only point at localhost');
    return override;
  }
  return `https://${PROFILE.environments[env].apiHost}`;
};

// -- parseArgs ----------------------------------------------------------------

test('parseArgs accepts --label and -e/--env only', () => {
  assert.deepEqual(parseArgs(['--label', 'budo', '-e', 'staging']), { help: false, label: 'budo', env: 'staging' });
  assert.deepEqual(parseArgs(['--env', 'production', '--label', 'spaziord']), { help: false, label: 'spaziord', env: 'production' });
  assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.deepEqual(parseArgs(['-h']), { help: true });
  assert.throws(() => parseArgs(['-e', 'staging']), /--label <label> is required/);
  assert.throws(() => parseArgs(['--label', 'budo']), /-e <env> must be one of staging \| production \(got nothing\)/);
  assert.throws(() => parseArgs(['--label', 'budo', '-e', 'local']), /got "local"/);
  assert.throws(() => parseArgs(['--label', 'budo', '-e', 'staging', 'extra']), /invalid arguments/);
  // No credential can be passed on the command line.
  assert.throws(() => parseArgs(['--label', 'budo', '-e', 'staging', '--password', 'x']), /invalid arguments/);
  assert.throws(() => parseArgs(['--label', 'budo', '-e', 'staging', '--email', 'x']), /invalid arguments/);
});

test('usage mentions the environment variables and all fifteen tools grouped by tier, never a credential flag', () => {
  const text = usage();
  assert.match(text, /AQ_ADMIN_EMAIL/);
  assert.match(text, /AQ_ADMIN_PASSWORD/);
  assert.match(text, /AQ_CF_READ_TOKEN/);
  assert.match(text, /claude mcp add/);
  assert.deepEqual(TOOL_NAMES, [...AUTHORING_TOOL_NAMES, ...OPS_TOOL_NAMES]);
  assert.equal(TOOL_NAMES.length, 15);
  for (const name of TOOL_NAMES) assert.ok(text.includes(name), name);
  assert.match(text, /tier 1[^\n]*system_health/);
  assert.match(text, /tier 2[^\n]*backup_now/);
  assert.match(text, /tier 3[^\n]*restore_instructions/);
  assert.doesNotMatch(text, /--password|--email|--token/);
});

// -- loadConfig ---------------------------------------------------------------

test('loadConfig names a missing credential without echoing any value', () => {
  const secret = 'S3cret-Value-That-Must-Not-Leak';
  assert.throws(
    () => loadConfig({ env: { AQ_ADMIN_PASSWORD: secret }, label: 'budo', envName: 'staging', loadProfile: fakeLoadProfile, resolveBaseUrl: fakeResolveBaseUrl }),
    (err) => {
      assert.match(err.message, /missing AQ_ADMIN_EMAIL in the environment/);
      assert.equal(err.message.includes(secret), false);
      return true;
    },
  );
  assert.throws(
    () => loadConfig({ env: { AQ_ADMIN_EMAIL: '  ' }, label: 'budo', envName: 'staging', loadProfile: fakeLoadProfile, resolveBaseUrl: fakeResolveBaseUrl }),
    /missing AQ_ADMIN_EMAIL and AQ_ADMIN_PASSWORD/,
  );
  assert.throws(() => loadConfig({ env: {}, label: 'budo', envName: 'local', loadProfile: fakeLoadProfile }), /env must be one of/);
});

test('loadConfig resolves the target from the profile, derives webOrigin, the ops names and the state paths under the repo root', () => {
  const env = { AQ_ADMIN_EMAIL: 'bot@example.invalid', AQ_ADMIN_PASSWORD: 'pw' };
  const config = loadConfig({ env, label: 'budo', envName: 'production', rootDir: '/repo', loadProfile: fakeLoadProfile, resolveBaseUrl: fakeResolveBaseUrl });
  assert.deepEqual(config, {
    label: 'budo',
    env: 'production',
    baseUrl: 'https://api-budo.example',
    webOrigin: 'https://budo.example',
    email: 'bot@example.invalid',
    password: 'pw',
    cfReadToken: null,
    ops: {
      database: 'budo-db',
      wranglerEnv: 'budo',
      production: { database: 'budo-db', mediaBucket: 'budo-media', backupBucket: 'budo-backups' },
    },
    auditPath: '/repo/.arenaquest/mcp-audit-budo-production.jsonl',
    uploadLedgerPath: '/repo/.arenaquest/mcp-upload-budo-production.jsonl',
    convertDir: '/repo/.arenaquest/mcp-convert/budo-production',
  });

  // Staging: its own D1 for bookmark_now, the production names for the restore text.
  const staging = loadConfig({ env, label: 'budo', envName: 'staging', rootDir: '/repo', loadProfile: fakeLoadProfile, resolveBaseUrl: fakeResolveBaseUrl });
  assert.deepEqual(staging.ops, {
    database: 'budo-db-staging',
    wranglerEnv: 'budo-staging',
    production: { database: 'budo-db', mediaBucket: 'budo-media', backupBucket: 'budo-backups' },
  });

  // A profile without the blocks falls back to the runbook's conventions.
  const bare = loadConfig({ env, label: 'x', envName: 'production', loadProfile: () => ({ environments: {} }), resolveBaseUrl: () => 'https://api.x' });
  assert.deepEqual(bare.ops, { database: null, wranglerEnv: 'x', production: { database: 'x-db', mediaBucket: 'x-media', backupBucket: 'x-backups' } });
});

test('loadConfig takes AQ_CF_READ_TOKEN when set (blank counts as unset) and never echoes it', () => {
  const base = { AQ_ADMIN_EMAIL: 'bot@example.invalid', AQ_ADMIN_PASSWORD: 'pw' };
  const opts = { label: 'budo', envName: 'production', loadProfile: fakeLoadProfile, resolveBaseUrl: fakeResolveBaseUrl };
  assert.equal(loadConfig({ env: base, ...opts }).cfReadToken, null);
  assert.equal(loadConfig({ env: { ...base, AQ_CF_READ_TOKEN: '   ' }, ...opts }).cfReadToken, null);
  assert.equal(loadConfig({ env: { ...base, AQ_CF_READ_TOKEN: 'cf-read-token-value' }, ...opts }).cfReadToken, 'cf-read-token-value');
  // A token never makes a missing credential's message leak.
  assert.throws(
    () => loadConfig({ env: { AQ_CF_READ_TOKEN: 'cf-read-token-value' }, ...opts }),
    (err) => !err.message.includes('cf-read-token-value') && /missing AQ_ADMIN_EMAIL and AQ_ADMIN_PASSWORD/.test(err.message),
  );
});

test('loadConfig reads exactly the four AQ_* variables from the environment — no Cloudflare or R2 variable', () => {
  const reads = new Set();
  const actual = {
    AQ_ADMIN_EMAIL: 'bot@example.invalid',
    AQ_ADMIN_PASSWORD: 'pw',
    AQ_API_BASE_URL: 'http://127.0.0.1:8787',
    AQ_CF_READ_TOKEN: 'cf-read-token-value',
    CF_API_TOKEN: 'must-not-be-read',
    CLOUDFLARE_API_TOKEN: 'must-not-be-read',
    CF_ACCOUNT_ID: 'must-not-be-read',
    R2_ACCESS_KEY_ID: 'must-not-be-read',
    R2_SECRET_ACCESS_KEY: 'must-not-be-read',
    JWT_SECRET: 'must-not-be-read',
  };
  const env = new Proxy(actual, {
    get(target, key) {
      if (typeof key === 'string') reads.add(key);
      return target[key];
    },
    has(target, key) {
      if (typeof key === 'string') reads.add(key);
      return key in target;
    },
    ownKeys(target) {
      reads.add('*enumerated*');
      return Reflect.ownKeys(target);
    },
  });
  const config = loadConfig({ env, label: 'budo', envName: 'staging', loadProfile: fakeLoadProfile, resolveBaseUrl: fakeResolveBaseUrl });
  assert.deepEqual([...reads].sort(), [...ENV_VARS].sort());
  assert.deepEqual([...ENV_VARS], ['AQ_ADMIN_EMAIL', 'AQ_ADMIN_PASSWORD', 'AQ_API_BASE_URL', 'AQ_CF_READ_TOKEN']);
  assert.equal(config.cfReadToken, 'cf-read-token-value');
  assert.equal(JSON.stringify(config).includes('must-not-be-read'), false);
});

test('loadConfig rejects a non-loopback AQ_API_BASE_URL and accepts a loopback one (real resolver)', () => {
  const env = { AQ_ADMIN_EMAIL: 'bot@example.invalid', AQ_ADMIN_PASSWORD: 'pw', AQ_API_BASE_URL: 'https://api-evil.example' };
  assert.throws(() => loadConfig({ env, label: 'budo', envName: 'staging' }), /AQ_API_BASE_URL may only point at localhost/);
  const local = loadConfig({ env: { ...env, AQ_API_BASE_URL: 'http://127.0.0.1:8787/' }, label: 'budo', envName: 'staging', loadProfile: fakeLoadProfile });
  assert.equal(local.baseUrl, 'http://127.0.0.1:8787');
});

test('loadConfig falls back to localhost:3000 for a placeholder webOrigin', () => {
  const env = { AQ_ADMIN_EMAIL: 'bot@example.invalid', AQ_ADMIN_PASSWORD: 'pw' };
  const config = loadConfig({
    env, label: 'x', envName: 'staging', loadProfile: () => ({ environments: { staging: { webOrigin: '<fill: web origin>' } } }), resolveBaseUrl: () => 'https://api.x',
  });
  assert.equal(config.webOrigin, 'http://localhost:3000');
});

// -- createServer -------------------------------------------------------------

test('createServer registers the fifteen tools (authoring, then ops) on an McpServer with a stub client and audit', () => {
  const config = loadConfig({
    env: { AQ_ADMIN_EMAIL: 'bot@example.invalid', AQ_ADMIN_PASSWORD: 'pw' }, label: 'budo', envName: 'staging', rootDir: '/repo', loadProfile: fakeLoadProfile, resolveBaseUrl: fakeResolveBaseUrl,
  });
  const client = { request: async () => { throw new Error('not in this test'); } };
  const spawn = () => { throw new Error('no spawn in this test'); };
  const { server, tools } = createServer({ config, client, audit: { record: () => {} }, version: '9.9.9', deps: { spawn } });
  assert.ok(server);
  assert.deepEqual(tools.map((t) => t.name), [...AUTHORING_TOOL_NAMES, ...OPS_TOOL_NAMES]);
  assert.equal(tools.length, 15);
  assert.equal(SERVER_NAME, 'aq-mcp');
  assert.throws(() => createServer({}), /config is required/);
  assert.equal(readVersion(REPO_ROOT), JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version);
  assert.equal(readVersion('/nowhere'), '0.0.0');
  assert.equal(resolvePath(REPO_ROOT, 'scripts', 'mcp', 'aq-mcp.mjs'), SERVER_PATH);
});

// -- one stdio round-trip -----------------------------------------------------

test('stdio round-trip: the spawned server lists exactly the fifteen tools with their annotations (no network)', async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH, '--label', 'budo', '-e', 'staging'],
    env: {
      ...getDefaultEnvironment(),
      AQ_ADMIN_EMAIL: 'bot@example.invalid',
      AQ_ADMIN_PASSWORD: 'dummy-password-never-sent',
      // Loopback and not listening: a login attempt would fail loudly.
      AQ_API_BASE_URL: 'http://127.0.0.1:1',
      AQ_CF_READ_TOKEN: 'cf-read-token-never-logged',
    },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => {
    stderr += chunk;
  });
  const client = new Client({ name: 'aq-mcp-test', version: '0.0.0' });
  try {
    await client.connect(transport);
    const serverInfo = client.getServerVersion();
    assert.equal(serverInfo?.name, 'aq-mcp');

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    assert.deepEqual(names, [...AUTHORING_TOOL_NAMES, ...OPS_TOOL_NAMES]);
    const reads = ['list_topics', 'read_topic', 'topic_comments', 'review_link', ...TIER_1_TOOL_NAMES, ...TIER_3_TOOL_NAMES];
    for (const tool of tools) {
      t.diagnostic(`tool ${tool.name} ${JSON.stringify(tool.annotations)}`);
      const isRead = reads.includes(tool.name);
      assert.equal(tool.annotations.readOnlyHint, isRead, tool.name);
      assert.equal(tool.annotations.destructiveHint, false, tool.name);
      assert.equal(tool.inputSchema.type, 'object');
      assert.equal('status' in (tool.inputSchema.properties ?? {}), false, `${tool.name} has no status input`);
      if (TIER_2_TOOL_NAMES.includes(tool.name)) {
        assert.deepEqual(Object.keys(tool.inputSchema.properties), ['confirmationId'], `${tool.name} takes only the confirmation id`);
        assert.match(tool.description, /Tier 2/);
      }
    }
    assert.deepEqual(Object.keys(tools.find((x) => x.name === 'upload_media').inputSchema.properties), ['topicId', 'path']);
    assert.deepEqual(Object.keys(tools.find((x) => x.name === 'restore_instructions').inputSchema.properties), ['scenario', 'bookmark']);
  } finally {
    await client.close();
  }
  assert.doesNotMatch(stderr, /dummy-password-never-sent|bot@example\.invalid|cf-read-token-never-logged/, 'no credential on stderr');
  assert.match(stderr, /15 tools/);
  assert.match(stderr, /AQ_CF_READ_TOKEN set/);
});
