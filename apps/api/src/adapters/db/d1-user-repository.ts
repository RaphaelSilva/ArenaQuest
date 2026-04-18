import type { D1Database } from '@cloudflare/workers-types';
import type {
  IUserRepository,
  UserRecord,
  CreateUserInput,
  UpdateUserInput,
} from '@arenaquest/shared/ports';
import type { Entities } from '@arenaquest/shared/types/entities';

type UserRow = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  status: string;
  created_at: string;
};

type RoleRow = {
  id: string;
  name: string;
  description: string;
  created_at: string;
};

export class D1UserRepository implements IUserRepository {
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

  private rowToUser(row: UserRow, roles: Entities.Security.Role[]): Entities.Identity.User {
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

  /** Replace a user's roles with the given role names. Clears all roles if empty array. */
  private async assignRoles(userId: string, roleNames: string[]): Promise<void> {
    await this.db.prepare('DELETE FROM user_roles WHERE user_id = ?').bind(userId).run();

    if (roleNames.length === 0) return;

    const placeholders = roleNames.map(() => '?').join(', ');
    const { results } = await this.db
      .prepare(`SELECT id FROM roles WHERE name IN (${placeholders})`)
      .bind(...roleNames)
      .all<{ id: string }>();

    for (const { id: roleId } of results) {
      await this.db
        .prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)')
        .bind(userId, roleId)
        .run();
    }
  }

  async findById(id: string): Promise<Entities.Identity.User | null> {
    const row = await this.db
      .prepare('SELECT id, name, email, password_hash, status, created_at FROM users WHERE id = ?')
      .bind(id)
      .first<UserRow>();

    if (!row) return null;
    const roles = await this.fetchRoles(id);
    return this.rowToUser(row, roles);
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.db
      .prepare('SELECT id, name, email, password_hash, status, created_at FROM users WHERE email = ?')
      .bind(email)
      .first<UserRow>();

    if (!row) return null;
    const roles = await this.fetchRoles(row.id);
    return { ...this.rowToUser(row, roles), passwordHash: row.password_hash };
  }

  async create(data: CreateUserInput): Promise<Entities.Identity.User> {
    const id = crypto.randomUUID();
    const status = data.status ?? 'active';

    await this.db
      .prepare(
        'INSERT INTO users (id, name, email, password_hash, status) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(id, data.name, data.email, data.passwordHash, status)
      .run();

    if (data.roleNames && data.roleNames.length > 0) {
      await this.assignRoles(id, data.roleNames);
    }

    const user = await this.findById(id);
    if (!user) throw new Error(`D1UserRepository: failed to fetch user after create (id=${id})`);
    return user;
  }

  async update(id: string, data: Partial<UpdateUserInput>): Promise<Entities.Identity.User> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }

    if (fields.length > 0) {
      values.push(id);
      await this.db
        .prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
        .bind(...values)
        .run();
    }

    if (data.roleNames !== undefined) {
      await this.assignRoles(id, data.roleNames);
    }

    const user = await this.findById(id);
    if (!user) throw new Error(`D1UserRepository: user not found (id=${id})`);
    return user;
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  }

  async list(opts?: { limit?: number; offset?: number }): Promise<Entities.Identity.User[]> {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    const { results } = await this.db
      .prepare(
        'SELECT id, name, email, password_hash, status, created_at FROM users LIMIT ? OFFSET ?',
      )
      .bind(limit, offset)
      .all<UserRow>();

    return Promise.all(
      results.map(async row => {
        const roles = await this.fetchRoles(row.id);
        return this.rowToUser(row, roles);
      }),
    );
  }

  async count(): Promise<number> {
    const { results } = await this.db
      .prepare('SELECT COUNT(*) as cnt FROM users')
      .all<{ cnt: number }>();
    return Number(results[0]?.cnt ?? 0);
  }
}
