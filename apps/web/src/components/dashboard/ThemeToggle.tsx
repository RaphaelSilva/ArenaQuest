'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'aq-theme';

function readDark(): boolean {
  if (typeof window === 'undefined') return true;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? stored === 'dark' : true;
}

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(readDark);

  useEffect(() => {
    if (isDark) {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = 'light';
    }
  }, [isDark]);

  function toggle() {
    const next = !isDark;
    setIsDark(next);
    localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-150"
      style={{
        background: 'var(--aq-bg3)',
        border: '1px solid var(--aq-border2)',
        color: 'var(--aq-text2)',
        fontSize: '16px',
      }}
    >
      {isDark ? '☀️' : '🌙'}
    </button>
  );
}
