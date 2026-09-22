import { render, screen, waitFor } from '@testing-library/react';
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

function detail(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: 'evt-public',
    slug: 'seminario-de-verao',
    title: 'Seminário de verão',
    summary: 'Open mat with a visiting instructor.',
    content: '## Programme\n\nWarm-up, randori, closing.',
    location: 'Dojo central',
    startsAt: '2026-10-10T13:00:00.000Z',
    endsAt: '2026-10-10T16:00:00.000Z',
    timezone: 'America/Sao_Paulo',
    audience: 'public',
    hasFlyer: true,
    contact: { number: '5519999991155', message: 'Olá! Quero o Seminário de verão.', label: '' },
    ...overrides,
  };
}

/**
 * Serves `event` to an authorized caller and, when `publiclyVisible` is false,
 * answers the anonymous caller with the API's single not-found — the same body
 * a slug that never existed would get.
 */
function stubApi(event: EventDetail, publiclyVisible = true) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];

  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const authorized = new Headers(init?.headers).has('Authorization');

    if (!authorized && !publiclyVisible) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'NotFound' }),
      } as unknown as Response;
    }

    return { ok: true, status: 200, json: async () => event } as unknown as Response;
  });

  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

async function renderDetail(slug: string) {
  const { default: EventDetailPage } = await import('../[slug]/page');
  return render(await EventDetailPage({ params: Promise.resolve({ slug }) }));
}

async function metadataFor(slug: string) {
  const { generateMetadata } = await import('../[slug]/page');
  return generateMetadata({ params: Promise.resolve({ slug }) });
}

describe('/events/[slug] — the server-rendered detail page', () => {
  beforeEach(() => {
    authState.user = null;
    authState.accessToken = null;
    authState.isLoading = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('renders the title, location and sanitised body without a session', async () => {
    const event = detail();
    stubApi(event);
    await renderDetail(event.slug);

    expect(screen.getByRole('heading', { level: 1, name: event.title })).toBeInTheDocument();
    expect(screen.getByText(event.location)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Programme' })).toBeInTheDocument();
  });

  it("renders date and time in the event's own timezone, not the machine's", async () => {
    // 13:00Z is 10:00 in America/Sao_Paulo; the test machine runs on UTC.
    const event = detail();
    stubApi(event);
    await renderDetail(event.slug);

    const when = screen.getByText(/10:00/);
    expect(when).toBeInTheDocument();
    expect(when.textContent).toContain('13:00'); // the 16:00Z end, in São Paulo
    expect(when.textContent).not.toMatch(/\b16:00\b/);
  });

  it('composes the wa.me target from the number and message the API returned', async () => {
    const event = detail();
    stubApi(event);
    await renderDetail(event.slug);

    const button = screen.getByRole('link', { name: dictPt.events.detail.contactDefaultLabel });
    expect(button).toHaveAttribute(
      'href',
      `https://wa.me/5519999991155?text=${encodeURIComponent(event.contact!.message)}`,
    );
    expect(button).toHaveAttribute('target', '_blank');
    expect(button).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it("uses the event's own contact label when the admin stored one", async () => {
    const event = detail({
      contact: { number: '5519999991155', message: '', label: 'Quero treinar' },
    });
    stubApi(event);
    await renderDetail(event.slug);

    expect(screen.getByRole('link', { name: 'Quero treinar' })).toBeInTheDocument();
  });

  it('renders no button at all when the API returned contact: null', async () => {
    const event = detail({ contact: null });
    stubApi(event);
    const { container } = await renderDetail(event.slug);

    expect(container.querySelector('a[href^="https://wa.me/"]')).toBeNull();
    // And it does not reach for the tenant number instead.
    expect(container.innerHTML).not.toContain('wa.me');
  });

  it('composes no message of its own when contact.message is empty', async () => {
    const event = detail({ contact: { number: '5519999991155', message: '', label: '' } });
    stubApi(event);
    await renderDetail(event.slug);

    const button = screen.getByRole('link', { name: dictPt.events.detail.contactDefaultLabel });
    // No `?text=` at all: the chat opens with nothing typed.
    expect(button).toHaveAttribute('href', 'https://wa.me/5519999991155');
  });

  it('keeps a restricted event out of the server-rendered HTML even with a session cookie', async () => {
    document.cookie = 'aq_refresh=not-a-real-token';
    authState.user = { id: 'u1' };
    authState.accessToken = 'a.b.c';

    const event = detail({
      id: 'evt-restricted',
      slug: 'graduacao-interna',
      title: 'Graduação interna',
      audience: 'restricted',
    });
    const { calls } = stubApi(event, false);

    const { container } = await renderDetail(event.slug);

    // The server asked anonymously, so the markup it produced carries nothing
    // about the event — this is the HTML that would land in a shared cache.
    expect(new Headers(calls[0].init?.headers).has('Authorization')).toBe(false);
    expect(calls[0].init?.credentials).toBeUndefined();
    expect(container.innerHTML).not.toContain(event.title);

    // The signed-in reader still gets there, but only after hydration.
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: event.title })).toBeInTheDocument();
    });

    // …and only that second, client-side request carried the token.
    expect(calls).toHaveLength(2);
    expect(new Headers(calls[1].init?.headers).get('Authorization')).toBe('Bearer a.b.c');
  });

  it('shows the shared not-found panel to a visitor with no session', async () => {
    const event = detail({ slug: 'graduacao-interna', audience: 'restricted' });
    stubApi(event, false);
    await renderDetail('graduacao-interna');

    await waitFor(() => {
      expect(screen.getByText(dictPt.events.detail.notFoundTitle)).toBeInTheDocument();
    });
  });
});

describe('/events/[slug] — generateMetadata', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('points og:image at the stable flyer route, never at a presigned URL', async () => {
    const event = detail();
    stubApi(event);

    const metadata = await metadataFor(event.slug);
    const images = metadata.openGraph?.images as Array<{ url: string }>;

    expect(images).toHaveLength(1);
    expect(images[0].url).toContain(`/v1/events/${event.slug}/flyer`);
    // A presigned target is dead an hour later — it must never be the og:image.
    expect(images[0].url).not.toContain('X-Amz-Signature');
    expect(images[0].url).not.toContain('X-Amz-Credential');
  });

  it('fills og:title and og:description from the event', async () => {
    const event = detail();
    stubApi(event);

    const metadata = await metadataFor(event.slug);

    expect(metadata.openGraph?.title).toContain(event.title);
    expect(metadata.openGraph?.description).toBe(event.summary);
    expect(metadata.description).toBe(event.summary);
  });

  it('emits no og:image for an event with no flyer', async () => {
    const event = detail({ hasFlyer: false });
    stubApi(event);

    const metadata = await metadataFor(event.slug);
    expect(metadata.openGraph?.images).toBeUndefined();
  });

  it('leaks nothing about an event the anonymous reader may not see', async () => {
    const event = detail({ title: 'Graduação interna', audience: 'restricted' });
    stubApi(event, false);

    const metadata = await metadataFor(event.slug);
    expect(JSON.stringify(metadata)).not.toContain(event.title);
    expect(metadata.title).toContain(dictPt.events.detail.notFoundTitle);
  });
});
