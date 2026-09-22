'use client';

import Link from 'next/link';
import { useRef, type KeyboardEvent } from 'react';
import { useDict } from '@web/context/dict-context';
import type { EventScope } from '@web/lib/events-api';

/** The id the board's list uses for `aria-labelledby`. */
export function scopeTabId(scope: EventScope): string {
  return `events-tab-${scope}`;
}

/** The id each tab points at with `aria-controls`. */
export const EVENTS_PANEL_ID = 'events-panel';

const SCOPES: readonly EventScope[] = ['upcoming', 'past'];

/**
 * "Próximos" / "Anteriores" over `?scope`.
 *
 * They are **links, not buttons**: the scope lives in the URL, so a tab is a
 * real navigation that can be bookmarked, shared, opened in a new tab and
 * crawled — and the next board is server-rendered rather than fetched. That is
 * the whole reason this page exists.
 *
 * The ARIA tab pattern is followed with manual activation (APG): Tab reaches
 * the tablist, the arrow keys move focus between the two tabs, and Enter
 * navigates. Focus never moves on its own.
 */
export function EventScopeTabs({ scope }: { scope: EventScope }) {
  const dict = useDict();
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const tabs = listRef.current?.querySelectorAll<HTMLAnchorElement>('[role="tab"]');
    if (!tabs || tabs.length === 0) return;

    const current = [...tabs].indexOf(document.activeElement as HTMLAnchorElement);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = (current + step + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[next].focus();
  }

  const labels: Record<EventScope, string> = {
    upcoming: dict.events.board.tabUpcoming,
    past: dict.events.board.tabPast,
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={dict.events.board.tabsLabel}
      onKeyDown={onKeyDown}
      className="inline-flex gap-1 rounded-[12px] p-1"
      style={{ background: 'var(--aq-bg3)', border: '1px solid var(--aq-border)' }}
    >
      {SCOPES.map((candidate) => {
        const isActive = candidate === scope;
        return (
          <Link
            key={candidate}
            id={scopeTabId(candidate)}
            role="tab"
            aria-selected={isActive}
            aria-controls={EVENTS_PANEL_ID}
            // Only the selected tab stays in the sequential tab order; the
            // arrow keys reach the other one. APG, roving tabindex.
            tabIndex={isActive ? 0 : -1}
            href={`/events?scope=${candidate}`}
            className="rounded-[9px] px-4 py-2 text-sm font-semibold transition-colors duration-200"
            style={{
              background: isActive ? 'var(--aq-accent)' : 'transparent',
              color: isActive ? '#0B0E17' : 'var(--aq-text2)',
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            {labels[candidate]}
          </Link>
        );
      })}
    </div>
  );
}
