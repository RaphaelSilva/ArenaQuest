#!/usr/bin/env node
/**
 * scripts/mcp/aq-mcp.mjs — the local ArenaQuest MCP server (RFC 0025).
 *
 *   node scripts/mcp/aq-mcp.mjs --label <label> -e <staging|production>
 *
 * A stdio MCP server registered once per machine and target
 * (`claude mcp add aq-budo-prod -- node /abs/path/scripts/mcp/aq-mcp.mjs --label budo -e production`).
 * It exposes the draft-authoring tools of `tools/authoring.mjs` (Plane A) and
 * the three-tier ops and backup tools of `tools/ops.mjs` (Plane B) on the same
 * server.
 *
 * Contract:
 *   - credentials come from `AQ_ADMIN_EMAIL` / `AQ_ADMIN_PASSWORD` in the
 *     environment — never argv, never a tool argument, never a log line. The
 *     account is a dedicated `content_creator`;
 *   - `AQ_CF_READ_TOKEN` (optional) is the ONLY Cloudflare credential the
 *     server loads: a read-only token for the tier-1 tools, handed to a child
 *     process through its env object only. The server reads exactly four
 *     `AQ_*` variables and nothing else from its environment (a test pins the
 *     access list); `CF_API_TOKEN`, `CLOUDFLARE_API_TOKEN` and `R2_*` are
 *     never read and never inherited by a child;
 *   - the target comes from `config/labels/<label>.jsonc`; `AQ_API_BASE_URL`
 *     overrides it only towards loopback (the importer's rule);
 *   - every call goes through the public API via `scripts/lib/api-client.mjs`;
 *   - STDOUT IS THE MCP CHANNEL. Everything human-readable goes to stderr;
 *   - login is lazy (first tool call), so registering the server against an
 *     unreachable API still lists its tools;
 *   - one audit line per call in `.arenaquest/mcp-audit-<label>-<env>.jsonl`
 *     under the repository root, whatever the client's working directory.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs as nodeParseArgs } from 'node:util';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadProfile as defaultLoadProfile } from '../deploy/core.mjs';
import { API_ENVS, createApiClient, resolveBaseUrl as defaultResolveBaseUrl } from '../lib/api-client.mjs';
import { createAudit } from './audit.mjs';
import { AUTHORING_TOOL_NAMES, registerAuthoringTools } from './tools/authoring.mjs';
import { OPS_TOOL_NAMES, TIER_1_TOOL_NAMES, TIER_2_TOOL_NAMES, TIER_3_TOOL_NAMES, registerOpsTools } from './tools/ops.mjs';

export const SERVER_NAME = 'aq-mcp';

/** The repository root — two levels above this file. State files live under it. */
export const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every tool the server registers, authoring first, then ops by tier. */
export const TOOL_NAMES = Object.freeze([...AUTHORING_TOOL_NAMES, ...OPS_TOOL_NAMES]);

/** The environment variables the server reads — by name, and nothing else. */
export const ENV_VARS = Object.freeze(['AQ_ADMIN_EMAIL', 'AQ_ADMIN_PASSWORD', 'AQ_API_BASE_URL', 'AQ_CF_READ_TOKEN']);

