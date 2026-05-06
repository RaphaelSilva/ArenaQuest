import type { TopicProgressItem } from './progress-api';

export type TopicNode = {
  id: string;
  parentId: string | null;
  title: string;
  status: string;
};

export type RootRollup = {
  rootId: string;
  title: string;
  total: number;
  completed: number;
  percentage: number;
};

/**
 * Computes per-root-topic completion by aggregating progress across all descendants.
 * Returns one entry per root topic (parentId === null) that has at least one
 * published descendant in the progress set.
 */
export function computeRootRollups(
  topics: TopicNode[],
  progressItems: TopicProgressItem[],
): RootRollup[] {
  const progressMap = new Map(progressItems.map((p) => [p.topicNodeId, p.status]));

  // Build child map for tree traversal
  const childrenOf = new Map<string | null, string[]>();
  for (const t of topics) {
    const siblings = childrenOf.get(t.parentId) ?? [];
    siblings.push(t.id);
    childrenOf.set(t.parentId, siblings);
  }

  function collectDescendants(nodeId: string): string[] {
    const result: string[] = [nodeId];
    for (const childId of childrenOf.get(nodeId) ?? []) {
      result.push(...collectDescendants(childId));
    }
    return result;
  }

  const roots = topics.filter((t) => t.parentId === null);

  return roots
    .map((root): RootRollup => {
      const all = collectDescendants(root.id);
      const inProgress = all.filter((id) => progressMap.has(id));
      const total = inProgress.length;
      const completed = inProgress.filter((id) => progressMap.get(id) === 'completed').length;
      return {
        rootId: root.id,
        title: root.title,
        total,
        completed,
        percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
      };
    })
    .filter((r) => r.total > 0);
}
