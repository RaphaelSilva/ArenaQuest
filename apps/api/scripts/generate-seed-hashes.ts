/**
 * Developer utility — run once to regenerate PBKDF2 hashes for seed passwords.
 *
 * Usage (from apps/api/):
 *   npx tsx scripts/generate-seed-hashes.ts
 *
 * Copy the output into migrations/seed/0001_test_users.sql.
 * Never commit plain-text passwords — only the hashes go into the migration.
 */

import { webcrypto } from 'node:crypto';

const crypto = webcrypto as unknown as Crypto;

const ITERATIONS = 100_000;

const ACCOUNTS: Array<{ label: string; password: string }> = [
  { label: 'admin@arenaquest.dev', password: 'Admin1234!' },
  { label: 'student@arenaquest.dev', password: 'Student1234!' },
  { label: 'professor@arenaquest.dev', password: 'Professor1234!' },
];

function uint8ToHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashPassword(plain: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(plain),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256,
  );

  return `pbkdf2:${ITERATIONS}:${uint8ToHex(salt)}:${uint8ToHex(new Uint8Array(bits))}`;
}

for (const { label, password } of ACCOUNTS) {
  const hash = await hashPassword(password);
  console.log(`-- ${label}`);
  console.log(`'${hash}',`);
  console.log();
}
