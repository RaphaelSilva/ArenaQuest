'use client';

import React from 'react';

type Props = {
  title: string;
  description?: string;
  icon?: string;
};

export function SectionEmpty({ title, description, icon = '📭' }: Props) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-[14px] border border-dashed border-[var(--aq-border2)] py-12 px-6 text-center"
      style={{ background: 'var(--aq-bg2)' }}
    >
      <span className="text-[32px] mb-3" aria-hidden>{icon}</span>
      <h5
        className="text-[15px] font-bold"
        style={{
          fontFamily: 'var(--font-space-grotesk), sans-serif',
          color: 'var(--aq-text2)',
        }}
      >
        {title}
      </h5>
      {description && (
        <p
          className="mt-1 text-[13px]"
          style={{
            color: 'var(--aq-text3)',
            maxWidth: '360px',
            lineHeight: '1.5',
          }}
        >
          {description}
        </p>
      )}
    </div>
  );
}
