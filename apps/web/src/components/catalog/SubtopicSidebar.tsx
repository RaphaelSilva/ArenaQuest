'use client';

import Link from 'next/link';
import type { TopicNode } from '@web/lib/topics-api';
import type { TopicProgressStatus } from '@web/lib/topics-api';
import { useDict } from '@web/context/dict-context';

type Props = {
  topicId: string;
  topicTitle: string;
  subtopicId: string;
  siblings: TopicNode[];
  progressMap: Map<string, TopicProgressStatus>;
};

export function SubtopicSidebar({ topicId, topicTitle, subtopicId, siblings, progressMap }: Props) {
  const dict = useDict();
  const completedCount = siblings.filter(
    (s) => (progressMap.get(s.id) ?? 'not_started') === 'completed',
  ).length;
  const topicPct = siblings.length > 0 ? Math.round((completedCount / siblings.length) * 100) : 0;

  const currentIndex = siblings.findIndex((s) => s.id === subtopicId);
  const prev = currentIndex > 0 ? siblings[currentIndex - 1] : null;
  const next = currentIndex < siblings.length - 1 ? siblings[currentIndex + 1] : null;

  return (
    <aside
      className="hidden flex-shrink-0 flex-col overflow-hidden lg:flex"
      style={{
        width: 280,
        background: 'var(--aq-bg2)',
        borderLeft: '1px solid var(--aq-border)',
      }}
    >
      {/* Header */}
      <div className="px-5 pb-4 pt-5" style={{ borderBottom: '1px solid var(--aq-border)' }}>
        <p
          className="mb-3 text-[11px] font-semibold uppercase tracking-widest"
          style={{ color: 'var(--aq-text3)' }}
        >
          {dict.catalog.subtopicSidebar.header}
        </p>
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[8px] text-base"
            style={{ background: 'var(--aq-accent-glow)' }}
            aria-hidden
          >
            📚
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--aq-text)' }}>
              {topicTitle}
            </p>
            <p className="text-[11px]" style={{ color: 'var(--aq-text3)' }}>
              {dict.catalog.subtopicSidebar.completedPct(topicPct)}
            </p>
          </div>
        </div>
        <div className="mt-3 h-[5px] overflow-hidden rounded-full" style={{ background: 'var(--aq-bg4)' }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${topicPct}%`,
              background: 'linear-gradient(90deg, var(--aq-accent), var(--aq-accent2))',
            }}
          />
        </div>
      </div>

      {/* Subtopic list */}
      <nav className="flex-1 overflow-y-auto py-2" style={{ scrollbarWidth: 'thin' }}>
        {siblings.map((s, i) => {
          const status = progressMap.get(s.id) ?? 'not_started';
          const isCurrent = s.id === subtopicId;
          return (
            <Link
              key={s.id}
              href={`/catalog/${s.id}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--aq-bg3)]"
              style={{
                background: isCurrent ? 'var(--aq-accent-glow)' : undefined,
                borderLeft: isCurrent ? '3px solid var(--aq-accent)' : '3px solid transparent',
              }}
            >
              {/* Number badge */}
              <div
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px] text-[12px] font-bold"
                style={
                  status === 'completed'
                    ? { background: 'var(--aq-accent3)', color: 'white' }
                    : isCurrent
                    ? { background: 'var(--aq-accent)', color: '#0B0E17' }
                    : { background: 'var(--aq-bg3)', color: 'var(--aq-text3)', border: '1px solid var(--aq-border2)' }
                }
              >
                {status === 'completed' ? '✓' : i + 1}
              </div>
              {/* Info */}
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-[13px]"
                  style={{
                    color: isCurrent ? 'var(--aq-accent)' : 'var(--aq-text)',
                    fontWeight: isCurrent ? 600 : 400,
                  }}
                >
                  {s.title}
                </p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <div className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: 'var(--aq-bg4)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: status === 'completed' ? '100%' : status === 'in_progress' ? '50%' : '0%',
                        background: status === 'completed' ? 'var(--aq-accent3)' : 'var(--aq-accent)',
                      }}
                    />
                  </div>
                  <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--aq-text3)' }}>
                    {status === 'completed' ? '100%' : status === 'in_progress' ? '50%' : '0%'}
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Prev/Next nav */}
      <div
        className="flex gap-2 p-4"
        style={{ borderTop: '1px solid var(--aq-border)' }}
      >
        {prev ? (
          <Link
            href={`/catalog/${prev.id}`}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-[8px] py-2 text-[12px] font-medium transition-colors hover:bg-[var(--aq-bg3)]"
            style={{ border: '1px solid var(--aq-border2)', color: 'var(--aq-text2)' }}
          >
            {dict.catalog.subtopicSidebar.previous}
          </Link>
        ) : (
          <div className="flex-1" />
        )}
        {next ? (
          <Link
            href={`/catalog/${next.id}`}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-[8px] py-2 text-[12px] font-medium transition-colors hover:bg-[var(--aq-bg3)]"
            style={{ border: '1px solid var(--aq-border2)', color: 'var(--aq-text2)' }}
          >
            {dict.catalog.subtopicSidebar.next}
          </Link>
        ) : (
          <Link
            href={`/catalog/${topicId}`}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-[8px] py-2 text-[12px] font-medium transition-colors"
            style={{ background: 'var(--aq-accent-glow)', border: '1px solid var(--aq-accent)', color: 'var(--aq-accent)' }}
          >
            {dict.catalog.subtopicSidebar.completedNav}
          </Link>
        )}
      </div>
    </aside>
  );
}
