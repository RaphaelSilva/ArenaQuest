/**
 * The unified not-found surface.
 *
 * Task 03 made the API answer three different situations with a byte-identical
 * `404`: a slug outside the caller's audience, a slug whose event was archived,
 * and a slug that never existed. That was not tidiness — `/events/{slug}` is
 * open to the internet, and a response that distinguished "you may not see
 * this" from "this does not exist" is an enumeration oracle: walk a wordlist,
 * keep the slugs that answer differently, and you have the private half of a
 * dojo's calendar without ever being a member.
 *
 * The UI can hand that oracle straight back. A "not available to your account"
 * panel for one case and a "no such event" panel for another re-creates the
 * distinction one layer up, in the HTML, where it is *easier* to read than a
 * status code.
 *
 * So these tests assert the property the same way Task 03 did: by **comparing
 * the three rendered pages to each other**, not each against a literal. A
 * literal drifts silently when someone adds a field; a comparison fails the
 * moment two of them stop matching.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

/** The three slugs the API cannot be allowed to tell apart. */
const OUT_OF_AUDIENCE = 'graduacao-interna';
const ARCHIVED = 'seminario-de-2019';
const NONEXISTENT = 'nao-existe-mesmo';

/**
 * The API as Task 03 built it: one `404`, one body, for all three reasons.
 * `grants` names the slugs a *token-bearing* caller may read — which is how the
 * out-of-audience case differs from the other two at all.
 */
function stubApi(grants: Record<string, EventDetail> = {}) {
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const authorized = new Headers(init?.headers).has('Authorization');
    const slug = decodeURIComponent(String(url).split('/events/')[1] ?? '');
    const granted = authorized ? grants[slug] : undefined;

    if (!granted) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'NotFound', message: 'Event not found' }),
      } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => granted } as unknown as Response;
  });

  vi.stubGlobal('fetch', fetchMock);
}

async function renderDetail(slug: string) {
  const { default: EventDetailPage } = await import('../[slug]/page');
  return render(await EventDetailPage({ params: Promise.resolve({ slug }) }));
}

/** The markup the server produced, before any post-hydration retry settles. */
async function serverHtml(slug: string): Promise<string> {
  const { container } = await renderDetail(slug);
  const html = container.innerHTML;
  cleanup();
  return html;
}

describe('/events/[slug] — one not-found surface for three different reasons', () => {
  beforeEach(() => {
    authState.user = null;
    authState.accessToken = null;
    authState.isLoading = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('renders the same HTML for an out-of-audience, an archived and a nonexistent slug', async () => {
    stubApi();

    const outOfAudience = await serverHtml(OUT_OF_AUDIENCE);
    const archived = await serverHtml(ARCHIVED);
    const nonexistent = await serverHtml(NONEXISTENT);

    // Compared to each other, never to a literal: a field added for one case
    // breaks this, whatever it says.
    expect(outOfAudience).toBe(archived);
    expect(archived).toBe(nonexistent);
  });

  it('puts none of the three slugs into the markup it produced', async () => {
    stubApi();

    for (const slug of [OUT_OF_AUDIENCE, ARCHIVED, NONEXISTENT]) {
      expect(await serverHtml(slug)).not.toContain(slug);
    }
  });

  it('keeps the server HTML identical even for a reader who is granted one of them', async () => {
    // The interaction worth pinning: `EventDetailFallback` retries with a token
    // after hydration, so this reader *will* end up seeing the restricted
    // event. What must not differ is the HTML the server produced — that is the
    // bytes a shared cache could keep and a crawler could index.
    authState.user = { id: 'u1' };
    authState.accessToken = 'a.b.c';
    stubApi({
      [OUT_OF_AUDIENCE]: {
        id: 'evt-restricted',
        slug: OUT_OF_AUDIENCE,
        title: 'Graduação interna',
        summary: '',
        content: '',
        location: '',
        startsAt: '2099-10-10T13:00:00.000Z',
        endsAt: null,
        timezone: 'America/Sao_Paulo',
        audience: 'restricted',
        hasFlyer: false,
        contact: null,
      },
    });

    const granted = await serverHtml(OUT_OF_AUDIENCE);
    const missing = await serverHtml(NONEXISTENT);

    expect(granted).toBe(missing);
    expect(granted).not.toContain('Graduação interna');
  });

  it('still lets the granted reader through after hydration — that is the design, not a leak', async () => {
    authState.user = { id: 'u1' };
    authState.accessToken = 'a.b.c';
    stubApi({
      [OUT_OF_AUDIENCE]: {
        id: 'evt-restricted',
        slug: OUT_OF_AUDIENCE,
        title: 'Graduação interna',
        summary: '',
        content: '',
        location: '',
        startsAt: '2099-10-10T13:00:00.000Z',
        endsAt: null,
        timezone: 'America/Sao_Paulo',
        audience: 'restricted',
        hasFlyer: false,
        contact: null,
      },
    });

    await renderDetail(OUT_OF_AUDIENCE);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: 'Graduação interna' }),
      ).toBeInTheDocument();
    });
  });

  it('settles on the not-found panel for a signed-in reader who is granted nothing', async () => {
    authState.user = { id: 'u1' };
    authState.accessToken = 'a.b.c';
    stubApi();

    await renderDetail(NONEXISTENT);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: dictPt.events.detail.notFoundTitle }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole('link', { name: dictPt.events.detail.notFoundCta }),
    ).toHaveAttribute('href', '/events');
  });
});
