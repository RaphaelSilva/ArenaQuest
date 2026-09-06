'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  DARK_MEDIA_QUERY,
  DEFAULT_PREFERENCE,
  nextPreference,
  readStoredPreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  writeStoredPreference,
  type ResolvedTheme,
  type ThemePreference,
} from '@web/lib/theme';

/*
 * Both the stored preference and the OS setting are external stores that React
 * does not own, so they are read through `useSyncExternalStore`. That gives the
 * server snapshot (always the default) needed to keep hydration consistent,
 * without an effect that writes state on mount.
 */

const listeners = new Set<() => void>();

function subscribePreference(onStoreChange: () => void) {
  // The `storage` event fires only in *other* tabs, so a change made here still
  // needs the explicit fan-out in setStoredPreference below.
  const onStorage = (event: StorageEvent) => {
    // `key === null` means the whole store was cleared.
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    onStoreChange();
  };
  listeners.add(onStoreChange);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Read straight from storage on every call. No memoisation: the return is a
 * string primitive, so React's Object.is check is already stable, and a cache
 * would only add a way for the snapshot to drift from the real store.
 */
function getPreferenceSnapshot(): ThemePreference {
  return readStoredPreference();
}

function getPreferenceServerSnapshot(): ThemePreference {
  return DEFAULT_PREFERENCE;
}

function setStoredPreference(preference: ThemePreference) {
  writeStoredPreference(preference);
  for (const listener of listeners) listener();
}

function subscribeSystem(onStoreChange: () => void) {
  // matchMedia returns a fresh MediaQueryList per call, so the same instance has
  // to be closed over for both the subscribe and the unsubscribe to line up.
  const query = window.matchMedia(DARK_MEDIA_QUERY);
  query.addEventListener('change', onStoreChange);
  return () => query.removeEventListener('change', onStoreChange);
}

function getSystemSnapshot(): boolean {
  return window.matchMedia(DARK_MEDIA_QUERY).matches;
}

function getSystemServerSnapshot(): boolean {
  // The server cannot know the OS setting; the default palette is dark anyway.
  return true;
}

type ThemeContextValue = {
  /** What the user picked — this is what the toggle renders. */
  preference: ThemePreference;
  /** What is painted right now, with `system` already resolved. */
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  /** Advance to the next preference in the cycle. */
  cyclePreference: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(
    subscribePreference,
    getPreferenceSnapshot,
    getPreferenceServerSnapshot,
  );
  const systemPrefersDark = useSyncExternalStore(
    subscribeSystem,
    getSystemSnapshot,
    getSystemServerSnapshot,
  );

  const resolvedTheme = resolveTheme(preference, systemPrefersDark);

  // The bootstrap script in the root layout already stamped the correct value
  // before first paint; this keeps <html> in sync with later changes.
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  const setPreference = useCallback((next: ThemePreference) => {
    setStoredPreference(next);
  }, []);

  const cyclePreference = useCallback(() => {
    setStoredPreference(nextPreference(getPreferenceSnapshot()));
  }, []);

  return (
    <ThemeContext.Provider value={{ preference, resolvedTheme, setPreference, cyclePreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
