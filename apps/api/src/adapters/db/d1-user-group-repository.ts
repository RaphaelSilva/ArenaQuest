import type { IUserGroupRepository, UserGroupRecord } from '@arenaquest/shared/ports';

type UserGroupRow = {
  id: string;
  name: string;
  description: string;
  created_at: string;
  member_count: number;
};

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

    return results.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      memberCount: row.member_count,
      createdAt: row.created_at,
    }));
  }
}
