#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(SCRIPT_PATH));

/** Strip JSONC comments and trailing commas without changing string literals. */
export function stripJsonc(text) {
  let output = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (inLineComment) {
      if (character === '\n') {
        inLineComment = false;
        output += character;
      }
      continue;
    }
    if (inBlockComment) {
      if (character === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      output += character;
      if (character === '\\') {
        output += next;
        index += 1;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
    } else if (character === '/' && next === '/') {
      inLineComment = true;
      index += 1;
    } else if (character === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
    } else {
      output += character;
    }
  }

  return output.replace(/,(\s*[}\]])/g, '$1');
}

export function parseJsonc(text) {
  return JSON.parse(stripJsonc(text));
}

export function resolveWranglerVars(wrangler, environment) {
  if (environment === 'production') return { ...(wrangler.vars ?? {}) };
  if (environment === 'staging') return { ...(wrangler.env?.staging?.vars ?? {}) };
  return {};
}

export function resolveWorkflowWebBuild(workflow, environment) {
  const targetJob = `deploy-${environment}`;
  const resolved = {};
  let inTargetJob = false;
  let envIndent = null;

  for (const line of workflow.split(/\r?\n/)) {
    const job = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (job) {
      inTargetJob = job[1] === targetJob;
      envIndent = null;
      continue;
    }
    if (!inTargetJob) continue;

    const env = line.match(/^(\s*)env:\s*$/);
    if (env) {
      envIndent = env[1].length;
      continue;
    }
    if (envIndent === null) continue;

    const entry = line.match(/^(\s*)(NEXT_PUBLIC_[A-Z0-9_]+):\s*(.*?)\s*$/);
    if (entry && entry[1].length > envIndent) {
      resolved[entry[2]] = unquote(entry[3]);
    } else if (line.trim() && line.search(/\S/) <= envIndent) {
      envIndent = null;
    }
  }
  return resolved;
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\s+#.*$/, '').trim();
}

export function parseDotEnv(text) {
  const resolved = {};
  for (const line of text.split(/\r?\n/)) {
    const entry = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!entry) continue;
    resolved[entry[1]] = unquote(entry[2]);
  }
  return resolved;
}

export function parseSecretNames(output) {
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed)) throw new Error('unexpected wrangler secret list response');
  return new Set(parsed.flatMap((entry) => (typeof entry?.name === 'string' ? [entry.name] : [])));
}

export function parseArgs(argv) {
  const usage = 'Usage: node scripts/preflight.mjs --env <local|staging|production>';
  if (argv.length !== 2 || argv[0] !== '--env') throw new Error(usage);
  if (!['local', 'staging', 'production'].includes(argv[1])) {
    throw new Error('--env must be local, staging, or production');
  }
  return { environment: argv[1] };
}

function requiredWhenActive(condition, values) {
  if (!condition) return false;
  const separator = condition.indexOf('=');
  if (separator < 1) return false;
  const key = condition.slice(0, separator).trim();
  const expected = condition.slice(separator + 1).trim();
  return String(values[key] ?? '') === expected;
}

