import type {
  IEnrollmentRepository,
  EnrollmentUserRecord,
  EnrollmentGroupRecord,
} from '@arenaquest/shared/ports';

type EnrollmentUserRow = {
  id: string;
  user_id: string;
  topic_node_id: string;
  granted_by: string;
  granted_at: string;
};

type EnrollmentGroupRow = {
  id: string;
  group_id: string;
  topic_node_id: string;
  granted_by: string;
  granted_at: string;
};

function rowToUserEnrollment(row: EnrollmentUserRow): EnrollmentUserRecord {
  return {
    id: row.id,
    userId: row.user_id,
    topicNodeId: row.topic_node_id,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at,
  };
}

function rowToGroupEnrollment(row: EnrollmentGroupRow): EnrollmentGroupRecord {
  return {
    id: row.id,
    groupId: row.group_id,
    topicNodeId: row.topic_node_id,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at,
  };
}

export class D1EnrollmentRepository implements IEnrollmentRepository {
  constructor(private readonly db: D1Database) {}

  /**
   * Returns (allow_tree ∪ public_set) − private_set using a single recursive CTE.
   * allow_tree: granted topics (user + group) expanded to all descendants.
   * public_set: non-archived public topics (no grant required).
   * private_set: always excluded, even if granted or public.
   */
  async getEffectiveAccessTopicIds(userId: string): Promise<string[]> {
    const { results } = await this.db
      .prepare(
        `WITH RECURSIVE
           allow_seed(id) AS (
             SELECT topic_node_id FROM enrollments_user WHERE user_id = ?1
             UNION
             SELECT eg.topic_node_id
               FROM enrollments_user_group eg
               JOIN user_group_members ugm ON ugm.group_id = eg.group_id
              WHERE ugm.user_id = ?1
           ),
           allow_tree(id) AS (
             SELECT id FROM allow_seed
             UNION ALL
             SELECT tn.id FROM topic_nodes tn JOIN allow_tree ON tn.parent_id = allow_tree.id
           ),
           public_set(id) AS (
             SELECT id FROM topic_nodes WHERE visibility = 'public' AND archived = 0
           )
         SELECT DISTINCT id FROM (
           SELECT id FROM allow_tree
           UNION
           SELECT id FROM public_set
         )
         WHERE id NOT IN (SELECT id FROM topic_nodes WHERE visibility = 'private')`,
      )
      .bind(userId)
      .all<{ id: string }>();
    return results.map((r) => r.id);
  }

  // ---------------------------------------------------------------------------
  // User grants
  // ---------------------------------------------------------------------------

  async listUserGrants(userId: string): Promise<EnrollmentUserRecord[]> {
    const { results } = await this.db
      .prepare(
        'SELECT * FROM enrollments_user WHERE user_id = ? ORDER BY granted_at DESC',
      )
      .bind(userId)
      .all<EnrollmentUserRow>();
    return results.map(rowToUserEnrollment);
  }

  async grantUser(
    userId: string,
    topicNodeId: string,
    grantedBy: string,
  ): Promise<EnrollmentUserRecord> {
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        'INSERT OR IGNORE INTO enrollments_user (id, user_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)',
      )
      .bind(id, userId, topicNodeId, grantedBy)
      .run();

    // Return the existing row whether we just inserted or it already existed.
    const row = await this.db
      .prepare('SELECT * FROM enrollments_user WHERE user_id = ? AND topic_node_id = ?')
      .bind(userId, topicNodeId)
      .first<EnrollmentUserRow>();
    if (!row) throw new Error(`D1EnrollmentRepository: user grant not found after insert`);
    return rowToUserEnrollment(row);
  }

  async revokeUser(
    userId: string,
    topicNodeId: string,
    opts?: { cascade?: boolean },
  ): Promise<void> {
    if (opts?.cascade) {
      // Cascade: remove this grant and all explicit descendant grants for the
      // same user using a recursive CTE.
      await this.db
        .prepare(
          `WITH RECURSIVE subtree(id) AS (
             SELECT id FROM topic_nodes WHERE id = ?
             UNION ALL
             SELECT tn.id FROM topic_nodes tn JOIN subtree s ON tn.parent_id = s.id
           )
           DELETE FROM enrollments_user
            WHERE user_id = ? AND topic_node_id IN (SELECT id FROM subtree)`,
        )
        .bind(topicNodeId, userId)
        .run();
    } else {
      await this.db
        .prepare('DELETE FROM enrollments_user WHERE user_id = ? AND topic_node_id = ?')
        .bind(userId, topicNodeId)
        .run();
    }
  }

  // ---------------------------------------------------------------------------
  // Group grants
  // ---------------------------------------------------------------------------

  async listGroupGrants(groupId: string): Promise<EnrollmentGroupRecord[]> {
    const { results } = await this.db
      .prepare(
        'SELECT * FROM enrollments_user_group WHERE group_id = ? ORDER BY granted_at DESC',
      )
      .bind(groupId)
      .all<EnrollmentGroupRow>();
    return results.map(rowToGroupEnrollment);
  }

  async grantGroup(
    groupId: string,
    topicNodeId: string,
    grantedBy: string,
  ): Promise<EnrollmentGroupRecord> {
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        'INSERT OR IGNORE INTO enrollments_user_group (id, group_id, topic_node_id, granted_by) VALUES (?, ?, ?, ?)',
      )
      .bind(id, groupId, topicNodeId, grantedBy)
      .run();

    const row = await this.db
      .prepare('SELECT * FROM enrollments_user_group WHERE group_id = ? AND topic_node_id = ?')
      .bind(groupId, topicNodeId)
      .first<EnrollmentGroupRow>();
    if (!row) throw new Error(`D1EnrollmentRepository: group grant not found after insert`);
    return rowToGroupEnrollment(row);
  }

  async revokeGroup(
    groupId: string,
    topicNodeId: string,
    opts?: { cascade?: boolean },
  ): Promise<void> {
    if (opts?.cascade) {
      await this.db
        .prepare(
          `WITH RECURSIVE subtree(id) AS (
             SELECT id FROM topic_nodes WHERE id = ?
             UNION ALL
             SELECT tn.id FROM topic_nodes tn JOIN subtree s ON tn.parent_id = s.id
           )
           DELETE FROM enrollments_user_group
            WHERE group_id = ? AND topic_node_id IN (SELECT id FROM subtree)`,
        )
        .bind(topicNodeId, groupId)
        .run();
    } else {
      await this.db
        .prepare('DELETE FROM enrollments_user_group WHERE group_id = ? AND topic_node_id = ?')
        .bind(groupId, topicNodeId)
        .run();
    }
  }
}
