import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_PREFERENCE,
  THEME_STORAGE_KEY,
  isThemePreference,
  nextPreference,
  readStoredPreference,
  resolveTheme,
  themeBootstrapScript,
  writeStoredPreference,
} from '../theme';

/** Point `matchMedia` at a fixed OS setting for the duration of a test. */
function stubMatchMedia(prefersDark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: prefersDark,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('resolveTheme', () => {
  it('passes explicit preferences through, ignoring the OS', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('follows the OS only for the system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('nextPreference', () => {
  it('cycles dark → light → system → dark', () => {
    expect(nextPreference('dark')).toBe('light');
    expect(nextPreference('light')).toBe('system');
    expect(nextPreference('system')).toBe('dark');
  });
});

describe('isThemePreference', () => {
  it('accepts only the three known values', () => {
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('os')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
  });
});

describe('readStoredPreference', () => {
  it('defaults to dark when nothing is stored', () => {
    expect(readStoredPreference()).toBe('dark');
    expect(DEFAULT_PREFERENCE).toBe('dark');
  });

  it('returns a valid stored preference', () => {
    writeStoredPreference('system');
    expect(readStoredPreference()).toBe('system');
    writeStoredPreference('light');
    expect(readStoredPreference()).toBe('light');
  });

  it('falls back to dark on a corrupt stored value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'chartreuse');
    expect(readStoredPreference()).toBe('dark');
  });
});

describe('themeBootstrapScript', () => {
  it('paints dark when no preference is stored', () => {
    stubMatchMedia(false);
    eval(themeBootstrapScript);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('honours an explicit light preference even when the OS is dark', () => {
    stubMatchMedia(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    eval(themeBootstrapScript);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('resolves the system preference against the OS setting', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'system');

    stubMatchMedia(false);
    eval(themeBootstrapScript);
    expect(document.documentElement.dataset.theme).toBe('light');

    stubMatchMedia(true);
    eval(themeBootstrapScript);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('falls back to dark on a corrupt stored value', () => {
    stubMatchMedia(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    eval(themeBootstrapScript);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('falls back to dark when storage access throws', () => {
    stubMatchMedia(false);
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('storage disabled');
    };
    try {
      eval(themeBootstrapScript);
      expect(document.documentElement.dataset.theme).toBe('dark');
    } finally {
      Storage.prototype.getItem = getItem;
    }
  });
});
