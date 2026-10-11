/**
 * scripts/mcp/confirm.test.mjs — the single-use confirmation ids of the tier-2
 * tools: happy path, replay, expiry, cross-tool and cross-argument refusals,
 * and the stable argument hash.
 *
 * Run: node --test scripts/mcp/confirm.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONFIRMATION_REASONS,
  CONFIRMATION_TTL_MS,
  argsHash,
  createConfirmations,
  describeRefusal,
  stableStringify,
} from './confirm.mjs';

/** A deterministic store: a settable clock and a counting byte source. */
function build({ ttlMs } = {}) {
  let clock = 1_000_000;
  let counter = 0;
  const store = createConfirmations({
    now: () => clock,
    random: (n) => Buffer.alloc(n, ++counter),
    ...(ttlMs !== undefined ? { ttlMs } : {}),
  });
  return { store, tick: (ms) => (clock += ms), at: () => clock };
}

test('stableStringify sorts keys at every depth and drops undefined', () => {
  assert.equal(stableStringify({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } }), '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
  assert.equal(stableStringify({ a: undefined, b: null }), '{"b":null}');
  assert.equal(stableStringify(undefined), 'null');
  assert.equal(argsHash({ b: 2, a: 1 }), argsHash({ a: 1, b: 2 }));
  assert.notEqual(argsHash({ a: 1 }), argsHash({ a: 2 }));
  assert.equal(argsHash(undefined), argsHash({}));
  assert.match(argsHash({}), /^[0-9a-f]{64}$/);
});

test('issue returns a 32-hex id with the expiry 5 minutes ahead; consume succeeds exactly once', () => {
  const { store, at } = build();
  assert.equal(CONFIRMATION_TTL_MS, 5 * 60_000);
  const issued = store.issue('backup_now', {});
  assert.match(issued.id, /^[0-9a-f]{32}$/);
  assert.equal(issued.expiresAt, new Date(at() + CONFIRMATION_TTL_MS).toISOString());
  assert.equal(store.size(), 1);

  assert.deepEqual(store.consume(issued.id, 'backup_now', {}), { ok: true });
  assert.deepEqual(store.consume(issued.id, 'backup_now', {}), { ok: false, reason: 'used' });
  assert.deepEqual(store.consume(issued.id, 'backup_now', {}), { ok: false, reason: 'used' }, 'still used, not unknown');
});

test('two issues never share an id; an unknown or malformed id is refused', () => {
  const { store } = build();
  const first = store.issue('backup_now', {});
  const second = store.issue('backup_now', {});
  assert.notEqual(first.id, second.id);
  assert.deepEqual(store.consume('nope', 'backup_now', {}), { ok: false, reason: 'unknown' });
  assert.deepEqual(store.consume(undefined, 'backup_now', {}), { ok: false, reason: 'unknown' });
  assert.deepEqual(store.consume(42, 'backup_now', {}), { ok: false, reason: 'unknown' });
  assert.throws(() => store.issue('', {}), /tool is required/);
});

test('an id expires after the TTL, then reads as expired (and is forgotten)', () => {
  const { store, tick } = build();
  const { id } = store.issue('bookmark_now', {});
  tick(CONFIRMATION_TTL_MS - 1);
  assert.deepEqual(store.consume(id, 'bookmark_now', {}), { ok: true });

  const late = store.issue('bookmark_now', {});
  tick(CONFIRMATION_TTL_MS);
  assert.deepEqual(store.consume(late.id, 'bookmark_now', {}), { ok: false, reason: 'expired' });
  assert.deepEqual(store.consume(late.id, 'bookmark_now', {}), { ok: false, reason: 'unknown' }, 'swept on expiry');
});

test('an id for one tool cannot confirm another; changed arguments are refused', () => {
  const { store } = build();
  const { id } = store.issue('bookmark_now', {});
  assert.deepEqual(store.consume(id, 'backup_now', {}), { ok: false, reason: 'tool-mismatch' });
  assert.deepEqual(store.consume(id, 'bookmark_now', { extra: true }), { ok: false, reason: 'args-mismatch' });
  // A refused consume does not burn the id.
  assert.deepEqual(store.consume(id, 'bookmark_now', {}), { ok: true });

  const bound = store.issue('infra_status', { env: 'staging', b: 1 });
  assert.deepEqual(store.consume(bound.id, 'infra_status', { b: 1, env: 'staging' }), { ok: true }, 'key order is not a change');
});

test('issue sweeps expired entries; a custom ttl is honoured', () => {
  const { store, tick } = build({ ttlMs: 10 });
  store.issue('backup_now', {});
  store.issue('backup_now', {});
  assert.equal(store.size(), 2);
  tick(10);
  store.issue('backup_now', {});
  assert.equal(store.size(), 1);
  assert.equal(store.ttlMs, 10);
});

test('describeRefusal names every reason and tells the operator to ask for a fresh plan', () => {
  for (const reason of CONFIRMATION_REASONS) {
    const text = describeRefusal(reason, 'backup_now');
    assert.match(text, /call backup_now again without an id/);
  }
  assert.match(describeRefusal('expired', 'x'), /5 minutes/);
  assert.match(describeRefusal('tool-mismatch', 'x'), /another tool/);
  assert.match(describeRefusal('bogus', 'x'), /unknown confirmation id/);
});
