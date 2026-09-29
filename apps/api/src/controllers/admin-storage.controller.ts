import type { z } from 'zod';
import type {
  IStorageAdapter,
  IStorageReferenceRepository,
  StorageObject,
  StorageReference,
  ExistingOwners,
} from '@arenaquest/shared/ports';
import { ORPHAN_GRACE_MS, parseStorageKey } from '@arenaquest/shared/domain/storage';
import type { ControllerResult } from '@api/core/result';
import type {
  ClassifiedObjectSchema,
  StorageAuditMissingResponseSchema,
  StorageAuditResponseSchema,
  StorageBrowseResponseSchema,
  StorageDeleteResponseSchema,
  StorageFolderSchema,
  StorageObjectDetailSchema,
  StorageReferenceSchema,
} from '@api/openapi/components/entities';

/**
 * Admin storage browser (RFC 0018 §4–§5, M25 Task 03) — **read-only**.
 *
 * Depends on the storage port and the storage-reference port only. Every key
 * or prefix is untrusted input: it is only ever handed to those ports, never
 * interpolated into a log line, a path or a SQL string.
 */

export type StorageStatus = 'linked' | 'pending' | 'displaced' | 'deleted-row' | 'orphan';
export type OrphanHint = 'owner-topic-gone' | 'owner-event-gone' | 'row-gone' | 'unknown-shape';

export interface Classification {
  status: StorageStatus;
  /** Only ever true for `pending`. */
  stale: boolean;
  /** Only set for `orphan`. */
  hint: OrphanHint | null;
}

export type ClassifiedObjectDto = z.infer<typeof ClassifiedObjectSchema>;
export type StorageReferenceDto = z.infer<typeof StorageReferenceSchema>;
export type StorageFolderDto = z.infer<typeof StorageFolderSchema>;
export type StorageBrowseDto = z.infer<typeof StorageBrowseResponseSchema>;
export type StorageObjectDetailDto = z.infer<typeof StorageObjectDetailSchema>;
export type StorageAuditDto = z.infer<typeof StorageAuditResponseSchema>;
export type StorageAuditMissingDto = z.infer<typeof StorageAuditMissingResponseSchema>;
export type StorageDeleteDto = z.infer<typeof StorageDeleteResponseSchema>;

/** Only these may be removed, and only once past the grace window (M25 Task 06). */
const DELETABLE_STATUSES: ReadonlySet<StorageStatus> = new Set(['orphan', 'deleted-row']);

/** Why a delete was refused — carried on the `409` next to the current classification. */
export type DeleteRefusalReason = 'not-deletable-status' | 'within-grace-window';

export const BROWSE_DEFAULT_LIMIT = 100;
export const AUDIT_MAX_LIMIT = 1000;
export const AUDIT_MISSING_MAX_LIMIT = 50;
/** Presigned preview URL lifetime on `/object`. */
export const PREVIEW_URL_TTL_SECONDS = 300;
/**
 * Upper bound on storage list calls used to fill one `/audit` page. R2 may
 * return short pages while more remain; this caps the work per request even
 * against a provider that keeps answering with empty pages.
 */
const AUDIT_MAX_LIST_CALLS = 10;

/** What the orphan hint needs to know about the key's claimed owner. */
export interface OwnerExistence {
  topicExists(id: string): boolean;
  eventExists(id: string): boolean;
}

/**
 * The single classification rule (milestone §2). Precedence runs from the
 * strongest claim to the weakest, so a key referenced several ways is shown
 * by its most "alive" reference and is never called an orphan.
 */
export function classifyObject(
  object: Pick<StorageObject, 'key' | 'lastModified'>,
  refs: readonly StorageReference[],
  owners: OwnerExistence,
  now: number,
): Classification {
  const isReady = (r: StorageReference) =>
    (r.kind === 'media' && r.status === 'ready') || (r.kind === 'event-flyer' && r.flyerStatus === 'ready');
  if (refs.some(isReady)) return { status: 'linked', stale: false, hint: null };

  // A live flyer column that is not `ready` is an upload in flight.
  const isPending = (r: StorageReference) =>
    (r.kind === 'media' && r.status === 'pending') || r.kind === 'event-flyer';
  if (refs.some(isPending)) {
    return { status: 'pending', stale: now - object.lastModified.getTime() > ORPHAN_GRACE_MS, hint: null };
  }

  if (refs.some((r) => r.kind === 'event-flyer-displaced')) {
    return { status: 'displaced', stale: false, hint: null };
  }

  if (refs.length > 0) return { status: 'deleted-row', stale: false, hint: null };

  const parsed = parseStorageKey(object.key);
  let hint: OrphanHint;
  if (parsed.kind === 'topic-media') {
    hint = owners.topicExists(parsed.topicId) ? 'row-gone' : 'owner-topic-gone';
  } else if (parsed.kind === 'event-flyer') {
    hint = owners.eventExists(parsed.eventId) ? 'row-gone' : 'owner-event-gone';
  } else {
    hint = 'unknown-shape';
  }
  return { status: 'orphan', stale: false, hint };
}

