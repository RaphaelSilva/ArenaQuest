import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminEventsController } from '@api/controllers/admin-events.controller';
import { Entities } from '@arenaquest/shared/types/entities';
import type {
  IEventRepository,
  IUserRepository,
  IUserGroupRepository,
  IStorageAdapter,
  CreateEventInput,
  UpdateEventInput,
  ListAdminEventsOptions,
  SetEventFlyerPendingInput,
  StorageObject,
} from '@arenaquest/shared/ports';

/**
 * Business rules of the admin events surface, on pure mocks.
 *
 * The part that matters most here is the flyer trio. `admin-media.controller`
 * finalizes on `objectExists`, which never looks at how many bytes actually
 * landed, so its ceiling is only ever a claim the client made at presign time;
 * this controller re-reads the **stored** size. The two assertions that pin
 * that difference — `rejects a stored object over the ceiling` and `treats a
 * missing object as NotUploaded` — are the point of the task, and neither may
 * be relaxed into "presign rejects a big number".
 */

const CEILING = 5 * 1024 * 1024;
const ADMIN_ID = 'user-admin';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/**
 * An in-memory `IEventRepository`.
 *
 * Written out rather than assembled from `vi.fn()`s because the flyer rules are
 * *state transitions*: `setFlyerPending` has to remember the key it displaced
 * so that `setFlyerReady` can hand it back, and a per-call stub would let a
 * broken controller pass by never exercising that memory.
 */
class FakeEventRepository implements IEventRepository {
  readonly rows = new Map<string, Entities.Events.Event>();
  /** The `flyer_replaced_key` column, which the entity deliberately omits. */
  readonly replacedKeys = new Map<string, string | null>();
  readonly grants = new Map<string, Entities.Events.EventAudienceGrants>();

  // -- reader surface: unused here, and loudly so ---------------------------

  listVisible(): Promise<Entities.Events.Event[]> {
    throw new Error('the admin surface must not use the audience-scoped read');
  }

  countVisible(): Promise<number> {
    throw new Error('the admin surface must not use the audience-scoped read');
  }

  findVisibleBySlug(): Promise<Entities.Events.Event | null> {
    throw new Error('the admin surface must not use the audience-scoped read');
  }

  // -- admin surface ---------------------------------------------------------

  async listAll(opts?: ListAdminEventsOptions): Promise<Entities.Events.Event[]> {
    const all = [...this.rows.values()].filter(e => !opts?.status || e.status === opts.status);
    const offset = opts?.offset ?? 0;
    return all.slice(offset, offset + (opts?.limit ?? 50));
  }

  async countAll(opts?: { status?: Entities.Config.EventStatus }): Promise<number> {
    return [...this.rows.values()].filter(e => !opts?.status || e.status === opts.status).length;
  }

  async findById(id: string): Promise<Entities.Events.Event | null> {
    const row = this.rows.get(id);
    return row ? { ...row, flyer: { ...row.flyer } } : null;
  }

  async findBySlug(slug: string): Promise<Entities.Events.Event | null> {
    return [...this.rows.values()].find(e => e.slug === slug) ?? null;
  }

