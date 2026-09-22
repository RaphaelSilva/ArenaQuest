import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EventsController,
  composeContactMessage,
  resolveContact,
} from '@api/controllers/events.controller';
import { Entities } from '@arenaquest/shared/types/entities';
import type {
  IEventRepository,
  IStorageAdapter,
  ListVisibleEventsOptions,
} from '@arenaquest/shared/ports';

/**
 * Business rules with pure mocks (node project). The audience matrix itself is
 * **not** here: it belongs to `test/db/d1-event-repository.spec.ts`, because the
 * repository owns the rule. What is asserted here is that this controller adds
 * no filtering of its own and passes the viewer straight through — the drift
 * that a second implementation would cause.
 */

const NOW = new Date('2026-06-15T12:00:00.000Z');

function makeEvent(
  overrides: Partial<Entities.Events.Event> = {},
): Entities.Events.Event {
  return {
    id: 'evt-1',
    slug: 'summer-seminar',
    title: 'Summer seminar',
    summary: 'A blurb',
    content: 'Plain body',
    location: 'Dojo',
    startsAt: new Date('2026-10-10T13:00:00.000Z'),
    endsAt: null,
    timezone: 'America/Sao_Paulo',
    status: Entities.Config.EventStatus.PUBLISHED,
    audience: Entities.Config.EventAudience.PUBLIC,
    flyer: { status: 'none', key: null, type: null, sizeBytes: null, name: null },
    whatsappNumber: '',
    whatsappMessage: null,
    contactLabel: '',
    createdBy: 'admin-1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

type RepoStub = {
  listVisible: ReturnType<typeof vi.fn>;
  countVisible: ReturnType<typeof vi.fn>;
  findVisibleBySlug: ReturnType<typeof vi.fn>;
};

let repo: RepoStub;
let storage: { getPresignedDownloadUrl: ReturnType<typeof vi.fn> };
let controller: EventsController;

beforeEach(() => {
  repo = {
    listVisible: vi.fn(async () => []),
    countVisible: vi.fn(async () => 0),
    findVisibleBySlug: vi.fn(async () => null),
  };
  storage = {
    getPresignedDownloadUrl: vi.fn(async (key: string) => `https://r2.test/${key}?signed=1`),
  };
  controller = new EventsController(
    repo as unknown as IEventRepository,
    storage as unknown as IStorageAdapter,
  );
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('EventsController.list', () => {
  it('passes the viewer and the scope through to the repository untouched', async () => {
    await controller.list({
      viewerUserId: 'user-7',
      scope: 'past',
      limit: 10,
      offset: 20,
      now: NOW,
    });

    const opts = repo.listVisible.mock.calls[0][0] as ListVisibleEventsOptions;
    expect(opts).toEqual({
      viewerUserId: 'user-7',
      scope: 'past',
      now: NOW,
      limit: 10,
      offset: 20,
    });
    // The count must be taken under the same audience rule, or the pagination
    // total would describe a different set than the page.
    expect(repo.countVisible.mock.calls[0][0]).toEqual({
      viewerUserId: 'user-7',
      scope: 'past',
      now: NOW,
    });
  });

  it('forwards an anonymous viewer as null rather than inventing an identity', async () => {
    await controller.list({ viewerUserId: null, scope: 'upcoming', limit: 50, offset: 0, now: NOW });

    expect((repo.listVisible.mock.calls[0][0] as ListVisibleEventsOptions).viewerUserId).toBeNull();
  });

  it('returns exactly what the repository returned — it filters nothing itself', async () => {
    // Deliberately a set the controller has every excuse to "helpfully" trim:
    // a draft and a restricted event. It must not.
    repo.listVisible.mockResolvedValue([
      makeEvent({ id: 'a', slug: 'a', audience: Entities.Config.EventAudience.RESTRICTED }),
      makeEvent({ id: 'b', slug: 'b', status: Entities.Config.EventStatus.DRAFT }),
    ]);
    repo.countVisible.mockResolvedValue(2);

    const result = await controller.list({
      viewerUserId: 'user-7',
      scope: 'upcoming',
      limit: 50,
      offset: 0,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.data.map(e => e.id)).toEqual(['a', 'b']);
    expect(result.data.total).toBe(2);
    expect(result.data.scope).toBe('upcoming');
  });

  it('omits the markdown body from list items', async () => {
    repo.listVisible.mockResolvedValue([makeEvent({ content: '# Long body' })]);

    const result = await controller.list({
      viewerUserId: null,
      scope: 'upcoming',
      limit: 50,
      offset: 0,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.data[0]).not.toHaveProperty('content');
  });

  it('reports the flyer as a boolean, never as a presigned URL', async () => {
    repo.listVisible.mockResolvedValue([
      makeEvent({ id: 'ready', flyer: { status: 'ready', key: 'k', type: 'image/png', sizeBytes: 1, name: 'f.png' } }),
      makeEvent({ id: 'pending', flyer: { status: 'pending', key: 'k2', type: 'image/png', sizeBytes: 1, name: 'f.png' } }),
    ]);

    const result = await controller.list({
      viewerUserId: null,
      scope: 'upcoming',
      limit: 50,
      offset: 0,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.data.map(e => e.hasFlyer)).toEqual([true, false]);
    expect(storage.getPresignedDownloadUrl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getBySlug
// ---------------------------------------------------------------------------

describe('EventsController.getBySlug', () => {
  it('returns 404 NotFound when the repository answers null', async () => {
    const result = await controller.getBySlug('nope', { viewerUserId: null });

    expect(result).toEqual({ ok: false, status: 404, error: 'NotFound' });
  });

  it('returns the identical not-found value for a missing and an invisible event', async () => {
    // The repository collapses both cases to null on purpose; this asserts the
    // controller does not re-expand them into two distinguishable answers.
    const missing = await controller.getBySlug('no-such-slug', { viewerUserId: null });
    const invisible = await controller.getBySlug('restricted-one', { viewerUserId: 'user-7' });

    expect(JSON.stringify(missing)).toBe(JSON.stringify(invisible));
  });

  it('never answers 403', async () => {
    const result = await controller.getBySlug('restricted-one', { viewerUserId: 'user-7' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).not.toBe(403);
  });

  it('sanitises the markdown body on the way out', async () => {
    repo.findVisibleBySlug.mockResolvedValue(
      makeEvent({ content: 'Hi <script>alert(1)</script> there' }),
    );

    const result = await controller.getBySlug('summer-seminar', { viewerUserId: null });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.content).not.toContain('<script>');
    expect(result.data.content).toContain('Hi');
  });

  it('serialises the instants as ISO strings and keeps an open-ended end null', async () => {
    repo.findVisibleBySlug.mockResolvedValue(makeEvent());

    const result = await controller.getBySlug('summer-seminar', { viewerUserId: null });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.startsAt).toBe('2026-10-10T13:00:00.000Z');
    expect(result.data.endsAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Contact resolution (RFC 0014 §5 as amended 2026-09-22)
// ---------------------------------------------------------------------------

describe('contact resolution', () => {
  it('is null when the event stores no number — there is NO tenant fallback', async () => {
    // The controller is constructed with a repository and a storage adapter and
    // nothing else: there is no binding, no env and no constant it could fall
    // back to. An empty column suppresses the whole block.
    repo.findVisibleBySlug.mockResolvedValue(makeEvent({ whatsappNumber: '' }));

    const result = await controller.getBySlug('summer-seminar', { viewerUserId: null });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.contact).toBeNull();
  });

  it('is null when the stored number is too short to dial', async () => {
    expect(resolveContact(makeEvent({ whatsappNumber: '12345' }))).toBeNull();
  });

  it('emits exactly the number stored on the event', async () => {
    repo.findVisibleBySlug.mockResolvedValue(makeEvent({ whatsappNumber: '5519999991155' }));

    const result = await controller.getBySlug('summer-seminar', { viewerUserId: null });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.contact?.number).toBe('5519999991155');
  });

  it('prefers the stored message when the admin wrote one', () => {
    const contact = resolveContact(
      makeEvent({ whatsappNumber: '5519999991155', whatsappMessage: 'Hi about the seminar' }),
    );

    expect(contact?.message).toBe('Hi about the seminar');
  });

  it('treats a blank stored message as unset and composes instead', () => {
    const contact = resolveContact(
      makeEvent({ whatsappNumber: '5519999991155', whatsappMessage: '   ' }),
    );

    expect(contact?.message).toBe(composeContactMessage(makeEvent()));
  });

  it('composes from the CURRENT title, so a rename never strands the message', () => {
    const before = resolveContact(
      makeEvent({ whatsappNumber: '5519999991155', title: 'Winter camp' }),
    );
    const after = resolveContact(
      makeEvent({ whatsappNumber: '5519999991155', title: 'Winter camp 2026' }),
    );

    expect(before?.message).toContain('"Winter camp"');
    expect(after?.message).toContain('"Winter camp 2026"');
    expect(after?.message).not.toBe(before?.message);
  });

  it('names the start date in the event own timezone', () => {
    const contact = resolveContact(
      makeEvent({
        whatsappNumber: '5519999991155',
        // 00:30 UTC on the 11th is still the 10th in Sao Paulo (UTC-3).
        startsAt: new Date('2026-10-11T00:30:00.000Z'),
        timezone: 'America/Sao_Paulo',
      }),
    );

    expect(contact?.message).toContain('10/10/2026');
  });

  it('falls back to the ISO date rather than throwing on a bad timezone', () => {
    const contact = resolveContact(
      makeEvent({ whatsappNumber: '5519999991155', timezone: 'Not/AZone' }),
    );

    expect(contact?.message).toContain('2026-10-10');
  });

  it('passes the label through as stored, empty string included', () => {
    expect(resolveContact(makeEvent({ whatsappNumber: '5519999991155' }))?.label).toBe('');
    expect(
      resolveContact(makeEvent({ whatsappNumber: '5519999991155', contactLabel: 'Eu quero' }))?.label,
    ).toBe('Eu quero');
  });
});

// ---------------------------------------------------------------------------
// getFlyerTarget
// ---------------------------------------------------------------------------

describe('EventsController.getFlyerTarget', () => {
  it('mints a 1-hour presigned GET for a ready flyer', async () => {
    repo.findVisibleBySlug.mockResolvedValue(
      makeEvent({
        flyer: { status: 'ready', key: 'events/evt-1/flyer.png', type: 'image/png', sizeBytes: 10, name: 'f.png' },
      }),
    );

    const result = await controller.getFlyerTarget('summer-seminar', { viewerUserId: null });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.url).toBe('https://r2.test/events/evt-1/flyer.png?signed=1');
    expect(result.data.audience).toBe('public');
    expect(storage.getPresignedDownloadUrl).toHaveBeenCalledWith(
      'events/evt-1/flyer.png',
      { expiresInSeconds: 3600 },
    );
  });

  it('returns the same 404 for an event with no flyer as for no event at all', async () => {
    repo.findVisibleBySlug.mockResolvedValue(makeEvent());
    const noFlyer = await controller.getFlyerTarget('summer-seminar', { viewerUserId: null });

    repo.findVisibleBySlug.mockResolvedValue(null);
    const noEvent = await controller.getFlyerTarget('nope', { viewerUserId: null });

    expect(JSON.stringify(noFlyer)).toBe(JSON.stringify(noEvent));
    expect(noFlyer).toEqual({ ok: false, status: 404, error: 'NotFound' });
  });

  it('does not serve a flyer that was presigned but never confirmed', async () => {
    repo.findVisibleBySlug.mockResolvedValue(
      makeEvent({
        flyer: { status: 'pending', key: 'events/evt-1/flyer.png', type: 'image/png', sizeBytes: 10, name: 'f.png' },
      }),
    );

    const result = await controller.getFlyerTarget('summer-seminar', { viewerUserId: null });

    expect(result).toEqual({ ok: false, status: 404, error: 'NotFound' });
    expect(storage.getPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('does not sign anything for an event the caller may not see', async () => {
    repo.findVisibleBySlug.mockResolvedValue(null);

    await controller.getFlyerTarget('restricted-one', { viewerUserId: 'user-7' });

    expect(storage.getPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('reports the audience so the router can decide whether the 302 is cacheable', async () => {
    repo.findVisibleBySlug.mockResolvedValue(
      makeEvent({
        audience: Entities.Config.EventAudience.MEMBERS,
        flyer: { status: 'ready', key: 'k', type: 'image/png', sizeBytes: 1, name: 'f.png' },
      }),
    );

    const result = await controller.getFlyerTarget('summer-seminar', { viewerUserId: 'user-7' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.audience).toBe('members');
  });
});
