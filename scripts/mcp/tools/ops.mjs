/**
 * scripts/mcp/tools/ops.mjs — Plane B of aq-mcp (RFC 0025 §5): the eight
 * operations and backup tools, in the RFC's three tiers.
 *
 *   tier 1 — diagnose (read-only, auto-approvable)
 *     system_health        GET /v1/admin/ops/health
 *     job_runs             GET /v1/admin/ops/job-runs
 *     backup_status        scripts/backup/status.mjs --json
 *     time_travel_status   the `timeTravel` slice of the same report
 *     infra_status         scripts/cloudflare/provision-label.mjs --check --json
 *   tier 2 — reversible action (two-call protocol, operator's wrangler login)
 *     backup_now           scripts/backup/export-d1.mjs (plan, then --yes)
 *     bookmark_now         wrangler d1 time-travel info (records a bookmark)
 *   tier 3 — destructive (no executor)
 *     restore_instructions returns the command and the runbook section; spawns nothing
 *
 * Credentials per tier, enforced by the environment each child receives:
 *
 *   - tier-1 spawns get an allowlisted environment (PATH, HOME, NODE_*, ...)
 *     plus `CLOUDFLARE_API_TOKEN` = `AQ_CF_READ_TOKEN`, the one Cloudflare
 *     credential the server loads. The value travels in the child's env
 *     object only — never argv, never a log line, never a tool result. When
 *     the variable is unset the child falls back to the operator's
 *     `wrangler login` session and the result says so in a `note`;
 *   - tier-2 spawns get the same allowlist WITHOUT any token, so the action
 *     runs on the operator's own `wrangler login`, and only after a valid
 *     single-use confirmation id (`../confirm.mjs`);
 *   - tier 3 has no spawn at all. The static guard
 *     (`../no-destructive.test.mjs`) pins that no spawned argv under
 *     `scripts/mcp/` carries a restore, an SQL execute, a deploy, a delete or
 *     a `secret put`, and that those words appear in this file only inside
 *     `restoreInstructionsFor` — the text builder — or in comments.
 *
 * Wrap, do not re-implement: every tier-1 and tier-2 tool spawns the existing
 * script (or the bookmark command the deploy CLI already uses) and parses its
 * output. `spawn` is injected so the tests never start a process.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { withRetry } from '../../lib/api-client.mjs';
import { bookmarkCommand, formatCommand, parseBookmark, restoreCommand } from '../../db/reset-remote.mjs';
import { createConfirmations as defaultCreateConfirmations, describeRefusal } from '../confirm.mjs';
import { READ_ANNOTATIONS, callTool } from './authoring.mjs';

/** The eight tool names, in the order they are registered (tier 1, 2, 3). */
export const OPS_TOOL_NAMES = [
  'system_health',
  'job_runs',
  'backup_status',
  'time_travel_status',
  'infra_status',
  'backup_now',
  'bookmark_now',
  'restore_instructions',
];

export const TIER_1_TOOL_NAMES = ['system_health', 'job_runs', 'backup_status', 'time_travel_status', 'infra_status'];
export const TIER_2_TOOL_NAMES = ['backup_now', 'bookmark_now'];
export const TIER_3_TOOL_NAMES = ['restore_instructions'];

/** Tier 2: not read-only, creates something, destroys nothing, reaches Cloudflare. */
export const ACTION_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
});

/** The repository root — three levels above this file. Scripts are spawned from it. */
export const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const RUNBOOK = 'docs/operations/backup-restore.md';
export const RESTORE_SCENARIOS = ['minutes-ago', 'database-lost', 'object-deleted'];
export const JOB_NAMES = ['billing', 'sweep_submissions'];
export const INFRA_ENVS = ['staging', 'production'];

/** How long a status report answers `time_travel_status` without a new spawn. */
export const STATUS_CACHE_MS = 30_000;

export const NO_TOKEN_NOTE = 'AQ_CF_READ_TOKEN not set — using the wrangler login session';

