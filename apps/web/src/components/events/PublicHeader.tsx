'use client';

import Link from 'next/link';
import { Logo } from '@web/components/design-system';
import { Nav } from '@web/components/layout/nav';
import { ThemeToggle } from '@web/components/layout/theme-toggle';
import { SidebarProvider } from '@web/context/sidebar-context';
import { useDict } from '@web/context/dict-context';
import { useAuth } from '@web/hooks/use-auth';

/**
 * One header for two readers.
 *
 * A signed-in visitor gets the product's own `<Nav/>`, so arriving at an event
 * from a shared link does not feel like leaving the platform. A stranger — the
 * default, and what the server renders — gets a minimal bar with the mark and a
 * way in. Nothing here gates anything: `(public)` has no auth contract, and the
 * page below renders identically either way.
 */
export function PublicHeader() {
  const { user } = useAuth();

  if (user) {
    return (
      <SidebarProvider>
        <Nav />
      </SidebarProvider>
    );
  }

  return <MinimalHeader />;
}

function MinimalHeader() {
  const dict = useDict();

  return (
    <header
      className="flex h-14 items-center justify-between px-6"
      style={{ background: 'var(--aq-bg2)', borderBottom: '1px solid var(--aq-border)' }}
    >
      <Link href="/" aria-label={dict.events.header.home}>
        <Logo size="sm" />
      </Link>

      <nav className="flex items-center gap-3" aria-label={dict.events.header.navLabel}>
        <ThemeToggle />
        <Link
          href="/events"
          className="rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150"
          style={{ color: 'var(--aq-text2)' }}
        >
          {dict.events.header.events}
        </Link>
        <Link
          href="/login"
          className="rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200"
          style={{
            background: 'var(--aq-accent)',
            color: '#0B0E17',
            fontFamily: "'Space Grotesk', sans-serif",
          }}
        >
          {dict.events.header.signIn}
        </Link>
      </nav>
    </header>
  );
}