const TOPIC_FOLDER_RE = /^topics\/([^/]+)\/$/;
const EVENT_FOLDER_RE = /^events\/([^/]+)\/$/;

function lastSegment(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

function toReferenceDto(ref: StorageReference): StorageReferenceDto {
  if (ref.kind === 'media') return { ...ref, createdAt: ref.createdAt.toISOString() };
  return { ...ref };
}

/** The reference adapter's bad-cursor error, recognised without importing the adapter. */
function isInvalidCursorError(err: unknown): boolean {
  return err instanceof Error && err.name === 'InvalidStorageReferenceCursorError';
}

const invalidCursor = <T>(): ControllerResult<T> => ({ ok: false, status: 400, error: 'InvalidCursor' });

export class AdminStorageController {
  constructor(
    private readonly storage: IStorageAdapter,
    private readonly references: IStorageReferenceRepository,
    private readonly clock: () => number = Date.now,
  ) {}

  async browse(input: { prefix: string; cursor?: string; limit?: number }): Promise<ControllerResult<StorageBrowseDto>> {
    const { prefix } = input;
    if (prefix !== '' && !prefix.endsWith('/')) {
      return { ok: false, status: 400, error: 'InvalidPrefix' };
    }

    const page = await this.storage.listObjects(prefix, {
      delimiter: '/',
      cursor: input.cursor,
      limit: clamp(input.limit ?? BROWSE_DEFAULT_LIMIT, 1, AUDIT_MAX_LIMIT),
    });

    const folderTopicIds: string[] = [];
    const folderEventIds: string[] = [];
    for (const p of page.prefixes) {
      const topic = TOPIC_FOLDER_RE.exec(p);
      if (topic) folderTopicIds.push(topic[1]);
      const event = EVENT_FOLDER_RE.exec(p);
      if (event) folderEventIds.push(event[1]);
    }

    const { objects, owners } = await this.classifyAll(page.objects, {
      topicIds: folderTopicIds,
      eventIds: folderEventIds,
    });

    const folders: StorageFolderDto[] = page.prefixes.map((p) => {
      const name = lastSegment(p);
      const topic = TOPIC_FOLDER_RE.exec(p);
      if (topic) {
        const title = owners.topics.get(topic[1]);
        return title !== undefined
          ? { prefix: p, name, owner: { kind: 'topic', id: topic[1], title }, ownerGone: false }
          : { prefix: p, name, owner: null, ownerGone: true };
      }
      const event = EVENT_FOLDER_RE.exec(p);
      if (event) {
        const title = owners.events.get(event[1]);
        return title !== undefined
          ? { prefix: p, name, owner: { kind: 'event', id: event[1], title }, ownerGone: false }
          : { prefix: p, name, owner: null, ownerGone: true };
      }
      return { prefix: p, name, owner: null, ownerGone: false };
    });

    return {
      ok: true,
      data: {
        prefix,
        folders,
        objects,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      },
    };
  }

  async object(key: string): Promise<ControllerResult<StorageObjectDetailDto>> {
    const head = await this.storage.headObject(key);
    if (!head) return { ok: false, status: 404, error: 'NotFound' };

    const { objects } = await this.classifyAll([head]);
    const downloadUrl = await this.storage.getPresignedDownloadUrl(key, {
      expiresInSeconds: PREVIEW_URL_TTL_SECONDS,
    });
    const expiresAt = new Date(this.clock() + PREVIEW_URL_TTL_SECONDS * 1000).toISOString();

    return { ok: true, data: { ...objects[0], downloadUrl, downloadUrlExpiresAt: expiresAt } };
  }

  async audit(input: { cursor?: string; limit?: number }): Promise<ControllerResult<StorageAuditDto>> {
    const limit = clamp(input.limit ?? AUDIT_MAX_LIMIT, 1, AUDIT_MAX_LIMIT);
    const walked: StorageObject[] = [];
    let cursor = input.cursor;

    // Fill this one page: a short storage page with a cursor is not the end.
    // Never continues past `limit` keys — the client drives the next page.
    for (let calls = 0; calls < AUDIT_MAX_LIST_CALLS; calls++) {
      const page = await this.storage.listObjects('', { cursor, limit: limit - walked.length });
      walked.push(...page.objects);
      cursor = page.nextCursor;
      if (!cursor || walked.length >= limit) break;
    }

    const { objects } = await this.classifyAll(walked);
    return {
      ok: true,
      data: {
        objects: objects.filter((o) => o.status !== 'linked'),
        scanned: walked.length,
        ...(cursor ? { nextCursor: cursor } : {}),
      },
    };
  }

  async auditMissing(input: { cursor?: string; limit?: number }): Promise<ControllerResult<StorageAuditMissingDto>> {
    const limit = clamp(input.limit ?? AUDIT_MISSING_MAX_LIMIT, 1, AUDIT_MISSING_MAX_LIMIT);

    let page;
    try {
      page = await this.references.listReferencedKeys({ cursor: input.cursor, limit });
    } catch (err) {
      if (isInvalidCursorError(err)) return invalidCursor();
      throw err;
    }

    // At most `limit` (≤ 50) head calls — one per distinct key.
    const keys = [...new Set(page.items.map((r) => r.key))];
    const heads = await Promise.all(keys.map((k) => this.storage.headObject(k)));
    const missing = new Set(keys.filter((_, i) => heads[i] === null));

    return {
      ok: true,
      data: {
        items: page.items
          .filter((r) => missing.has(r.key))
          .map((r) => ({ key: r.key, status: 'missing-object' as const, reference: toReferenceDto(r) })),
        scanned: page.items.length,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      },
    };
  }

  /**
   * The milestone's only write (M25 Task 06). Re-reads the head and
   * re-classifies the key inside this request — never trusts what the client
   * last saw — and removes the object only when it is `orphan` or
   * `deleted-row` **and** older than `ORPHAN_GRACE_MS`. Storage only: no DB
   * row is touched, not even the soft-deleted `media` row of a `deleted-row`.
   */
  async deleteObject(key: string, actorId: string): Promise<ControllerResult<StorageDeleteDto>> {
    const head = await this.storage.headObject(key);
    if (!head) return { ok: false, status: 404, error: 'NotFound' };

    const { objects } = await this.classifyAll([head]);
    const object = objects[0];

    let reason: DeleteRefusalReason | null = null;
    if (!DELETABLE_STATUSES.has(object.status)) reason = 'not-deletable-status';
    else if (this.clock() - head.lastModified.getTime() <= ORPHAN_GRACE_MS) reason = 'within-grace-window';
    if (reason) {
      return { ok: false, status: 409, error: 'StorageObjectNotDeletable', meta: { reason, object } };
    }

    const status = object.status as StorageDeleteDto['status'];
    await this.storage.deleteObject(key);

    // One structured line, fixed event name; the key is a JSON value, never a
    // format template.
    console.info(
      JSON.stringify({
        event: 'storage.orphan.deleted',
        actor: actorId,
        key,
        size: head.size,
        status,
        at: new Date(this.clock()).toISOString(),
      }),
    );

    return { ok: true, data: { deleted: true, key, size: head.size, status } };
  }

  /**
   * Resolve and classify a batch of objects with one `resolveKeys` and one
   * `existingOwners` call — the latter also covering any extra owner ids the
   * caller needs (folder labels on `/browse`).
   */
  private async classifyAll(
    list: readonly StorageObject[],
    extra: { topicIds?: string[]; eventIds?: string[] } = {},
  ): Promise<{ objects: ClassifiedObjectDto[]; owners: ExistingOwners }> {
    const refs = list.length > 0
      ? await this.references.resolveKeys(list.map((o) => o.key))
      : new Map<string, StorageReference[]>();

    const topicIds = [...(extra.topicIds ?? [])];
    const eventIds = [...(extra.eventIds ?? [])];
    for (const o of list) {
      if (refs.has(o.key)) continue;
      const parsed = parseStorageKey(o.key);
      if (parsed.kind === 'topic-media') topicIds.push(parsed.topicId);
      else if (parsed.kind === 'event-flyer') eventIds.push(parsed.eventId);
    }

    const owners: ExistingOwners = topicIds.length > 0 || eventIds.length > 0
      ? await this.references.existingOwners({ topicIds, eventIds })
      : { topics: new Map(), events: new Map() };
    const existence: OwnerExistence = {
      topicExists: (id) => owners.topics.has(id),
      eventExists: (id) => owners.events.has(id),
    };

    const now = this.clock();
    const objects = list.map((o): ClassifiedObjectDto => {
      const objectRefs = refs.get(o.key) ?? [];
      const c = classifyObject(o, objectRefs, existence, now);
      return {
        key: o.key,
        name: lastSegment(o.key),
        size: o.size,
        uploadedAt: o.lastModified.toISOString(),
        contentType: o.contentType ?? null,
        status: c.status,
        stale: c.stale,
        hint: c.hint,
        references: objectRefs.map(toReferenceDto),
      };
    });

    return { objects, owners };
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(n)));
}
