import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventsController, resolveContact } from '@api/controllers/events.controller';
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

  it('returns the stored message verbatim — byte for byte, unwrapped', () => {
    // Not `toContain`: the assertion is equality, because anything the API added
    // around the admin's sentence would be text in a language it cannot know.
    const stored = 'Hi! About the seminar on the 10th — is there space left?';
    const contact = resolveContact(
      makeEvent({ whatsappNumber: '5519999991155', whatsappMessage: stored }),
    );

    expect(contact?.message).toBe(stored);
  });

  it('yields an empty message for a null column — the server composes nothing', () => {
    // RFC 0014 §5 as amended 2026-09-22: an empty column means the button opens
    // a chat with no pre-filled text. It is not an invitation to invent one.
    const contact = resolveContact(
      makeEvent({ whatsappNumber: '5519999991155', whatsappMessage: null }),
    );

    expect(contact).not.toBeNull();
    expect(contact?.message).toBe('');
  });

  it('serialises the empty message as a present "" rather than omitting the key', () => {
    // The web client calls `whatsappLink(number, message)` unconditionally; a
    // required string means no `?? ''` at the call site and one shape to render.
    const contact = resolveContact(
      makeEvent({ whatsappNumber: '5519999991155', whatsappMessage: null }),
    );

    expect(contact).toHaveProperty('message');
    expect(JSON.parse(JSON.stringify(contact))).toHaveProperty('message', '');
  });

  it('normalises a whitespace-only stored message to the same empty string', () => {
    const contact = resolveContact(
      makeEvent({ whatsappNumber: '5519999991155', whatsappMessage: '   ' }),
    );

    expect(contact?.message).toBe('');
  });

  it('keeps contact non-null when the number is set but the message is not', () => {
    // The suppression rule keys on the NUMBER alone; a numbered event with no
    // message is a valid call-to-action, not a missing one.
    const contact = resolveContact(
      makeEvent({ whatsappNumber: '5519999991155', whatsappMessage: '' }),
    );

    expect(contact).toEqual({ number: '5519999991155', message: '', label: '' });
  });

  it('does NOT follow a rename: the stored text is owned by the admin', () => {
    // The inverse of the behaviour this controller shipped with. Staleness after
    // a rename is now a visible edit in the admin form rather than a silent
    // server default that could only ever be written in one language.
    const stored = 'Interested in the winter camp';
    const before = resolveContact(
      makeEvent({ whatsappNumber: '5519999991155', title: 'Winter camp', whatsappMessage: stored }),
    );
    const after = resolveContact(
      makeEvent({
        whatsappNumber: '5519999991155',
        title: 'Winter camp 2026 — now in March',
        whatsappMessage: stored,
      }),
    );

    expect(after?.message).toBe(before?.message);
    expect(after?.message).toBe(stored);
  });

  it('ignores the title, the start instant and the timezone entirely', () => {
    // A zone the runtime would reject used to matter, because the composition
    // formatted a date with it. Nothing on the contact path reads it now, so a
    // malformed IANA string cannot reach a formatter at all.
    const contact = resolveContact(
      makeEvent({
        whatsappNumber: '5519999991155',
        title: 'Anything at all',
        startsAt: new Date('2026-10-11T00:30:00.000Z'),
        timezone: 'Not/AZone',
      }),
    );

    expect(contact).toEqual({ number: '5519999991155', message: '', label: '' });
  });

  it('adds no characters of its own to a contact built from ASCII-only columns', () => {
    // The black-box half of the guard below: given input the API could only make
    // non-ASCII by contributing copy, the output stays ASCII.
    const contact = resolveContact(
      makeEvent({ whatsappNumber: '5519999991155', whatsappMessage: 'Plain ASCII', contactLabel: '' }),
    );

    expect(JSON.stringify(contact)).toMatch(/^[\x00-\x7F]*$/);
  });

  it('passes the label through as stored, empty string included', () => {
    expect(resolveContact(makeEvent({ whatsappNumber: '5519999991155' }))?.label).toBe('');
    expect(
      resolveContact(makeEvent({ whatsappNumber: '5519999991155', contactLabel: 'Eu quero' }))?.label,
    ).toBe('Eu quero');
  });

  it('defines no user-facing literal in any language anywhere in the controller', () => {
    // The white-box half. A behavioural test can only catch copy on the paths it
    // exercises; this catches a helper someone adds next year and calls from one
    // branch. Comments are stripped first — prose is allowed to contain an em
    // dash or an accent; executable code on this surface is not allowed to
    // contain a sentence. The controller has no regex or URL literals, so the
    // naive strip is safe here.
    const source = readFileSync(
      new URL('../../src/controllers/events.controller.ts', import.meta.url),
      'utf8',
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    const nonAscii = code.match(/[^\x00-\x7F]/g);
    expect(nonAscii ?? []).toEqual([]);
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
