import type { Entities } from '../types/entities';

/**
 * Storage reference contract (RFC 0018 §3).
 *
 * Answers "who owns this object-storage key?" by name. The port speaks in keys
 * and references only — no store, no SQL and no provider type. The columns it
 * covers are exactly the ones registered in `STORAGE_KEY_OWNERS`
 * (`domain/storage/key-owners.ts`).
 *
 * The contract is **read-only**: nothing here changes a row. Classification
 * (linked / pending / displaced / deleted-row / orphan) is built on top of
 * these references by the caller, not by the implementation.
 */

/** A `media` row whose `storage_key` is the key. */
export interface MediaStorageReference {
  kind: 'media';
  key: string;
  mediaId: string;
  /** Every status is returned, `deleted` included — the caller classifies. */
  status: Entities.Config.MediaStatus;
  originalName: string;
  type: string;
  sizeBytes: number;
  /** The uploader id is kept even when the user row no longer resolves. */
  uploaderId: string;
  uploader: { id: string; name: string } | null;
  /** The topic id is kept even when the topic row is gone (`topic: null`). */
  topicId: string;
  topic: { id: string; title: string; status: Entities.Config.TopicNodeStatus } | null;
  createdAt: Date;
}

/**
 * An event whose flyer column holds the key: `event-flyer` for `flyer_key`,
 * `event-flyer-displaced` for `flyer_replaced_key` (the object a pending
 * re-upload is about to displace).
 */
export interface EventFlyerStorageReference {
  kind: 'event-flyer' | 'event-flyer-displaced';
  key: string;
  eventId: string;
  title: string;
  slug: string;
  flyerStatus: Entities.Events.EventFlyerStatus;
  flyerName: string | null;
}

/** A `topic_submissions` row whose `storage_key` is the key (RFC 0020). */
export interface SubmissionStorageReference {
  kind: 'submission';
  key: string;
  submissionId: string;
  /**
   * Every status the key can match. A `removed` tombstone has
   * `storage_key = NULL`, so in practice only `pending` and `ready` resolve.
   */
  status: Entities.Config.SubmissionStatus;
  title: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  /** The author id is kept even when the user row no longer resolves. */
  authorId: string;
  author: { id: string; name: string } | null;
  /** The topic id is kept even when the topic row is gone (`topic: null`). */
  topicId: string;
  topic: { id: string; title: string; status: Entities.Config.TopicNodeStatus } | null;
  createdAt: Date;
}

export type StorageReference =
  | MediaStorageReference
  | EventFlyerStorageReference
  | SubmissionStorageReference;

export interface ExistingOwnersQuery {
  topicIds?: readonly string[];
  eventIds?: readonly string[];
}

export interface ExistingOwners {
  /** Topic id → title, only for ids that exist. */
  topics: Map<string, string>;
  /** Event id → title, only for ids that exist. */
  events: Map<string, string>;
}

export interface ListReferencedKeysOptions {
  /** Opaque cursor returned by a previous page; omit for the first page. */
  cursor?: string;
  limit: number;
}

export interface ReferencedKeysPage {
  items: StorageReference[];
  /** Present while more references remain. A short page may still carry one. */
  nextCursor?: string;
}

export interface IStorageReferenceRepository {
  /**
   * Every reference for each key. A key with no reference is absent from the
   * returned map; a key referenced by several rows maps to all of them.
   */
  resolveKeys(keys: readonly string[]): Promise<Map<string, StorageReference[]>>;

  /** Which of the given topic / event ids still exist, with their titles. */
  existingOwners(query: ExistingOwnersQuery): Promise<ExistingOwners>;

  /**
   * Stable, cursor-paged walk over every live reference: `ready` and `pending`
   * media keys, every non-null flyer key (`flyer_key` and
   * `flyer_replaced_key`) and `ready` / `pending` submission keys. `deleted`
   * media rows and `removed` submissions are omitted. Each reference is
   * returned exactly once across the pages.
   */
  listReferencedKeys(options: ListReferencedKeysOptions): Promise<ReferencedKeysPage>;
}
