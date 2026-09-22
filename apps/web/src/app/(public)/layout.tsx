import { dict } from '@web/i18n';
import { PublicHeader } from '@web/components/events/PublicHeader';

/**
 * The `(public)` route group — the first pages in ArenaQuest a stranger can
 * read.
 *
 * It is purely additive. The product's auth gate is the client-side redirect in
 * `(protected)/layout.tsx`, not a middleware, so there is no guard here to
 * bypass and none to weaken: this group simply never had one.
 *
 * The layout is a Server Component and stays one. Only the header knows whether
 * a session resolved, and it decides nothing about the page below it. The skip
 * link is therefore server-rendered too, and is the first thing in the tab
 * order: without it a keyboard reader crosses the whole header — logo, theme
 * toggle, two nav links — before reaching the board on every navigation.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col" style={{ background: 'var(--aq-bg)' }}>
      <a
        href="#main-content"
        className="sr-only rounded-[10px] px-4 py-2 text-sm font-semibold focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
        style={{ background: 'var(--aq-accent)', color: '#0B0E17' }}
      >
        {dict.events.header.skipToContent}
      </a>

      <PublicHeader />
      <main id="main-content" className="flex flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}
