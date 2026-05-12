import type { IOAuthAccountRepository } from '@arenaquest/shared/ports';
import type { Entities } from '@arenaquest/shared/types/entities';

type UserRow = {
  id: string;
  name: string;
  email: string;
  status: string;
  created_at: string;
};

type RoleRow = {
  id: string;
  name: string;
  description: string;
  created_at: string;
};

type OAuthRow = {
  provider: string;
  provider_user_id: string;
  user_id: string;
  email: string;
  created_at: string;
};

export class D1OAuthAccountRepository implements IOAuthAccountRepository {
  constructor(private readonly db: D1Database) {}

  private async fetchRoles(userId: string): Promise<Entities.Security.Role[]> {
    const { results } = await this.db
      .prepare(
        `SELECT r.id, r.name, r.description, r.created_at
         FROM roles r
         INNER JOIN user_roles ur ON r.id = ur.role_id
         WHERE ur.user_id = ?`,
      )
      .bind(userId)
      .all<RoleRow>();

    return results.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      createdAt: new Date(r.created_at),
    }));
  }

  async findUserByProvider(
    provider: string,
    providerUserId: string,
  ): Promise<Entities.Identity.User | null> {
    const row = await this.db
      .prepare(
        `SELECT u.id, u.name, u.email, u.status, u.created_at
         FROM users u
         INNER JOIN oauth_accounts oa ON u.id = oa.user_id
         WHERE oa.provider = ? AND oa.provider_user_id = ?`,
      )
      .bind(provider, providerUserId)
      .first<UserRow>();

    if (!row) return null;

    const roles = await this.fetchRoles(row.id);
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      status: row.status as Entities.Config.UserStatus,
      roles,
      groups: [],
      createdAt: new Date(row.created_at),
    };
  }

  async link(
    provider: string,
    providerUserId: string,
    userId: string,
    email: string,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO oauth_accounts (provider, provider_user_id, user_id, email)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(provider, providerUserId, userId, email)
      .run();
  }

  async findByUser(
    provider: string,
    userId: string,
  ): Promise<Entities.OAuth.OAuthAccount | null> {
    const row = await this.db
      .prepare(
        `SELECT provider, provider_user_id, user_id, email, created_at
         FROM oauth_accounts
         WHERE provider = ? AND user_id = ?`,
      )
      .bind(provider, userId)
      .first<OAuthRow>();

    if (!row) return null;

    return {
      provider: row.provider,
      providerUserId: row.provider_user_id,
      userId: row.user_id,
      email: row.email,
      createdAt: new Date(row.created_at),
    };
  }
}
