import React from 'react';

export interface LogoProps {
  className?: string;
  showIcon?: boolean;
  showText?: boolean;
  iconOnly?: boolean;
  textOnly?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function Logo({
  className = '',
  showIcon = true,
  showText = true,
  iconOnly = false,
  textOnly = false,
  size = 'md',
}: LogoProps) {
  const displayIcon = (showIcon || iconOnly) && !textOnly;
  const displayText = (showText || textOnly) && !iconOnly;

  const sizes = {
    sm: { icon: 'h-6 w-6 text-[10px]', text: 'text-sm' },
    md: { icon: 'h-7 w-7 text-xs', text: 'text-base' },
    lg: { icon: 'h-10 w-10 text-lg', text: 'text-xl' },
  };

  const { icon: iconClass, text: textClass } = sizes[size];

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {displayIcon && (
        <div
          className={`flex ${iconClass} items-center justify-center rounded-md font-bold shrink-0`}
          style={{
            background: 'var(--aq-accent)',
            color: '#0B0E17',
            fontFamily: "'Space Grotesk', sans-serif",
          }}
        >
          AQ
        </div>
      )}
      {displayText && (
        <span
          className={`${textClass} font-bold tracking-tight whitespace-nowrap`}
          style={{
            color: 'var(--aq-text)',
            fontFamily: "'Space Grotesk', sans-serif",
            letterSpacing: '-0.3px',
          }}
        >
          Arena<span style={{ color: 'var(--aq-accent)' }}>Quest</span>
        </span>
      )}
    </div>
  );
}
