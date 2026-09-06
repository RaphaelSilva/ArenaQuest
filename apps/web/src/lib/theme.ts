/**
 * Theme preference — the single source of truth for how the UI picks its palette.
 *
 * The preference is per-browser (not per-account): it lives in `localStorage`
 * under {@link THEME_STORAGE_KEY}. `localStorage` is deliberate — the bootstrap
 * script below has to resolve the theme *synchronously, before the first paint*,
 * and only a synchronous store can do that. An async store (IndexedDB) would
 * paint the default palette for a frame and then swap it.
 */

/** What the user picked. `system` defers to the OS `prefers-color-scheme`. */
export type ThemePreference = 'dark' | 'light' | 'system';

/** What actually gets painted, after `system` has been resolved. */
export type ResolvedTheme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'aq-theme';

/** With no stored choice the app is dark — never the OS setting. */
export const DEFAULT_PREFERENCE: ThemePreference = 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['dark', 'light', 'system'];

export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'dark' || value === 'light' || value === 'system';
}

/** Collapse a preference into the palette to paint. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

/** The next preference in the toggle cycle: dark → light → system → dark. */
export function nextPreference(current: ThemePreference): ThemePreference {
  const index = THEME_PREFERENCES.indexOf(current);
  return THEME_PREFERENCES[(index + 1) % THEME_PREFERENCES.length];
}

/** Read the stored preference. Absent, unparsable or corrupt values fall back to the default. */
export function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : DEFAULT_PREFERENCE;
  } catch {
    // Private mode / storage disabled — the default still renders.
    return DEFAULT_PREFERENCE;
  }
}

export function writeStoredPreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Persisting is best-effort; the in-memory preference still applies for this session.
  }
}

/**
 * Blocking script injected into `<head>`, so `data-theme` is on `<html>` before
 * the first paint. Without it every load flashes the default palette until React
 * hydrates. Kept dependency-free and inlined as a string because it must run
 * ahead of the bundle.
 */
export const themeBootstrapScript = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(p!=='dark'&&p!=='light'&&p!=='system')p=${JSON.stringify(
  DEFAULT_PREFERENCE,
)};var r=p==='system'?(window.matchMedia(${JSON.stringify(
  DARK_MEDIA_QUERY,
)}).matches?'dark':'light'):p;document.documentElement.dataset.theme=r;}catch(e){document.documentElement.dataset.theme=${JSON.stringify(
  DEFAULT_PREFERENCE,
)};}})();`;
