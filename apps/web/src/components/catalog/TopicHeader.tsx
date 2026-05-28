'use client';

import type { TopicNode, TopicWithMedia } from '@web/lib/topics-api';
import { useDict } from '@web/context/dict-context';

type Props = {
  topic: TopicWithMedia;
  trail: TopicNode[];
  totalInBranch: number;
};

export function TopicHeader({ topic, trail, totalInBranch }: Props) {
  const dict = useDict();

  const subtopicCount = topic.children.length;
  const mediaCount = topic.media.length;

  const getInitials = (title: string): string => {
    const letters = title.match(/\p{L}/gu) || [];
    return letters.slice(0, 2).join('').toUpperCase();
  };

  const buildEyebrow = (): string => {
    const parts: string[] = [];
    parts.push(dict.catalog.title);
    parts.push(dict.catalog.redesign.eyebrowRoot);

    for (let i = 1; i < trail.length; i++) {
      parts.push(trail[i].title);
    }

    return parts.join(' › ');
  };

  const initials = getInitials(topic.title);
  const eyebrow = buildEyebrow();

  return (
    <div className="mb-8">
      <p
        className="mb-3 text-[11px] font-semibold uppercase tracking-widest"
        style={{ color: 'var(--aq-text3)', fontFamily: "'Space Grotesk', sans-serif" }}
      >
        {eyebrow}
      </p>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-[auto_1fr_auto] md:items-center">
        {/* Left: Initials block */}
        <div
          className="flex h-16 w-16 items-center justify-center rounded-[12px] flex-shrink-0 text-[22px] font-bold leading-none"
          style={{
            background: 'linear-gradient(135deg, var(--aq-accent), var(--aq-accent2))',
            color: 'var(--aq-bg)',
            fontFamily: "'Space Grotesk', sans-serif",
          }}
        >
          {initials}
        </div>

        {/* Middle: Title and description */}
        <div>
          <h1
            className="text-[28px] font-bold leading-tight tracking-tight"
            style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.5px' }}
          >
            {topic.title}
          </h1>
        </div>

        {/* Right: Stats (on md+) or horizontal chips (mobile) */}
        <div className="flex flex-col gap-3 md:flex-row md:gap-4 md:flex-shrink-0">
          <div className="flex flex-col items-center rounded-[12px] px-4 py-3" style={{ background: 'var(--aq-bg3)' }}>
            <p
              className="text-[22px] font-bold"
              style={{ color: 'var(--aq-accent)', fontFamily: "'Space Grotesk', sans-serif" }}
            >
              {subtopicCount}
            </p>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--aq-text3)' }}>
              {dict.catalog.redesign.statsSubtopics}
            </p>
          </div>

          <div className="flex flex-col items-center rounded-[12px] px-4 py-3" style={{ background: 'var(--aq-bg3)' }}>
            <p
              className="text-[22px] font-bold"
              style={{ color: 'var(--aq-accent)', fontFamily: "'Space Grotesk', sans-serif" }}
            >
              {mediaCount}
            </p>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--aq-text3)' }}>
              {dict.catalog.redesign.statsMedia}
            </p>
          </div>

          <div className="flex flex-col items-center rounded-[12px] px-4 py-3" style={{ background: 'var(--aq-bg3)' }}>
            <p
              className="text-[22px] font-bold"
              style={{ color: 'var(--aq-accent)', fontFamily: "'Space Grotesk', sans-serif" }}
            >
              {totalInBranch}
            </p>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--aq-text3)' }}>
              {dict.catalog.redesign.statsTotal}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
