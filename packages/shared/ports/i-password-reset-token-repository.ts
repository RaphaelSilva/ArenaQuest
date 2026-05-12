/**
 * IPasswordResetTokenRepository
 *
 * Persists single-use, time-limited password-reset tokens.
 * The plaintext token travels only in the reset email; only its
 * SHA-256 hash is stored, so a leaked DB dump cannot be replayed.
 *
 * Atomicity:
 *   `consumeByPlainToken` MUST atomically check that the token is
 *   unconsumed and unexpired, then mark it consumed in a single
 *   conditional UPDATE. Concurrent double-submits must result in
 *   exactly one success.
 */

export type PasswordResetConsumeResult =
  | { outcome: 'consumed'; userId: string }
  | { outcome: 'expired' }
  | { outcome: 'already_used' }
  | { outcome: 'invalid' };

export interface IPasswordResetTokenRepository {
  /** Persist a new reset token. `plainToken` is hashed before storage. */
  create(input: { plainToken: string; userId: string; expiresAt: Date }): Promise<void>;

  /**
   * Atomically consume a plaintext token.
   * - `consumed`   — token was valid and is now claimed; proceed with reset.
   * - `expired`    — token existed but its TTL has elapsed.
   * - `already_used` — token was already consumed.
   * - `invalid`    — token does not exist (unknown hash).
   */
  consumeByPlainToken(plainToken: string): Promise<PasswordResetConsumeResult>;

  /** Remove all unconsumed tokens for a user (call before issuing a new one). */
  invalidateAllForUser(userId: string): Promise<void>;

  /** Best-effort cleanup of expired rows. Safe to no-op. */
  purgeExpired(now: Date): Promise<void>;
}
