import { describe, it, expect, vi, afterEach } from 'vitest';
import type { EventListItem } from '@web/lib/events-api';

function listItem(slug: string, overrides: Partial<EventListItem> = {}): EventListItem {
  return {
    id: slug,
    slug,
    title: slug,
    summary: '',
    location: '',
    startsAt: '2026-10-10T13:00:00.000Z',
    endsAt: null,
    timezone: 'America/Sao_Paulo',
    audience: 'public',
    hasFlyer: false,
    ...overrides,
  };
}

/**
 * The stub answers the anonymous list only — which is the point: the sitemap
 * has no token to send, so whatever it can see is by construction the published
 * `public` set.
 */
function stubEventList(byScope: Record<string, EventListItem[]>) {
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    const scope = href.includes('scope=past') ? 'past' : 'upcoming';
    const offset = Number(new URL(href, 'http://x').searchParams.get('offset') ?? '0');
    const all = byScope[scope] ?? [];
    const page = all.slice(offset, offset + 100);

    return {
      ok: true,
      status: 200,
      json: async () => ({ data: page, total: all.length, limit: 100, offset, scope }),
      // Surfaced so the assertion below can prove no token went out.
      __authorized: new Headers(init?.headers).has('Authorization'),
    } as unknown as Response;
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('sitemap.xml', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('lists the board, the landing page and every published public event', async () => {
    stubEventList({
      upcoming: [listItem('seminario-de-verao')],
      past: [listItem('graduacao-2025')],
    });

    const { default: sitemap } = await import('../sitemap');
    const entries = await sitemap();
    const paths = entries.map((entry) => new URL(entry.url).pathname);

    expect(paths).toContain('/events');
    expect(paths).toContain('/events/seminario-de-verao');
    expect(paths).toContain('/events/graduacao-2025');
  });

  it('is built from the anonymous read, so it can never advertise a 404', async () => {
    const fetchMock = stubEventList({ upcoming: [listItem('seminario-de-verao')], past: [] });

    const { default: sitemap } = await import('../sitemap');
    await sitemap();

    for (const call of fetchMock.mock.calls) {
      expect(new Headers(call[1]?.headers).has('Authorization')).toBe(false);
    }
  });

  it('degrades to the static pages when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down');
      }),
    );

    const { default: sitemap } = await import('../sitemap');
    const entries = await sitemap();

    expect(entries.map((entry) => new URL(entry.url).pathname)).toEqual(['/', '/events']);
  });
});

describe('robots.txt', () => {
  afterEach(() => vi.resetModules());

  it('opens the public board and keeps crawlers out of the signed-in surfaces', async () => {
    const { default: robots } = await import('../robots');
    const rules = robots();
    const rule = Array.isArray(rules.rules) ? rules.rules[0] : rules.rules;

    expect(rule?.allow).toContain('/events');
    expect(rule?.disallow).toContain('/admin');
    expect(rule?.disallow).toContain('/dashboard');
    expect(rules.sitemap).toMatch(/\/sitemap\.xml$/);
  });
});
