'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import type { TopicNode } from '@web/lib/topics-api';
import type { TopicProgressStatus } from '@web/lib/topics-api';
import { useDict } from '@web/context/dict-context';
import { TopicTreeNode, type TopicTreeData } from './TopicTreeNode';

function buildTree(nodes: TopicNode[]): TopicTreeData[] {
  const byId = new Map<string, TopicTreeData>(nodes.map((n) => [n.id, { ...n, children: [] }]));
  const roots: TopicTreeData[] = [];
  for (const node of byId.values()) {
    if (node.parentId === null) roots.push(node);
    else {
      const parent = byId.get(node.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
  }
  function sort(list: TopicTreeData[]) {
    list.sort((a, b) => a.order - b.order);
    list.forEach((n) => sort(n.children));
  }
  sort(roots);
  return roots;
}

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9 9L11.5 11.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

type Props = {
  topics: TopicNode[];
  progressMap: Map<string, TopicProgressStatus>;
  globalProgress: number;
  isInstructor: boolean;
};

export function CatalogSidebar({ topics, progressMap, globalProgress }: Props) {
  const dict = useDict();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tree = useMemo(() => buildTree(topics), [topics]);
  const topicById = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);

  const openParam = searchParams.get('open') ?? '';
  const userExpandedIds = useMemo(
    () => new Set(openParam ? openParam.split(',').filter(Boolean) : tree.map((n) => n.id)),
    [openParam, tree],
  );

  const qParam = searchParams.get('q') ?? '';
  const [searchValue, setSearchValue] = useState(qParam);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Active topic id derived from the URL — used for highlighting and ancestor auto-expansion.
  const activeId = useMemo(() => {
    const match = pathname.match(/^\/catalog\/([^/]+)/);
    return match ? match[1] : null;
  }, [pathname]);

  // Ancestors of the active route are always expanded so deep topics are visible.
  const ancestorIds: ReadonlySet<string> = (() => {
    const ids: string[] = [];
    let cur = activeId ? topicById.get(activeId) : undefined;
    while (cur?.parentId) {
      ids.push(cur.parentId);
      cur = topicById.get(cur.parentId);
    }
    return new Set(ids);
  })();

  const q = qParam.toLowerCase();

  function nodeOrDescendantMatches(node: TopicTreeData): boolean {
    if (!q) return true;
    if (node.title.toLowerCase().includes(q)) return true;
    return node.children.some(nodeOrDescendantMatches);
  }

  function collectMatchAncestors(node: TopicTreeData, parents: readonly string[]): string[] {
    const here: string[] = node.title.toLowerCase().includes(q) ? [...parents] : [];
    const nextParents = [...parents, node.id];
    for (const child of node.children) {
      here.push(...collectMatchAncestors(child, nextParents));
    }
    return here;
  }

  // Ancestors of any node whose title matches the query — kept open so matches surface.
  const matchAncestorIds: ReadonlySet<string> = q
    ? new Set(tree.flatMap((root) => collectMatchAncestors(root, [])))
    : new Set();

  const effectiveExpanded: ReadonlySet<string> = new Set<string>([
    ...userExpandedIds,
    ...ancestorIds,
    ...matchAncestorIds,
  ]);

  const updateUrl = useCallback(
    (newExpandedIds: Set<string>, newQ: string) => {
      const params = new URLSearchParams(searchParams.toString());
      const openVal = Array.from(newExpandedIds).join(',');
      if (openVal) params.set('open', openVal);
      else params.delete('open');
      if (newQ) params.set('q', newQ);
      else params.delete('q');
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const handleToggle = useCallback(
    (id: string) => {
      const next = new Set(userExpandedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      updateUrl(next, qParam);
    },
    [userExpandedIds, qParam, updateUrl],
  );

  function handleSearch(value: string) {
    setSearchValue(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      updateUrl(userExpandedIds, value);
    }, 200);
  }

  function renderTree() {
    const visible = tree.filter(nodeOrDescendantMatches);
    if (visible.length === 0) {
      return (
        <p className="px-4 py-6 text-center text-xs" style={{ color: 'var(--aq-text3)' }}>
          {dict.catalog.sidebar.noResults}
        </p>
      );
    }
    return visible.map((node) => (
      <TopicTreeNode
        key={node.id}
        node={node}
        depth={0}
        expandedIds={effectiveExpanded}
        progressMap={progressMap}
        activeId={activeId}
        onToggle={handleToggle}
        expandLabel={dict.catalog.sidebar.expandTopic}
        collapseLabel={dict.catalog.sidebar.collapseTopic}
      />
    ));
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div
        className="px-5 pb-3 pt-5"
        style={{ borderBottom: '1px solid var(--aq-border)' }}
      >
        {/* Global progress */}
        <div>
          <div className="mb-1.5 flex justify-between text-[12px]" style={{ color: 'var(--aq-text2)' }}>
            <span>{dict.catalog.sidebar.progressLabel}</span>
            <strong style={{ color: 'var(--aq-accent)' }}>{globalProgress}%</strong>
          </div>
          <div
            className="h-[6px] overflow-hidden rounded-full"
            style={{ background: 'var(--aq-bg4)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${globalProgress}%`,
                background: 'linear-gradient(90deg, var(--aq-accent), var(--aq-accent2))',
              }}
            />
          </div>
        </div>
      </div>

      {/* Search & Eyebrow */}
      <div className="mx-4 mt-4">
        <p
          className="mb-2 text-[11px] font-semibold uppercase tracking-[1.2px]"
          style={{ color: 'var(--aq-text3)' }}
        >
          {dict.catalog.breadcrumb.catalogue}
        </p>
        <div
          className="flex items-center gap-2 rounded-[9px] px-3 py-[7px]"
          style={{ background: 'var(--aq-bg3)', border: '1px solid var(--aq-border2)' }}
        >
          <span style={{ color: 'var(--aq-text3)' }}>
            <SearchIcon />
          </span>
          <input
            type="search"
            placeholder={dict.catalog.sidebar.searchPlaceholder}
            value={searchValue}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full bg-transparent text-[13px] outline-none"
            style={{ color: 'var(--aq-text)', caretColor: 'var(--aq-accent)' }}
            aria-label={dict.catalog.sidebar.searchAriaLabel}
          />
        </div>
      </div>

      {/* Tree */}
      <nav
        className="flex-1 overflow-y-auto py-3"
        aria-label={dict.catalog.sidebar.navAriaLabel}
        style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--aq-bg4) transparent' }}
      >
        {topics.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs" style={{ color: 'var(--aq-text3)' }}>
            {dict.catalog.sidebar.noContent}
          </p>
        ) : (
          renderTree()
        )}
      </nav>
    </div>
  );
}