  async create(data: CreateEventInput): Promise<Entities.Events.Event> {
    const id = data.id ?? `evt-${this.rows.size + 1}`;
    const base = data.slug || data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let slug = base;
    for (let n = 2; await this.findBySlug(slug); n++) slug = `${base}-${n}`;

    const now = new Date('2026-01-01T00:00:00.000Z');
    const row: Entities.Events.Event = {
      id,
      slug,
      title: data.title,
      summary: data.summary ?? '',
      content: data.content ?? '',
      location: data.location ?? '',
      startsAt: data.startsAt,
      endsAt: data.endsAt ?? null,
      timezone: data.timezone ?? 'America/Sao_Paulo',
      status: data.status ?? Entities.Config.EventStatus.DRAFT,
      audience: data.audience ?? Entities.Config.EventAudience.MEMBERS,
      flyer: { status: 'none', key: null, type: null, sizeBytes: null, name: null },
      whatsappNumber: data.whatsappNumber ?? '',
      whatsappMessage: data.whatsappMessage ?? null,
      contactLabel: data.contactLabel ?? '',
      createdBy: data.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(id, row);
    this.replacedKeys.set(id, null);
    return { ...row };
  }

  async update(id: string, data: UpdateEventInput): Promise<Entities.Events.Event> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`no such event: ${id}`);

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined || key === 'endsAt') {
        (row as unknown as Record<string, unknown>)[key] = value;
      }
    }
    row.updatedAt = new Date('2026-02-02T00:00:00.000Z');
    return { ...row };
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  async getAudienceGrants(eventId: string): Promise<Entities.Events.EventAudienceGrants> {
    return this.grants.get(eventId) ?? { groupIds: [], userIds: [] };
  }

  async replaceAudienceGrants(
    eventId: string,
    grants: Entities.Events.EventAudienceGrants,
  ): Promise<void> {
    this.grants.set(eventId, { groupIds: [...grants.groupIds], userIds: [...grants.userIds] });
  }

  async setFlyerPending(eventId: string, flyer: SetEventFlyerPendingInput): Promise<void> {
    const row = this.rows.get(eventId);
    if (!row) return;
    if (row.flyer.status === 'ready' && row.flyer.key) {
      this.replacedKeys.set(eventId, row.flyer.key);
    }
    row.flyer = {
      status: 'pending',
      key: flyer.key,
      type: flyer.type,
      sizeBytes: flyer.sizeBytes,
      name: flyer.name,
    };
  }

  async setFlyerReady(eventId: string, opts?: { sizeBytes?: number }): Promise<string | null> {
    const row = this.rows.get(eventId);
    if (!row) return null;
    const replaced = this.replacedKeys.get(eventId) ?? null;
    row.flyer = {
      ...row.flyer,
      status: 'ready',
      sizeBytes: opts?.sizeBytes ?? row.flyer.sizeBytes,
    };
    this.replacedKeys.set(eventId, null);
    return replaced === null || replaced === row.flyer.key ? null : replaced;
  }

  async clearFlyer(eventId: string): Promise<string | null> {
    const row = this.rows.get(eventId);
    if (!row) return null;
    const key = row.flyer.key;
    row.flyer = { status: 'none', key: null, type: null, sizeBytes: null, name: null };
    this.replacedKeys.set(eventId, null);
    return key;
  }
}

/** Only the four methods this controller may touch are real. */
function fakeStorage(objects: Map<string, number>) {
  return {
    getPresignedUploadUrl: vi.fn(async (key: string) => `https://r2.test/${key}?sig=x`),
    getPresignedDownloadUrl: vi.fn(async (key: string) => `https://r2.test/${key}?get=x`),
    headObject: vi.fn(async (key: string): Promise<StorageObject | null> => {
      const size = objects.get(key);
      return size === undefined ? null : { key, size, lastModified: new Date() };
    }),
    deleteObject: vi.fn(async (key: string) => {
      objects.delete(key);
    }),
  } as unknown as IStorageAdapter & {
    getPresignedUploadUrl: ReturnType<typeof vi.fn>;
    headObject: ReturnType<typeof vi.fn>;
    deleteObject: ReturnType<typeof vi.fn>;
  };
}

function fakeUsers(known: string[]): IUserRepository {
  return {
    findById: vi.fn(async (id: string) => (known.includes(id) ? ({ id } as never) : null)),
  } as unknown as IUserRepository;
}

function fakeGroups(known: string[]): IUserGroupRepository {
  return {
    getById: vi.fn(async (id: string) => (known.includes(id) ? ({ id } as never) : null)),
  } as unknown as IUserGroupRepository;
}

// ---------------------------------------------------------------------------

let repo: FakeEventRepository;
let objects: Map<string, number>;
let storage: ReturnType<typeof fakeStorage>;
let controller: AdminEventsController;

beforeEach(() => {
  repo = new FakeEventRepository();
  objects = new Map<string, number>();
  storage = fakeStorage(objects);
  controller = new AdminEventsController(
    repo,
    storage,
    fakeUsers(['user-a', 'user-b']),
    fakeGroups(['group-a', 'group-b']),
  );
});

