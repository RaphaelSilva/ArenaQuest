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

import { REPO_ROOT, SERVER_NAME, createServer, loadConfig, parseArgs, readVersion, usage } from './aq-mcp.mjs';
import { AUTHORING_TOOL_NAMES } from './tools/authoring.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(HERE, 'aq-mcp.mjs');

const PROFILE = {
  label: 'budo',
  environments: {
    staging: { apiHost: 'api-budo-staging.example', webOrigin: 'budo-web-staging.pages.dev' },
    production: { apiHost: 'api-budo.example', webOrigin: 'budo.example' },
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

test('usage mentions the environment variables and the seven tools, never a credential flag', () => {
  const text = usage();
  assert.match(text, /AQ_ADMIN_EMAIL/);
  assert.match(text, /AQ_ADMIN_PASSWORD/);
  assert.match(text, /claude mcp add/);
  for (const name of AUTHORING_TOOL_NAMES) assert.ok(text.includes(name), name);
  assert.doesNotMatch(text, /--password|--email/);
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

test('loadConfig resolves the target from the profile, derives webOrigin and the state paths under the repo root', () => {
  const env = { AQ_ADMIN_EMAIL: 'bot@example.invalid', AQ_ADMIN_PASSWORD: 'pw' };
  const config = loadConfig({ env, label: 'budo', envName: 'production', rootDir: '/repo', loadProfile: fakeLoadProfile, resolveBaseUrl: fakeResolveBaseUrl });
  assert.deepEqual(config, {
    label: 'budo',
    env: 'production',
    baseUrl: 'https://api-budo.example',
    webOrigin: 'https://budo.example',
    email: 'bot@example.invalid',
    password: 'pw',
    auditPath: '/repo/.arenaquest/mcp-audit-budo-production.jsonl',
    uploadLedgerPath: '/repo/.arenaquest/mcp-upload-budo-production.jsonl',
    convertDir: '/repo/.arenaquest/mcp-convert/budo-production',
  });
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

test('createServer registers the seven tools on an McpServer with a stub client and audit', () => {
  const config = loadConfig({
    env: { AQ_ADMIN_EMAIL: 'bot@example.invalid', AQ_ADMIN_PASSWORD: 'pw' }, label: 'budo', envName: 'staging', rootDir: '/repo', loadProfile: fakeLoadProfile, resolveBaseUrl: fakeResolveBaseUrl,
  });
  const client = { request: async () => { throw new Error('not in this test'); } };
  const { server, tools } = createServer({ config, client, audit: { record: () => {} }, version: '9.9.9' });
  assert.ok(server);
  assert.deepEqual(tools.map((t) => t.name), AUTHORING_TOOL_NAMES);
  assert.equal(SERVER_NAME, 'aq-mcp');
  assert.throws(() => createServer({}), /config is required/);
  assert.equal(readVersion(REPO_ROOT), JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version);
  assert.equal(readVersion('/nowhere'), '0.0.0');
  assert.equal(resolvePath(REPO_ROOT, 'scripts', 'mcp', 'aq-mcp.mjs'), SERVER_PATH);
});

// -- one stdio round-trip -----------------------------------------------------

test('stdio round-trip: the spawned server lists exactly the seven tools with their annotations (no network)', async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH, '--label', 'budo', '-e', 'staging'],
    env: {
      ...getDefaultEnvironment(),
      AQ_ADMIN_EMAIL: 'bot@example.invalid',
      AQ_ADMIN_PASSWORD: 'dummy-password-never-sent',
      // Loopback and not listening: a login attempt would fail loudly.
      AQ_API_BASE_URL: 'http://127.0.0.1:1',
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
    assert.deepEqual(names, AUTHORING_TOOL_NAMES);
    for (const tool of tools) {
      t.diagnostic(`tool ${tool.name} ${JSON.stringify(tool.annotations)}`);
      const isRead = ['list_topics', 'read_topic', 'topic_comments', 'review_link'].includes(tool.name);
      assert.equal(tool.annotations.readOnlyHint, isRead, tool.name);
      assert.equal(tool.annotations.destructiveHint, false, tool.name);
      assert.equal(tool.inputSchema.type, 'object');
      assert.equal('status' in (tool.inputSchema.properties ?? {}), false, `${tool.name} has no status input`);
    }
    assert.deepEqual(Object.keys(tools.find((x) => x.name === 'upload_media').inputSchema.properties), ['topicId', 'path']);
  } finally {
    await client.close();
  }
  assert.doesNotMatch(stderr, /dummy-password-never-sent|bot@example\.invalid/, 'no credential on stderr');
  assert.match(stderr, /7 tools/);
});
