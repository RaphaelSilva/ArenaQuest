'use client';

import { useCallback, useRef, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import type { TopicNode } from '@web/lib/topics-api';
import type { TopicProgressStatus } from '@web/lib/topics-api';
import { useDict } from '@web/context/dict-context';

type TreeNode = TopicNode & { children: TreeNode[] };

function buildTree(nodes: TopicNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>(nodes.map((n) => [n.id, { ...n, children: [] }]));
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId === null) roots.push(node);
    else {
      const parent = byId.get(node.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
  }
  function sort(list: TreeNode[]) {
    list.sort((a, b) => a.order - b.order);
    list.forEach((n) => sort(n.children));
  }
  sort(roots);
  return roots;
}

const STATUS_DOT: Record<TopicProgressStatus, string> = {
  completed: 'var(--aq-accent3)',
  in_progress: 'var(--aq-accent)',
  not_started: 'var(--aq-bg4)',
};

const STATUS_LABEL: Record<TopicProgressStatus, string> = {
  completed: '✓',
  in_progress: '…',
  not_started: '○',
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      style={{ transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'none' }}
    >
      <path
        d="M3.5 2L6.5 5L3.5 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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

  const tree = buildTree(topics);

  const openParam = searchParams.get('open') ?? '';
  const expandedIds = new Set(openParam ? openParam.split(',').filter(Boolean) : tree.map((n) => n.id));

  const qParam = searchParams.get('q') ?? '';
  const [searchValue, setSearchValue] = useState(qParam);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);



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

  function toggleExpand(id: string) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateUrl(next, qParam);
  }

  function handleSearch(value: string) {
    setSearchValue(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      updateUrl(expandedIds, value);
    }, 200);
  }

  const q = qParam.toLowerCase();

  function topicMatchesSearch(node: TreeNode): boolean {
    if (!q) return true;
    if (node.title.toLowerCase().includes(q)) return true;
    return node.children.some((c) => c.title.toLowerCase().includes(q));
  }

  function renderTree() {
    const visible = tree.filter(topicMatchesSearch);
    if (visible.length === 0) {
      return (
        <p className="px-4 py-6 text-center text-xs" style={{ color: 'var(--aq-text3)' }}>
          {dict.catalog.sidebar.noResults}
        </p>
      );
    }
    return visible.map((node) => {
      const isOpen = expandedIds.has(node.id);
      const subtopicTotal = node.children.length;

      const isActive = pathname.startsWith(`/catalog/${node.id}`);

      const visibleChildren = q
        ? node.children.filter((c) => c.title.toLowerCase().includes(q))
        : node.children;

      return (
        <div key={node.id}>
          {/* Topic row */}
          <div
            className="relative flex cursor-pointer items-center gap-0 pr-3"
            style={{
              background: isActive ? 'var(--aq-accent-glow)' : undefined,
              padding: '0 12px 0 0',
            }}
            onClick={() => toggleExpand(node.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && toggleExpand(node.id)}
            aria-expanded={isOpen}
          >
            {isActive && (
              <div
                className="absolute left-0 top-0 bottom-0"
                style={{ width: 3, background: 'var(--aq-accent)', borderRadius: '0 2px 2px 0' }}
              />
            )}
            {/* Chevron */}
            <span
              className="flex h-9 w-5 flex-shrink-0 items-center justify-center"
              style={{ color: 'var(--aq-text3)' }}
            >
              {node.children.length > 0 && <ChevronIcon open={isOpen} />}
            </span>
            {/* Icon */}
            <span
              className="mr-2.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[7px] text-sm"
              style={{ background: 'var(--aq-accent-glow)' }}
              aria-hidden
            >
              📚
            </span>
            {/* Info (Slot 3 - Label) */}
            <div className="min-w-0 flex-1 py-2">
              <p
                className="truncate text-[13px] font-medium"
                style={{ color: isActive ? 'var(--aq-accent)' : 'var(--aq-text)' }}
              >
                {node.title}
              </p>
            </div>
            {/* Count (Slot 4) */}
            <span className="flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-[6px]" style={{ color: 'var(--aq-text3)', background: 'var(--aq-bg3)', border: '1px solid var(--aq-border2)' }}>
              {subtopicTotal}
            </span>
            {/* Link to topic page */}
            <Link
              href={`/catalog/${node.id}`}
              className="absolute inset-0"
              aria-label={node.title}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          {/* Subtopics */}
          {isOpen && visibleChildren.length > 0 && (
            <div>
              {visibleChildren.map((child) => {
                const childStatus = progressMap.get(child.id) ?? 'not_started';
                const isChildActive = pathname === `/catalog/${child.id}`;
                return (
                  <Link
                    key={child.id}
                    href={`/catalog/${child.id}`}
                    className="flex items-center gap-2 py-[7px] text-xs transition-colors hover:bg-[var(--aq-bg3)]"
                    style={{
                      paddingLeft: 54,
                      paddingRight: 12,
                      background: isChildActive ? 'var(--aq-accent-glow)' : undefined,
                      color: 'var(--aq-text2)',
                    }}
                  >
                    <span
                      className="h-[6px] w-[6px] flex-shrink-0 rounded-full"
                      style={{ background: STATUS_DOT[childStatus] }}
                    />
                    <span className="flex-1 truncate">{child.title}</span>
                    <span style={{ color: STATUS_DOT[childStatus] }}>{STATUS_LABEL[childStatus]}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      );
    });
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
