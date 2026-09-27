'use client';

import { useDict } from '@web/context/dict-context';
import {
  AlertGlyph,
  EventStateButton,
  EventStatePanel,
} from '@web/components/events/EventStatePanel';

/**
 * The last line before a blank page.
 *
 * The board's own reads never throw — `fetchPublicEventList` turns every
 * failure into `null`, and the board renders that as its "listing unavailable"
 * state. What this boundary catches is everything else: a malformed instant
 * that trips date formatting, a render bug shipped in a hurry, an exception
 * thrown while streaming. Without it, Next's default is an unstyled error page
 * on the one surface a stranger judges the dojo by.
 *
 * **Nothing from `error` is rendered.** A digest or a stack on a public page
 * tells a visitor nothing and tells someone probing the board more than it
 * should; the copy is the same dictionary message either way, and `reset` is
 * the only affordance — re-rendering the segment is usually enough, since the
 * cause is normally one bad row rather than a broken deploy.
 */
export default function EventsError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const dict = useDict();

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-16">
      <EventStatePanel
        role="alert"
        tone="error"
        headingLevel={1}
        icon={<AlertGlyph />}
        title={dict.events.board.error.title}
        body={dict.events.board.error.body}
        action={<EventStateButton onClick={reset}>{dict.events.board.error.retry}</EventStateButton>}
      />
    </div>
  );
}
