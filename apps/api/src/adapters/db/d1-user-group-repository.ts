import type {
  IUserGroupRepository,
  UserGroupRecord,
  GroupMemberRecord,
  CreateUserGroupInput,
} from '@arenaquest/shared/ports';

type UserGroupRow = {
  id: string;
  name: string;
  description: string;
  created_at: string;
  member_count: number;
};

type GroupMemberRow = {
  id: string;
  name: string;
  email: string;
};

function rowToGroup(row: UserGroupRow): UserGroupRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    memberCount: row.member_count,
    createdAt: row.created_at,
  };
}

export class D1UserGroupRepository implements IUserGroupRepository {
  constructor(private readonly db: D1Database) {}

  async listAll(): Promise<UserGroupRecord[]> {
    const { results } = await this.db
      .prepare(
        `SELECT g.id, g.name, g.description, g.created_at,
                (SELECT COUNT(*) FROM user_group_members m WHERE m.group_id = g.id) AS member_count
         FROM user_groups g
         ORDER BY g.name ASC`,
      )
      .all<UserGroupRow>();

    return results.map(rowToGroup);
  }

  async getById(id: string): Promise<UserGroupRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT g.id, g.name, g.description, g.created_at,
                (SELECT COUNT(*) FROM user_group_members m WHERE m.group_id = g.id) AS member_count
         FROM user_groups g
         WHERE g.id = ?`,
      )
      .bind(id)
      .first<UserGroupRow>();

    return row ? rowToGroup(row) : null;
  }

  async findByName(name: string): Promise<UserGroupRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT g.id, g.name, g.description, g.created_at,
                (SELECT COUNT(*) FROM user_group_members m WHERE m.group_id = g.id) AS member_count
         FROM user_groups g
         WHERE g.name = ?`,
      )
      .bind(name)
      .first<UserGroupRow>();

    return row ? rowToGroup(row) : null;
  }

  async create(input: CreateUserGroupInput): Promise<UserGroupRecord> {
    await this.db
      .prepare(
        `INSERT INTO user_groups (id, name, description) VALUES (?, ?, ?)`,
      )
      .bind(input.id, input.name, input.description)
      .run();

    return {
      id: input.id,
      name: input.name,
      description: input.description,
      memberCount: 0,
      createdAt: new Date().toISOString(),
    };
  }

  async listMembers(groupId: string): Promise<GroupMemberRecord[]> {
    const { results } = await this.db
      .prepare(
        `SELECT u.id, u.name, u.email
         FROM user_group_members m
         JOIN users u ON u.id = m.user_id
         WHERE m.group_id = ?
         ORDER BY u.name ASC`,
      )
      .bind(groupId)
      .all<GroupMemberRow>();

    return results.map(row => ({ userId: row.id, name: row.name, email: row.email }));
  }

  async addMember(groupId: string, userId: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO user_group_members (group_id, user_id) VALUES (?, ?)`,
      )
      .bind(groupId, userId)
      .run();
  }

  async removeMember(groupId: string, userId: string): Promise<void> {
    await this.db
      .prepare(`DELETE FROM user_group_members WHERE group_id = ? AND user_id = ?`)
      .bind(groupId, userId)
      .run();
  }
}
