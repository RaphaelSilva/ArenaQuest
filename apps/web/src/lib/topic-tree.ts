import type { TopicNode } from '@web/lib/topics-api';

/**
 * Builds the breadcrumb trail of TopicNodes from a leaf or sub-node up to the root topic,
 * assuming an acyclic topic tree.
 */
export function buildTrail(nodes: TopicNode[], leafId: string): TopicNode[] {
  const byId = new Map<string, TopicNode>(nodes.map((n) => [n.id, n]));
  const trail: TopicNode[] = [];
  
  let currentId: string | null = leafId;
  const visited = new Set<string>(); // Cycle protection fallback
  
  while (currentId !== null && !visited.has(currentId)) {
    visited.add(currentId);
    const node = byId.get(currentId);
    if (!node) {
      break;
    }
    trail.unshift(node);
    currentId = node.parentId;
  }
  
  return trail;
}

/**
 * Computes the total number of topic nodes in a branch (including the root node itself),
 * assuming an acyclic topic tree.
 */
export function countDeep(nodes: TopicNode[], rootId: string): number {
  const byParentId = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentId) {
      const list = byParentId.get(node.parentId) ?? [];
      list.push(node.id);
      byParentId.set(node.parentId, list);
    }
  }

  const byId = new Map<string, TopicNode>(nodes.map((n) => [n.id, n]));
  if (!byId.has(rootId)) {
    return 0;
  }

  let count = 0;
  const queue: string[] = [rootId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    count++;

    const children = byParentId.get(currentId) ?? [];
    queue.push(...children);
  }

  return count;
}
