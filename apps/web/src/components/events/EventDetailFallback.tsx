'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@web/hooks/use-auth';
import { useDict } from '@web/context/dict-context';
import { fetchViewerEvent, type EventDetail } from '@web/lib/events-api';
import { EventDetailView } from './EventDetailView';

/**
 * What `/events/{slug}` renders when the **anonymous** server fetch came back
 * empty.
 *
 * The server never sends a token, so an event that is `members` or `restricted`
 * is a `404` to it even when the reader holds a session cookie — that is the
 * point: nothing audience-scoped is ever baked into cacheable HTML. But a
 * signed-in reader who just clicked a chipped card from their own board must
 * not land on "not found", so the lookup is retried here, after hydration, with
 * their token, and the result is never cached.
 *
 * The API answers a slug the caller may not see byte-identically to a slug that
 * does not exist, so both outcomes land on the same panel below. This component
 * cannot tell them apart, and must not try.
 */
export function EventDetailFallback({ slug }: { slug: string }) {
  const { accessToken, isLoading } = useAuth();

  // Kept together with the slug it answered, so a client-side navigation to
  // another event never shows the previous one while its lookup is in flight.
  const [answer, setAnswer] = useState<{ slug: string; event: EventDetail | null } | null>(null);

  useEffect(() => {
    if (isLoading || !accessToken) return;

    let cancelled = false;
    fetchViewerEvent(accessToken, slug).then((result) => {
      if (!cancelled) setAnswer({ slug, event: result });
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken, isLoading, slug]);

  const settled = answer?.slug === slug ? answer : null;

  if (settled?.event) return <EventDetailView event={settled.event} />;
  // Nothing more to try: no session to retry with, or the retry came back empty.
  if (settled || (!isLoading && !accessToken)) return <EventNotFound />;
  return <EventDetailLoading />;
}

function EventDetailLoading() {
  const dict = useDict();
  return (
    <p className="mx-auto w-full max-w-3xl px-6 py-16 text-sm" style={{ color: 'var(--aq-text2)' }}>
      {dict.events.detail.loading}
    </p>
  );
}

export function EventNotFound() {
  const dict = useDict();

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col items-start gap-4 px-6 py-16">
      <h1
        className="text-2xl font-bold"
        style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" }}
      >
        {dict.events.detail.notFoundTitle}
      </h1>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--aq-text2)' }}>
        {dict.events.detail.notFoundBody}
      </p>
      <Link
        href="/events"
        className="rounded-[10px] px-5 py-2.5 text-sm font-semibold transition-all duration-200"
        style={{
          background: 'var(--aq-accent)',
          color: '#0B0E17',
          fontFamily: "'Space Grotesk', sans-serif",
        }}
      >
        {dict.events.detail.notFoundCta}
      </Link>
    </section>
  );
}
