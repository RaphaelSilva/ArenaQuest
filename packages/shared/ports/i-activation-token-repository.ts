/**
 * IActivationTokenRepository
 *
 * Persists single-use activation tokens for the public self-registration
 * flow. The plaintext token is what travels in the activation email; the
 * repository only ever sees and stores the SHA-256 hash.
 *
 * Atomicity:
 *  - `consumeByPlainToken` MUST atomically check `consumed_at IS NULL AND
 *    expires_at > now`, set `consumed_at = now`, and update the user's
 *    status. A partial failure must leave neither the token consumed nor
 *    the user activated.
 */

export type ConsumeResult =
  | { outcome: 'activated'; userId: string }
  | { outcome: 'already_active'; userId: string }
  | { outcome: 'invalid' };

export interface IActivationTokenRepository {
  /** Persist a new activation token. `plainToken` is hashed before storage. */
  create(input: { plainToken: string; userId: string; expiresAt: Date }): Promise<void>;

  /**
   * Atomically consume a plaintext token and flip the owning user to ACTIVE.
   * Returns the outcome discriminator the controller maps to HTTP responses.
   * Never throws on a missing/expired/replayed token — those all collapse
   * into `{ outcome: 'invalid' }` so the caller cannot oracle-distinguish them.
   */
  consumeByPlainToken(plainToken: string): Promise<ConsumeResult>;

  /** Best-effort cleanup of expired rows. Safe to no-op. */
  purgeExpired(now: Date): Promise<void>;
}
