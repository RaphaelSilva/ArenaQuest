'use client';

import React from 'react';

export function MainPaneSkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      {/* Header strip placeholder */}
      <div>
        <div className="h-4 w-24 rounded bg-[var(--aq-bg3)] mb-4" />
        <div className="h-8 w-64 rounded-[8px] bg-[var(--aq-bg3)] mb-2" />
        <div className="h-5 w-48 rounded bg-[var(--aq-bg3)]" />
      </div>

      {/* Description card skeleton */}
      <div
        className="rounded-[14px] border border-[var(--aq-border)] p-6 space-y-3"
        style={{ background: 'var(--aq-bg2)' }}
      >
        <div className="h-4 w-40 rounded bg-[var(--aq-bg3)]" />
        <div className="h-3 w-full rounded bg-[var(--aq-bg3)]" />
        <div className="h-3 w-5/6 rounded bg-[var(--aq-bg3)]" />
      </div>

      {/* Subtopics grid skeleton */}
      <div>
        <div className="h-4 w-32 rounded bg-[var(--aq-bg3)] mb-4" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div
            className="h-[100px] rounded-[12px] border border-[var(--aq-border)] p-5"
            style={{ background: 'var(--aq-bg2)' }}
          />
          <div
            className="h-[100px] rounded-[12px] border border-[var(--aq-border)] p-5"
            style={{ background: 'var(--aq-bg2)' }}
          />
        </div>
      </div>

      {/* Media section skeleton */}
      <div>
        <div className="h-4 w-24 rounded bg-[var(--aq-bg3)] mb-4" />
        <div
          className="h-[70px] rounded-[12px] border border-[var(--aq-border)]"
          style={{ background: 'var(--aq-bg2)' }}
        />
      </div>
    </div>
  );
}
