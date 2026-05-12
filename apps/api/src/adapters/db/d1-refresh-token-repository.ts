
import type { IRefreshTokenRepository } from '@arenaquest/shared/ports';
import { sha256Hex } from './hash';

type RefreshTokenRow = {
  token: string;
  user_id: string;
  expires_at: string;
};

export class D1RefreshTokenRepository implements IRefreshTokenRepository {
  constructor(private readonly db: D1Database) {}

  async save(userId: string, token: string, expiresAt: Date): Promise<void> {
    const tokenHash = await sha256Hex(token);
    await this.db
      .prepare('INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(tokenHash, userId, expiresAt.toISOString())
      .run();
  }

  async findByToken(token: string): Promise<{ userId: string; expiresAt: Date } | null> {
    const tokenHash = await sha256Hex(token);
    const row = await this.db
      .prepare('SELECT token, user_id, expires_at FROM refresh_tokens WHERE token = ?')
      .bind(tokenHash)
      .first<RefreshTokenRow>();

    if (!row) return null;
    return { userId: row.user_id, expiresAt: new Date(row.expires_at) };
  }

  async delete(token: string): Promise<void> {
    const tokenHash = await sha256Hex(token);
    await this.db.prepare('DELETE FROM refresh_tokens WHERE token = ?').bind(tokenHash).run();
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(userId).run();
  }

  async deleteAllForUserExcept(userId: string, keepToken: string): Promise<void> {
    const keepHash = await sha256Hex(keepToken);
    await this.db
      .prepare('DELETE FROM refresh_tokens WHERE user_id = ? AND token != ?')
      .bind(userId, keepHash)
      .run();
  }
}
