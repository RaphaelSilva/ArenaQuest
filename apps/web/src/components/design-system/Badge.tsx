import { ReactNode } from 'react';

type BadgeStatus = 'done' | 'inprog' | 'locked' | 'archived' | 'published' | 'active' | 'inactive' | 'draft';
type BadgeSize = 'sm' | 'md';

interface BadgeProps {
  status: BadgeStatus;
  size?: BadgeSize;
  children: ReactNode;
  className?: string;
}

export type { BadgeProps };

const statusStyles: Record<BadgeStatus, string> = {
  done: `
    bg-[oklch(0.68_0.17_150_/_0.15)]
    text-[color:var(--accent3)]
  `.trim(),
  inprog: `
    bg-[color:var(--accent-glow)]
    text-[color:var(--accent)]
  `.trim(),
  locked: `
    bg-[color:var(--bg4)]
    text-[color:var(--text3)]
  `.trim(),
  archived: `
    bg-[oklch(0.74_0.19_52_/_0.15)]
    text-[color:var(--accent)]
  `.trim(),
  published: `
    bg-[oklch(0.68_0.17_150_/_0.15)]
    text-[color:var(--accent3)]
  `.trim(),
  active: `
    bg-[oklch(0.68_0.17_150_/_0.15)]
    text-[color:var(--accent3)]
  `.trim(),
  inactive: `
    bg-[oklch(0.65_0.22_15_/_0.12)]
    text-[oklch(0.65_0.22_15)]
  `.trim(),
  draft: `
    bg-[color:var(--bg4)]
    text-[color:var(--text3)]
  `.trim(),
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: `
    px-2
    py-1
    text-xs
    font-semibold
  `.trim(),
  md: `
    px-3
    py-1.5
    text-sm
    font-semibold
  `.trim(),
};

export function Badge({
  status,
  size = 'md',
  children,
  className,
}: BadgeProps) {
  const baseStyles = `
    inline-flex
    items-center
    justify-center
    rounded-lg
    font-['Space_Grotesk']
    tracking-tight
    whitespace-nowrap
  `.trim();

  const statusClass = statusStyles[status];
  const sizeClass = sizeStyles[size];

  const combinedClassName = `
    ${baseStyles}
    ${statusClass}
    ${sizeClass}
    ${className || ''}
  `
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');

  return <span className={combinedClassName}>{children}</span>;
}
