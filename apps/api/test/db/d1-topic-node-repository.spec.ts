import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { D1TopicNodeRepository } from '@api/adapters/db/d1-topic-node-repository';
import { Entities } from '@arenaquest/shared/types/entities';

// D1's exec() processes one statement at a time in the local simulator
const MIGRATION_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS topic_nodes (
    id                TEXT    NOT NULL PRIMARY KEY,
    parent_id         TEXT    REFERENCES topic_nodes(id) ON DELETE RESTRICT,
    title             TEXT    NOT NULL,
    content           TEXT    NOT NULL DEFAULT '',
    status            TEXT    NOT NULL DEFAULT 'draft',
    sort_order        INTEGER NOT NULL DEFAULT 0,
    estimated_minutes INTEGER NOT NULL DEFAULT 0,
    archived          INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS tags (
    id         TEXT NOT NULL PRIMARY KEY,
    name       TEXT NOT NULL,
    slug       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS topic_node_tags (
    topic_node_id TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE CASCADE,
    tag_id        TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (topic_node_id, tag_id)
  )`,
  `CREATE TABLE IF NOT EXISTS topic_node_prerequisites (
    topic_node_id   TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE CASCADE,
    prerequisite_id TEXT NOT NULL REFERENCES topic_nodes(id) ON DELETE CASCADE,
    PRIMARY KEY (topic_node_id, prerequisite_id)
  )`,
];

describe('D1TopicNodeRepository', () => {
  let repo: D1TopicNodeRepository;

  beforeAll(async () => {
    await env.DB.batch(MIGRATION_STATEMENTS.map(sql => env.DB.prepare(sql)));
    repo = new D1TopicNodeRepository(env.DB);
  });

  it('create + findById round-trip', async () => {
    const node = await repo.create({ title: 'Intro to Algebra' });

    expect(node.id).toBeTypeOf('string');
    expect(node.title).toBe('Intro to Algebra');
    expect(node.parentId).toBeNull();
    expect(node.status).toBe(Entities.Config.TopicNodeStatus.DRAFT);
    expect(node.archived).toBe(false);
    expect(node.tags).toEqual([]);
    expect(node.prerequisiteIds).toEqual([]);

    const fetched = await repo.findById(node.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(node.id);
  });

  it('findById returns null for unknown id', async () => {
    const result = await repo.findById('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('listChildren(null) returns only root-level nodes', async () => {
    const root = await repo.create({ title: 'Root Node' });
    const child = await repo.create({ title: 'Child Node', parentId: root.id });

    const roots = await repo.listChildren(null);
    const ids = roots.map(n => n.id);

    expect(ids).toContain(root.id);
    expect(ids).not.toContain(child.id);
  });

  it('listChildren(parentId) returns direct children in sort_order', async () => {
    const parent = await repo.create({ title: 'Parent' });
    const c1 = await repo.create({ title: 'Child A', parentId: parent.id, order: 0 });
    const c2 = await repo.create({ title: 'Child B', parentId: parent.id, order: 1 });
    const c3 = await repo.create({ title: 'Child C', parentId: parent.id, order: 2 });

    const children = await repo.listChildren(parent.id);
    expect(children.map(c => c.id)).toEqual([c1.id, c2.id, c3.id]);
  });

  it('update modifies scalar fields', async () => {
    const node = await repo.create({ title: 'Old Title' });

    const updated = await repo.update(node.id, {
      title: 'New Title',
      content: 'Some content',
      status: Entities.Config.TopicNodeStatus.PUBLISHED,
      estimatedMinutes: 30,
    });

    expect(updated.title).toBe('New Title');
    expect(updated.content).toBe('Some content');
    expect(updated.status).toBe(Entities.Config.TopicNodeStatus.PUBLISHED);
    expect(updated.estimatedMinutes).toBe(30);
  });

  it('create and update associate tags via tagIds', async () => {
    // Seed tags directly
    const tagId = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO tags (id, name, slug) VALUES (?, ?, ?)').bind(tagId, 'Math', 'math').run();

    const node = await repo.create({ title: 'Tagged Node', tagIds: [tagId] });
    expect(node.tags).toHaveLength(1);
    expect(node.tags[0].slug).toBe('math');

    // Replace tags with empty list
    const updated = await repo.update(node.id, { tagIds: [] });
    expect(updated.tags).toHaveLength(0);
  });

  it('create associates prerequisiteIds', async () => {
    const prereq = await repo.create({ title: 'Prereq Node' });
    const node = await repo.create({ title: 'Dependent Node', prerequisiteIds: [prereq.id] });

    expect(node.prerequisiteIds).toContain(prereq.id);

    // Replace prerequisites
    const updated = await repo.update(node.id, { prerequisiteIds: [] });
    expect(updated.prerequisiteIds).toHaveLength(0);
  });

  it('delete removes the node', async () => {
    const node = await repo.create({ title: 'To Delete' });
    await repo.delete(node.id);
    expect(await repo.findById(node.id)).toBeNull();
  });

  describe('wouldCreateCycle', () => {
    it('returns true when moving a node under itself', async () => {
      const node = await repo.create({ title: 'Self' });
      expect(await repo.wouldCreateCycle(node.id, node.id)).toBe(true);
    });

    it('returns true when moving a node under its descendant', async () => {
      const root = await repo.create({ title: 'Root' });
      const child = await repo.create({ title: 'Child', parentId: root.id });
      const grandchild = await repo.create({ title: 'Grandchild', parentId: child.id });

      expect(await repo.wouldCreateCycle(root.id, grandchild.id)).toBe(true);
    });

    it('returns false for a valid move to an unrelated node', async () => {
      const a = await repo.create({ title: 'A' });
      const b = await repo.create({ title: 'B' });
      expect(await repo.wouldCreateCycle(a.id, b.id)).toBe(false);
    });
  });

  describe('move', () => {
    it('moves a node to a new parent and produces gapless sort_order', async () => {
      const parent = await repo.create({ title: 'Move Parent' });
      const c1 = await repo.create({ title: 'C1', parentId: parent.id, order: 0 });
      const c2 = await repo.create({ title: 'C2', parentId: parent.id, order: 1 });

      // Move c1 to root
      const moved = await repo.move(c1.id, null);
      expect(moved.parentId).toBeNull();

      // Remaining sibling in parent should still be at sort_order 0
      const remaining = await repo.findById(c2.id);
      expect(remaining!.order).toBe(0);
    });

    it('inserts the node at the requested sort position and renumbers', async () => {
      const parent = await repo.create({ title: 'Order Parent' });
      const c1 = await repo.create({ title: 'First', parentId: parent.id, order: 0 });
      const c2 = await repo.create({ title: 'Second', parentId: parent.id, order: 1 });
      const incoming = await repo.create({ title: 'Incoming' });

      // Move incoming to position 0 (before First)
      await repo.move(incoming.id, parent.id, 0);

      const children = await repo.listChildren(parent.id);
      expect(children.map(c => c.id)).toEqual([incoming.id, c1.id, c2.id]);
      expect(children.map(c => c.order)).toEqual([0, 1, 2]);
    });

    it('rejects a move that would create a cycle', async () => {
      const root = await repo.create({ title: 'Cycle Root' });
      const child = await repo.create({ title: 'Cycle Child', parentId: root.id });

      await expect(repo.move(root.id, child.id)).rejects.toThrow('cycle');
    });
  });

  describe('archive', () => {
    it('cascades archived status to all descendants', async () => {
      const root = await repo.create({ title: 'Archive Root' });
      const child = await repo.create({ title: 'Archive Child', parentId: root.id });
      const grandchild = await repo.create({ title: 'Archive Grandchild', parentId: child.id });

      await repo.archive(root.id);

      const [r, c, g] = await Promise.all([
        repo.findById(root.id),
        repo.findById(child.id),
        repo.findById(grandchild.id),
      ]);

      expect(r!.archived).toBe(true);
      expect(c!.archived).toBe(true);
      expect(g!.archived).toBe(true);
    });

    it('does not archive unrelated nodes', async () => {
      const target = await repo.create({ title: 'Target' });
      const sibling = await repo.create({ title: 'Sibling' });

      await repo.archive(target.id);

      const s = await repo.findById(sibling.id);
      expect(s!.archived).toBe(false);
    });
  });
});
