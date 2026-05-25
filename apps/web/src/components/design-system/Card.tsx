import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  hoverable?: boolean;
  shadow?: 'sm' | 'md' | 'lg';
}

export type { CardProps };

const shadowStyles = {
  sm: `
    shadow-[0_2px_8px_rgba(0_0_0_/_0.3)]
  `.trim(),
  md: `
    shadow-[0_4px_24px_rgba(0_0_0_/_0.4)]
  `.trim(),
  lg: `
    shadow-[0_8px_40px_rgba(0_0_0_/_0.4)]
  `.trim(),
};

export function Card({
  children,
  className,
  hoverable = false,
  shadow = 'md',
}: CardProps) {
  const baseStyles = `
    bg-[color:var(--bg2)]
    border
    border-[color:var(--border)]
    rounded-[14px]
    p-6
  `.trim();

  const hoverStyles = hoverable
    ? `
      hover:border-[color:var(--border2)]
      hover:shadow-lg
      transition-all
      duration-200
    `.trim()
    : '';

  const shadowClass = shadowStyles[shadow];

  const combinedClassName = `
    ${baseStyles}
    ${shadowClass}
    ${hoverStyles}
    ${className || ''}
  `
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');

  return <div className={combinedClassName}>{children}</div>;
}
