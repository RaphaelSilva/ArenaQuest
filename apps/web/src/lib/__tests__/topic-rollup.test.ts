import { describe, it, expect } from 'vitest';
import { computeRootRollups } from '../topic-rollup';
import type { TopicNode } from '../topic-rollup';
import type { TopicProgressItem } from '../progress-api';

function node(id: string, parentId: string | null, title = id): TopicNode {
  return { id, parentId, title, status: 'published' };
}

function progress(topicNodeId: string, status: string): TopicProgressItem {
  return { topicNodeId, status, completedAt: null, updatedAt: '2026-01-01T00:00:00Z' };
}

describe('computeRootRollups', () => {
  it('returns an entry for each root that has progress', () => {
    const topics = [node('r1', null, 'Root 1'), node('c1', 'r1', 'Child 1')];
    const items = [progress('c1', 'completed')];
    const rollups = computeRootRollups(topics, items);
    expect(rollups).toHaveLength(1);
    expect(rollups[0].rootId).toBe('r1');
  });

  it('calculates 100% when all descendants are completed', () => {
    const topics = [
      node('r1', null),
      node('c1', 'r1'),
      node('c2', 'r1'),
    ];
    const items = [progress('c1', 'completed'), progress('c2', 'completed')];
    const rollups = computeRootRollups(topics, items);
    expect(rollups[0].percentage).toBe(100);
  });

  it('calculates 0% when all in-progress nodes are not completed', () => {
    const topics = [node('r1', null), node('c1', 'r1')];
    const items = [progress('c1', 'in_progress')];
    const rollups = computeRootRollups(topics, items);
    expect(rollups[0].percentage).toBe(0);
  });

  it('includes the root node itself in the count if it has progress', () => {
    const topics = [node('r1', null), node('c1', 'r1')];
    const items = [progress('r1', 'completed'), progress('c1', 'completed')];
    const rollups = computeRootRollups(topics, items);
    expect(rollups[0].total).toBe(2);
    expect(rollups[0].completed).toBe(2);
    expect(rollups[0].percentage).toBe(100);
  });

  it('omits roots with no progress entries', () => {
    const topics = [
      node('r1', null, 'Root 1'),
      node('r2', null, 'Root 2'),
      node('c2', 'r2'),
    ];
    const items = [progress('c2', 'completed')];
    const rollups = computeRootRollups(topics, items);
    expect(rollups.map((r) => r.rootId)).toEqual(['r2']);
  });

  it('handles deeply nested topics', () => {
    const topics = [
      node('r1', null),
      node('l1', 'r1'),
      node('l2', 'l1'),
      node('l3', 'l2'),
    ];
    const items = [
      progress('l1', 'completed'),
      progress('l2', 'in_progress'),
      progress('l3', 'completed'),
    ];
    const rollups = computeRootRollups(topics, items);
    expect(rollups[0].total).toBe(3);
    expect(rollups[0].completed).toBe(2);
    expect(rollups[0].percentage).toBe(67);
  });

  it('returns empty array when topics list is empty', () => {
    expect(computeRootRollups([], [])).toEqual([]);
  });

  it('returns empty array when progress list is empty', () => {
    const topics = [node('r1', null), node('c1', 'r1')];
    expect(computeRootRollups(topics, [])).toEqual([]);
  });
});
