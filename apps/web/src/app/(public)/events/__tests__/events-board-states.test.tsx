/**
 * The board below the happy path: empty, unavailable, loading.
 *
 * The empty board is not a corner case here — it is the first state a
 * brand-new tenant sees, and the state a crawler may arrive to while a dojo is
 * between seminars. So the assertions below check the *server-produced markup*,
 * not just what is on screen after React settles: `container.innerHTML` is read
 * straight out of the Server Component's output, which is what `curl` returns
 * and what gets indexed.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dictPt } from '@web/i18n';
import type { EventListItem } from '@web/lib/events-api';

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

const board = dictPt.events.board;

const MEMBERS_ONLY_EVENT: EventListItem = {
  id: 'evt-members',
  slug: 'treino-fechado',
  title: 'Treino fechado',
  summary: '',
  location: '',
  startsAt: '2099-10-10T13:00:00.000Z',
  endsAt: null,
  timezone: 'America/Sao_Paulo',
  audience: 'members',
  hasFlyer: false,
};

/**
 * `anonymous` is what the token-less server read returns; `viewer` is the
 * entitled superset a token buys. `null` on either side means the API did not
 * answer at all — which `fetchPublicEventList` collapses into the same `null`
 * an empty board would *not* produce.
 */
function stubApi({
  anonymous,
  viewer,
  deferViewer,
}: {
  anonymous: EventListItem[] | null;
  viewer?: EventListItem[];
  deferViewer?: boolean;
}) {
  const release: Array<() => void> = [];

  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const authorized = new Headers(init?.headers).has('Authorization');
    const data = authorized ? (viewer ?? []) : anonymous;

    if (authorized && deferViewer) {
      await new Promise<void>((resolve) => release.push(resolve));
    }

    if (data === null) {
      return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data, total: data.length, limit: 50, offset: 0, scope: 'upcoming' }),
    } as unknown as Response;
  });

  vi.stubGlobal('fetch', fetchMock);
  return { releaseViewer: () => release.forEach((resolve) => resolve()) };
}

async function renderBoard(scope?: string) {
  const { default: EventsPage } = await import('../page');
  return render(await EventsPage({ searchParams: Promise.resolve(scope ? { scope } : {}) }));
}

describe('/events — the empty board', () => {
  beforeEach(() => {
    authState.user = null;
    authState.accessToken = null;
    authState.isLoading = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('invites the visitor and points at the past tab, in the server markup itself', async () => {
    stubApi({ anonymous: [] });
    const { container } = await renderBoard();

    // Read off the server output: this is the HTML `curl -s /events` returns.
    expect(container.innerHTML).toContain(board.empty.upcomingTitle);
    expect(container.innerHTML).toContain(board.empty.upcomingBody);

    // And the way out of an empty calendar is the history, not a dead end.
    expect(screen.getByRole('link', { name: board.empty.upcomingCta })).toHaveAttribute(
      'href',
      '/events?scope=past',
    );
  });

  it('is not a skeleton: no loading copy stands in for the empty state', async () => {
    stubApi({ anonymous: [] });
    const { container } = await renderBoard();

    expect(container.innerHTML).not.toContain(board.loading);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the empty copy, not a spinner, while a session is still resolving', async () => {
    // The regression this pins: `AuthProvider` starts with `isLoading: true`,
    // which is also its state during a server render. A loading branch keyed on
    // that flag puts a spinner in the HTML `curl` returns and hands the crawler
    // a page with no copy on it — the empty board stops being indexable content
    // and becomes a client-only skeleton. There is no token here, and a token is
    // the only thing the entitled read can be waiting on.
    authState.isLoading = true;
    stubApi({ anonymous: [] });
    const { container } = await renderBoard();

    expect(container.innerHTML).toContain(board.empty.upcomingTitle);
    expect(container.innerHTML).not.toContain(board.loading);
  });

  it('gives the past tab its own empty state rather than a blank panel', async () => {
    stubApi({ anonymous: [] });
    const { container } = await renderBoard('past');

    expect(container.innerHTML).toContain(board.empty.pastTitle);
    expect(container.innerHTML).toContain(board.empty.pastBody);
    expect(container.innerHTML).not.toContain(board.empty.upcomingTitle);
    expect(screen.getByRole('link', { name: board.empty.pastCta })).toHaveAttribute(
      'href',
      '/events?scope=upcoming',
    );
  });

  it('still offers the stranger a way in', async () => {
    stubApi({ anonymous: [] });
    await renderBoard();

    expect(screen.getByText(board.signedOutTitle)).toBeInTheDocument();
  });
});

describe('/events — the listing could not be loaded', () => {
  beforeEach(() => {
    authState.user = null;
    authState.accessToken = null;
    authState.isLoading = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('says so plainly instead of claiming the dojo has nothing scheduled', async () => {
    stubApi({ anonymous: null });
    const { container } = await renderBoard();

    expect(screen.getByRole('alert')).toHaveTextContent(board.error.title);
    expect(container.innerHTML).toContain(board.error.body);

    // The distinction this whole branch exists for.
    expect(container.innerHTML).not.toContain(board.empty.upcomingTitle);
  });

  it('is a readable message, not a blank page', async () => {
    stubApi({ anonymous: null });
    const { container } = await renderBoard();

    expect(container.textContent?.trim()).not.toBe('');
    expect(screen.getByRole('heading', { level: 1, name: board.title })).toBeInTheDocument();
  });
});

describe('/events — a signed-in reader whose public slice is empty', () => {
  beforeEach(() => {
    authState.user = { id: 'u1' };
    authState.accessToken = 'a.b.c';
    authState.isLoading = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('waits rather than flashing "nothing scheduled" at a members-only board', async () => {
    const { releaseViewer } = stubApi({
      anonymous: [],
      viewer: [MEMBERS_ONLY_EVENT],
      deferViewer: true,
    });
    await renderBoard();

    // Their entitled read is still in flight: saying the calendar is empty here
    // would be wrong about the very events they are entitled to.
    expect(screen.getByRole('status')).toHaveTextContent(board.loading);
    expect(screen.queryByText(board.empty.upcomingTitle)).not.toBeInTheDocument();

    releaseViewer();
    await waitFor(() => {
      expect(screen.getByText(MEMBERS_ONLY_EVENT.title)).toBeInTheDocument();
    });
  });

  it('settles on the empty state when their entitled read is empty too', async () => {
    stubApi({ anonymous: [], viewer: [] });
    await renderBoard();

    await waitFor(() => {
      expect(screen.getByText(board.empty.upcomingTitle)).toBeInTheDocument();
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not hang on the loading state when their entitled read fails', async () => {
    // The anonymous slice answered; only the token read broke. The board falls
    // back to what it already rendered instead of spinning forever.
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (new Headers(init?.headers).has('Authorization')) {
        return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [], total: 0, limit: 50, offset: 0, scope: 'upcoming' }),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    await renderBoard();

    await waitFor(() => {
      expect(screen.getByText(board.empty.upcomingTitle)).toBeInTheDocument();
    });
  });
});
