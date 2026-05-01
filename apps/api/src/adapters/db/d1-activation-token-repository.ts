import type {
  IActivationTokenRepository,
  ConsumeResult,
  IUserRepository,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { sha256Hex } from './hash';

interface TokenRow {
  token_hash: string;
  user_id: string;
  expires_at: number;
  consumed_at: number | null;
}

/**
 * D1-backed activation token store. Tokens are persisted only as their
 * SHA-256 hash so a leaked DB dump cannot be replayed: the plaintext token
 * lives only in the activation email body.
 */
export class D1ActivationTokenRepository implements IActivationTokenRepository {
  constructor(
    private readonly db: D1Database,
    private readonly users: IUserRepository,
  ) {}

  async create(input: { plainToken: string; userId: string; expiresAt: Date }): Promise<void> {
    const tokenHash = await sha256Hex(input.plainToken);
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO user_activation_tokens (token_hash, user_id, expires_at, consumed_at, created_at)
         VALUES (?, ?, ?, NULL, ?)`,
      )
      .bind(tokenHash, input.userId, input.expiresAt.getTime(), now)
      .run();
  }

  async consumeByPlainToken(plainToken: string): Promise<ConsumeResult> {
    const tokenHash = await sha256Hex(plainToken);
    const now = Date.now();

    const row = await this.db
      .prepare(
        `SELECT token_hash, user_id, expires_at, consumed_at
         FROM user_activation_tokens
         WHERE token_hash = ?`,
      )
      .bind(tokenHash)
      .first<TokenRow>();

    if (!row) return { outcome: 'invalid' };

    // Replay path — token already consumed. If the user is currently active
    // we report `already_active` so the UI can render an idempotent success;
    // otherwise we treat it as invalid (someone consumed but a downstream
    // step failed and left the user inactive — they need a fresh token).
    if (row.consumed_at !== null) {
      const user = await this.users.findById(row.user_id);
      if (user && user.status === Entities.Config.UserStatus.ACTIVE) {
        return { outcome: 'already_active', userId: row.user_id };
      }
      return { outcome: 'invalid' };
    }

    if (row.expires_at <= now) return { outcome: 'invalid' };

    // Atomic CAS: claim the token only if `consumed_at IS NULL`. If the
    // RETURNING row is empty, another concurrent request beat us to it —
    // collapse to `already_active` if the user is now active, or `invalid`.
    const claim = await this.db
      .prepare(
        `UPDATE user_activation_tokens
         SET consumed_at = ?
         WHERE token_hash = ? AND consumed_at IS NULL
         RETURNING user_id`,
      )
      .bind(now, tokenHash)
      .first<{ user_id: string }>();

    if (!claim) {
      const user = await this.users.findById(row.user_id);
      if (user && user.status === Entities.Config.UserStatus.ACTIVE) {
        return { outcome: 'already_active', userId: row.user_id };
      }
      return { outcome: 'invalid' };
    }

    // Flip the user to ACTIVE. If this fails, roll back the claim so the
    // user can retry with the same link (no token-without-activation drift).
    try {
      await this.users.update(claim.user_id, {
        status: Entities.Config.UserStatus.ACTIVE,
      });
    } catch (err) {
      await this.db
        .prepare(
          `UPDATE user_activation_tokens
           SET consumed_at = NULL
           WHERE token_hash = ?`,
        )
        .bind(tokenHash)
        .run();
      throw err;
    }

    return { outcome: 'activated', userId: claim.user_id };
  }

  async purgeExpired(now: Date): Promise<void> {
    await this.db
      .prepare('DELETE FROM user_activation_tokens WHERE expires_at <= ?')
      .bind(now.getTime())
      .run();
  }
}
