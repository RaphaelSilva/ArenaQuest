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
};

const PCT: Record<TopicProgressStatus, number> = {
  completed: 100,
  in_progress: 50,
  not_started: 0,
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

const STATUS_STRIPE: Record<TopicProgressStatus, string> = {
  completed: 'var(--aq-accent3)',
  in_progress: 'var(--aq-accent)',
  not_started: 'transparent',
};

export function SubtopicCard({ subtopic, index, status }: Props) {
  const dict = useDict();
  const pct = PCT[status];
  const stripe = STATUS_STRIPE[status];
  const bg = STATUS_BG[status];
  const color = STATUS_COLOR[status];

  const statusLabels: Record<TopicProgressStatus, string> = {
    completed: dict.catalog.subtopicCard.statusCompleted,
    in_progress: dict.catalog.subtopicCard.statusInProgress,
    not_started: dict.catalog.subtopicCard.statusNotStarted,
  };

  return (
    <Link
      href={`/catalog/${subtopic.id}`}
      className="relative flex items-center gap-5 overflow-hidden rounded-[14px] px-6 py-5 transition-transform duration-200 hover:translate-x-[3px]"
      style={{
        background: 'var(--aq-bg2)',
        border: '1px solid var(--aq-border)',
        boxShadow: 'var(--aq-card-shadow, 0 2px 12px rgba(0,0,0,0.15))',
      }}
    >
      {/* Left accent stripe */}
      <div
        className="absolute bottom-0 left-0 top-0 w-1 rounded-[4px_0_0_4px]"
        style={{ background: stripe }}
      />

      {/* Number badge */}
      <div
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] text-[13px] font-bold"
        style={
          status === 'completed'
            ? { background: 'var(--aq-accent3)', color: 'white' }
            : status === 'in_progress'
            ? { background: 'var(--aq-accent)', color: '#0B0E17' }
            : { background: 'var(--aq-bg3)', color: 'var(--aq-text3)', border: '1px solid var(--aq-border2)' }
        }
        aria-hidden
      >
        {status === 'completed' ? '✓' : index + 1}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold" style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" }}>
          {subtopic.title}
        </p>
        {subtopic.content && (
          <p className="mt-0.5 text-[13px]" style={{ color: 'var(--aq-text2)' }}>
            {subtopic.content.replace(/[#*`_[\]]/g, '').slice(0, 80).trim()}…
          </p>
        )}
        {subtopic.tags && subtopic.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {subtopic.tags.map((t) => (
              <span
                key={t.id}
                className="rounded-[6px] px-2 py-0.5 text-[11px] font-medium"
                style={{ background: 'var(--aq-bg4)', color: 'var(--aq-text3)' }}
              >
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="flex flex-shrink-0 flex-col items-end gap-2" style={{ minWidth: 100 }}>

        <div className="w-full">
          <p className="mb-1 text-right text-[11px]" style={{ color: 'var(--aq-text3)' }}>{pct}%</p>
          <div className="h-[5px] overflow-hidden rounded-full" style={{ background: 'var(--aq-bg4)' }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${pct}%`, background: stripe || 'var(--aq-accent)' }}
            />
          </div>
        </div>
        <span
          className="rounded-[10px] px-2.5 py-0.5 text-[11px] font-semibold"
          style={{ background: bg, color: color }}
        >
          {statusLabels[status]}
        </span>
      </div>
    </Link>
  );
}
