import type {
  IEventRepository,
  IStorageAdapter,
  IUserRepository,
  IUserGroupRepository,
  CreateEventInput,
  UpdateEventInput,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { normalizeWhatsapp } from '@arenaquest/shared/domain/contact/whatsapp';
import { sanitizeMarkdown } from '@arenaquest/shared/utils/sanitize-markdown';
import {
  IMAGE_MEDIA_TYPES,
  MEDIA_SIZE_LIMIT_BYTES,
  isImageMediaType,
  mediaSizeLimitFor,
} from '@arenaquest/shared/domain/media/limits';
import { sanitizeFileName } from '@api/controllers/admin-media.controller';
import type { ControllerResult } from '@api/core/result';

/**
 * The admin authoring surface of the events board (RFC 0014, Milestone 20
 * Task 04).
 *
 * Three things distinguish it from the topic admin surface it otherwise
 * mirrors:
 *
 * 1. **There is no hard delete.** Removal is `status: 'archived'`, which is
 *    reversible and keeps the row and its flyer object together. A `delete`
 *    method deliberately does not exist here even though the port exposes one.
 * 2. **The slug is immutable on rename.** `update` forwards `slug` only when a
 *    caller names one, so a title change never re-derives it and a link already
 *    circulating in a WhatsApp group keeps resolving.
 * 3. **The flyer ceiling is enforced against stored bytes.** See
 *    {@link AdminEventsController.finalizeFlyer} — the topic path checks only
 *    that the key exists, which makes its ceiling a client-side suggestion.
 *
 * The publish gate is **not** here: `status → published` is an authorisation
 * rule about the caller, and it lives on the route as its own `requireRole`,
 * mirroring `routes/admin/billing.ts`. This controller is handed a transition
 * that has already been authorised.
 */

// ---------------------------------------------------------------------------
// Flyer limits
// ---------------------------------------------------------------------------

/**
 * The flyer ceiling, taken from the shared table rather than re-declared.
 *
 * Every image type in `IMAGE_MEDIA_TYPES` carries the same 5 MB ceiling today;
 * the lookup is per type anyway so that a future divergence in the shared table
 * is honoured here without an edit.
 */
function flyerCeilingFor(contentType: string): number {
  return mediaSizeLimitFor(contentType) ?? MEDIA_SIZE_LIMIT_BYTES['image/jpeg'];
}

/** Presigned upload and download URLs both live one hour, as topic media does. */
const FLYER_URL_TTL_SECONDS = 3600;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface AdminEventFlyerDto {
  status: Entities.Events.EventFlyerStatus;
  key: string | null;
  type: string | null;
  sizeBytes: number | null;
  name: string | null;
}

export interface AdminEventDto {
  id: string;
  slug: string;
  title: string;
  summary: string;
  /** Markdown, sanitised before it was persisted. */
  content: string;
  location: string;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  status: Entities.Config.EventStatus;
  audience: Entities.Config.EventAudience;
  flyer: AdminEventFlyerDto;
  whatsappNumber: string;
  whatsappMessage: string | null;
  contactLabel: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Present only for a `restricted` event — the audience it is addressed to.
   *
   * Resolved per event, so it is materialised for the restricted slice of a
   * page and nothing else: a board whose events are mostly `public` pays one
   * extra pair of reads for none of them.
   */
  audienceGrants?: Entities.Events.EventAudienceGrants;
}

export interface AdminEventListDto {
  data: AdminEventDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface FlyerPresignDto {
  uploadUrl: string;
  /** Seconds the upload URL stays valid. */
  expiresInSeconds: number;
  /** The ceiling the URL was signed against, in bytes. */
  maxBytes: number;
  flyer: AdminEventFlyerDto;
}

// ---------------------------------------------------------------------------
// Inputs (shapes the route's Zod schemas produce)
// ---------------------------------------------------------------------------

/**
 * The wire spellings of the two enums.
 *
 * The route's Zod schemas produce string literals, and the entity enums are
 * TypeScript `enum`s whose members are those same literals. Typing the inputs
 * this way lets the router hand its validated payload straight over, and the
 * single `as` where each one reaches the port is a spelling change rather than
 * a widening.
 */
type EventStatusValue = `${Entities.Config.EventStatus}`;
type EventAudienceValue = `${Entities.Config.EventAudience}`;

/**
 * Wire spelling to enum member, written out rather than asserted.
 *
 * `'draft' as Entities.Config.EventStatus` would compile for any string the
 * union ever grows, which is precisely the mismatch worth catching: a value
 * added to the Zod schema and not to the entity enum (or the reverse) has to
 * fail here, at the one place the two vocabularies meet. An exhaustive
 * `Record` over the union makes that a compile error instead of a silent pass.
 */
const EVENT_STATUS_BY_VALUE: Readonly<Record<EventStatusValue, Entities.Config.EventStatus>> = {
  draft: Entities.Config.EventStatus.DRAFT,
  published: Entities.Config.EventStatus.PUBLISHED,
  archived: Entities.Config.EventStatus.ARCHIVED,
};

const EVENT_AUDIENCE_BY_VALUE: Readonly<
  Record<EventAudienceValue, Entities.Config.EventAudience>
> = {
  public: Entities.Config.EventAudience.PUBLIC,
  members: Entities.Config.EventAudience.MEMBERS,
  restricted: Entities.Config.EventAudience.RESTRICTED,
};

export interface CreateEventBody {
  title: string;
  /** Optional; omitted means "derive it from the title, once". */
  slug?: string;
  summary?: string;
  content?: string;
  location?: string;
  /** ISO-8601 instant. */
  startsAt: string;
  endsAt?: string | null;
  timezone?: string;
  audience?: EventAudienceValue;
  whatsappNumber?: string;
  whatsappMessage?: string | null;
  contactLabel?: string;
}

export interface UpdateEventBody {
  title?: string;
  slug?: string;
  summary?: string;
  content?: string;
  location?: string;
  startsAt?: string;
  endsAt?: string | null;
  timezone?: string;
  status?: EventStatusValue;
  audience?: EventAudienceValue;
  whatsappNumber?: string;
  whatsappMessage?: string | null;
  contactLabel?: string;
}

export interface FlyerPresignBody {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface ListAdminEventsQuery {
  status?: EventStatusValue;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Small result helpers
// ---------------------------------------------------------------------------

function notFound<T>(detail: string): ControllerResult<T> {
  return { ok: false, status: 404, error: 'NotFound', meta: { detail } };
}

function invalid<T>(field: string, detail: string): ControllerResult<T> {
  return { ok: false, status: 400, error: 'ValidationError', meta: { field, detail } };
}

// ---------------------------------------------------------------------------

export class AdminEventsController {
  constructor(
    private readonly events: IEventRepository,
    private readonly storage: IStorageAdapter,
    private readonly users: IUserRepository,
    private readonly groups: IUserGroupRepository,
  ) {}

  // -- reads -----------------------------------------------------------------

  /**
   * The admin board: drafts, published and archived alike.
   *
   * Deliberately not `listVisible`: an author has to see what a reader cannot,
   * and the audience rule that `listVisible` enforces would hide exactly the
   * rows this screen exists to manage.
   */
  async list(query: ListAdminEventsQuery): Promise<ControllerResult<AdminEventListDto>> {
    const { status, limit, offset } = query;

    const filter = status === undefined ? undefined : EVENT_STATUS_BY_VALUE[status];

    const [events, total] = await Promise.all([
      this.events.listAll({ status: filter, limit, offset }),
      this.events.countAll({ status: filter }),
    ]);

    const data = await Promise.all(events.map(event => this.toDto(event)));

    return { ok: true, data: { data, total, limit, offset } };
  }

  // -- writes ----------------------------------------------------------------

  /**
   * Creates a **draft**, always.
   *
   * `status` is not an accepted field: the `status → published` transition is
   * guarded on the `PATCH` path, and a `status` honoured here would be a way
   * around that guard rather than a convenience. Publishing is a second call,
   * by an admin.
   */
  async create(body: CreateEventBody, createdBy: string): Promise<ControllerResult<AdminEventDto>> {
    const startsAt = parseInstant(body.startsAt);
    if (!startsAt) return invalid('startsAt', 'must be an ISO-8601 instant');

    const endsAt = body.endsAt == null ? null : parseInstant(body.endsAt);
    if (body.endsAt != null && !endsAt) return invalid('endsAt', 'must be an ISO-8601 instant');
    if (endsAt && endsAt.getTime() < startsAt.getTime()) {
      return invalid('endsAt', 'must not precede startsAt');
    }

    const whatsapp = resolveWhatsappNumber(body.whatsappNumber);
    if (!whatsapp.ok) return invalid('whatsappNumber', whatsapp.detail);

    // An explicit slug is the caller's to own, collision included. An omitted
    // one is handed to the repository as '' so that derivation and the
    // uniqueness ladder stay in the single place that owns them.
    const explicitSlug = body.slug?.trim() ?? '';
    if (explicitSlug) {
      const taken = await this.events.findBySlug(explicitSlug);
      if (taken) return slugConflict(explicitSlug);
    }

    const input: CreateEventInput = {
      slug: explicitSlug,
      title: body.title,
      summary: body.summary,
      // Sanitised on the way in, not only on the way out: what is persisted is
      // what a later consumer — an OpenGraph render, an export — will trust.
      content: body.content === undefined ? undefined : sanitizeMarkdown(body.content),
      location: body.location,
      startsAt,
      endsAt,
      timezone: body.timezone,
      status: Entities.Config.EventStatus.DRAFT,
      audience: body.audience === undefined ? undefined : EVENT_AUDIENCE_BY_VALUE[body.audience],
      whatsappNumber: whatsapp.value,
      whatsappMessage: body.whatsappMessage,
      contactLabel: body.contactLabel,
      createdBy,
    };

    const created = await this.events.create(input);
    return { ok: true, data: await this.toDto(created) };
  }

  /**
   * Patches an event, including its status transitions.
   *
   * A title change does **not** move the slug — `slug` reaches the repository
   * only when the caller names one, and `UpdateEventInput` leaves an omitted
   * key untouched. That is the whole of the "slug is immutable on rename" rule.
   */
  async update(id: string, body: UpdateEventBody): Promise<ControllerResult<AdminEventDto>> {
    const event = await this.events.findById(id);
    if (!event) return notFound('event not found');

    const patch: UpdateEventInput = {};

    if (body.startsAt !== undefined) {
      const startsAt = parseInstant(body.startsAt);
      if (!startsAt) return invalid('startsAt', 'must be an ISO-8601 instant');
      patch.startsAt = startsAt;
    }

    if (body.endsAt !== undefined) {
      if (body.endsAt === null) {
        patch.endsAt = null;
      } else {
        const endsAt = parseInstant(body.endsAt);
        if (!endsAt) return invalid('endsAt', 'must be an ISO-8601 instant');
        patch.endsAt = endsAt;
      }
    }

    const effectiveStart = patch.startsAt ?? event.startsAt;
    const effectiveEnd = patch.endsAt !== undefined ? patch.endsAt : event.endsAt;
    if (effectiveEnd && effectiveEnd.getTime() < effectiveStart.getTime()) {
      return invalid('endsAt', 'must not precede startsAt');
    }

    if (body.whatsappNumber !== undefined) {
      const whatsapp = resolveWhatsappNumber(body.whatsappNumber);
      if (!whatsapp.ok) return invalid('whatsappNumber', whatsapp.detail);
      patch.whatsappNumber = whatsapp.value;
    }

    if (body.slug !== undefined) {
      const slug = body.slug.trim();
      if (!slug) return invalid('slug', 'must not be empty');
      if (slug !== event.slug) {
        const taken = await this.events.findBySlug(slug);
        if (taken && taken.id !== id) return slugConflict(slug);
        patch.slug = slug;
      }
    }

    if (body.title !== undefined) patch.title = body.title;
    if (body.summary !== undefined) patch.summary = body.summary;
    if (body.content !== undefined) patch.content = sanitizeMarkdown(body.content);
    if (body.location !== undefined) patch.location = body.location;
    if (body.timezone !== undefined) patch.timezone = body.timezone;
    if (body.status !== undefined) patch.status = EVENT_STATUS_BY_VALUE[body.status];
    if (body.audience !== undefined) {
      patch.audience = EVENT_AUDIENCE_BY_VALUE[body.audience];
    }
    if (body.whatsappMessage !== undefined) patch.whatsappMessage = body.whatsappMessage;
    if (body.contactLabel !== undefined) patch.contactLabel = body.contactLabel;

    const updated = await this.events.update(id, patch);
    return { ok: true, data: await this.toDto(updated) };
  }

  // -- audience --------------------------------------------------------------

  /**
   * Replaces the whole grant set.
   *
   * Whole-set rather than additive, so a group removed from the payload loses
   * its grant. Every id is verified first: the join tables carry foreign keys,
   * and an unknown id would otherwise surface as a 500 from D1 instead of as
   * the caller's mistake.
   */
  async replaceAudience(
    id: string,
    grants: Entities.Events.EventAudienceGrants,
  ): Promise<ControllerResult<Entities.Events.EventAudienceGrants>> {
    const event = await this.events.findById(id);
    if (!event) return notFound('event not found');

    const groupIds = unique(grants.groupIds);
    const userIds = unique(grants.userIds);

    const [missingGroups, missingUsers] = await Promise.all([
      filterAsync(groupIds, async groupId => (await this.groups.getById(groupId)) === null),
      filterAsync(userIds, async userId => (await this.users.findById(userId)) === null),
    ]);

    if (missingGroups.length > 0 || missingUsers.length > 0) {
      return {
        ok: false,
        status: 422,
        error: 'UnknownAudienceTarget',
        meta: { groupIds: missingGroups, userIds: missingUsers },
      };
    }

    await this.events.replaceAudienceGrants(id, { groupIds, userIds });
    return { ok: true, data: { groupIds, userIds } };
  }

  // -- flyer -----------------------------------------------------------------

  /**
   * Authorises one flyer upload.
   *
   * The key is fresh on every presign, so a replacement never writes over the
   * object a reader is currently being redirected to; `setFlyerPending`
   * remembers the displaced key and `finalizeFlyer` deletes it once the new
   * bytes are confirmed.
   */
  async presignFlyer(
    id: string,
    body: FlyerPresignBody,
  ): Promise<ControllerResult<FlyerPresignDto>> {
    const event = await this.events.findById(id);
    if (!event) return notFound('event not found');

    // A flyer is an image and nothing else (RFC 0014 §3). The route's schema
    // admits every type the upload lifecycle knows, and this is where the
    // narrower rule is stated, so "flyers are images" is a domain rule with a
    // domain error rather than a schema artefact.
    if (!isImageMediaType(body.contentType)) {
      return {
        ok: false,
        status: 422,
        error: 'UnsupportedMediaType',
        meta: {
          detail: 'an event flyer must be an image',
          allowed: [...IMAGE_MEDIA_TYPES],
        },
      };
    }

    const maxBytes = flyerCeilingFor(body.contentType);
    if (body.sizeBytes > maxBytes) {
      return {
        ok: false,
        status: 422,
        error: 'FileTooLarge',
        meta: {
          detail: `${body.contentType} files must be ≤ ${maxBytes / (1024 * 1024)} MB`,
          maxBytes,
        },
      };
    }

    const key = `events/${id}/flyer-${crypto.randomUUID()}-${sanitizeFileName(body.fileName)}`;

    // Signed against **the ceiling**, not against `body.sizeBytes`. The declared
    // size is a claim by the client and must not become the bound the signature
    // carries: whoever "tightens" this back to the declared size reopens the
    // hole the topic path still has. The size that is actually enforced is the
    // stored one, re-read in `finalizeFlyer`.
    const uploadUrl = await this.storage.getPresignedUploadUrl(key, {
      expiresInSeconds: FLYER_URL_TTL_SECONDS,
      contentType: body.contentType,
      maxSizeBytes: maxBytes,
    });

    await this.events.setFlyerPending(id, {
      key,
      type: body.contentType,
      sizeBytes: body.sizeBytes,
      name: body.fileName,
    });

    return {
      ok: true,
      data: {
        uploadUrl,
        expiresInSeconds: FLYER_URL_TTL_SECONDS,
        maxBytes,
        flyer: {
          status: 'pending',
          key,
          type: body.contentType,
          sizeBytes: body.sizeBytes,
          name: body.fileName,
        },
      },
    };
  }

  /**
   * Confirms an upload — and this is where the ceiling becomes real.
   *
   * `headObject` reads the size of the object that actually landed and compares
   * **that** against the ceiling. The topic path asserts only that the key
   * exists, which leaves its own limit as a client-side suggestion; an event
   * flyer over the ceiling is deleted and the row is left `pending`, so a
   * retry is the only way forward and nothing half-accepted is ever served.
   *
   * A `null` head is a distinct outcome from an oversize one: it means the
   * `PUT` never landed, and the caller's fix is to upload rather than to
   * shrink.
   */
  async finalizeFlyer(id: string): Promise<ControllerResult<AdminEventDto>> {
    const event = await this.events.findById(id);
    if (!event) return notFound('event not found');

    // Idempotent: a repeated finalize on an already-confirmed flyer is the
    // client retrying a lost response, not an error.
    if (event.flyer.status === 'ready') {
      return { ok: true, data: await this.toDto(event) };
    }

    if (event.flyer.status !== 'pending' || !event.flyer.key) {
      return {
        ok: false,
        status: 422,
        error: 'NoPendingFlyer',
        meta: { detail: 'request a presigned upload first' },
      };
    }

    const key = event.flyer.key;
    const stored = await this.storage.headObject(key);
    if (!stored) {
      return {
        ok: false,
        status: 422,
        error: 'NotUploaded',
        meta: { detail: 'object not found in storage; complete the upload first' },
      };
    }

    const maxBytes = flyerCeilingFor(event.flyer.type ?? 'image/jpeg');
    if (stored.size > maxBytes) {
      // The object is removed and the row stays `pending`: a rejected upload
      // must leave neither bytes in the bucket nor a half-accepted state that
      // a later finalize could wave through.
      await this.storage.deleteObject(key).catch(logStorageFailure('delete oversize flyer', key));
      return {
        ok: false,
        status: 422,
        error: 'FileTooLarge',
        meta: {
          detail: `the stored object is ${stored.size} bytes; the ceiling is ${maxBytes}`,
          maxBytes,
          storedBytes: stored.size,
        },
      };
    }

    // Order matters: the row is flipped to `ready` first, and only then is the
    // displaced object deleted. The reverse order would destroy a live flyer
    // whenever the update failed, and a delete that fails here leaves an orphan
    // rather than a wrong answer — so it is logged, never raised.
    const displacedKey = await this.events.setFlyerReady(id, { sizeBytes: stored.size });
    if (displacedKey && displacedKey !== key) {
      await this.storage
        .deleteObject(displacedKey)
        .catch(logStorageFailure('delete replaced flyer', displacedKey));
    }

    const updated = await this.events.findById(id);
    if (!updated) return notFound('event not found');
    return { ok: true, data: await this.toDto(updated) };
  }

  /**
   * Removes the flyer, object included.
   *
   * The row is cleared before the object is deleted, for the same reason the
   * media path clears first: a failed delete leaves an unreferenced object,
   * while a failed update would leave a reference to nothing.
   */
  async deleteFlyer(id: string): Promise<ControllerResult<null>> {
    const event = await this.events.findById(id);
    if (!event) return notFound('event not found');

    const key = await this.events.clearFlyer(id);
    if (key) {
      await this.storage.deleteObject(key).catch(logStorageFailure('delete flyer', key));
    }

    return { ok: true, data: null };
  }

  // -- mapping ---------------------------------------------------------------

  private async toDto(event: Entities.Events.Event): Promise<AdminEventDto> {
    const dto: AdminEventDto = {
      id: event.id,
      slug: event.slug,
      title: event.title,
      summary: event.summary,
      content: event.content,
      location: event.location,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt === null ? null : event.endsAt.toISOString(),
      timezone: event.timezone,
      status: event.status,
      audience: event.audience,
      flyer: {
        status: event.flyer.status,
        key: event.flyer.key,
        type: event.flyer.type,
        sizeBytes: event.flyer.sizeBytes,
        name: event.flyer.name,
      },
      whatsappNumber: event.whatsappNumber,
      whatsappMessage: event.whatsappMessage,
      contactLabel: event.contactLabel,
      createdBy: event.createdBy,
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
    };

    if (event.audience === Entities.Config.EventAudience.RESTRICTED) {
      dto.audienceGrants = await this.events.getAudienceGrants(event.id);
    }

    return dto;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugConflict<T>(slug: string): ControllerResult<T> {
  return {
    ok: false,
    status: 409,
    error: 'SlugConflict',
    meta: { detail: `the slug "${slug}" is already taken`, slug },
  };
}

/** `null` for anything `Date` cannot parse, so a typo is a 400 and not an epoch. */
function parseInstant(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Validates a WhatsApp number at write time.
 *
 * **Empty is valid and means "this event has no button".** There is no tenant
 * fallback (RFC 0014, decision of 2026-09-22), so an empty column is a real
 * choice rather than a missing value to be filled in from somewhere else. A
 * non-empty value that fails the shared 10–15-digit rule is rejected, because
 * the web would refuse to render it and a stored number nobody can call is
 * worse than no number at all.
 */
function resolveWhatsappNumber(
  raw: string | undefined,
): { ok: true; value: string } | { ok: false; detail: string } {
  if (raw === undefined) return { ok: true, value: '' };
  if (raw.trim() === '') return { ok: true, value: '' };

  const normalised = normalizeWhatsapp(raw);
  if (!normalised) {
    return { ok: false, detail: 'must contain between 10 and 15 digits, or be empty' };
  }
  return { ok: true, value: normalised };
}

function unique(values: string[] | undefined): string[] {
  return [...new Set(values ?? [])];
}

async function filterAsync(
  values: string[],
  predicate: (value: string) => Promise<boolean>,
): Promise<string[]> {
  const verdicts = await Promise.all(values.map(predicate));
  return values.filter((_, index) => verdicts[index]);
}

/**
 * A storage cleanup that fails is logged and swallowed.
 *
 * The database row is already correct by the time any of these run; raising
 * would turn "an object was left behind" into "the write appeared to fail",
 * which is the worse of the two for the caller and for the data.
 */
function logStorageFailure(action: string, key: string): (error: unknown) => void {
  return (error: unknown) => {
    console.error(`[admin-events] ${action} failed (key=${key})`, error);
  };
}
