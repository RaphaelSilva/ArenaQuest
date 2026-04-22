/**
 * Adversarial unit tests for JwtAuthAdapter.
 *
 * Happy-path coverage lives in auth-service.spec.ts and auth.router.spec.ts;
 * this file focuses exclusively on malformed / adversarial inputs.
 *
 * PBKDF2 uses 1 000 iterations so password-hash cases finish in milliseconds.
 */
import { describe, it, expect } from 'vitest';
import { JwtAuthAdapter } from '@api/adapters/auth/jwt-auth-adapter';

const SECRET = 'test-secret-must-be-at-least-32-chars!';
const ALT_SECRET = 'different-secret-must-be-32-chars-too!!';

const adapter = new JwtAuthAdapter({
  secret: SECRET,
  pbkdf2Iterations: 1_000,
  accessTokenExpiresInSeconds: 300,
});

// ── JWT construction helpers ─────────────────────────────────────────────────

function b64url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesToB64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(b64: string): Uint8Array {
  const padded = b64
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSign(input: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
  return bytesToB64url(new Uint8Array(buf));
}

async function buildToken(
  header: object,
  payload: object,
  secret: string,
): Promise<string> {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const sig = await hmacSign(`${h}.${p}`, secret);
  return `${h}.${p}.${sig}`;
}

async function buildRawToken(
  headerB64: string,
  payloadB64: string,
  secret: string,
): Promise<string> {
  const sig = await hmacSign(`${headerB64}.${payloadB64}`, secret);
  return `${headerB64}.${payloadB64}.${sig}`;
}

function goodClaims(): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return { sub: 'u1', email: 'u@example.com', roles: ['student'], iat: now, exp: now + 300 };
}

const GOOD_HEADER = { alg: 'HS256', typ: 'JWT' };

// ── Suite 1: malformed input ─────────────────────────────────────────────────

describe('verifyAccessToken — malformed input', () => {
  it('empty string -> null', async () => {
    expect(await adapter.verifyAccessToken('')).toBeNull();
  });

  it('one segment -> null', async () => {
    expect(await adapter.verifyAccessToken('onlyone')).toBeNull();
  });

  it('two dot-separated segments -> null', async () => {
    expect(await adapter.verifyAccessToken('a.b')).toBeNull();
  });

  it('four dot-separated segments -> null', async () => {
    expect(await adapter.verifyAccessToken('a.b.c.d')).toBeNull();
  });

  it('non-base64url payload segment -> null', async () => {
    const token = await buildRawToken(b64url(JSON.stringify(GOOD_HEADER)), '!!NOT_BASE64!!', SECRET);
    expect(await adapter.verifyAccessToken(token)).toBeNull();
  });

  it('payload that decodes to a string literal -> null', async () => {
    const token = await buildRawToken(b64url(JSON.stringify(GOOD_HEADER)), b64url('"hello"'), SECRET);
    expect(await adapter.verifyAccessToken(token)).toBeNull();
  });

  it('payload that decodes to an array -> null', async () => {
    const token = await buildRawToken(b64url(JSON.stringify(GOOD_HEADER)), b64url('["a","b"]'), SECRET);
    expect(await adapter.verifyAccessToken(token)).toBeNull();
  });
});

// ── Suite 2: wrong algorithm / header ────────────────────────────────────────

describe('verifyAccessToken — wrong algorithm / header', () => {
  // Header check happens before signature verify — no real signature needed.
  function fakeToken(headerObj: object): string {
    const h = b64url(JSON.stringify(headerObj));
    const p = b64url(JSON.stringify(goodClaims()));
    return `${h}.${p}.fakesig`;
  }

  it('alg "none" with empty signature -> null', async () => {
    const h = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const p = b64url(JSON.stringify(goodClaims()));
    expect(await adapter.verifyAccessToken(`${h}.${p}.`)).toBeNull();
  });

  it('alg "RS256" -> null', async () => {
    expect(await adapter.verifyAccessToken(fakeToken({ alg: 'RS256', typ: 'JWT' }))).toBeNull();
  });

  it('typ "JWS" (correct alg, wrong typ) -> null', async () => {
    expect(await adapter.verifyAccessToken(fakeToken({ alg: 'HS256', typ: 'JWS' }))).toBeNull();
  });

  it('header missing alg -> null', async () => {
    expect(await adapter.verifyAccessToken(fakeToken({ typ: 'JWT' }))).toBeNull();
  });
});

// ── Suite 3: signature tampering ─────────────────────────────────────────────

describe('verifyAccessToken — signature tampering', () => {
  it('last byte of signature flipped -> null', async () => {
    const token = await adapter.signAccessToken({ sub: 'u1', email: 'u@example.com', roles: [] });
    const parts = token.split('.');
    const sigBytes = b64urlToBytes(parts[2]);
    sigBytes[sigBytes.length - 1] ^= 0x01;
    parts[2] = bytesToB64url(sigBytes);
    expect(await adapter.verifyAccessToken(parts.join('.'))).toBeNull();
  });

  it('token signed with a different secret -> null', async () => {
    const token = await buildToken(GOOD_HEADER, goodClaims(), ALT_SECRET);
    expect(await adapter.verifyAccessToken(token)).toBeNull();
  });
});

// ── Suite 4: claim shape ──────────────────────────────────────────────────────