function isMissing(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

/**
 * Evaluate manifest presence and enum constraints without performing I/O.
 * Secret scopes receive sets of names, never maps containing secret values.
 */
export function evaluatePresence(manifest, resolved) {
  const values = {
    ENV: resolved.environment,
    ...(resolved.webBuild ?? {}),
    ...(resolved.apiVars ?? {}),
  };
  const sources = {
    'web-build': resolved.webBuild ?? {},
    'api-vars': resolved.apiVars ?? {},
    'api-secrets': resolved.apiSecretNames,
    'ci-secrets': resolved.ciSecretNames,
  };
  const results = [];

  for (const scope of ['web-build', 'api-vars', 'api-secrets', 'ci-secrets']) {
    const source = sources[scope];
    const secretScope = scope === 'api-secrets' || scope === 'ci-secrets';
    for (const [key, spec] of Object.entries(manifest[scope] ?? {})) {
      const conditionActive = requiredWhenActive(spec.requiredWhen, values);
      const active = Boolean(spec.required) || conditionActive;

      if (!active) {
        const optionalValue = secretScope ? source?.has(key) : source?.[key];
        if (optionalValue === undefined || optionalValue === false || isMissing(optionalValue)) {
          results.push({ scope, key, status: 'pass', detail: 'optional, not set' });
          continue;
        }
      }

      if (secretScope && source === null) {
        results.push({ scope, key, status: 'skip', detail: 'secret-name lookup unavailable' });
        continue;
      }

      const present = secretScope ? source?.has(key) === true : !isMissing(source?.[key]);
      if (!present) {
        results.push({
          scope,
          key,
          status: 'fail',
          detail: conditionActive ? `missing (required when ${spec.requiredWhen})` : 'missing',
        });
        continue;
      }

      const value = secretScope ? undefined : source[key];
      if (spec.enum && !spec.enum.includes(String(value))) {
        results.push({
          scope,
          key,
          status: 'fail',
          detail: `invalid; expected one of: ${spec.enum.join(', ')}`,
        });
        continue;
      }

      results.push({
        scope,
        key,
        status: 'pass',
        detail: secretScope ? 'present by name' : 'present',
      });
    }
  }
  return results;
}

export function mapExitCode(results) {
  if (results.some((result) => result.status === 'fail')) return 1;
  if (results.some((result) => result.status === 'skip' || result.status === 'manual')) return 2;
  return 0;
}

const ICONS = { pass: '✅', fail: '❌', skip: '⚠️', manual: '⚠️' };

/** Format only the result allow-list, so accidental attached values cannot leak. */
export function formatChecklist(environment, results) {
  const lines = [`Deployment preflight — ${environment}`];
  for (const scope of ['web-build', 'api-vars', 'api-secrets', 'ci-secrets']) {
    const scoped = results.filter((result) => result.scope === scope);
    if (scoped.length === 0) continue;
    lines.push(`  ${scope}`);
    for (const result of scoped) {
      lines.push(`    ${ICONS[result.status] ?? '•'} ${result.key} — ${result.detail}`);
    }
  }
  const failed = results.filter((result) => result.status === 'fail').length;
  const skipped = results.filter((result) => result.status === 'skip').length;
  lines.push('');
  lines.push(`Summary: ${failed} failed, ${skipped} skipped. Exit ${mapExitCode(results)}.`);
  return lines.join('\n');
}

function readJsonc(path) {
  return parseJsonc(readFileSync(path, 'utf8'));
}

function resolveLocalWebBuild() {
  const resolved = {};
  for (const filename of ['.env', '.env.local']) {
    const path = join(ROOT, 'apps', 'web', filename);
    if (existsSync(path)) Object.assign(resolved, parseDotEnv(readFileSync(path, 'utf8')));
  }
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('NEXT_PUBLIC_')) resolved[name] = process.env[name];
  }
  return resolved;
}

function listApiSecretNames(environment) {
  if (environment === 'local') {
    const names = new Set(Object.keys(process.env));
    return names.size === 0 ? null : names;
  }
  const args = ['--dir', 'apps/api', 'exec', 'wrangler', 'secret', 'list', '--json'];
  if (environment === 'staging') args.push('--env', 'staging');
  const result = spawnSync('pnpm', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) return null;
  try {
    return parseSecretNames(result.stdout);
  } catch {
    return null;
  }
}

function currentCiSecretNames() {
  const names = new Set(Object.keys(process.env));
  if (!names.has('CF_API_TOKEN') && !names.has('CF_ACCOUNT_ID')) return null;
  return names;
}

function resolveConfiguration(environment) {
  const manifest = readJsonc(join(ROOT, 'config', 'deployment.manifest.jsonc'));
  let apiVars;
  let webBuild;

  if (environment === 'local') {
    apiVars = Object.fromEntries(
      Object.keys(manifest['api-vars'] ?? {}).flatMap((name) =>
        Object.hasOwn(process.env, name) ? [[name, process.env[name]]] : [],
      ),
    );
    webBuild = resolveLocalWebBuild();
  } else {
    const wrangler = readJsonc(join(ROOT, 'apps', 'api', 'wrangler.jsonc'));
    apiVars = resolveWranglerVars(wrangler, environment);
    const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'deploy-web.yml'), 'utf8');
    webBuild = resolveWorkflowWebBuild(workflow, environment);
  }

  return {
    manifest,
    resolved: {
      environment,
      apiVars,
      webBuild,
      apiSecretNames: listApiSecretNames(environment),
      ciSecretNames: currentCiSecretNames(),
    },
  };
}

function main() {
  try {
    const { environment } = parseArgs(process.argv.slice(2));
    const { manifest, resolved } = resolveConfiguration(environment);
    const results = evaluatePresence(manifest, resolved);
    console.log(formatChecklist(environment, results));
    process.exitCode = mapExitCode(results);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(new URL(`file://${process.argv[1]}`)) === SCRIPT_PATH) {
  main();
}
