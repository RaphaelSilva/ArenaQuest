import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import { ThemeProvider } from '@web/context/theme-context';
import { THEME_STORAGE_KEY } from '@web/lib/theme';
import { ThemeToggle } from '../theme-toggle';

const theme = dictPt.layout.nav.theme;

/** jsdom ships no matchMedia; pin the OS setting per test. */
function stubMatchMedia(prefersDark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: prefersDark,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

function renderToggle(variant?: 'icon' | 'menu') {
  return render(
    <ThemeProvider>
      <ThemeToggle variant={variant} />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  stubMatchMedia(false);
});

describe('ThemeToggle', () => {
  it('starts on dark when the user has never chosen', () => {
    renderToggle();
    expect(screen.getByRole('button', { name: `${theme.label}: ${theme.dark}` })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('cycles dark → light → system → dark and persists each step', async () => {
    const user = userEvent.setup();
    renderToggle();
    const button = () => screen.getByRole('button');

    await user.click(button());
    expect(button()).toHaveAccessibleName(`${theme.label}: ${theme.light}`);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');

    await user.click(button());
    expect(button()).toHaveAccessibleName(`${theme.label}: ${theme.system}`);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    // The stubbed OS is light, so `system` resolves to light.
    expect(document.documentElement.dataset.theme).toBe('light');

    await user.click(button());
    expect(button()).toHaveAccessibleName(`${theme.label}: ${theme.dark}`);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('restores a previously stored preference on mount', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    renderToggle();
    expect(screen.getByRole('button')).toHaveAccessibleName(`${theme.label}: ${theme.light}`);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('resolves the system preference against a dark OS', () => {
    stubMatchMedia(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    renderToggle();
    expect(screen.getByRole('button')).toHaveAccessibleName(`${theme.label}: ${theme.system}`);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('keeps an explicit light choice even when the OS is dark', () => {
    stubMatchMedia(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    renderToggle();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('renders the drawer variant with a visible label and current mode', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    renderToggle('menu');
    const button = screen.getByRole('button', { name: `${theme.label}: ${theme.system}` });
    expect(button).toHaveTextContent(theme.label);
    expect(button).toHaveTextContent(theme.system);
  });
});
