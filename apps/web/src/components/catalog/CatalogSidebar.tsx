'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { TopicNode } from '@web/lib/topics-api';

type TreeNode = TopicNode & { children: TreeNode[] };

function buildTree(nodes: TopicNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>(
    nodes.map((n) => [n.id, { ...n, children: [] }]),
  );
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId === null) {
      roots.push(node);
    } else {
      const parent = byId.get(node.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
  }
  function sortChildren(list: TreeNode[]): void {
    list.sort((a, b) => a.order - b.order);
    for (const n of list) sortChildren(n.children);
  }
  sortChildren(roots);
  return roots;
}

type CatalogSidebarProps = {
  topics: TopicNode[];
};

export function CatalogSidebar({ topics }: CatalogSidebarProps) {
  const tree = buildTree(topics);
  const pathname = usePathname();
  // Expanded logic: could default to all collapsed or all expanded.
  // We'll use a simple set to keep track, defaulting to expanded for roots if desired.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(tree.map(n => n.id)));

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderNodes(treeNodes: TreeNode[], depth = 0): React.ReactNode {
    return treeNodes.map((node) => {
      const isSelected = pathname === `/catalog/${node.id}`;
      const isExpanded = expandedIds.has(node.id);
      const hasChildren = node.children.length > 0;

      return (
        <div key={node.id}>
          <div
            className={`group flex items-center gap-1.5 rounded-lg py-1.5 pr-2 text-sm transition-all duration-200 ${
              isSelected
                ? 'bg-indigo-50 text-indigo-900 shadow-sm dark:bg-indigo-500/10 dark:text-indigo-300'
                : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/50'
            }`}
            style={{ paddingLeft: `${6 + depth * 18}px` }}
          >
            {/* Expand / collapse toggle */}
            <button
              type="button"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
              onClick={(e) => { e.preventDefault(); toggleExpand(node.id); }}
              className="w-4 flex-shrink-0 text-center text-xs text-zinc-400 disabled:invisible"
              disabled={!hasChildren}
            >
              {hasChildren ? (isExpanded ? '▾' : '▸') : ''}
            </button>

            {/* Link to topic */}
            <Link
              href={`/catalog/${node.id}`}
              className="min-w-0 flex-1 truncate text-left font-medium"
              title={node.title}
            >
              {node.title}
            </Link>
            
            {/* Minutes indicator */}
            {node.estimatedMinutes > 0 && (
              <span className="flex-shrink-0 text-[10px] font-medium text-zinc-400">
                {node.estimatedMinutes}m
              </span>
            )}
          </div>

          {/* Children */}
          {isExpanded && hasChildren && (
            <div className="mt-0.5 space-y-0.5">
              {renderNodes(node.children, depth + 1)}
            </div>
          )}
        </div>
      );
    });
  }

  return (
    <nav className="space-y-1" aria-label="Catalogue tree">
      {tree.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-500">No published content available.</p>
      ) : (
        renderNodes(tree)
      )}
    </nav>
  );
}
