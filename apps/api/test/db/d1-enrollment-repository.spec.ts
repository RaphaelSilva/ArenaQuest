import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { D1EnrollmentRepository } from '@api/adapters/db/d1-enrollment-repository';

const MIGRATION_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id    TEXT NOT NULL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE
  )`,
  `CREATE TABLE IF NOT EXISTS topic_nodes (
    id        TEXT    NOT NULL PRIMARY KEY,
    parent_id TEXT    REFERENCES topic_nodes(id),
    title     TEXT    NOT NULL,
    status    TEXT    NOT NULL DEFAULT 'draft',
    archived  INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS user_groups (
    id          TEXT NOT NULL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS user_group_members (
    group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS enrollments_user (
    id            TEXT NOT NULL PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic_node_id TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE CASCADE,
    granted_by    TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    granted_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, topic_node_id)
  )`,
  `CREATE TABLE IF NOT EXISTS enrollments_user_group (
    id            TEXT NOT NULL PRIMARY KEY,
    group_id      TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
    topic_node_id TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE CASCADE,
    granted_by    TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    granted_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (group_id, topic_node_id)
  )`,
];

describe('D1EnrollmentRepository', () => {
  let repo: D1EnrollmentRepository;
  let userId: string;
  let adminId: string;
  let rootTopicId: string;
  let childTopicId: string;
  let grandChildId: string;
  let groupId: string;

  beforeAll(async () => {
    await env.DB.batch(MIGRATION_STATEMENTS.map((sql) => env.DB.prepare(sql)));
    repo = new D1EnrollmentRepository(env.DB);
  });

  beforeEach(async () => {
    userId = crypto.randomUUID();
    adminId = crypto.randomUUID();
    rootTopicId = crypto.randomUUID();
    childTopicId = crypto.randomUUID();
    grandChildId = crypto.randomUUID();
    groupId = crypto.randomUUID();

    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(userId, `u-${userId}@t.com`),
      env.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(adminId, `a-${adminId}@t.com`),
      env.DB.prepare("INSERT INTO topic_nodes (id, title) VALUES (?, 'Root')").bind(rootTopicId),
      env.DB.prepare("INSERT INTO topic_nodes (id, parent_id, title) VALUES (?, ?, 'Child')").bind(childTopicId, rootTopicId),
      env.DB.prepare("INSERT INTO topic_nodes (id, parent_id, title) VALUES (?, ?, 'Grandchild')").bind(grandChildId, childTopicId),
      env.DB.prepare("INSERT INTO user_groups (id, name) VALUES (?, ?)").bind(groupId, `grp-${groupId}`),
    ]);
  });

  // ---------------------------------------------------------------------------
  // User grants
  // ---------------------------------------------------------------------------

  describe('user grants', () => {
    it('grantUser creates record and returns it', async () => {
      const grant = await repo.grantUser(userId, rootTopicId, adminId);
      expect(grant.userId).toBe(userId);
      expect(grant.topicNodeId).toBe(rootTopicId);
      expect(grant.grantedBy).toBe(adminId);
    });

    it('grantUser is idempotent (returns existing on duplicate)', async () => {
      const g1 = await repo.grantUser(userId, rootTopicId, adminId);
      const g2 = await repo.grantUser(userId, rootTopicId, adminId);
      expect(g1.id).toBe(g2.id);
    });

    it('listUserGrants returns all grants for user', async () => {
      await repo.grantUser(userId, rootTopicId, adminId);
      await repo.grantUser(userId, childTopicId, adminId);
      const grants = await repo.listUserGrants(userId);
      const ids = grants.map((g) => g.topicNodeId);
      expect(ids).toContain(rootTopicId);
      expect(ids).toContain(childTopicId);
    });

    it('revokeUser removes the grant', async () => {
      await repo.grantUser(userId, rootTopicId, adminId);
      await repo.revokeUser(userId, rootTopicId);
      const grants = await repo.listUserGrants(userId);
      expect(grants.find((g) => g.topicNodeId === rootTopicId)).toBeUndefined();
    });

    it('revokeUser with cascade removes descendant grants', async () => {
      await repo.grantUser(userId, rootTopicId, adminId);
      await repo.grantUser(userId, childTopicId, adminId);
      await repo.grantUser(userId, grandChildId, adminId);

      await repo.revokeUser(userId, rootTopicId, { cascade: true });

      const grants = await repo.listUserGrants(userId);
      expect(grants).toHaveLength(0);
    });

    it('revokeUser without cascade only removes the specified grant', async () => {
      await repo.grantUser(userId, rootTopicId, adminId);
      await repo.grantUser(userId, childTopicId, adminId);

      await repo.revokeUser(userId, rootTopicId);

      const grants = await repo.listUserGrants(userId);
      expect(grants).toHaveLength(1);
      expect(grants[0].topicNodeId).toBe(childTopicId);
    });
  });

  // ---------------------------------------------------------------------------
  // Group grants
  // ---------------------------------------------------------------------------

  describe('group grants', () => {
    it('grantGroup creates and returns record', async () => {
      const grant = await repo.grantGroup(groupId, rootTopicId, adminId);
      expect(grant.groupId).toBe(groupId);
      expect(grant.topicNodeId).toBe(rootTopicId);
    });

    it('grantGroup is idempotent', async () => {
      const g1 = await repo.grantGroup(groupId, rootTopicId, adminId);
      const g2 = await repo.grantGroup(groupId, rootTopicId, adminId);
      expect(g1.id).toBe(g2.id);
    });

    it('revokeGroup with cascade removes descendant grants', async () => {
      await repo.grantGroup(groupId, rootTopicId, adminId);
      await repo.grantGroup(groupId, childTopicId, adminId);

      await repo.revokeGroup(groupId, rootTopicId, { cascade: true });

      const grants = await repo.listGroupGrants(groupId);
      expect(grants).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getEffectiveAccessTopicIds (recursive CTE)
  // ---------------------------------------------------------------------------

  describe('getEffectiveAccessTopicIds', () => {
    it('returns empty when user has no grants', async () => {
      const ids = await repo.getEffectiveAccessTopicIds(userId);
      expect(ids).toHaveLength(0);
    });

    it('expands root grant to all descendants', async () => {
      await repo.grantUser(userId, rootTopicId, adminId);
      const ids = await repo.getEffectiveAccessTopicIds(userId);
      expect(ids).toContain(rootTopicId);
      expect(ids).toContain(childTopicId);
      expect(ids).toContain(grandChildId);
    });

    it('includes topics from group membership', async () => {
      // Add user to group, grant root to group
      await env.DB
        .prepare('INSERT INTO user_group_members (group_id, user_id) VALUES (?, ?)')
        .bind(groupId, userId)
        .run();
      await repo.grantGroup(groupId, rootTopicId, adminId);

      const ids = await repo.getEffectiveAccessTopicIds(userId);
      expect(ids).toContain(rootTopicId);
      expect(ids).toContain(childTopicId);
      expect(ids).toContain(grandChildId);
    });

    it('union of direct and group grants deduplicates', async () => {
      await repo.grantUser(userId, rootTopicId, adminId);
      await env.DB
        .prepare('INSERT INTO user_group_members (group_id, user_id) VALUES (?, ?)')
        .bind(groupId, userId)
        .run();
      await repo.grantGroup(groupId, rootTopicId, adminId);

      const ids = await repo.getEffectiveAccessTopicIds(userId);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
      expect(ids.filter((id) => id === rootTopicId)).toHaveLength(1);
    });
  });
});
