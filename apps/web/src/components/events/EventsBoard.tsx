'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@web/hooks/use-auth';
import { useDict } from '@web/context/dict-context';
import { fetchViewerEventList, type EventListItem, type EventScope } from '@web/lib/events-api';
import { mergeEventLists } from './event-format';
import { EventCard } from './EventCard';
import { EVENTS_PANEL_ID, scopeTabId } from './EventScopeTabs';
import {
  AlertGlyph,
  CalendarGlyph,
  EventStateLink,
  EventStatePanel,
  HistoryGlyph,
} from './EventStatePanel';

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
 *
 * ---------------------------------------------------------------------------
 * Three states below the happy path
 * ---------------------------------------------------------------------------
 *
 * - **Empty** — a real board with nothing on it. It is rendered here rather
 *   than upstream because "empty" is only known after the merge, and it is
 *   rendered in the *server* pass like every other branch of this component:
 *   a brand-new tenant and the crawler that indexes it both arrive to this
 *   state, so its copy has to be in the markup `curl` returns, not painted a
 *   round-trip later.
 * - **Unavailable** — the API did not answer. The page hands that down as a
 *   flag because `fetchPublicEventList` collapses a `5xx`, a `429` and a dead
 *   socket into `null`, which is otherwise indistinguishable from an empty
 *   board. Telling a visitor "nothing scheduled" when the backend is down is a
 *   lie about the dojo, so the two states are kept apart here.
 * - **Loading** — a signed-in reader whose *public* slice is empty, while their
 *   entitled read is in flight. A members-only board would otherwise sit on
 *   "nothing scheduled" while the events that reader *is* entitled to are
 *   already on the wire.
 *
 * The loading branch turns on `accessToken` alone, deliberately **not** on
 * `isLoading` from the session. There is no token during a server render and
 * none on React's first client render either, so the server HTML and the
 * hydration pass both land on the empty state — which is the point: gate this
 * on "a session is being resolved" instead and every anonymous visitor, and
 * every crawler, receives a spinner where the board's indexable copy should be.
 */
export function EventsBoard({
  initial,
  scope,
  unavailable = false,
}: {
  initial: EventListItem[];
  scope: EventScope;
  /** The server's anonymous read failed — not the same thing as an empty board. */
  unavailable?: boolean;
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
      // Recorded even when the read failed (`result === null`). An empty list
      // merges to a no-op, and settling the request is what stops the loading
      // state below from hanging on a failure that already fell back to the
      // anonymous slice.
      if (!cancelled) setViewer({ request, events: result?.data ?? [] });
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken, scope, request]);

  const settled = viewer?.request === request ? viewer.events : null;

  const events = useMemo(
    () => mergeEventLists(initial, settled ?? EMPTY, scope),
    [initial, settled, scope],
  );

  // Only meaningful while the board is otherwise blank — see the header.
  const viewerPending = Boolean(accessToken) && settled === null;

  return (
    <div
      id={EVENTS_PANEL_ID}
      role="tabpanel"
      aria-labelledby={scopeTabId(scope)}
      className="flex flex-col gap-6"
    >
      {events.length > 0 ? (
        <ul
          aria-label={dict.events.board.listLabel}
          className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </ul>
      ) : viewerPending ? (
        <BoardLoading />
      ) : unavailable ? (
        <BoardUnavailable />
      ) : (
        <BoardEmpty scope={scope} />
      )}

      {/* Rendered for the default reader — a stranger — so it is present in the
          server HTML rather than appearing a round-trip later. It disappears as
          soon as a session resolves. */}
      {user === null && <SignInAffordance />}
    </div>
  );
}

/**
 * The empty board.
 *
 * On the upcoming tab it points at "Anteriores" on purpose: a dojo between
 * seminars still has a history worth reading, and sending that visitor away
 * empty-handed wastes the one page they came to. The past tab points back the
 * other way for the same reason.
 */
function BoardEmpty({ scope }: { scope: EventScope }) {
  const dict = useDict();
  const copy = dict.events.board.empty;

  if (scope === 'past') {
    return (
      <EventStatePanel
        icon={<HistoryGlyph />}
        title={copy.pastTitle}
        body={copy.pastBody}
        action={<EventStateLink href="/events?scope=upcoming">{copy.pastCta}</EventStateLink>}
      />
    );
  }

  return (
    <EventStatePanel
      icon={<CalendarGlyph />}
      title={copy.upcomingTitle}
      body={copy.upcomingBody}
      action={<EventStateLink href="/events?scope=past">{copy.upcomingCta}</EventStateLink>}
    />
  );
}

/** The API did not answer. Said plainly, rather than dressed as an empty board. */
function BoardUnavailable() {
  const dict = useDict();

  return (
    <EventStatePanel
      role="alert"
      tone="error"
      icon={<AlertGlyph />}
      title={dict.events.board.error.title}
      body={dict.events.board.error.body}
    />
  );
}

function BoardLoading() {
  const dict = useDict();

  return (
    <p
      role="status"
      aria-live="polite"
      className="py-12 text-center text-sm"
      style={{ color: 'var(--aq-text2)' }}
    >
      {dict.events.board.loading}
    </p>
  );
}

function SignInAffordance() {
  const dict = useDict();

  return (
    <aside
      className="flex flex-col items-start gap-3 rounded-[14px] border p-5 sm:flex-row sm:items-center sm:justify-between"
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
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-[10px] px-5 py-2.5 text-sm font-semibold transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{
          background: 'var(--aq-accent)',
          color: '#0B0E17',
          outlineColor: 'var(--aq-accent)',
          fontFamily: "'Space Grotesk', sans-serif",
        }}
      >
        {dict.events.board.signedOutCta}
      </Link>
    </aside>
  );
}
