export interface IRefreshTokenRepository {
  save(userId: string, token: string, expiresAt: Date): Promise<void>;
  findByToken(token: string): Promise<{ userId: string; expiresAt: Date } | null>;
  delete(token: string): Promise<void>;
  deleteAllForUser(userId: string): Promise<void>;
  /** Delete all refresh tokens for a user except the one matching `keepToken` (plaintext). */
  deleteAllForUserExcept(userId: string, keepToken: string): Promise<void>;
}
