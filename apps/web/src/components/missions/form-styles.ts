import type { CSSProperties } from 'react';

/** Field chrome shared by the mission editor's inputs, selects and textareas (tokens only). */
export const fieldClass =
  'w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-60';

export const fieldStyle: CSSProperties = {
  borderColor: 'var(--border2)',
  background: 'var(--bg3)',
  color: 'var(--text)',
};

export const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wider';
export const labelStyle: CSSProperties = { color: 'var(--text2)' };

export const hintClass = 'mt-1 text-xs';
export const hintStyle: CSSProperties = { color: 'var(--text3)' };

export const errorStyle: CSSProperties = { color: 'var(--error)' };

/** Section eyebrow (design-system §5.5 rule 3). */
export const eyebrowClass = 'text-[11px] font-semibold uppercase tracking-[1.2px]';
export const eyebrowStyle: CSSProperties = {
  color: 'var(--text3)',
  fontFamily: "'Space Grotesk', sans-serif",
};

export const cardClass = 'rounded-[14px] border p-5';
export const cardStyle: CSSProperties = { background: 'var(--bg2)', borderColor: 'var(--border)' };
