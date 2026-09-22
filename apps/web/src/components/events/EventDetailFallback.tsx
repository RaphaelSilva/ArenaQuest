'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@web/hooks/use-auth';
import { useDict } from '@web/context/dict-context';
import { fetchViewerEvent, type EventDetail } from '@web/lib/events-api';
import { EventDetailView } from './EventDetailView';
import { CompassGlyph, EventStateLink, EventStatePanel } from './EventStatePanel';

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
    <p
      role="status"
      aria-live="polite"
      className="mx-auto w-full max-w-3xl px-6 py-16 text-center text-sm"
      style={{ color: 'var(--aq-text2)' }}
    >
      {dict.events.detail.loading}
    </p>
  );
}

/**
 * The single not-found surface.
 *
 * **It takes no arguments, and that is the point.** An out-of-audience slug, an
 * archived slug and a slug that never existed all land here, and the component
 * has nothing to tell them apart with even if a later change wanted to: no
 * slug, no status, no reason. Task 03 made the API's three 404 bodies
 * byte-identical to deny an enumeration oracle on a surface open to the
 * internet — a UI that worded one of them differently would rebuild that oracle
 * one layer up, and this signature is what makes doing so a deliberate act
 * rather than an accident.
 *
 * `__tests__/event-not-found.test.tsx` pins it by comparing three rendered
 * pages to each other, so a field added for one case breaks the build.
 */
export function EventNotFound() {
  const dict = useDict();

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-16">
      <EventStatePanel
        headingLevel={1}
        icon={<CompassGlyph />}
        title={dict.events.detail.notFoundTitle}
        body={dict.events.detail.notFoundBody}
        action={<EventStateLink href="/events">{dict.events.detail.notFoundCta}</EventStateLink>}
      />
    </div>
  );
}
