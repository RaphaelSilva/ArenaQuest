'use client';

import React from 'react';

type Props = {
  message: string;
};

export function SectionError({ message }: Props) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-[14px] border border-[var(--aq-border)] py-10 px-6 text-center"
      style={{
        background: 'oklch(0.62 0.17 24 / 0.08)',
        borderColor: 'oklch(0.62 0.17 24 / 0.2)',
      }}
    >
      <span className="text-[28px] mb-2" aria-hidden>⚠️</span>
      <p
        className="text-[13px] font-medium"
        style={{
          fontFamily: 'var(--font-space-grotesk), sans-serif',
          color: 'oklch(0.62 0.17 24)',
        }}
      >
        {message}
      </p>
    </div>
  );
}