// -- child environment --------------------------------------------------------

/** Exact names a child may inherit. */
const ENV_ALLOW_KEYS = ['PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'TZ', 'TERM', 'CI'];
/** Prefixes a child may inherit (`NODE_OPTIONS`, `PNPM_HOME`, `XDG_CONFIG_HOME`, ...). */
const ENV_ALLOW_PREFIXES = ['NODE_', 'PNPM_', 'XDG_', 'LC_'];

/**
 * The environment a spawned child receives. Pure: built from `base` (the
 * server's `process.env` by default) through the allowlist above, so neither
 * `CF_API_TOKEN`, `CLOUDFLARE_API_TOKEN`, `R2_*` nor the `AQ_*` credentials
 * ever reach a child by inheritance. Tier 1 adds `CLOUDFLARE_API_TOKEN` from
 * `token` when one is given; tier 2 never adds a token.
 */
export function childEnvFor(tier, { base = process.env, token = null } = {}) {
  if (tier !== 1 && tier !== 2) throw new TypeError(`childEnvFor: tier must be 1 or 2 (got ${tier})`);
  const env = {};
  for (const [key, value] of Object.entries(base ?? {})) {
    if (value === undefined) continue;
    if (ENV_ALLOW_KEYS.includes(key) || ENV_ALLOW_PREFIXES.some((prefix) => key.startsWith(prefix))) env[key] = value;
  }
  if (tier === 1 && typeof token === 'string' && token.trim() !== '') env.CLOUDFLARE_API_TOKEN = token;
  return env;
}

// -- spawning -----------------------------------------------------------------

/** The default spawner: `spawnSync`'s shape, captured, from the repository root. */
export function defaultSpawn(file, args, { cwd, env } = {}) {
  return spawnSync(file, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function firstLine(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? '';
}

function lastLines(text, count) {
  const lines = String(text ?? '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');
  return lines.slice(-count);
}

/** The first JSON object printed on stdout (a banner before it is skipped). */
function parseJsonStdout(stdout, what) {
  const text = String(stdout ?? '');
  const start = text.search(/^[[{]/m);
  if (start < 0) throw new Error(`${what} printed no JSON`);
  try {
    return JSON.parse(text.slice(start));
  } catch (err) {
    throw new Error(`${what} printed invalid JSON: ${err.message}`);
  }
}

/** `?job=…&since=…&limit=…` with only the keys that are set. */
export function jobRunsQuery({ job, since, limit } = {}) {
  const params = new URLSearchParams();
  if (job !== undefined) params.set('job', job);
  if (since !== undefined) params.set('since', since);
  if (limit !== undefined) params.set('limit', String(limit));
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

/** A policy answer the model should read; never an MCP error. */
function refuse(reason, extra = {}) {
  return { refused: true, reason, ...extra };
}

// -- tier 3: the text builder ------------------------------------------------

/**
 * The restore command and runbook section for `scenario`, filled for the
 * label. Pure text: this is the ONLY place in `scripts/mcp/` where a restore,
 * an SQL execute, a deploy or a delete may be spelled out, and the static
 * guard excises exactly this function from its source scan. Nothing here is
 * ever passed to `spawn`.
 */
export function restoreInstructionsFor(config, { scenario, bookmark } = {}) {
  const label = config.label;
  const production = config.ops?.production ?? {};
  const database = production.database ?? `${label}-db`;
  const mediaBucket = production.mediaBucket ?? `${label}-media`;
  const backupBucket = production.backupBucket ?? `${label}-backups`;
  const target = { database, wranglerEnv: label };
  const wrangler = 'pnpm --filter api exec wrangler';
  const never = 'tier 3: the assistant never runs this — a human types it at a terminal, after recording a bookmark (bookmark_now)';

  switch (scenario) {
    case 'minutes-ago':
      return {
        scenario,
        label,
        runbook: `${RUNBOOK}#1-d1-time-travel`,
        command: formatCommand(restoreCommand(target, bookmark ?? '<bookmark>')),
        steps: [
          `record the current position first (the undo): ${wrangler} d1 time-travel info ${database} --env ${label}`,
          `pick the instant: ${wrangler} d1 time-travel info ${database} --env ${label} --timestamp=<ISO 8601> prints its bookmark`,
          'run the restore command above; wrangler asks for confirmation',
          `verify (${RUNBOOK}#4-verify): row counts, GET /health, a backoffice login`,
        ],
        note: never,
      };
    case 'database-lost':
      return {
        scenario,
        label,
        runbook: `${RUNBOOK}#2-restore-a-dump`,
        command: [
          `${wrangler} r2 object get ${backupBucket}/d1/production/manifest.json --file manifest.json --remote`,
          `${wrangler} r2 object get ${backupBucket}/<d1.latest.key> --file dump.sql.gz --remote`,
          'sha256sum dump.sql.gz && gunzip --keep dump.sql.gz',
          `${wrangler} d1 create ${database}-restored`,
          `${wrangler} d1 execute ${database}-restored --remote --file dump.sql`,
        ].join('\n'),
        steps: [
          'read d1.latest.key, d1.latest.sha256 and d1.latest.bytes from the manifest',
          'download the dump and STOP on a checksum or size mismatch',
          `restore into a NEW database (${database}-restored); production keeps its id until you switch`,
          `to switch: set the new uuid in config/labels/${label}.jsonc and apps/api/wrangler.jsonc, then make deploy-api-prod DEPLOY_LABEL=${label}`,
          `verify (${RUNBOOK}#4-verify): row counts against d1.latest.rowCounts`,
        ],
        note: never,
      };
    case 'object-deleted':
      return {
        scenario,
        label,
        runbook: `${RUNBOOK}#3-r2-copy-back`,
        command: [
          `${wrangler} r2 object get ${backupBucket}/r2/production/<key> --file restored.bin --remote`,
          `${wrangler} r2 object put ${mediaBucket}/<key> --file restored.bin --content-type <mime-type> --remote`,
        ].join('\n'),
        steps: [
          `confirm the key is mirrored: ${wrangler} r2 object get ${backupBucket}/r2/production/index.json --file index.json --remote`,
          'download the mirrored object and put it back under its original key with its content type',
          `check it is byte-identical: ${wrangler} r2 object get ${mediaBucket}/<key> --file check.bin --remote && sha256sum restored.bin check.bin`,
          'an object deleted from the source stays mirrored for backup.retention.tombstoneDays (90) and is pruned after',
        ],
        note: never,
      };
    default:
      throw new Error(`restore_instructions: scenario must be one of ${RESTORE_SCENARIOS.join(' | ')} (got "${scenario}")`);
  }
}

// -- tool builders -----------------------------------------------------------

/**
 * Build the eight tools. `config` is the server's (`{ label, env,
 * cfReadToken, ops: { database, wranglerEnv, production } }`); `client` the
 * API client (tier-1 routes); `spawn` the process spawner; `confirmations`
 * the id store; `clock` the wall clock; `env` the server's environment the
 * child allowlist is drawn from; `cwd` where children run.
 *
 * Each tool is `{ name, title, description, inputSchema, annotations, run }`,
 * the authoring shape, so `callTool` adds the audit line and the MCP envelope.
 */
export function buildOpsTools({
  client,
  config,
  env = process.env,
  spawn = defaultSpawn,
  confirmations = defaultCreateConfirmations(),
  clock = () => new Date(),
  cwd = REPO_ROOT,
} = {}) {
  if (!client) throw new TypeError('buildOpsTools: client is required');
  if (!config) throw new TypeError('buildOpsTools: config is required');

  const label = config.label;
  const token = config.cfReadToken ?? null;
  const tier1Env = () => childEnvFor(1, { base: env, token });
  const tier2Env = () => childEnvFor(2, { base: env });
  const note = token ? null : NO_TOKEN_NOTE;
  const withNote = (result) => (note ? { ...result, note } : result);

  const statusScript = join('scripts', 'backup', 'status.mjs');
  const exportScript = join('scripts', 'backup', 'export-d1.mjs');
  const provisionScript = join('scripts', 'cloudflare', 'provision-label.mjs');

  function runScript(tier, script, args) {
    const childEnv = tier === 1 ? tier1Env() : tier2Env();
    const result = spawn(process.execPath, [script, ...args], { cwd, env: childEnv });
    if (result?.error) throw new Error(`${script} could not be started: ${result.error.message}`);
    return result;
  }

  /** The `--json` report of a script whose exit 1/2 is data, not failure. */
  function jsonReport(script, args, { dataExits = [0, 1, 2] } = {}) {
    const result = runScript(1, script, args);
    const what = `${script} ${args.join(' ')}`;
    if (!dataExits.includes(result.status)) {
      throw new Error(`${what} exited ${result.status ?? 'by signal'}: ${firstLine(result.stderr) || firstLine(result.stdout) || 'no output'}`);
    }
    let report;
    try {
      report = parseJsonStdout(result.stdout, what);
    } catch (err) {
      const hint = firstLine(result.stderr);
      throw new Error(hint ? `${err.message} (${hint})` : err.message);
    }
    return { report, exitCode: result.status };
  }

  // One status spawn feeds both backup_status and time_travel_status.
  let statusCache = null;
  function statusReport({ maxAgeMs = 0 } = {}) {
    const at = clock().getTime();
    if (maxAgeMs > 0 && statusCache && at - statusCache.at <= maxAgeMs) return statusCache.report;
    const { report } = jsonReport(statusScript, ['--label', label, '-e', 'production', '--json']);
    statusCache = { at, report };
    return report;
  }

  /** The tier-2 target: the server environment's D1, as the deploy CLI names it. */
  function bookmarkTarget() {
    const database = config.ops?.database;
    if (!database) throw new Error(`config/labels/${label}.jsonc has no environments.${config.env}.d1.name`);
    return { database, wranglerEnv: config.ops?.wranglerEnv ?? (config.env === 'production' ? label : `${label}-staging`) };
  }

  /** The two-call protocol: no id → plan + id; an id → consume or refuse. */
  function confirmOrPlan(tool, args, buildPlan) {
    const { confirmationId, ...bound } = args ?? {};
    if (confirmationId === undefined || confirmationId === null || confirmationId === '') {
      const plan = buildPlan();
      const issued = confirmations.issue(tool.name, bound);
      return {
        proceed: false,
        result: {
          ...plan,
          confirmationId: issued.id,
          expiresAt: issued.expiresAt,
          note: `plan only — nothing was executed. To execute, call ${tool.name} again with this confirmationId before ${issued.expiresAt} (single use).`,
        },
      };
    }
    const verdict = confirmations.consume(String(confirmationId), tool.name, bound);
    if (!verdict.ok) return { proceed: false, result: refuse(describeRefusal(verdict.reason, tool.name), { code: verdict.reason }) };
    return { proceed: true };
  }

  // -- tier 1 ---------------------------------------------------------------

  const systemHealth = {
    name: 'system_health',
    title: 'System health',
    description:
      'Tier 1 (read-only). Measured health of the API: D1, KV and R2 probes with latency, the newest applied migration ' +
      'and the last run of every scheduled job (GET /v1/admin/ops/health). The verdict is in the body.',
    inputSchema: {},
    annotations: READ_ANNOTATIONS,
    async run() {
      return withRetry(() => client.request('GET', '/v1/admin/ops/health'));
    },
  };

  const jobRuns = {
    name: 'job_runs',
    title: 'Job runs',
    description:
      'Tier 1 (read-only). The scheduled-job ledger, newest first (GET /v1/admin/ops/job-runs): billing and the ' +
      'submission sweep, cron or manual, including failures and empty days.',
    inputSchema: {
      job: z.enum(JOB_NAMES).optional().describe('Only this job'),
      since: z.string().optional().describe('ISO 8601 timestamp; only runs started at or after it'),
      limit: z.number().int().min(1).max(200).optional().describe('Page size (API default when omitted)'),
    },
    annotations: READ_ANNOTATIONS,
    async run({ job, since, limit } = {}) {
      if (since !== undefined && Number.isNaN(Date.parse(since))) return refuse(`since must be an ISO 8601 timestamp (got "${since}")`);
      return withRetry(() => client.request('GET', `/v1/admin/ops/job-runs${jobRunsQuery({ job, since, limit })}`));
    },
  };

  const backupStatus = {
    name: 'backup_status',
    title: 'Backup status',
    description:
      'Tier 1 (read-only). "Was a backup made, and what do I do if not?" for the label\'s PRODUCTION data: dump age, ' +
      'size delta, last restore drill, R2 mirror lag, Time Travel bookmark and the last home-lab pull on this machine — ' +
      'each line green/amber/red with the command that fixes it (printed, never run). The same report as ' +
      'make backup-status-prod; status red/amber is data, not an error.',
    inputSchema: {},
    annotations: READ_ANNOTATIONS,
    async run() {
      return withNote(statusReport({ maxAgeMs: 0 }));
    },
  };

  const timeTravelStatus = {
    name: 'time_travel_status',
    title: 'Time Travel status',
    description:
      'Tier 1 (read-only). The current D1 Time Travel bookmark of the label\'s PRODUCTION database and the window note ' +
      '(the window is a plan property, not probed). Reuses a backup_status report younger than 30 seconds.',
    inputSchema: {},
    annotations: READ_ANNOTATIONS,
    async run() {
      const report = statusReport({ maxAgeMs: STATUS_CACHE_MS });
      const line = (report.lines ?? []).find((item) => item.id === 'timeTravel') ?? null;
      return withNote({
        label: report.label,
        env: report.env,
        checkedAt: report.checkedAt,
        bookmark: report.data?.timeTravel?.bookmark ?? null,
        windowNote: report.data?.timeTravel?.windowNote ?? null,
        line,
      });
    },
  };

  const infraStatus = {
    name: 'infra_status',
    title: 'Infrastructure status',
    description:
      'Tier 1 (read-only). Which Cloudflare resources of the label exist (D1, KV, media and backup buckets, Pages project, ' +
      'Worker) and which secrets are set — by name only, never a value — with the fix command for each gap ' +
      '(provision-label.mjs --check --json). exitCode 0 ok, 1 missing, 2 unknown.',
    inputSchema: {
      env: z.enum(INFRA_ENVS).optional().describe('Environment to check; defaults to the server\'s'),
    },
    annotations: READ_ANNOTATIONS,
    async run({ env: wanted } = {}) {
      const target = wanted ?? config.env;
      const { report } = jsonReport(provisionScript, ['--label', label, '-e', target, '--check', '--json']);
      return withNote(report);
    },
  };

  // -- tier 2 ---------------------------------------------------------------

  const backupNow = {
    name: 'backup_now',
    title: 'Back up the production D1 now',
    description:
      'Tier 2 (reversible action, two calls). Without confirmationId: returns the export plan (export-d1.mjs --dry-run) ' +
      'and a single-use confirmation id valid for 5 minutes; nothing is exported. With a valid confirmationId: runs the ' +
      'export once, on the operator\'s own wrangler login, writing only to the backup bucket. A reused, expired or ' +
      'foreign id is refused.',
    inputSchema: {
      confirmationId: z.string().optional().describe('The id returned by the previous backup_now call'),
    },
    annotations: ACTION_ANNOTATIONS,
    async run(args = {}) {
      const gate = confirmOrPlan(backupNow, args, () => {
        const dry = runScript(1, exportScript, ['--label', label, '-e', 'production', '--dry-run']);
        if (dry.status !== 0) throw new Error(`export-d1.mjs --dry-run exited ${dry.status ?? 'by signal'}: ${firstLine(dry.stderr) || firstLine(dry.stdout)}`);
        return { plan: `${dry.stdout ?? ''}${dry.stderr ?? ''}`.trim() };
      });
      if (!gate.proceed) return gate.result;

      const result = runScript(2, exportScript, ['--label', label, '-e', 'production', '--yes']);
      const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
      if (result.status !== 0) throw new Error(`export-d1.mjs exited ${result.status ?? 'by signal'}: ${firstLine(result.stderr) || firstLine(result.stdout)}`);
      statusCache = null;
      return { ok: true, label, env: 'production', finishedAt: clock().toISOString(), summary: lastLines(output, 6) };
    },
  };

  const bookmarkNow = {
    name: 'bookmark_now',
    title: 'Record a Time Travel bookmark now',
    description:
      'Tier 2 (reversible action, two calls). Without confirmationId: returns the exact wrangler command that will run ' +
      'and a single-use confirmation id valid for 5 minutes. With a valid confirmationId: records the current D1 Time ' +
      'Travel bookmark of the server\'s environment on the operator\'s own wrangler login and returns it with the restore ' +
      'command AS TEXT (never run). A reused, expired or foreign id is refused.',
    inputSchema: {
      confirmationId: z.string().optional().describe('The id returned by the previous bookmark_now call'),
    },
    annotations: ACTION_ANNOTATIONS,
    async run(args = {}) {
      const target = bookmarkTarget();
      const command = bookmarkCommand(target);
      const gate = confirmOrPlan(bookmarkNow, args, () => ({
        plan: formatCommand(command),
        database: target.database,
        wranglerEnv: target.wranglerEnv,
      }));
      if (!gate.proceed) return gate.result;

      const result = spawn(command[0], command.slice(1), { cwd, env: tier2Env() });
      if (result?.error) throw new Error(`${command[0]} could not be started: ${result.error.message}`);
      if (result.status !== 0) throw new Error(`wrangler d1 time-travel info exited ${result.status ?? 'by signal'}: ${firstLine(result.stderr) || firstLine(result.stdout)}`);
      const bookmark = parseBookmark(result.stdout);
      return {
        bookmark,
        database: target.database,
        wranglerEnv: target.wranglerEnv,
        recordedAt: clock().toISOString(),
        restoreCommand: formatCommand(restoreCommand(target, bookmark)),
        note: 'the restore command is text for a human (tier 3); the assistant never runs it',
      };
    },
  };

  // -- tier 3 ---------------------------------------------------------------

  const restoreInstructions = {
    name: 'restore_instructions',
    title: 'Restore instructions',
    description:
      'Tier 3 (destructive — no executor). Returns the exact restore command for the label and the runbook section ' +
      '(docs/operations/backup-restore.md) for the scenario: minutes-ago (D1 Time Travel), database-lost (restore a ' +
      'dump) or object-deleted (R2 copy-back). Executes nothing; a human runs it.',
    inputSchema: {
      scenario: z.enum(RESTORE_SCENARIOS).describe('minutes-ago | database-lost | object-deleted'),
      bookmark: z.string().optional().describe('A Time Travel bookmark to fill into the minutes-ago command'),
    },
    annotations: READ_ANNOTATIONS,
    async run({ scenario, bookmark } = {}) {
      return restoreInstructionsFor(config, { scenario, bookmark });
    },
  };

  return [systemHealth, jobRuns, backupStatus, timeTravelStatus, infraStatus, backupNow, bookmarkNow, restoreInstructions];
}

/** Register the eight tools on an `McpServer`, through the authoring envelope. Returns the built tool list. */
export function registerOpsTools(server, { audit, now, ...deps }) {
  if (!audit) throw new TypeError('registerOpsTools: audit is required');
  const tools = buildOpsTools(deps);
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { title: tool.title, ...tool.annotations },
      },
      (args) => callTool(tool, args, { audit, ...(now ? { now } : {}) }),
    );
  }
  return tools;
}
