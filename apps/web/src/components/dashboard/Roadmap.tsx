'use client';

import Link from 'next/link';
import type { RoadmapNode } from '@web/lib/dashboard-api';
import { useDict } from '@web/context/dict-context';

type Props = { nodes: RoadmapNode[] };

const STATUS_COLORS: Record<RoadmapNode['status'], string> = {
  completed: 'var(--aq-accent3)',
  in_progress: 'var(--aq-accent)',
  not_started: 'var(--aq-bg4)',
};

export function Roadmap({ nodes }: Props) {
  const dict = useDict();

  if (nodes.length === 0) {
    return (
      <section
        className="rounded-2xl border border-dashed p-8 text-center"
        style={{ borderColor: 'var(--aq-border2)', background: 'var(--aq-bg2)' }}
        aria-label={dict.dashboard.roadmap.title}
      >
        <p className="text-sm" style={{ color: 'var(--aq-text3)' }}>
          {dict.dashboard.roadmap.empty}
        </p>
      </section>
    );
  }

  return (
    <section
      className="overflow-hidden rounded-2xl border"
      style={{ background: 'var(--aq-bg2)', borderColor: 'var(--aq-border2)' }}
      aria-label={dict.dashboard.roadmap.title}
    >
      <div
        className="border-b px-5 py-4"
        style={{ borderColor: 'var(--aq-border)' }}
      >
        <h2
          className="text-[13px] font-semibold"
          style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" }}
        >
          {dict.dashboard.roadmap.title}
        </h2>
      </div>

      <div className="overflow-x-auto px-5 py-4">
        {/* 140px card + 24px connector + 16px gap, minus trailing connector */}
        <ol className="flex gap-4" style={{ minWidth: `${nodes.length * 140 + (nodes.length - 1) * 40}px` }}>
          {nodes.map((node, idx) => {
            const color = STATUS_COLORS[node.status];
            return (
              <li key={node.id} className="flex items-center gap-3">
                <Link
                  href={`/catalog/${node.id}`}
                  className="flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-colors duration-150"
                  style={{
                    width: '140px',
                    background: 'var(--aq-bg3)',
                    borderColor: node.status === 'not_started' ? 'var(--aq-border)' : color,
                  }}
                >
                  <span className="text-2xl" aria-hidden>{node.emoji}</span>
                  <span
                    className="text-xs font-semibold leading-tight"
                    style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" }}
                  >
                    {node.name}
                  </span>
                  <div
                    className="w-full h-1 overflow-hidden rounded-full"
                    style={{ background: 'var(--aq-bg4)' }}
                    role="progressbar"
                    aria-label={`${node.name}: ${node.pct}%`}
                    aria-valuenow={node.pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${node.pct}%`, background: color }}
                    />
                  </div>
                  <span className="text-[11px]" style={{ color: 'var(--aq-text3)' }}>
                    {node.pct}%
                  </span>
                </Link>

                {idx < nodes.length - 1 && (
                  <div
                    className="h-[2px] w-6 shrink-0 rounded-full"
                    style={{ background: 'var(--aq-border2)' }}
                    aria-hidden
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
