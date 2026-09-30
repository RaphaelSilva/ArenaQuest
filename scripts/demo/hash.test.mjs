/**
 * Unit tests for scripts/demo/hash.mjs — the PBKDF2 format the API reads.
 * Run with: node --test scripts/demo/hash.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PBKDF2_ITERATIONS, derivePbkdf2Hex, hashPassword, verifyPassword } from './hash.mjs';

// Produced by `pnpm --filter api exec tsx scripts/gen-hash.ts --password demo-fixture-password`,
// i.e. by the real JwtAuthAdapter.hashPassword. It pins the format both ways.
const ADAPTER_HASH =
  'pbkdf2:100000:305b47a66fc856b30db4f310a3d72e25:2fe3fcc21a037d07bd76ec4fa784aa3c54a9e77545e49700a4797336739112c0';

test('iterations are pinned to the Workers ceiling', () => {
  assert.equal(PBKDF2_ITERATIONS, 100_000);
});

test('re-deriving the adapter hash with its salt yields its key', async () => {
  const [, iterations, salt, key] = ADAPTER_HASH.split(':');
  assert.equal(await derivePbkdf2Hex('demo-fixture-password', salt, Number(iterations)), key);
  assert.equal(await verifyPassword('demo-fixture-password', ADAPTER_HASH), true);
  assert.equal(await verifyPassword('wrong-password', ADAPTER_HASH), false);
});

test('hashPassword writes the adapter shape: pbkdf2:100000:<32 hex>:<64 hex>', async () => {
  const hash = await hashPassword('another password');
  assert.match(hash, /^pbkdf2:100000:[0-9a-f]{32}:[0-9a-f]{64}$/);
  assert.equal(await verifyPassword('another password', hash), true);
});

test('a fixed salt reproduces the adapter hash exactly', async () => {
  const salt = Buffer.from(ADAPTER_HASH.split(':')[2], 'hex');
  assert.equal(await hashPassword('demo-fixture-password', { salt }), ADAPTER_HASH);
});

test('salts are random, so two hashes of one password differ', async () => {
  assert.notEqual(await hashPassword('same'), await hashPassword('same'));
});

test('an empty password is refused', async () => {
  await assert.rejects(() => hashPassword(''), TypeError);
});

test('verifyPassword rejects a malformed or placeholder hash', async () => {
  assert.equal(await verifyPassword('x', '!dry-run:no-password-set'), false);
  assert.equal(await verifyPassword('x', 'bcrypt:1:2:3'), false);
});