describe('verifyAccessToken — claim shape', () => {
  it('sub not a string -> null', async () => {
    const token = await buildToken(GOOD_HEADER, { ...goodClaims(), sub: 42 }, SECRET);
    expect(await adapter.verifyAccessToken(token)).toBeNull();
  });

  it('roles not an array -> null', async () => {
    const token = await buildToken(GOOD_HEADER, { ...goodClaims(), roles: 'admin' }, SECRET);
    expect(await adapter.verifyAccessToken(token)).toBeNull();
  });

  it('missing iat -> null', async () => {
    const { iat: _iat, ...noIat } = goodClaims() as { iat: number; [k: string]: unknown };
    const token = await buildToken(GOOD_HEADER, noIat, SECRET);
    expect(await adapter.verifyAccessToken(token)).toBeNull();
  });

  it('missing exp -> null', async () => {
    const { exp: _exp, ...noExp } = goodClaims() as { exp: number; [k: string]: unknown };
    const token = await buildToken(GOOD_HEADER, noExp, SECRET);
    expect(await adapter.verifyAccessToken(token)).toBeNull();
  });

  it('exp one second in the past -> null', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = { ...goodClaims(), exp: now - 1 };
    const token = await buildToken(GOOD_HEADER, expired, SECRET);
    expect(await adapter.verifyAccessToken(token)).toBeNull();
  });
});

// ── Suite 5: verifyPassword — malformed stored hash ──────────────────────────

describe('verifyPassword — malformed stored hash', () => {
  const VALID_SALT = 'a'.repeat(32);   // 32 hex chars = 16 bytes
  const VALID_HASH = 'b'.repeat(64);   // 64 hex chars = 32 bytes

  it('prefix other than pbkdf2 -> false', async () => {
    expect(await adapter.verifyPassword('pw', `bcrypt:1000:${VALID_SALT}:${VALID_HASH}`)).toBe(false);
  });

  it('three colon-separated parts instead of four -> false', async () => {
    expect(await adapter.verifyPassword('pw', `pbkdf2:1000:${VALID_SALT}`)).toBe(false);
  });

  it('non-numeric iterations -> false', async () => {
    expect(await adapter.verifyPassword('pw', `pbkdf2:NaN:${VALID_SALT}:${VALID_HASH}`)).toBe(false);
  });

  it('salt with wrong length (< 32 hex chars) -> false', async () => {
    expect(await adapter.verifyPassword('pw', `pbkdf2:1000:${VALID_SALT.slice(0, 20)}:${VALID_HASH}`)).toBe(false);
  });

  it('non-hex characters in hash field -> false', async () => {
    const nonHexHash = 'Z'.repeat(64);
    expect(await adapter.verifyPassword('pw', `pbkdf2:1000:${VALID_SALT}:${nonHexHash}`)).toBe(false);
  });

  it('correct format but wrong password -> false', async () => {
    const stored = await adapter.hashPassword('correct-password');
    expect(await adapter.verifyPassword('wrong-password', stored)).toBe(false);
  });
});

// ── Suite 6: generateRefreshToken ────────────────────────────────────────────

describe('generateRefreshToken', () => {
  it('returns a 64-character lowercase hex string', async () => {
    const token = await adapter.generateRefreshToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('two consecutive calls return distinct values', async () => {
    const [a, b] = await Promise.all([
      adapter.generateRefreshToken(),
      adapter.generateRefreshToken(),
    ]);
    expect(a).not.toBe(b);
  });
});

// ── Suite 7: hashPassword ─────────────────────────────────────────────────────

describe('hashPassword', () => {
  it('returns pbkdf2:1000:<32-hex>:<64-hex>', async () => {
    const hash = await adapter.hashPassword('any-password');
    expect(hash).toMatch(/^pbkdf2:1000:[0-9a-f]{32}:[0-9a-f]{64}$/);
  });

  it('same plaintext hashed twice yields different outputs (random salt)', async () => {
    const [h1, h2] = await Promise.all([
      adapter.hashPassword('same-password'),
      adapter.hashPassword('same-password'),
    ]);
    expect(h1).not.toBe(h2);
  });
});

// ── Suite 8: readIterationsFromHash (S-06) ───────────────────────────────────

describe('JwtAuthAdapter.readIterationsFromHash', () => {
  it('returns the iteration count from a valid pbkdf2 hash', () => {
    expect(JwtAuthAdapter.readIterationsFromHash('pbkdf2:210000:aabbcc:ddeeff')).toBe(210_000);
  });

  it('returns null for non-pbkdf2 prefix', () => {
    expect(JwtAuthAdapter.readIterationsFromHash('bcrypt:12:salt:hash')).toBeNull();
  });

  it('returns null for wrong number of parts', () => {
    expect(JwtAuthAdapter.readIterationsFromHash('pbkdf2:100000:onlythreeparts')).toBeNull();
  });

  it('returns null for non-finite iteration value', () => {
    expect(JwtAuthAdapter.readIterationsFromHash('pbkdf2:NaN:salt:hash')).toBeNull();
    expect(JwtAuthAdapter.readIterationsFromHash('pbkdf2:Infinity:salt:hash')).toBeNull();
  });
});

// ── Suite 9: currentPbkdf2Iterations getter (S-06) ───────────────────────────

describe('currentPbkdf2Iterations getter', () => {
  it('returns the configured iteration count', () => {
    expect(adapter.currentPbkdf2Iterations).toBe(1_000);
  });

  it('returns 100 000 when using the default', () => {
    const defaultAdapter = new JwtAuthAdapter({
      secret: SECRET,
    });
    expect(defaultAdapter.currentPbkdf2Iterations).toBe(100_000);
  });
});
