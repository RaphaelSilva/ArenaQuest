import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ReactElement } from 'react';

vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: '--font-geist-sans' }),
  Geist_Mono: () => ({ variable: '--font-geist-mono' }),
  Space_Grotesk: () => ({ variable: '--font-space-grotesk' }),
  JetBrains_Mono: () => ({ variable: '--font-jetbrains-mono' }),
}));

/**
 * `<html lang>` had been hardcoded to `en` since before the default build
 * language became `pt`, which told every screen reader and every crawler the
 * wrong thing about a page of Portuguese. It is now the same build-time value
 * the dictionaries resolve from.
 */
async function langOfRootLayout(): Promise<string> {
  const { default: RootLayout } = await import('../layout');
  const tree = RootLayout({ children: null }) as ReactElement<{ lang: string }>;
  return tree.props.lang;
}

describe('root layout — <html lang>', () => {
  const original = process.env.NEXT_PUBLIC_LANGUAGE;

  afterEach(() => {
    process.env.NEXT_PUBLIC_LANGUAGE = original;
    vi.resetModules();
  });

  it('follows NEXT_PUBLIC_LANGUAGE when it is set to en', async () => {
    process.env.NEXT_PUBLIC_LANGUAGE = 'en';
    expect(await langOfRootLayout()).toBe('en');
  });

  it('follows NEXT_PUBLIC_LANGUAGE when it is set to pt', async () => {
    process.env.NEXT_PUBLIC_LANGUAGE = 'pt';
    expect(await langOfRootLayout()).toBe('pt');
  });

  it('defaults to pt, the default build language, when it is unset', async () => {
    delete process.env.NEXT_PUBLIC_LANGUAGE;
    expect(await langOfRootLayout()).toBe('pt');
  });
});
