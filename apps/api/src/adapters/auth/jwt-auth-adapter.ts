/**
 * JwtAuthAdapter
 *
 * Concrete implementation of IAuthAdapter using:
 *   - PBKDF2-SHA256  for password hashing    (Web Crypto API — native on CF Workers)
 *   - HMAC-SHA256    for JWT signing (HS256)  (Web Crypto API — native on CF Workers)
 *   - crypto.getRandomValues                 for refresh token generation
 *
 * Zero external dependencies — everything runs on the built-in Web Crypto API
 * available in the Cloudflare Workers runtime and modern browsers alike.
 *
 * Configuration is injected via the constructor so secrets never live in
 * module scope and the adapter is trivially testable.
 *
 * Usage:
 *   const auth = new JwtAuthAdapter({
 *     secret: env.JWT_SECRET,
 *     accessTokenExpiresInSeconds: 900,   // 15 min
 *   });
 */

import type { IAuthAdapter, TokenPayload, VerifiedToken } from '@arenaquest/shared/ports';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface JwtAuthAdapterConfig {
  /**
   * HMAC-SHA256 signing secret for JWTs.
   * Must be at least 32 characters.
   * Store as a Cloudflare Worker secret: `wrangler secret put JWT_SECRET`
   */
  secret: string;

  /**
   * Access token time-to-live in seconds.
   * Defaults to 900 (15 minutes).
   * Keep short — refresh token rotation handles long sessions.
   */
  accessTokenExpiresInSeconds?: number;

  /**
   * PBKDF2 iteration count.
   * Defaults to 100_000 — the maximum supported by the Cloudflare Workers
   * Web Crypto API runtime. OWASP 2023 recommends 600_000 for SHA-256, but
   * the Workers runtime caps `deriveBits` at 100_000 iterations.
   * Lower values can be set in tests (`pbkdf2Iterations: 1_000`); the
   * stored-hash format encodes the count per row, so old hashes remain
   * verifiable even after a default change.
   */
  pbkdf2Iterations?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Encode a Uint8Array to a base64url string (no padding). */
function uint8ToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Decode a base64url string to a Uint8Array. */
function base64UrlToUint8(b64url: string): Uint8Array {
  const base64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Encode a plain string to base64url. */
function strToBase64Url(str: string): string {
  return uint8ToBase64Url(new TextEncoder().encode(str));
}

/** Decode a base64url string to a plain string. */
function base64UrlToStr(b64url: string): string {
  return new TextDecoder().decode(base64UrlToUint8(b64url));
}

/** Convert a Uint8Array to a lowercase hex string. */
function uint8ToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Convert a lowercase hex string to a Uint8Array. */
function hexToUint8(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string: odd length');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

const JWT_HEADER_B64 = strToBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

/** Import the signing secret as a CryptoKey for HMAC-SHA256 operations. */
async function importHmacKey(
  secret: string,
  usage: 'sign' | 'verify',
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export class JwtAuthAdapter implements IAuthAdapter {
  private readonly secret: string;
  private readonly accessTokenTtl: number;
  private readonly iterations: number;

  constructor(config: JwtAuthAdapterConfig) {
    if (!config.secret || config.secret.length < 32) {
      throw new Error(
        'JwtAuthAdapter: secret must be at least 32 characters. ' +
        'Use `wrangler secret put JWT_SECRET` to set it securely.',
      );
    }
    this.secret = config.secret;
    this.accessTokenTtl = config.accessTokenExpiresInSeconds ?? 900;
    this.iterations = config.pbkdf2Iterations ?? 100_000;
  }

  // ── Key-derivation metadata ───────────────────────────────────────────────

  get currentPbkdf2Iterations(): number {
    return this.iterations;
  }

  /**
   * Extract the PBKDF2 iteration count encoded in a stored hash string.
   * Returns `null` for any input that does not follow the
   * `pbkdf2:<n>:<salt>:<hash>` format or has a non-finite iteration count.
   */
  static readIterationsFromHash(storedHash: string): number | null {
    const parts = storedHash.split(':');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return null;
    const n = parseInt(parts[1], 10);
    return Number.isFinite(n) ? n : null;
  }

  // ── Password hashing ──────────────────────────────────────────────────────

  /**
   * Hash a password with PBKDF2-SHA256.
   *
   * Stored format: `pbkdf2:<iterations>:<saltHex>:<derivedKeyHex>`
   *
   * The format is self-describing so future iteration increases only affect
   * new passwords — existing hashes keep working with their original count.
   */
  async hashPassword(plain: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(plain),
      'PBKDF2',
      false,
      ['deriveBits'],
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt,
        iterations: this.iterations,
      },
      keyMaterial,
      256, // 32 bytes output
    );

    const saltHex = uint8ToHex(salt);
    const hashHex = uint8ToHex(new Uint8Array(derivedBits));

    return `pbkdf2:${this.iterations}:${saltHex}:${hashHex}`;
  }

  /**
   * Verify a plaintext password against a stored PBKDF2 hash.
   *
   * Uses `crypto.subtle.verify` (HMAC) for the final comparison to ensure
   * constant-time equality regardless of where the strings differ.
   */
  async verifyPassword(plain: string, storedHash: string): Promise<boolean> {
    const parts = storedHash.split(':');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
      return false;
    }

    const [, rawIterations, saltHex, expectedHex] = parts;
    const iterations = parseInt(rawIterations, 10);

    if (isNaN(iterations) || saltHex.length !== 32 || expectedHex.length !== 64) {
      return false;
    }

    let salt: Uint8Array;
    let expectedBytes: Uint8Array;
    try {
      salt = hexToUint8(saltHex);
      expectedBytes = hexToUint8(expectedHex);
    } catch {
      return false;
    }

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(plain),
      'PBKDF2',
      false,
      ['deriveBits'],
    );

    const derivedBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      keyMaterial,
      256,
    );

    const derivedBytes = new Uint8Array(derivedBits);

    // Constant-time comparison via HMAC sign+verify trick.
    // We sign both byte arrays with the same key and compare the MACs —
    // this avoids early-exit leaks from a direct byte-by-byte comparison.
    const compareKey = await crypto.subtle.importKey(
      'raw',
      crypto.getRandomValues(new Uint8Array(32)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );

    const expectedMac = await crypto.subtle.sign('HMAC', compareKey, expectedBytes);
    return crypto.subtle.verify('HMAC', compareKey, expectedMac, derivedBytes);
  }

  // ── Access token (JWT HS256) ───────────────────────────────────────────────

  /**
   * Sign an access token (JWT, HS256).
   *
   * Structure: base64url(header) . base64url(payload) . base64url(signature)
   */
  async signAccessToken(payload: TokenPayload): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    const claims: VerifiedToken = {
      ...payload,
      iat: now,
      exp: now + this.accessTokenTtl,
    };

    const signingInput = `${JWT_HEADER_B64}.${strToBase64Url(JSON.stringify(claims))}`;

    const key = await importHmacKey(this.secret, 'sign');
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(signingInput),
    );

    const signature = uint8ToBase64Url(new Uint8Array(signatureBuffer));
    return `${signingInput}.${signature}`;
  }

  /**
   * Verify a JWT's signature and expiry.
   * Returns the decoded payload or `null` — never throws.
   *
   * Failure cases (all return null):
   *   - Malformed token (wrong number of segments)
   *   - Invalid base64url encoding
   *   - Signature mismatch
   *   - Token expired (`exp` in the past)
   *   - Missing required claims
   */
  async verifyAccessToken(token: string): Promise<VerifiedToken | null> {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const [headerB64, payloadB64, signatureB64] = parts;

      // Validate header
      let header: { alg?: string; typ?: string };
      try {
        header = JSON.parse(base64UrlToStr(headerB64));
      } catch {
        return null;
      }
      if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;

      // Verify signature
      const signingInput = `${headerB64}.${payloadB64}`;
      const key = await importHmacKey(this.secret, 'verify');
      const signatureBytes = base64UrlToUint8(signatureB64);

      const valid = await crypto.subtle.verify(
        'HMAC',
        key,
        signatureBytes,
        new TextEncoder().encode(signingInput),
      );
      if (!valid) return null;

      // Decode and validate payload
      let claims: Partial<VerifiedToken>;
      try {
        claims = JSON.parse(base64UrlToStr(payloadB64));
      } catch {
        return null;
      }

      if (
        typeof claims.sub !== 'string' ||
        typeof claims.email !== 'string' ||
        !Array.isArray(claims.roles) ||
        typeof claims.iat !== 'number' ||
        typeof claims.exp !== 'number'
      ) {
        return null;
      }

      // Check expiry
      const now = Math.floor(Date.now() / 1000);
      if (claims.exp < now) return null;

      return claims as VerifiedToken;
    } catch {
      // Absorb any unexpected error — verification always returns null on failure
      return null;
    }
  }

  // ── Refresh token ─────────────────────────────────────────────────────────

  /**
   * Generate a 256-bit cryptographically random opaque refresh token.
   * Returns a 64-character lowercase hex string.
   *
   * This token carries no claims — it is a lookup key. Store it (hashed with
   * SHA-256) in the `refresh_tokens` table alongside the userId and expiry.
   */
  async generateRefreshToken(): Promise<string> {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return uint8ToHex(bytes);
  }
}