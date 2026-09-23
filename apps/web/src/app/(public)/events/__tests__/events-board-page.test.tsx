import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dictPt } from '@web/i18n';
import type { EventListItem } from '@web/lib/events-api';

// The board reads the session through this hook only. Mocking it keeps the
// test off the network that `AuthProvider` would otherwise hit on mount.
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

function listItem(overrides: Partial<EventListItem> = {}): EventListItem {
  return {
    id: 'evt-public',
    slug: 'seminario-de-verao',
    title: 'Seminário de verão',
    summary: 'Open mat with a visiting instructor.',
    location: 'Dojo central',
    startsAt: '2026-10-10T13:00:00.000Z',
    endsAt: null,
    timezone: 'America/Sao_Paulo',
    audience: 'public',
    hasFlyer: true,
    ...overrides,
  };
}

const PUBLIC_EVENT = listItem();
const RESTRICTED_EVENT = listItem({
  id: 'evt-restricted',
  slug: 'graduacao-interna',
  title: 'Graduação interna',
  audience: 'restricted',
});

/**
 * Stands in for the API. The anonymous branch is what the Server Component
 * reaches; the `Bearer` branch is the entitled superset only a Client
 * Component can ask for.
 */
function stubApi() {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];

  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init });

    const headers = new Headers(init?.headers);
    const authorized = headers.has('Authorization');
    const data = authorized ? [PUBLIC_EVENT, RESTRICTED_EVENT] : [PUBLIC_EVENT];

    return {
      ok: true,
      status: 200,
      json: async () => ({ data, total: data.length, limit: 50, offset: 0, scope: 'upcoming' }),
    } as unknown as Response;
  });

  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

async function renderBoard(scope?: string) {
  const { default: EventsPage } = await import('../page');
  const ui = await EventsPage({ searchParams: Promise.resolve(scope ? { scope } : {}) });
  return render(ui);
}

describe('/events — the server-rendered board', () => {
  beforeEach(() => {
    authState.user = null;
    authState.accessToken = null;
    authState.isLoading = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('carries the event titles in the markup the server produced', async () => {
    stubApi();
    await renderBoard();

    // No client fetch has run: this is what `curl` and a crawler receive.
    expect(screen.getByText(PUBLIC_EVENT.title)).toBeInTheDocument();
  });

  it('fetches the board with no Authorization header, ever', async () => {
    const { calls } = stubApi();
    await renderBoard();

    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0].init?.headers).has('Authorization')).toBe(false);
    // Nor by the back door: no cookie may be forwarded either.
    expect(calls[0].init?.credentials).toBeUndefined();
  });

  it('shows the public slice and the sign-in affordance to a signed-out visitor', async () => {
    stubApi();
    await renderBoard();

    expect(screen.getByText(PUBLIC_EVENT.title)).toBeInTheDocument();
    expect(screen.queryByText(RESTRICTED_EVENT.title)).not.toBeInTheDocument();
    expect(screen.getByText(dictPt.events.board.signedOutTitle)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: dictPt.events.board.signedOutCta }),
    ).toHaveAttribute('href', '/login');
  });

  it('keeps the public slice and adds the entitled events after hydration', async () => {
    authState.user = { id: 'u1' };
    authState.accessToken = 'a.b.c';
    stubApi();

    await renderBoard();

    // The server slice is on screen before the token fetch resolves…
    expect(screen.getByText(PUBLIC_EVENT.title)).toBeInTheDocument();

    // …and is still there once the entitled superset merges in.
    await waitFor(() => {
      expect(screen.getByText(RESTRICTED_EVENT.title)).toBeInTheDocument();
    });
    expect(screen.getByText(PUBLIC_EVENT.title)).toBeInTheDocument();
    expect(screen.getByText(dictPt.events.audience.restricted)).toBeInTheDocument();
    // One board, not two tables.
    expect(screen.getAllByRole('list')).toHaveLength(1);

    // A signed-in reader is not asked to sign in.
    expect(screen.queryByText(dictPt.events.board.signedOutTitle)).not.toBeInTheDocument();
  });

  it('defaults to Próximos and moves ?scope on the Anteriores tab', async () => {
    stubApi();
    await renderBoard();

    const upcoming = screen.getByRole('tab', { name: dictPt.events.board.tabUpcoming });
    const past = screen.getByRole('tab', { name: dictPt.events.board.tabPast });

    expect(upcoming).toHaveAttribute('aria-selected', 'true');
    expect(past).toHaveAttribute('aria-selected', 'false');
    expect(past).toHaveAttribute('href', '/events?scope=past');
    expect(upcoming).toHaveAttribute('href', '/events?scope=upcoming');
  });

  it('asks the API for the past scope when ?scope=past is on the URL', async () => {
    const { calls } = stubApi();
    await renderBoard('past');

    expect(calls[0].url).toContain('scope=past');
    expect(screen.getByRole('tab', { name: dictPt.events.board.tabPast })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('falls back to the upcoming scope for an unknown ?scope value', async () => {
    const { calls } = stubApi();
    await renderBoard('sideways');

    expect(calls[0].url).toContain('scope=upcoming');
  });
});
