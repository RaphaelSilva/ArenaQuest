'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The one panel every non-happy state on the events surfaces renders through:
 * an empty board, an empty admin list, a failed load, and the not-found page.
 *
 * It exists so those states cannot drift apart. The not-found surface in
 * particular must stay **identical** for an out-of-audience slug, an archived
 * slug and a slug that never existed — the API makes its three 404s
 * byte-identical to deny an enumeration oracle, and a UI that decorated one of
 * them differently would hand that oracle straight back. Funnelling the states
 * through one component means a field added later is added to all of them or to
 * none, and the comparison test in `__tests__/event-not-found.test.tsx` fails if
 * anyone routes around it.
 *
 * The panel carries no interactive state of its own: it is a Client Component
 * only because its callers are, and it renders in the server HTML exactly as it
 * renders after hydration. That is what keeps the empty board indexable.
 */
export function EventStatePanel({
  icon,
  title,
  body,
  action,
  headingLevel = 2,
  tone = 'neutral',
  role,
}: {
  /** Decorative glyph — always `aria-hidden`; the copy carries the meaning. */
  icon: ReactNode;
  title: string;
  body: string;
  /** Optional call to action, rendered below the copy. */
  action?: ReactNode;
  /** `1` when the panel replaces the page's own heading (the detail page). */
  headingLevel?: 1 | 2;
  tone?: 'neutral' | 'error';
  /** `alert` for a failure the reader did not navigate to; omitted otherwise. */
  role?: 'alert' | 'status';
}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const isError = tone === 'error';

  return (
    <section
      role={role}
      className="flex w-full flex-col items-center gap-3 rounded-[14px] border border-dashed px-6 py-12 text-center"
      style={{
        background: isError ? 'var(--aq-error-bg)' : 'var(--aq-bg2)',
        borderColor: isError ? 'var(--aq-error)' : 'var(--aq-border2)',
      }}
    >
      <span aria-hidden="true" style={{ color: isError ? 'var(--aq-error)' : 'var(--aq-text3)' }}>
        {icon}
      </span>

      <Heading
        className="text-lg font-bold leading-tight"
        style={{
          color: isError ? 'var(--aq-error)' : 'var(--aq-text)',
          fontFamily: "'Space Grotesk', sans-serif",
        }}
      >
        {title}
      </Heading>

      <p
        className="max-w-md text-sm leading-relaxed"
        style={{ color: isError ? 'var(--aq-text)' : 'var(--aq-text2)' }}
      >
        {body}
      </p>

      {action && <div className="mt-2">{action}</div>}
    </section>
  );
}

/** The accent call to action shared by every panel above, as a link. */
export function EventStateLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={ACTION_CLASS} style={ACTION_STYLE}>
      {children}
    </Link>
  );
}

/** The same call to action as a button, for a retry that stays on the page. */
export function EventStateButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className={ACTION_CLASS} style={ACTION_STYLE}>
      {children}
    </button>
  );
}

const ACTION_CLASS =
  'inline-flex min-h-11 items-center justify-center rounded-[10px] px-5 py-2.5 text-sm font-semibold transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2';

const ACTION_STYLE = {
  background: 'var(--aq-accent)',
  color: '#0B0E17',
  outlineColor: 'var(--aq-accent)',
  fontFamily: "'Space Grotesk', sans-serif",
} as const;

// ---------------------------------------------------------------------------
// Glyphs
//
// Inline SVG rather than an emoji: an emoji is a text node, so it would have to
// clear the hardcoded-string scan, and it renders as a different picture on
// every platform. These are `aria-hidden` without exception — the panel's title
// and body are the accessible content.
// ---------------------------------------------------------------------------

function glyph(path: ReactNode) {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

/** An empty calendar — nothing scheduled yet. */
export const CalendarGlyph = () =>
  glyph(
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>,
  );

/** A clock turning back — the history tab. */
export const HistoryGlyph = () =>
  glyph(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
  );

/** A warning triangle — something failed to load. */
export const AlertGlyph = () =>
  glyph(
    <>
      <path d="M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </>,
  );

/** A compass with no bearing — the unified not-found surface. */
export const CompassGlyph = () =>
  glyph(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15 9-2 6-4-2 2-6 4 2Z" />
    </>,
  );
