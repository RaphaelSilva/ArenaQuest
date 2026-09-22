import type { Metadata } from 'next';
import { dict } from '@web/i18n';
import { brand } from '@web/lib/brand';
import {
  fetchPublicEventList,
  PUBLIC_SITE_ORIGIN,
  type EventScope,
} from '@web/lib/events-api';
import { EventScopeTabs } from '@web/components/events/EventScopeTabs';
import { EventsBoard } from '@web/components/events/EventsBoard';

/**
 * SSR per request at the edge — not static at build.
 *
 * `@cloudflare/next-on-pages` needs `runtime = 'edge'` for a dynamic route, and
 * the board must be dynamic: prerendered at build time, an event published this
 * morning would not appear until the next deploy, which defeats the point of an
 * events board.
 */
export const runtime = 'edge';

/** `?scope=` is the only input; anything else falls back to the default list. */
function parseScope(raw: string | string[] | undefined): EventScope {
  return raw === 'past' ? 'past' : 'upcoming';
}

export async function generateMetadata(): Promise<Metadata> {
  const title = `${dict.events.board.title} · ${brand.fullName}`;
  const description = dict.events.board.metaDescription;

  return {
    title,
    description,
    alternates: { canonical: `${PUBLIC_SITE_ORIGIN}/events` },
    openGraph: {
      title,
      description,
      url: `${PUBLIC_SITE_ORIGIN}/events`,
      type: 'website',
    },
  };
}

/**
 * The board.
 *
 * **This fetch is anonymous, always.** The page is audience-scoped — the same
 * URL answers differently per caller — so rendering it with a visitor's token
 * and then caching or prerendering that HTML would serve a `restricted` event
 * to whoever asked next. `fetchPublicEventList` takes no token parameter, which
 * is what makes that a compile error rather than a code-review catch.
 *
 * The entitled superset is merged in on the client, after hydration, inside
 * `EventsBoard`.
 */
export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string | string[] }>;
}) {
  const scope = parseScope((await searchParams).scope);
  const list = await fetchPublicEventList({ scope });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-3">
        <h1
          className="text-3xl font-bold"
          style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" }}
        >
          {dict.events.board.title}
        </h1>
        <p className="max-w-xl text-sm leading-relaxed" style={{ color: 'var(--aq-text2)' }}>
          {dict.events.board.subtitle}
        </p>
      </header>

      <EventScopeTabs scope={scope} />

      <EventsBoard initial={list?.data ?? []} scope={scope} />
    </div>
  );
}
