/**
 * The accessibility properties of the board's three interactive pieces.
 *
 * These are the parts a visual review passes over: a chip that is only a
 * colour, a tab pair that is only a link pair, an image with no alternative.
 * Each assertion below stands for something a keyboard or screen-reader user
 * needs and a screenshot cannot show.
 *
 * What is *not* covered here: contrast ratios, focus-ring visibility, reflow at
 * a real viewport, and the behaviour of an actual screen reader. There is no
 * browser driver in this suite; those still need a human pass.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { dictPt } from '@web/i18n';
import type { EventListItem } from '@web/lib/events-api';
import { EventAudienceChip } from '../EventAudienceChip';
import { EventCard } from '../EventCard';
import { EventScopeTabs } from '../EventScopeTabs';
import { EventFlyer } from '../EventFlyer';

const board = dictPt.events.board;

function listItem(overrides: Partial<EventListItem> = {}): EventListItem {
  return {
    id: 'evt-1',
    slug: 'seminario-de-verao',
    title: 'Seminário de verão',
    summary: 'Open mat.',
    location: 'Dojo central',
    startsAt: '2099-10-10T13:00:00.000Z',
    endsAt: null,
    timezone: 'America/Sao_Paulo',
    audience: 'public',
    hasFlyer: true,
    ...overrides,
  };
}

describe('the audience chip does not rely on colour alone', () => {
  it('names the audience in words', () => {
    render(<EventAudienceChip audience="members" />);
    expect(screen.getByText(dictPt.events.audience.members)).toBeInTheDocument();
  });

  it('carries a different glyph per audience, not only a different tint', () => {
    const { container: members } = render(<EventAudienceChip audience="members" />);
    expect(members.querySelector('[data-audience="members"]')).not.toBeNull();

    const { container: restricted } = render(<EventAudienceChip audience="restricted" />);
    expect(restricted.querySelector('[data-audience="restricted"]')).not.toBeNull();

    // Two levels, two shapes: the markup differs even with every colour
    // stripped out.
    expect(members.querySelector('svg')?.innerHTML).not.toBe(
      restricted.querySelector('svg')?.innerHTML,
    );
  });

  it('renders nothing at all for a public event', () => {
    const { container } = render(<EventAudienceChip audience="public" />);
    expect(container.innerHTML).toBe('');
  });
});

describe('the scope tabs follow the ARIA tab pattern', () => {
  it('exposes a labelled tablist with exactly one selected tab', () => {
    render(<EventScopeTabs scope="upcoming" />);

    const tablist = screen.getByRole('tablist', { name: board.tabsLabel });
    expect(tablist).toBeInTheDocument();

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true')).toHaveLength(1);
  });

  it('keeps only the selected tab in the sequential tab order (roving tabindex)', () => {
    render(<EventScopeTabs scope="upcoming" />);

    expect(screen.getByRole('tab', { name: board.tabUpcoming })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: board.tabPast })).toHaveAttribute('tabindex', '-1');
  });

  it('moves focus between the tabs with the arrow keys, and wraps', async () => {
    const user = userEvent.setup();
    render(<EventScopeTabs scope="upcoming" />);

    const upcoming = screen.getByRole('tab', { name: board.tabUpcoming });
    const past = screen.getByRole('tab', { name: board.tabPast });

    upcoming.focus();
    await user.keyboard('{ArrowRight}');
    expect(past).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(upcoming).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(past).toHaveFocus();
  });

  it('activates manually: arrowing does not navigate on its own', async () => {
    // APG manual activation — focus moves, the scope in the URL does not.
    const user = userEvent.setup();
    render(<EventScopeTabs scope="upcoming" />);

    screen.getByRole('tab', { name: board.tabUpcoming }).focus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: board.tabUpcoming })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});

describe('every flyer slot carries an alternative', () => {
  it('names the event in the image alt text', () => {
    render(<EventFlyer slug="s" title="Seminário" hasFlyer variant="card" />);
    expect(screen.getByAltText(board.flyerAlt('Seminário'))).toBeInTheDocument();
  });

  it('labels the placeholder rather than leaving a silent box', () => {
    render(<EventFlyer slug="s" title="Seminário" hasFlyer={false} variant="card" />);
    expect(screen.getByRole('img', { name: board.flyerPlaceholderAlt('Seminário') })).toBeInTheDocument();
  });
});

describe('the card is one link per event', () => {
  it('names the link after the event rather than leaving a bare URL', () => {
    const event = listItem();
    render(
      <ul>
        <EventCard event={event} />
      </ul>,
    );

    const link = screen.getByRole('link', { name: board.openEvent(event.title) });
    expect(link).toHaveAttribute('href', `/events/${event.slug}`);
    // One tab stop per card, not three.
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('keeps the grid square when an event has no flyer', () => {
    const event = listItem({ hasFlyer: false });
    render(
      <ul>
        <EventCard event={event} />
      </ul>,
    );

    expect(
      screen.getByRole('img', { name: board.flyerPlaceholderAlt(event.title) }),
    ).toBeInTheDocument();
  });
});
