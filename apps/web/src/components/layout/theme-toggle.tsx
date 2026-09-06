'use client';

import { useTheme } from '@web/context/theme-context';
import { useDict } from '@web/context/dict-context';
import type { ThemePreference } from '@web/lib/theme';

function MoonIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="4" strokeWidth={2} />
      <path
        strokeLinecap="round"
        strokeWidth={2}
        d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
      />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" strokeWidth={2} />
      <path strokeLinecap="round" strokeWidth={2} d="M8 20h8m-4-4v4" />
    </svg>
  );
}

const ICONS: Record<ThemePreference, () => React.ReactElement> = {
  dark: MoonIcon,
  light: SunIcon,
  system: SystemIcon,
};

/**
 * Cycles the theme preference: dark → light → system → dark.
 *
 * `icon` is the compact desktop navbar form; `menu` is the full-width row used
 * in the mobile drawer, where it sits directly above "sign out".
 */
export function ThemeToggle({ variant = 'icon' }: { variant?: 'icon' | 'menu' }) {
  const { preference, cyclePreference } = useTheme();
  const dict = useDict();

  const Icon = ICONS[preference];
  const modeLabel = dict.layout.nav.theme[preference];
  const accessibleLabel = `${dict.layout.nav.theme.label}: ${modeLabel}`;

  if (variant === 'menu') {
    return (
      <button
        type="button"
        onClick={cyclePreference}
        aria-label={accessibleLabel}
        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/50"
      >
        <span className="flex items-center gap-2">
          <Icon />
          {dict.layout.nav.theme.label}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{modeLabel}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={cyclePreference}
      aria-label={accessibleLabel}
      title={accessibleLabel}
      className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
    >
      <Icon />
    </button>
  );
}
