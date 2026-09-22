/**
 * The detail page's non-happy states: an event that has already happened, and
 * an event with no flyer.
 *
 * Both exist because of a decision made upstream. Keeping past events on the
 * board (RFC 0014's vitrine argument) is worth nothing if the page behind the
 * link is stripped, and a dojo that never uploaded a flyer should not have its
 * page rendered with a torn-image icon in the middle of it.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dictPt } from '@web/i18n';
import type { EventDetail } from '@web/lib/events-api';

const authState: { user: { id: string } | null; accessToken: string | null; isLoading: boolean } = {
  user: null,
  accessToken: null,
  isLoading: false,
};

vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => authState,
  useCurrentUser: () => authState.user,
  useHasRole: () => false,
}));

const detailCopy = dictPt.events.detail;

function detail(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: 'evt-public',
    slug: 'seminario-de-verao',
    title: 'Seminário de verão',
    summary: 'Open mat with a visiting instructor.',
    content: '## Programme\n\nWarm-up, randori, closing.',
    location: 'Dojo central',
    // Comfortably in the future, so "past" is never an accident of the clock.
    startsAt: '2099-10-10T13:00:00.000Z',
    endsAt: '2099-10-10T16:00:00.000Z',
    timezone: 'America/Sao_Paulo',
    audience: 'public',
    hasFlyer: true,
    contact: { number: '5519999991155', message: 'Olá!', label: '' },
    ...overrides,
  };
}

function stubApi(event: EventDetail) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => event }) as unknown as Response),
  );
}

async function renderDetail(event: EventDetail) {
  stubApi(event);
  const { default: EventDetailPage } = await import('../[slug]/page');
  return render(await EventDetailPage({ params: Promise.resolve({ slug: event.slug }) }));
}

beforeEach(() => {
  authState.user = null;
  authState.accessToken = null;
  authState.isLoading = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('/events/[slug] — an event that has already happened', () => {
  const past = detail({
    startsAt: '2019-03-02T13:00:00.000Z',
    endsAt: '2019-03-02T16:00:00.000Z',
  });

  it('marks it as past', async () => {
    await renderDetail(past);
    expect(screen.getByText(detailCopy.pastBadge)).toBeInTheDocument();
  });

  it('keeps its content, its flyer and its date — the page is not a dead end', async () => {
    await renderDetail(past);

    expect(screen.getByRole('heading', { level: 1, name: past.title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Programme' })).toBeInTheDocument();
    expect(screen.getByAltText(dictPt.events.board.flyerAlt(past.title))).toBeInTheDocument();
    expect(screen.getByText(past.location)).toBeInTheDocument();
    // 13:00Z is 10:00 in São Paulo; the date survives in the event's own zone.
    expect(screen.getByText(/10:00/)).toBeInTheDocument();
  });

  it('keeps the contact button, rendered below the past note', async () => {
    // The product call (Milestone 20 Task 07 §5): a reader on an old seminar is
    // usually asking about the next edition, so the path stays open — but the
    // note comes first, so nobody writes in thinking the date is still ahead.
    const { container } = await renderDetail(past);

    const button = screen.getByRole('link', { name: detailCopy.contactDefaultLabel });
    expect(button).toBeInTheDocument();

    const note = screen.getByText(detailCopy.pastNote);
    expect(note.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.innerHTML).toContain('wa.me');
  });

  it('leaves an upcoming event unmarked', async () => {
    await renderDetail(detail());

    expect(screen.queryByText(detailCopy.pastBadge)).not.toBeInTheDocument();
    expect(screen.queryByText(detailCopy.pastNote)).not.toBeInTheDocument();
  });

  it('does not mark an event that started but has not ended', async () => {
    const running = detail({
      startsAt: '2019-03-02T13:00:00.000Z',
      endsAt: '2099-03-02T16:00:00.000Z',
    });
    await renderDetail(running);

    expect(screen.queryByText(detailCopy.pastBadge)).not.toBeInTheDocument();
  });
});

describe('/events/[slug] — an event with no flyer', () => {
  it('renders a labelled placeholder instead of a broken image', async () => {
    const event = detail({ hasFlyer: false });
    const { container } = await renderDetail(event);

    expect(
      screen.getByRole('img', { name: dictPt.events.board.flyerPlaceholderAlt(event.title) }),
    ).toBeInTheDocument();

    // The only way a browser can draw a torn-page icon is an <img> it cannot
    // resolve. There is no <img> at all here.
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('/flyer');
  });

  it('renders the real flyer when the event has one', async () => {
    const event = detail();
    const { container } = await renderDetail(event);

    const image = screen.getByAltText(dictPt.events.board.flyerAlt(event.title));
    expect(image).toBeInTheDocument();
    expect(image).toHaveAttribute('src', expect.stringContaining(`/v1/events/${event.slug}/flyer`));
    expect(
      container.querySelector(`[aria-label="${dictPt.events.board.flyerPlaceholderAlt(event.title)}"]`),
    ).toBeNull();
  });
});
