'use client';

import { useState } from 'react';
import { useDict } from '@web/context/dict-context';
import { eventFlyerUrl } from '@web/lib/events-api';

/**
 * The flyer, or a deliberate stand-in for it.
 *
 * Two failure modes produce the same broken-image box in a browser and are both
 * closed here: an event that never had a flyer (`hasFlyer === false`), and a
 * flyer whose stable route fails to resolve — an object removed from the bucket
 * behind a row that still claims one, or a signature the API could not mint.
 * The second is why the `onError` swap exists rather than just the `hasFlyer`
 * guard: a card in a grid that collapses to a torn-page icon looks like a bug in
 * the board, on the one surface a stranger judges the dojo by.
 *
 * The placeholder keeps the image's aspect ratio, so a board mixing events with
 * and without flyers still renders as one grid rather than a ragged one, and it
 * carries `role="img"` with a label naming the event: a reader on a screen
 * reader is told the flyer is missing rather than meeting silence.
 */
export function EventFlyer({
  slug,
  title,
  hasFlyer,
  variant,
}: {
  slug: string;
  title: string;
  hasFlyer: boolean;
  /** `card` crops to a thumbnail strip; `detail` shows the whole flyer. */
  variant: 'card' | 'detail';
}) {
  const dict = useDict();
  const [failed, setFailed] = useState(false);

  const shape =
    variant === 'card'
      ? 'aspect-[16/9] w-full object-cover'
      : 'aspect-[16/9] w-full rounded-[14px] object-cover sm:aspect-[3/2]';

  if (hasFlyer && !failed) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={eventFlyerUrl(slug)}
        alt={dict.events.board.flyerAlt(title)}
        className={shape}
        loading={variant === 'card' ? 'lazy' : undefined}
        style={variant === 'detail' ? { border: '1px solid var(--aq-border)' } : undefined}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      role="img"
      aria-label={dict.events.board.flyerPlaceholderAlt(title)}
      className={`flex items-center justify-center ${shape}`}
      style={{
        background: 'var(--aq-bg3)',
        color: 'var(--aq-text3)',
        border: variant === 'detail' ? '1px dashed var(--aq-border2)' : undefined,
        borderBottom: variant === 'card' ? '1px solid var(--aq-border)' : undefined,
      }}
    >
      <svg
        width={variant === 'detail' ? 48 : 32}
        height={variant === 'detail' ? 48 : 32}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </svg>
    </div>
  );
}