async function seed(overrides: Partial<CreateEventInput> = {}): Promise<Entities.Events.Event> {
  return repo.create({
    slug: '',
    title: 'Summer seminar',
    startsAt: new Date('2026-10-10T13:00:00.000Z'),
    createdBy: ADMIN_ID,
    ...overrides,
  });
}

function expectErr(result: { ok: boolean }): { status: number; error: string; meta?: Record<string, unknown> } {
  expect(result.ok).toBe(false);
  return result as never;
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('create', () => {
  it('creates a draft and sanitises the markdown before persisting it', async () => {
    const result = await controller.create(
      {
        title: 'Summer seminar',
        startsAt: '2026-10-10T13:00:00.000Z',
        content: 'Welcome <script>alert(1)</script> everyone',
      },
      ADMIN_ID,
    );

    expect(result.ok).toBe(true);
    const dto = (result as { data: { id: string; status: string; content: string } }).data;
    expect(dto.status).toBe('draft');
    expect(dto.content).not.toContain('<script>');
    // Persisted sanitised, not merely rendered sanitised.
    expect(repo.rows.get(dto.id)!.content).not.toContain('<script>');
  });

  it('honours an explicit slug', async () => {
    const result = await controller.create(
      { title: 'Summer seminar', slug: 'verao-2026', startsAt: '2026-10-10T13:00:00.000Z' },
      ADMIN_ID,
    );
    expect((result as { data: { slug: string } }).data.slug).toBe('verao-2026');
  });

  it('refuses a colliding explicit slug with 409', async () => {
    await seed({ slug: 'verao-2026' });

    const result = await controller.create(
      { title: 'Another one', slug: 'verao-2026', startsAt: '2026-10-10T13:00:00.000Z' },
      ADMIN_ID,
    );

    const err = expectErr(result);
    expect(err.status).toBe(409);
    expect(err.error).toBe('SlugConflict');
  });

  it('accepts an empty WhatsApp number — it means "no button", not "missing"', async () => {
    const omitted = await controller.create(
      { title: 'No number', startsAt: '2026-10-10T13:00:00.000Z' },
      ADMIN_ID,
    );
    const empty = await controller.create(
      { title: 'No number either', startsAt: '2026-10-10T13:00:00.000Z', whatsappNumber: '' },
      ADMIN_ID,
    );

    expect(omitted.ok).toBe(true);
    expect(empty.ok).toBe(true);
    expect((empty as { data: { whatsappNumber: string } }).data.whatsappNumber).toBe('');
  });

  it('normalises a valid WhatsApp number and rejects one that fails the digit rule', async () => {
    const ok = await controller.create(
      {
        title: 'With a number',
        startsAt: '2026-10-10T13:00:00.000Z',
        whatsappNumber: '+55 19 99999-1155',
      },
      ADMIN_ID,
    );
    expect((ok as { data: { whatsappNumber: string } }).data.whatsappNumber).toBe('5519999991155');

    const bad = await controller.create(
      { title: 'Broken number', startsAt: '2026-10-10T13:00:00.000Z', whatsappNumber: '12345' },
      ADMIN_ID,
    );
    const err = expectErr(bad);
    expect(err.status).toBe(400);
    expect(err.meta?.field).toBe('whatsappNumber');
  });

  it('rejects an unparseable instant', async () => {
    const result = await controller.create({ title: 'When?', startsAt: 'yesterday' }, ADMIN_ID);
    expect(expectErr(result).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('update', () => {
  it('leaves the slug alone when the title changes', async () => {
    const event = await seed({ slug: 'verao-2026', title: 'Summer seminar' });

    const result = await controller.update(event.id, { title: 'Summer seminar 2026 (new date)' });

    const dto = (result as { data: { slug: string; title: string } }).data;
    expect(dto.slug).toBe('verao-2026');
    expect(dto.title).toBe('Summer seminar 2026 (new date)');
  });

  it('moves the slug when one is named explicitly, and 409s on a collision', async () => {
    const first = await seed({ slug: 'verao-2026' });
    await seed({ slug: 'inverno-2026', title: 'Winter' });

    const moved = await controller.update(first.id, { slug: 'verao-2026-remarcado' });
    expect((moved as { data: { slug: string } }).data.slug).toBe('verao-2026-remarcado');

    const clash = await controller.update(first.id, { slug: 'inverno-2026' });
    expect(expectErr(clash).status).toBe(409);
  });

  it('accepts its own slug as a no-op rather than colliding with itself', async () => {
    const event = await seed({ slug: 'verao-2026' });
    const result = await controller.update(event.id, { slug: 'verao-2026' });
    expect(result.ok).toBe(true);
  });

  it('archives and un-archives through the status field', async () => {
    const event = await seed({ status: Entities.Config.EventStatus.PUBLISHED });

    const archived = await controller.update(event.id, { status: 'archived' });
    expect((archived as { data: { status: string } }).data.status).toBe('archived');

    const restored = await controller.update(event.id, { status: 'published' });
    expect((restored as { data: { status: string } }).data.status).toBe('published');
  });

  it('rejects an invalid WhatsApp number and accepts clearing it', async () => {
    const event = await seed({ whatsappNumber: '5519999991155' });

    expect(expectErr(await controller.update(event.id, { whatsappNumber: '123' })).status).toBe(400);

    const cleared = await controller.update(event.id, { whatsappNumber: '' });
    expect((cleared as { data: { whatsappNumber: string } }).data.whatsappNumber).toBe('');
  });

  it('404s an unknown event', async () => {
    expect(expectErr(await controller.update('nope', { title: 'x' })).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// audience
// ---------------------------------------------------------------------------

describe('replaceAudience', () => {
  it('replaces the whole set, revoking whoever is absent from the payload', async () => {
    const event = await seed({ audience: Entities.Config.EventAudience.RESTRICTED });
    await controller.replaceAudience(event.id, { groupIds: ['group-a', 'group-b'], userIds: ['user-a'] });

    const result = await controller.replaceAudience(event.id, { groupIds: ['group-b'], userIds: [] });

    expect((result as { data: unknown }).data).toEqual({ groupIds: ['group-b'], userIds: [] });
    expect(await repo.getAudienceGrants(event.id)).toEqual({ groupIds: ['group-b'], userIds: [] });
  });

  it('refuses an unknown group or user with 422 and names it', async () => {
    const event = await seed();

    const err = expectErr(
      await controller.replaceAudience(event.id, {
        groupIds: ['group-a', 'ghost-group'],
        userIds: ['ghost-user'],
      }),
    );

    expect(err.status).toBe(422);
    expect(err.error).toBe('UnknownAudienceTarget');
    expect(err.meta).toEqual({ groupIds: ['ghost-group'], userIds: ['ghost-user'] });
    // Nothing was written: a rejected set must not be half-applied.
    expect(repo.grants.has(event.id)).toBe(false);
  });

  it('404s an unknown event', async () => {
    const err = expectErr(await controller.replaceAudience('nope', { groupIds: [], userIds: [] }));
    expect(err.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// flyer — presign
// ---------------------------------------------------------------------------

describe('presignFlyer', () => {
  it('signs the upload URL against the declared size, never against the ceiling', async () => {
    const event = await seed();

    await controller.presignFlyer(event.id, {
      fileName: 'flyer.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1024,
    });

    const [, options] = storage.getPresignedUploadUrl.mock.calls[0] as [string, { maxSizeBytes: number }];
    // `maxSizeBytes` becomes R2's `ContentLength`, which the presigner *signs*
    // rather than treating as an upper bound. Signing with the ceiling would
    // pin every flyer PUT to exactly 5 MB and make the endpoint unusable; the
    // ceiling is enforced at finalize, against the bytes that actually landed.
    expect(options.maxSizeBytes).toBe(1024);
    expect(options.maxSizeBytes).not.toBe(CEILING);
  });

  it('rejects a 6 MB JPEG with 422 FileTooLarge and reports the ceiling', async () => {
    const event = await seed();

    const err = expectErr(
      await controller.presignFlyer(event.id, {
        fileName: 'huge.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 6 * 1024 * 1024,
      }),
    );

    expect(err.status).toBe(422);
    expect(err.error).toBe('FileTooLarge');
    expect(err.meta?.maxBytes).toBe(CEILING);
    expect(storage.getPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects a non-image type — a flyer is an image and nothing else', async () => {
    const event = await seed();

    const err = expectErr(
      await controller.presignFlyer(event.id, {
        fileName: 'programme.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
      }),
    );

    expect(err.status).toBe(422);
    expect(err.error).toBe('UnsupportedMediaType');
    expect(storage.getPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it('marks the flyer pending under a fresh key', async () => {
    const event = await seed();

    const result = await controller.presignFlyer(event.id, {
      fileName: 'Flyer Final.JPG',
      contentType: 'image/jpeg',
      sizeBytes: 2048,
    });

    const data = (result as { data: { uploadUrl: string; flyer: { status: string; key: string } } }).data;
    expect(data.flyer.status).toBe('pending');
    expect(data.flyer.key).toMatch(new RegExp(`^events/${event.id}/flyer-`));
    expect(data.uploadUrl).toContain(data.flyer.key);
  });

  it('404s an unknown event', async () => {
    const err = expectErr(
      await controller.presignFlyer('nope', {
        fileName: 'f.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 10,
      }),
    );
    expect(err.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// flyer — finalize
// ---------------------------------------------------------------------------

/** Presign, then place `storedBytes` in the fake bucket under the signed key. */
async function presignAndStore(eventId: string, storedBytes: number | null, declared = 1024) {
  const presign = await controller.presignFlyer(eventId, {
    fileName: 'flyer.jpg',
    contentType: 'image/jpeg',
    sizeBytes: declared,
  });
  const key = (presign as { data: { flyer: { key: string } } }).data.flyer.key;
  if (storedBytes !== null) objects.set(key, storedBytes);
  return key;
}

describe('finalizeFlyer', () => {
  it('rejects a client that declared 1 KB and stored 50 MB: 422, object deleted, still pending', async () => {
    const event = await seed();
    const key = await presignAndStore(event.id, 50 * 1024 * 1024, 1024);

    const err = expectErr(await controller.finalizeFlyer(event.id));

    expect(err.status).toBe(422);
    expect(err.error).toBe('FileTooLarge');
    expect(err.meta?.storedBytes).toBe(50 * 1024 * 1024);
    // The bytes are gone…
    expect(storage.deleteObject).toHaveBeenCalledWith(key);
    expect(objects.has(key)).toBe(false);
    // …and the row never advanced.
    expect(repo.rows.get(event.id)!.flyer.status).toBe('pending');
  });

  it('treats a missing object as NotUploaded — a distinct code from over-ceiling', async () => {
    const event = await seed();
    await presignAndStore(event.id, null);

    const err = expectErr(await controller.finalizeFlyer(event.id));

    expect(err.status).toBe(422);
    expect(err.error).toBe('NotUploaded');
    // Nothing was deleted: there was nothing there, and the row stays pending
    // so the client can retry the PUT against the same key.
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(repo.rows.get(event.id)!.flyer.status).toBe('pending');
  });

  it('flips to ready and records the size that was actually stored', async () => {
    const event = await seed();
    await presignAndStore(event.id, 4096, 1024);

    const result = await controller.finalizeFlyer(event.id);

    const flyer = (result as { data: { flyer: { status: string; sizeBytes: number } } }).data.flyer;
    expect(flyer.status).toBe('ready');
    expect(flyer.sizeBytes).toBe(4096);
  });

  it('refuses a finalize with no pending flyer', async () => {
    const event = await seed();

    const err = expectErr(await controller.finalizeFlyer(event.id));
    expect(err.status).toBe(422);
    expect(err.error).toBe('NoPendingFlyer');
  });

  it('is idempotent once the flyer is ready', async () => {
    const event = await seed();
    await presignAndStore(event.id, 4096);
    await controller.finalizeFlyer(event.id);

    const again = await controller.finalizeFlyer(event.id);
    expect(again.ok).toBe(true);
  });

  it('deletes the previously-ready object on a second successful finalize', async () => {
    const event = await seed();
    const firstKey = await presignAndStore(event.id, 4096);
    await controller.finalizeFlyer(event.id);

    const secondKey = await presignAndStore(event.id, 8192);
    expect(secondKey).not.toBe(firstKey);
    await controller.finalizeFlyer(event.id);

    // The displaced object is gone; the new one is untouched.
    expect(storage.deleteObject).toHaveBeenCalledWith(firstKey);
    expect(objects.has(firstKey)).toBe(false);
    expect(objects.has(secondKey)).toBe(true);
    expect(repo.rows.get(event.id)!.flyer.key).toBe(secondKey);
  });

  it('still succeeds when deleting the displaced object fails', async () => {
    const event = await seed();
    await presignAndStore(event.id, 4096);
    await controller.finalizeFlyer(event.id);
    await presignAndStore(event.id, 8192);

    storage.deleteObject.mockRejectedValueOnce(new Error('R2 is having a day'));
    const result = await controller.finalizeFlyer(event.id);

    // The row is already correct; an orphan in the bucket is not the caller's
    // problem and must not be reported as a failed write.
    expect(result.ok).toBe(true);
    expect(repo.rows.get(event.id)!.flyer.status).toBe('ready');
  });

  it('404s an unknown event', async () => {
    expect(expectErr(await controller.finalizeFlyer('nope')).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// flyer — delete
// ---------------------------------------------------------------------------

describe('deleteFlyer', () => {
  it('clears the columns and removes the object', async () => {
    const event = await seed();
    const key = await presignAndStore(event.id, 4096);
    await controller.finalizeFlyer(event.id);

    const result = await controller.deleteFlyer(event.id);

    expect(result.ok).toBe(true);
    expect(storage.deleteObject).toHaveBeenCalledWith(key);
    expect(repo.rows.get(event.id)!.flyer.status).toBe('none');
  });

  it('404s an unknown event', async () => {
    expect(expectErr(await controller.deleteFlyer('nope')).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('list', () => {
  it('returns drafts and archived events alongside published ones', async () => {
    await seed({ title: 'Draft one' });
    await seed({ title: 'Published one', status: Entities.Config.EventStatus.PUBLISHED });
    await seed({ title: 'Archived one', status: Entities.Config.EventStatus.ARCHIVED });

    const result = await controller.list({ limit: 50, offset: 0 });

    const data = (result as { data: { data: { status: string }[]; total: number } }).data;
    expect(data.total).toBe(3);
    expect(data.data.map(e => e.status).sort()).toEqual(['archived', 'draft', 'published']);
  });

  it('filters by status', async () => {
    await seed({ title: 'Draft one' });
    await seed({ title: 'Archived one', status: Entities.Config.EventStatus.ARCHIVED });

    const result = await controller.list({ status: 'archived', limit: 50, offset: 0 });
    const data = (result as { data: { data: { title: string }[] } }).data;
    expect(data.data.map(e => e.title)).toEqual(['Archived one']);
  });

  it('materialises the grant set for a restricted event only', async () => {
    const restricted = await seed({
      title: 'Restricted',
      audience: Entities.Config.EventAudience.RESTRICTED,
    });
    await controller.replaceAudience(restricted.id, { groupIds: ['group-a'], userIds: [] });
    await seed({ title: 'Members', audience: Entities.Config.EventAudience.MEMBERS });

    const result = await controller.list({ limit: 50, offset: 0 });
    const rows = (result as {
      data: { data: { audience: string; audienceGrants?: { groupIds: string[] } }[] };
    }).data.data;

    expect(rows.find(r => r.audience === 'restricted')!.audienceGrants).toEqual({
      groupIds: ['group-a'],
      userIds: [],
    });
    expect(rows.find(r => r.audience === 'members')!.audienceGrants).toBeUndefined();
  });
});