/** Version reported in the MCP handshake: the root package.json's. */
export function readVersion(rootDir = REPO_ROOT) {
  try {
    return JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// -- arguments ----------------------------------------------------------------

/**
 * `--label <x> -e <env> [--help]`. Nothing else: no credential, no base URL,
 * no account can be passed on the command line.
 */
export function parseArgs(argv) {
  let parsed;
  try {
    parsed = nodeParseArgs({
      args: argv,
      options: {
        label: { type: 'string' },
        env: { type: 'string', short: 'e' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
    });
  } catch (err) {
    throw new Error(`invalid arguments: ${err.message}`);
  }

  const { values } = parsed;
  if (values.help) return { help: true };

  const label = values.label;
  if (!label || String(label).trim() === '') throw new Error('--label <label> is required');

  const env = values.env;
  if (!API_ENVS.includes(env)) {
    const got = env === undefined ? 'nothing' : `"${env}"`;
    throw new Error(`-e <env> must be one of ${API_ENVS.join(' | ')} (got ${got})`);
  }

  return { help: false, label: String(label).trim(), env };
}

export function usage() {
  return `
  Usage: node scripts/mcp/aq-mcp.mjs --label <label> -e <env>

  Local MCP server (stdio) for the ArenaQuest AI admin assistant. Register it
  in Claude Code once per label and environment:

    claude mcp add aq-<label>-<env> -- node /abs/path/scripts/mcp/aq-mcp.mjs --label <label> -e <env>

  Required
    --label <label>        Tenant label (config/labels/<label>.jsonc)
    -e, --env <env>        Target environment: staging | production

  Environment (never argv)
    AQ_ADMIN_EMAIL         Dedicated content_creator account
    AQ_ADMIN_PASSWORD      Its password
    AQ_API_BASE_URL        Optional; loopback only (local development)
    AQ_CF_READ_TOKEN       Optional; read-only Cloudflare token for the tier-1 tools
                           (unset: the tier-1 scripts use the wrangler login session)

  Tools
    authoring (drafts)     ${AUTHORING_TOOL_NAMES.join(', ')}
    tier 1 — diagnose      ${TIER_1_TOOL_NAMES.join(', ')}
    tier 2 — act           ${TIER_2_TOOL_NAMES.join(', ')} (two calls: plan + confirmation id)
    tier 3 — instructions  ${TIER_3_TOOL_NAMES.join(', ')} (returns the command; never runs it)
  Audit: .arenaquest/mcp-audit-<label>-<env>.jsonl (repository root)
`;
}

// -- configuration ------------------------------------------------------------

/**
 * Resolve everything the server needs from the environment and the label
 * profile. Pure given its inputs; the error for a missing credential NAMES
 * the variable and never echoes a value.
 */
export function loadConfig({
  env = process.env,
  label,
  envName,
  rootDir = REPO_ROOT,
  loadProfile = defaultLoadProfile,
  resolveBaseUrl = defaultResolveBaseUrl,
} = {}) {
  if (!label) throw new Error('label is required');
  if (!API_ENVS.includes(envName)) throw new Error(`env must be one of ${API_ENVS.join(' | ')}`);

  const missing = ['AQ_ADMIN_EMAIL', 'AQ_ADMIN_PASSWORD'].filter((name) => !env[name] || String(env[name]).trim() === '');
  if (missing.length > 0) {
    throw new Error(`missing ${missing.join(' and ')} in the environment (export them from a .env you do not commit)`);
  }

  // Loopback-only override; a deployed target always comes from the profile.
  const baseUrl = resolveBaseUrl(label, envName, { override: env.AQ_API_BASE_URL });

  const profile = loadProfile(label);
  const environment = profile?.environments?.[envName] ?? {};
  const rawOrigin = environment.webOrigin;
  const webOrigin = rawOrigin && !String(rawOrigin).includes('<')
    ? (String(rawOrigin).startsWith('http') ? String(rawOrigin) : `https://${rawOrigin}`)
    : 'http://localhost:3000';

  // The one Cloudflare credential, optional: tier 1 degrades to the wrangler
  // login session without it. Read by name; the value is never echoed.
  const rawToken = env.AQ_CF_READ_TOKEN;
  const cfReadToken = typeof rawToken === 'string' && rawToken.trim() !== '' ? rawToken : null;

  // What the ops tools need from the profile, resolved once: the server
  // environment's D1 (bookmark_now) and the production names the restore
  // instructions are filled with. Conventions are the runbook's fallbacks.
  const production = profile?.environments?.production ?? {};
  const ops = {
    database: environment?.d1?.name ?? null,
    wranglerEnv: envName === 'production' ? label : `${label}-staging`,
    production: {
      database: production?.d1?.name ?? `${label}-db`,
      mediaBucket: production?.r2?.bucket ?? `${label}-media`,
      backupBucket: production?.backup?.bucket ?? `${label}-backups`,
    },
  };

  const stateDir = join(rootDir, '.arenaquest');
  return {
    label,
    env: envName,
    baseUrl,
    webOrigin,
    email: env.AQ_ADMIN_EMAIL,
    password: env.AQ_ADMIN_PASSWORD,
    cfReadToken,
    ops,
    auditPath: join(stateDir, `mcp-audit-${label}-${envName}.jsonl`),
    uploadLedgerPath: join(stateDir, `mcp-upload-${label}-${envName}.jsonl`),
    convertDir: join(stateDir, 'mcp-convert', `${label}-${envName}`),
  };
}

// -- server -------------------------------------------------------------------

/**
 * Build the `McpServer` with every tool registered: the authoring tools, then
 * the ops tools by tier. `client` defaults to the shared API client over
 * `config`; tests pass a stub (and, through `deps`, a `spawn` stub for the ops
 * tools). Returns `{ server, tools }`.
 */
export function createServer({ config, client, audit, deps = {}, version = readVersion() }) {
  if (!config) throw new TypeError('createServer: config is required');
  const apiClient =
    client ??
    createApiClient({ baseUrl: config.baseUrl, email: config.email, password: config.password });
  const auditLog = audit ?? createAudit(config.auditPath);

  const server = new McpServer({ name: SERVER_NAME, version });
  const authoring = registerAuthoringTools(server, { client: apiClient, config, audit: auditLog, ...deps });
  const ops = registerOpsTools(server, { client: apiClient, config, audit: auditLog, ...deps });
  return { server, tools: [...authoring, ...ops] };
}

function log(message) {
  // stderr only: stdout carries the JSON-RPC stream.
  process.stderr.write(`${SERVER_NAME}: ${message}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    log(err.message);
    process.stderr.write(usage());
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    // The one deliberate stdout write: a human asked for it, no client is attached.
    process.stdout.write(usage());
    return;
  }

  let config;
  try {
    config = loadConfig({ label: args.label, envName: args.env });
  } catch (err) {
    log(err.message);
    process.exitCode = 1;
    return;
  }

  const version = readVersion();
  const { server, tools } = createServer({ config, version });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Credentials are named only by their variable, never by a value.
  log(
    `v${version} — label ${config.label}, env ${config.env} → ${config.baseUrl} ` +
      `(AQ_ADMIN_EMAIL set, AQ_CF_READ_TOKEN ${config.cfReadToken ? 'set' : 'unset — tier 1 uses the wrangler login session'})`,
  );
  log(`${tools.length} tools: ${tools.map((tool) => tool.name).join(', ')}`);
  log(`audit → ${config.auditPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => {
    log(err?.message ?? String(err));
    process.exitCode = 1;
  });
}
