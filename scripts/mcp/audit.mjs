/**
 * scripts/mcp/audit.mjs — the aq-mcp audit trail (RFC 0025 §7).
 *
 * One JSON line per tool call, appended to
 * `.arenaquest/mcp-audit-<label>-<env>.jsonl` (gitignored, like the importer's
 * ledger): timestamp, tool, arguments MINUS content bodies, outcome, duration
 * and the error's first line when there is one. API writes are additionally
 * attributable server-side to the dedicated content-creator account.
 *
 * Two rules the tests pin:
 *   - a body (`markdown`, `content`, `body`) is never written — only its byte
 *     length, so the line says "a 4 KB edit happened" without copying the edit;
 *   - a credential never reaches the file. Credentials are not tool arguments
 *     by construction (they come from the environment), and `redact` drops any
 *     key that looks like one anyway, so a future tool cannot leak by accident.
 *
 * stdlib only, ESM, zero dependencies.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Keys whose VALUE is replaced by its byte length (`<key>Bytes`). */
export const BODY_KEYS = ['markdown', 'content', 'body'];

/** Keys that are dropped outright, whatever their value. */
const SECRET_KEY_PATTERN = /password|passwd|secret|token|authorization|apikey|api_key/i;

/**
 * The outcomes a record may carry. `refused` is a policy answer (not a draft,
 * over the limit, no ffmpeg) returned to the model as a normal result; `error`
 * is a thrown failure (API error, missing file) surfaced as an MCP tool error.
 */
export const OUTCOMES = ['ok', 'refused', 'error'];

/**
 * Arguments as they may appear in the audit log: ids, titles, paths and tags
 * are kept; bodies become their byte length; credential-looking keys vanish.
 * Pure — never mutates its input; a non-object is recorded as `{}`.
 */
export function redact(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  const out = {};
  for (const [key, value] of Object.entries(args)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    if (BODY_KEYS.includes(key)) {
      out[`${key}Bytes`] = typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0;
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Build the audit writer for one server. `record` is synchronous and appends
 * one line; a write failure is reported on stderr rather than thrown, because
 * a full disk must not turn a successful upload into a reported failure.
 */
export function createAudit(path, { now = () => new Date(), append = defaultAppend, onError = defaultOnError } = {}) {
  function record({ tool, args, outcome, durationMs, error }) {
    if (!OUTCOMES.includes(outcome)) {
      throw new TypeError(`audit outcome must be one of ${OUTCOMES.join(', ')} (got "${outcome}")`);
    }
    const line = {
      at: now().toISOString(),
      tool,
      args: redact(args),
      outcome,
      durationMs: Math.max(0, Math.round(durationMs ?? 0)),
      ...(error ? { error: String(error).split('\n')[0] } : {}),
    };
    try {
      append(path, `${JSON.stringify(line)}\n`);
    } catch (err) {
      onError(err);
    }
    return line;
  }

  return { path, record };
}

function defaultAppend(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, text, 'utf8');
}

function defaultOnError(err) {
  // stderr only: stdout is the MCP channel.
  console.error(`aq-mcp: audit line not written: ${err.message}`);
}
