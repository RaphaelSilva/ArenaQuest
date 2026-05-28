import { describe, it, expect } from 'vitest';
import { buildTrail, countDeep } from '../topic-tree';
import type { TopicNode } from '@web/lib/topics-api';

function testNode(id: string, parentId: string | null): TopicNode {
  return {
    id,
    parentId,
    title: `Topic ${id}`,
    content: `Content for ${id}`,
    status: 'published',
    archived: false,
    order: 1,
    estimatedMinutes: 5,
    tags: [],
    prerequisiteIds: [],
  };
}

describe('topic-tree helpers', () => {
  describe('buildTrail', () => {
    it('returns path from root to leaf', () => {
      const nodes = [
        testNode('root', null),
        testNode('child', 'root'),
        testNode('grandchild', 'child'),
      ];
      
      const trail = buildTrail(nodes, 'grandchild');
      expect(trail.map((t) => t.id)).toEqual(['root', 'child', 'grandchild']);
    });

    it('returns only root when checking root', () => {
      const nodes = [testNode('root', null)];
      const trail = buildTrail(nodes, 'root');
      expect(trail.map((t) => t.id)).toEqual(['root']);
    });

    it('falls back gracefully on missing intermediate parent', () => {
      const nodes = [
        testNode('grandchild', 'child'),
        // 'child' is missing
        testNode('root', null),
      ];
      const trail = buildTrail(nodes, 'grandchild');
      // Should recover whatever is connected and not crash. Here child is missing so it returns only grandchild.
      expect(trail.map((t) => t.id)).toEqual(['grandchild']);
    });
  });

  describe('countDeep', () => {
    it('returns 0 for empty nodes or non-existent rootId', () => {
      expect(countDeep([], 'non-existent')).toBe(0);
    });

    it('returns 1 for a single leaf node (empty subtree / no children)', () => {
      const nodes = [testNode('leaf', null)];
      expect(countDeep(nodes, 'leaf')).toBe(1);
    });

    it('returns correct count for a one-level subtree', () => {
      const nodes = [
        testNode('parent', null),
        testNode('child1', 'parent'),
        testNode('child2', 'parent'),
      ];
      expect(countDeep(nodes, 'parent')).toBe(3);
    });

    it('returns correct count for a multi-level subtree', () => {
      const nodes = [
        testNode('root', null),
        testNode('child1', 'root'),
        testNode('child2', 'root'),
        testNode('grandchild1', 'child1'),
        testNode('grandchild2', 'child1'),
        testNode('external', null), // should not be counted
      ];
      expect(countDeep(nodes, 'root')).toBe(5);
    });
  });
});
