'use client';

import type { ReactNode } from 'react';

export type NoteBadgeTone = 'accent' | 'neutral' | 'warning';

type NoteBadgeProps = {
  tone?: NoteBadgeTone;
  children: ReactNode;
};

const TONES: Record<NoteBadgeTone, { background: string; borderColor: string; color: string }> = {
  accent: { background: 'var(--aq-accent-glow)', borderColor: 'var(--aq-accent)', color: 'var(--aq-accent)' },
  neutral: { background: 'var(--aq-bg3)', borderColor: 'var(--aq-border2)', color: 'var(--aq-text2)' },
  warning: { background: 'var(--aq-error-bg)', borderColor: 'var(--aq-error)', color: 'var(--aq-error)' },
};

/** A small pill chip on a note card (visibility, moderation, and — in Task 07 — staff badges). */
export function NoteBadge({ tone = 'neutral', children }: NoteBadgeProps) {
  return (
    <span
      className="inline-flex items-center rounded-[20px] border px-2 py-0.5 text-[11px] font-semibold"
      style={TONES[tone]}
    >
      {children}
    </span>
  );
}
