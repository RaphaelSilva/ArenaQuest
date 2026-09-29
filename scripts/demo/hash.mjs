/**
 * hash.mjs — PBKDF2 password hash in the `JwtAuthAdapter` format (RFC 0021 §3).
 *
 *     pbkdf2:<iterations>:<saltHex>:<derivedKeyHex>
 *
 * PBKDF2-SHA256, a random 16-byte salt and a 32-byte derived key — the exact
 * shape `apps/api/src/adapters/auth/jwt-auth-adapter.ts#hashPassword` writes and
 * `verifyPassword` reads. The iteration count is pinned to 100 000: the Workers
 * runtime refuses anything higher, so a larger value would make every demo
 * login fail. `hash.test.mjs` pins the format against a hash produced by
 * `apps/api/scripts/gen-hash.ts`.
 *
 * Stdlib only (Web Crypto, as the adapter). The plaintext never leaves this
 * module: callers get the hash string back and nothing else.
 */

import { webcrypto } from 'node:crypto';

/** The adapter's (and the Workers runtime's) iteration count. Never change it. */
export const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

const toHex = (bytes) => Buffer.from(bytes).toString('hex');

/** The derived key, hex, of `password` with the given salt (hex) and iterations. */
export async function derivePbkdf2Hex(password, saltHex, iterations = PBKDF2_ITERATIONS) {
  if (typeof password !== 'string' || password.length === 0) throw new TypeError('password must be a non-empty string');
  const keyMaterial = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await webcrypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(saltHex, 'hex'), iterations },
    keyMaterial,
    KEY_BITS,
  );
  return toHex(new Uint8Array(bits));
}

/** `pbkdf2:100000:<saltHex>:<keyHex>` for `password`, with a fresh random salt. */
export async function hashPassword(password, { salt = webcrypto.getRandomValues(new Uint8Array(SALT_BYTES)) } = {}) {
  const saltHex = toHex(salt);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${saltHex}:${await derivePbkdf2Hex(password, saltHex)}`;
}

/** True when `storedHash` (adapter format) was derived from `password`. For tests and checks. */
export async function verifyPassword(password, storedHash) {
  const parts = String(storedHash).split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || !/^[0-9a-f]+$/.test(parts[2])) return false;
  return (await derivePbkdf2Hex(password, parts[2], iterations)) === parts[3];
}
