'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@web/hooks/use-auth';
import { useDict } from '@web/context/dict-context';
import { fetchViewerEventList, type EventListItem, type EventScope } from '@web/lib/events-api';
import { mergeEventLists } from './event-format';
import { EventCard } from './EventCard';
import { EVENTS_PANEL_ID, scopeTabId } from './EventScopeTabs';

/** Stable identity, so the memo below does not recompute on every render. */
const EMPTY: EventListItem[] = [];

/**
 * The board itself.
 *
 * `initial` is the **anonymous** slice the Server Component already rendered —
 * it is in the HTML a crawler receives, and it is what a visitor with no
 * JavaScript sees. This component never discards it: after hydration, a signed
 * -in reader's entitled superset is fetched with their token and *merged in*,
 * so the public slice cannot blink out while a second request is in flight or
 * if that request fails.
 *
 * The client is not deciding what it may see. It sends the token it has to the
 * same endpoint the server called without one; the difference between the two
 * responses is the entitled set, resolved server-side both times.
 */
export function EventsBoard({
  initial,
  scope,
}: {
  initial: EventListItem[];
  scope: EventScope;
}) {
  const dict = useDict();
  const { user, accessToken } = useAuth();

  // The entitled response is stored *with the request it answered*. A new scope
  // or a new token invalidates it by comparison rather than by a reset, so the
  // stale superset is never rendered for a request it did not answer.
  const request = `${scope}:${accessToken ?? ''}`;
  const [viewer, setViewer] = useState<{ request: string; events: EventListItem[] } | null>(null);

  useEffect(() => {
    if (!accessToken) return;

    let cancelled = false;
    fetchViewerEventList(accessToken, { scope }).then((result) => {
      if (!cancelled && result) setViewer({ request, events: result.data });
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken, scope, request]);

  const events = useMemo(
    () => mergeEventLists(initial, viewer?.request === request ? viewer.events : EMPTY, scope),
    [initial, viewer, request, scope],
  );

  const emptyMessage =
    scope === 'past' ? dict.events.board.emptyPast : dict.events.board.emptyUpcoming;

  return (
    <div
      id={EVENTS_PANEL_ID}
      role="tabpanel"
      aria-labelledby={scopeTabId(scope)}
      className="flex flex-col gap-6"
    >
      {events.length === 0 ? (
        <p className="py-10 text-center text-sm" style={{ color: 'var(--aq-text2)' }}>
          {emptyMessage}
        </p>
      ) : (
        <ul
          aria-label={dict.events.board.listLabel}
          className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </ul>
      )}

      {/* Rendered for the default reader — a stranger — so it is present in the
          server HTML rather than appearing a round-trip later. It disappears as
          soon as a session resolves. */}
      {user === null && <SignInAffordance />}
    </div>
  );
}

function SignInAffordance() {
  const dict = useDict();

  return (
    <aside
      className="flex flex-col items-start gap-2 rounded-[14px] border p-5 sm:flex-row sm:items-center sm:justify-between"
      style={{ background: 'var(--aq-bg2)', borderColor: 'var(--aq-border2)' }}
    >
      <div className="flex flex-col gap-1">
        <p
          className="text-sm font-bold"
          style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" }}
        >
          {dict.events.board.signedOutTitle}
        </p>
        <p className="text-sm" style={{ color: 'var(--aq-text2)' }}>
          {dict.events.board.signedOutBody}
        </p>
      </div>
      <Link
        href="/login"
        className="shrink-0 rounded-[10px] px-5 py-2.5 text-sm font-semibold transition-all duration-200"
        style={{
          background: 'var(--aq-accent)',
          color: '#0B0E17',
          fontFamily: "'Space Grotesk', sans-serif",
        }}
      >
        {dict.events.board.signedOutCta}
      </Link>
    </aside>
  );
}
