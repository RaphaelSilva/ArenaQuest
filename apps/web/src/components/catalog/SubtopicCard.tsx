'use client';

import Link from 'next/link';
import type { TopicNode } from '@web/lib/topics-api';
import type { TopicProgressStatus } from '@web/lib/topics-api';
import { useDict } from '@web/context/dict-context';

type Props = {
  topicId: string;
  subtopic: TopicNode;
  index: number;
  status: TopicProgressStatus;
  hasChildren?: boolean;
};

const STATUS_BG: Record<TopicProgressStatus, string> = {
  completed: 'oklch(0.68 0.17 150 / 0.15)',
  in_progress: 'var(--aq-accent-glow)',
  not_started: 'var(--aq-bg4)',
};

const STATUS_COLOR: Record<TopicProgressStatus, string> = {
  completed: 'var(--aq-accent3)',
  in_progress: 'var(--aq-accent)',
  not_started: 'var(--aq-text3)',
};

export function SubtopicCard({ subtopic, index, status, hasChildren }: Props) {
  const dict = useDict();
  const bg = STATUS_BG[status];
  const color = STATUS_COLOR[status];

  const statusLabels: Record<TopicProgressStatus, string> = {
    completed: dict.catalog.subtopicCard.statusCompleted,
    in_progress: dict.catalog.subtopicCard.statusInProgress,
    not_started: dict.catalog.subtopicCard.statusNotStarted,
  };

  const paddedIndex = String(index + 1).padStart(2, '0');

  return (
    <Link
      href={`/catalog/${subtopic.id}`}
      className="group relative flex items-center gap-4 overflow-hidden rounded-[12px] px-5 py-4 transition-all duration-200 hover:translate-x-[2px]"
      style={{
        background: 'var(--aq-bg2)',
        border: '1px solid var(--aq-border)',
        boxShadow: 'var(--aq-card-shadow, 0 2px 12px rgba(0,0,0,0.15))',
      }}
    >
      {/* Index number */}
      <div
        className="flex-shrink-0 text-[20px] font-bold"
        style={{
          fontFamily: 'var(--font-jetbrains-mono), monospace',
          color: 'var(--aq-accent)',
          minWidth: '28px',
        }}
      >
        {paddedIndex}
      </div>

      {/* Info block */}
      <div className="min-w-0 flex-1">
        <h4
          className="text-[15px] font-bold"
          style={{
            fontFamily: 'var(--font-space-grotesk), sans-serif',
            color: 'var(--aq-text)',
          }}
        >
          {subtopic.title}
        </h4>
        {subtopic.content && (
          <p
            className="mt-0.5 text-[13px] line-clamp-2"
            style={{ color: 'var(--aq-text2)', lineHeight: '1.4' }}
          >
            {subtopic.content.replace(/[#*`_[\]]/g, '').trim()}
          </p>
        )}

        {/* Pills row */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {hasChildren && (
            <span
              className="rounded-[6px] px-2 py-0.5 text-[11px] font-semibold flex items-center gap-1"
              style={{ background: 'var(--aq-accent-glow)', color: 'var(--aq-accent)' }}
            >
              📂 {dict.catalog.redesign.deepLabel}
            </span>
          )}
          <span
            className="rounded-[6px] px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: bg, color: color }}
          >
            {statusLabels[status]}
          </span>
        </div>
      </div>

      {/* Arrow chip */}
      <div className="flex-shrink-0 ml-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--aq-border2)] bg-transparent text-[var(--aq-text3)] transition-all duration-200 group-hover:border-[var(--aq-accent)] group-hover:bg-[var(--aq-accent)] group-hover:text-[#0b0e17]">
          <svg
            className="h-4 w-4 stroke-current"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </div>
      </div>
    </Link>
  );
}
