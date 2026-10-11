/**
 * scripts/mcp/confirm.mjs — single-use confirmation ids for the tier-2 tools
 * (RFC 0025 §5).
 *
 * A tier-2 tool is a two-call protocol: the first call returns the plan and a
 * confirmation id, the second call carries the id and executes. The id is
 *
 *   - random (16 bytes, hex), so it cannot be guessed or derived;
 *   - bound to ONE tool and to the SHA-256 of its (stably serialised)
 *     arguments, so an id issued for `bookmark_now` cannot confirm
 *     `backup_now`, and a plan confirmed with other arguments is refused;
 *   - single use: a replay answers `used`;
 *   - short-lived: 5 minutes, then `expired`.
 *
 * Held in memory only — one server process lifetime. A restart forgets every
 * pending plan, which is the safe direction. stdlib only, zero dependencies.
 */

import { createHash, randomBytes } from 'node:crypto';

/** How long a plan stays confirmable. */
export const CONFIRMATION_TTL_MS = 5 * 60_000;

/** The refusal reasons `consume` can answer. */
export const CONFIRMATION_REASONS = ['unknown', 'expired', 'used', 'tool-mismatch', 'args-mismatch'];

/**
 * JSON with object keys sorted at every depth, so `{ a: 1, b: 2 }` and
 * `{ b: 2, a: 1 }` hash alike. `undefined` properties are dropped, as
 * `JSON.stringify` does.
 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

/** The fingerprint an id is bound to: the SHA-256 of the stable serialisation. */
export function argsHash(args) {
  return createHash('sha256').update(stableStringify(args ?? {})).digest('hex');
}

/**
 * Build the in-memory store. `now` returns epoch milliseconds, `random(n)`
 * returns `n` random bytes; both are injectable for the tests.
 */
export function createConfirmations({ now = Date.now, random = randomBytes, ttlMs = CONFIRMATION_TTL_MS } = {}) {
  const pending = new Map();

  /** Forget what can never be consumed again. */
  function sweep(at) {
    for (const [id, entry] of pending) {
      if (entry.expiresAt <= at) pending.delete(id);
    }
  }

  /** Issue an id for `tool` called with `args`. Returns `{ id, expiresAt }` (ISO). */
  function issue(tool, args) {
    if (typeof tool !== 'string' || tool === '') throw new TypeError('issue: tool is required');
    const at = now();
    sweep(at);
    const id = Buffer.from(random(16)).toString('hex');
    const expiresAt = at + ttlMs;
    pending.set(id, { tool, argsHash: argsHash(args), expiresAt, used: false });
    return { id, expiresAt: new Date(expiresAt).toISOString() };
  }

  /**
   * Consume `id` for `tool` and `args`. `{ ok: true }` exactly once; otherwise
   * `{ ok: false, reason }` with one of `CONFIRMATION_REASONS`. The checks run
   * in that order, so a stale id is reported as stale before any mismatch.
   */
  function consume(id, tool, args) {
    const at = now();
    const entry = typeof id === 'string' ? pending.get(id) : undefined;
    if (!entry) return { ok: false, reason: 'unknown' };
    if (entry.expiresAt <= at) {
      pending.delete(id);
      return { ok: false, reason: 'expired' };
    }
    if (entry.used) return { ok: false, reason: 'used' };
    if (entry.tool !== tool) return { ok: false, reason: 'tool-mismatch' };
    if (entry.argsHash !== argsHash(args)) return { ok: false, reason: 'args-mismatch' };
    entry.used = true;
    return { ok: true };
  }

  return { issue, consume, ttlMs, size: () => pending.size };
}

/** The sentence a refusal carries, so the model can tell the operator what to do. */
export function describeRefusal(reason, tool) {
  switch (reason) {
    case 'expired':
      return `the confirmation id has expired (ids are valid for ${CONFIRMATION_TTL_MS / 60_000} minutes) — call ${tool} again without an id for a fresh plan`;
    case 'used':
      return `the confirmation id was already used — call ${tool} again without an id for a fresh plan`;
    case 'tool-mismatch':
      return `the confirmation id was issued for another tool — call ${tool} again without an id for a fresh plan`;
    case 'args-mismatch':
      return `the confirmation id was issued for other arguments — call ${tool} again without an id for a fresh plan`;
    default:
      return `unknown confirmation id — call ${tool} again without an id for a fresh plan`;
  }
}
