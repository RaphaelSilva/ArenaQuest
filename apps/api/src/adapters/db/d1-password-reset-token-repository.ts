import type {
  IPasswordResetTokenRepository,
  PasswordResetConsumeResult,
} from '@arenaquest/shared/ports';
import { sha256Hex } from './hash';

interface TokenRow {
  token_hash: string;
  user_id: string;
  expires_at: number;
  consumed_at: number | null;
}

export class D1PasswordResetTokenRepository implements IPasswordResetTokenRepository {
  constructor(private readonly db: D1Database) {}

  async create(input: { plainToken: string; userId: string; expiresAt: Date }): Promise<void> {
    const tokenHash = await sha256Hex(input.plainToken);
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, consumed_at, created_at)
         VALUES (?, ?, ?, NULL, ?)`,
      )
      .bind(tokenHash, input.userId, input.expiresAt.getTime(), now)
      .run();
  }

  async consumeByPlainToken(plainToken: string): Promise<PasswordResetConsumeResult> {
    const tokenHash = await sha256Hex(plainToken);
    const now = Date.now();

    const row = await this.db
      .prepare(
        `SELECT token_hash, user_id, expires_at, consumed_at
         FROM password_reset_tokens
         WHERE token_hash = ?`,
      )
      .bind(tokenHash)
      .first<TokenRow>();

    if (!row) return { outcome: 'invalid' };
    if (row.consumed_at !== null) return { outcome: 'already_used' };
    if (row.expires_at <= now) return { outcome: 'expired' };

    // Atomic CAS: claim only if consumed_at IS still NULL.
    // A concurrent request may have claimed it between the SELECT and this UPDATE.
    const claim = await this.db
      .prepare(
        `UPDATE password_reset_tokens
         SET consumed_at = ?
         WHERE token_hash = ? AND consumed_at IS NULL
         RETURNING user_id`,
      )
      .bind(now, tokenHash)
      .first<{ user_id: string }>();

    if (!claim) return { outcome: 'already_used' };

    return { outcome: 'consumed', userId: claim.user_id };
  }

  async invalidateAllForUser(userId: string): Promise<void> {
    await this.db
      .prepare(
        `DELETE FROM password_reset_tokens
         WHERE user_id = ? AND consumed_at IS NULL`,
      )
      .bind(userId)
      .run();
  }

  async purgeExpired(now: Date): Promise<void> {
    await this.db
      .prepare('DELETE FROM password_reset_tokens WHERE expires_at <= ?')
      .bind(now.getTime())
      .run();
  }
}
