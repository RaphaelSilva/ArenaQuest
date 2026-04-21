/**
 * IAuthAdapter
 *
 * Cloud-agnostic contract for all authentication operations.
 *
 * Architecture notes:
 * - The default implementation uses JWT (HS256) + PBKDF2-SHA256 via Web Crypto API.
 * - A future implementation could delegate to Auth0, Clerk, or any OIDC provider
 *   by implementing this same interface — the business layer stays untouched.
 * - Password hashing and token signing are intentionally separated so each can
 *   evolve independently (e.g. migrate hash algorithm without touching JWT logic).
 *
 * Usage:
 *   const auth: IAuthAdapter = container.resolve('auth');
 *   const hash = await auth.hashPassword('hunter2');
 *   const token = await auth.signAccessToken({ sub: user.id, email: user.email, roles });
 */

// ---------------------------------------------------------------------------
// Token payload
// ---------------------------------------------------------------------------

/**
 * The claims embedded in every access token.
 * Keep this lean — large payloads inflate every request header.
 */
export interface TokenPayload {
  /** User's primary key (maps to Entities.Identity.User.id). */
  sub: string;
  /** User's email — included for display purposes without an extra DB lookup. */
  email: string;
  /** Role names the user holds at the time of login. */
  roles: string[];
}

/**
 * The full set of claims found in a verified token,
 * including the standard registered claims added by the adapter.
 */
export interface VerifiedToken extends TokenPayload {
  /** Issued-at timestamp (seconds since Unix epoch). */
  iat: number;
  /** Expiration timestamp (seconds since Unix epoch). */
  exp: number;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface IAuthAdapter {
  // ── Key-derivation metadata ───────────────────────────────────────────────

  /**
   * The PBKDF2 iteration count the adapter will use for **new** hashes.
   * Callers compare this against the count encoded in a stored hash to decide
   * whether a transparent rehash is needed.
   */
  readonly currentPbkdf2Iterations: number;

  // ── Password hashing ──────────────────────────────────────────────────────

  /**
   * Derive a secure hash from a plaintext password.
   * The returned string is self-contained — it encodes the algorithm,
   * parameters, salt, and derived key so it can be verified later without
   * storing anything else.
   *
   * Format (PBKDF2 implementation): `pbkdf2:<iterations>:<saltHex>:<hashHex>`
   *
   * @param plain - Plaintext password provided by the user.
   */
  hashPassword(plain: string): Promise<string>;

  /**
   * Verify a plaintext password against a stored hash.
   * Performs a constant-time comparison to prevent timing attacks.
   *
   * @param plain        - Plaintext password to check.
   * @param storedHash   - Hash previously returned by `hashPassword`.
   * @returns `true` if the password matches, `false` otherwise.
   */
  verifyPassword(plain: string, storedHash: string): Promise<boolean>;

  // ── Access token (JWT) ────────────────────────────────────────────────────

  /**
   * Sign and return a short-lived access token for the given payload.
   * The token expiry is controlled by the adapter's configuration.
   *
   * @param payload - Claims to embed in the token.
   */
  signAccessToken(payload: TokenPayload): Promise<string>;

  /**
   * Verify an access token's signature and expiry.
   * Returns the decoded payload on success, or `null` for any failure
   * (expired, tampered signature, malformed structure).
   *
   * Never throws — all error cases are represented as `null`.
   *
   * @param token - Raw JWT string (the `Bearer <token>` value).
   */
  verifyAccessToken(token: string): Promise<VerifiedToken | null>;

  // ── Refresh token ─────────────────────────────────────────────────────────

  /**
   * Generate a cryptographically random opaque refresh token.
   * The token itself carries no claims — it is a lookup key into the
   * `refresh_tokens` table where the associated userId and expiry are stored.
   *
   * @returns A hex-encoded 32-byte (256-bit) random string.
   */
  generateRefreshToken(): Promise<string>;
}