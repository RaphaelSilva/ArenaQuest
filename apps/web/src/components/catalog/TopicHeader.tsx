'use client';

import type { TopicNode } from '@web/lib/topics-api';
import { useDict } from '@web/context/dict-context';

type Props = {
  topic: TopicNode & { children: TopicNode[] };
  pct: number;
};

export function TopicHeader({ topic, pct }: Props) {
  const dict = useDict();
  const subtopicCount = topic.children.length;
  const totalMinutes = topic.children.reduce((sum, c) => sum + (c.estimatedMinutes ?? 0), 0);

  const description =
    topic.tags && topic.tags.length > 0
      ? topic.tags.map((t) => t.name).join(' · ')
      : topic.content
      ? topic.content.replace(/[#*`_[\]]/g, '').slice(0, 120).trim() + '…'
      : null;

  return (
    <div className="mb-8 flex items-start justify-between gap-6">
      <div className="flex items-start gap-5">
        {/* Icon */}
        <span
          className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-[14px] text-[26px]"
          style={{ background: 'var(--aq-accent-glow)' }}
          aria-hidden
        >
          📚
        </span>

        <div>
          <h1
            className="text-[28px] font-bold leading-tight tracking-tight"
            style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.5px' }}
          >
            {topic.title}
          </h1>
          {description && (
            <p className="mt-1 max-w-xl text-[14px] leading-relaxed" style={{ color: 'var(--aq-text2)' }}>
              {description}
            </p>
          )}
        </div>
      </div>

      {/* Stat boxes */}
      <div className="flex flex-shrink-0 gap-4">
        <div className="text-right">
          <p
            className="text-[22px] font-bold"
            style={{ color: 'var(--aq-accent)', fontFamily: "'Space Grotesk', sans-serif" }}
          >
            {subtopicCount}
          </p>
          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--aq-text3)' }}>{dict.catalog.topicPage.subtopics}</p>
        </div>
        <div className="text-right">
          <p
            className="text-[22px] font-bold"
            style={{ color: 'var(--aq-accent)', fontFamily: "'Space Grotesk', sans-serif" }}
          >
            {totalMinutes}
          </p>
          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--aq-text3)' }}>{dict.catalog.topicPage.estimatedMin}</p>
        </div>
        <div className="text-right">
          <p
            className="text-[22px] font-bold"
            style={{ color: 'var(--aq-accent)', fontFamily: "'Space Grotesk', sans-serif" }}
          >
            {pct}%
          </p>
          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--aq-text3)' }}>{dict.catalog.topicPage.progress}</p>
        </div>
      </div>
    </div>
  );
}
