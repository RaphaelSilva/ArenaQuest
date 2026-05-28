'use client';

import Link from 'next/link';
import type { TopicNode, TopicProgressStatus } from '@web/lib/topics-api';

export type TopicTreeData = TopicNode & { children: TopicTreeData[] };

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

type Props = {
  node: TopicTreeData;
  depth: number;
  expandedIds: Set<string>;
  progressMap: Map<string, TopicProgressStatus>;
  activeId: string | null;
  onToggle: (id: string) => void;
  expandLabel: (title: string) => string;
  collapseLabel: (title: string) => string;
};

export function TopicTreeNode({
  node,
  depth,
  expandedIds,
  progressMap,
  activeId,
  onToggle,
  expandLabel,
  collapseLabel,
}: Props) {
  const hasChildren = node.children.length > 0;
  const isOpen = expandedIds.has(node.id);
  const isActive = activeId === node.id;
  const status = progressMap.get(node.id) ?? 'not_started';

  return (
    <div>
      <div
        className="relative flex items-center"
        style={{
          background: isActive ? 'var(--aq-accent-glow)' : undefined,
          paddingLeft: 12 + depth * 14,
          paddingRight: 12,
        }}
        role="button"
        tabIndex={0}
        aria-expanded={hasChildren ? isOpen : undefined}
      >
        {isActive && (
          <div
            className="absolute left-0 top-0 bottom-0"
            style={{ width: 3, background: 'var(--aq-accent)', borderRadius: '0 2px 2px 0' }}
          />
        )}
        {/* Chevron — z-indexed above the overlay link so its clicks land here */}
        <button
          type="button"
          aria-label={isOpen ? collapseLabel(node.title) : expandLabel(node.title)}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            if (hasChildren) onToggle(node.id);
          }}
          className="flex h-9 w-5 flex-shrink-0 items-center justify-center border-0 bg-transparent"
          style={{
            color: 'var(--aq-text3)',
            visibility: hasChildren ? 'visible' : 'hidden',
            cursor: hasChildren ? 'pointer' : 'default',
            position: 'relative',
            zIndex: 1,
          }}
          tabIndex={hasChildren ? 0 : -1}
          disabled={!hasChildren}
        >
          <ChevronIcon open={isOpen} />
        </button>
        {/* Icon */}
        <span
          className="mr-2.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[7px] text-sm"
          style={{ background: 'var(--aq-accent-glow)' }}
          aria-hidden
        >
          📚
        </span>
        {/* Label */}
        <div className="min-w-0 flex-1 py-2">
          <p
            className="truncate text-[13px] font-medium"
            style={{ color: isActive ? 'var(--aq-accent)' : 'var(--aq-text)' }}
          >
            {node.title}
          </p>
        </div>
        {/* Trailing: count badge for intermediate nodes, status indicator for leaves */}
        {hasChildren ? (
          <span
            className="flex-shrink-0 rounded-[6px] px-2 py-0.5 text-[11px] font-semibold"
            style={{
              color: 'var(--aq-text3)',
              background: 'var(--aq-bg3)',
              border: '1px solid var(--aq-border2)',
            }}
          >
            {node.children.length}
          </span>
        ) : (
          <span className="flex flex-shrink-0 items-center gap-1.5">
            <span
              className="h-[6px] w-[6px] rounded-full"
              style={{ background: STATUS_DOT[status] }}
            />
            <span className="text-[11px]" style={{ color: STATUS_DOT[status] }}>
              {STATUS_LABEL[status]}
            </span>
          </span>
        )}
        {/* Navigation overlay */}
        <Link
          href={`/catalog/${node.id}`}
          className="absolute inset-0"
          aria-label={node.title}
        />
      </div>
      {isOpen && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TopicTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              progressMap={progressMap}
              activeId={activeId}
              onToggle={onToggle}
              expandLabel={expandLabel}
              collapseLabel={collapseLabel}
            />
          ))}
        </div>
      )}
    </div>
  );
}
