/**
 * Storage key-owner registry.
 *
 * The one place that answers "which database columns hold an object-storage
 * key?". The admin storage browser resolves every bucket key against these
 * columns, and a coverage spec over the API migrations fails whenever a
 * `*_key` column appears that is neither registered here nor explicitly
 * declared non-storage — so a new owner cannot silently turn its objects
 * into "orphans".
 *
 * Pure data and pure functions: no database access lives here.
 */

/** A table/column pair that stores an object-storage key. */
export interface StorageKeyOwner {
  readonly table: string;
  readonly column: string;
}

/** Every column that holds an object-storage key. */
export const STORAGE_KEY_OWNERS: readonly StorageKeyOwner[] = [
  { table: 'media', column: 'storage_key' },
  { table: 'events', column: 'flyer_key' },
  // The flyer a pending re-upload is about to displace (see migration 0027).
  { table: 'events', column: 'flyer_replaced_key' },
  // Student submissions (migration 0030); NULL on a `removed` tombstone.
  { table: 'topic_submissions', column: 'storage_key' },
] as const;

/**
 * `*_key` columns that are NOT object-storage keys. Anything added here must
 * be genuinely unrelated to the bucket.
 */
export const NON_STORAGE_KEY_COLUMNS: readonly string[] = [
  // xp_events: de-duplicates XP credits per source event.
  'idempotency_key',
  // quest_progress: the quest period ('YYYY-MM-DD' / 'YYYY-Wnn').
  'period_key',
] as const;

/**
 * Minimum age before an unreferenced object may be treated as an orphan.
 * Fixed at 24 h — well above the media and flyer presign TTLs — so an upload
 * still in flight is never mistaken for one (M25 Decision 2).
 */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

/** What a storage key's shape says about its intended owner. */
export type ParsedStorageKey =
  | { kind: 'topic-media'; topicId: string; mediaId: string; fileName: string }
  | { kind: 'event-flyer'; eventId: string; fileName: string }
  | { kind: 'submission'; authorId: string; submissionId: string; fileName: string }
  | { kind: 'unknown' };

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

// Mirrors the key builders:
//   admin-media.controller  → `topics/${topicId}/${mediaId}-${sanitizeFileName(name)}`
//   admin-events.controller → `events/${id}/flyer-${randomUUID()}-${sanitizeFileName(name)}`
//   submissions.controller  → `submissions/${authorId}/${randomUUID()}-${sanitizeFileName(name)}`
// `sanitizeFileName` never emits `/`, so the file-name segment is slash-free;
// a key with deeper nesting is not one of ours and parses as `unknown`.
const TOPIC_MEDIA_RE = new RegExp(`^topics/([^/]+)/(${UUID})-([^/]+)$`);
const EVENT_FLYER_RE = new RegExp(`^events/([^/]+)/flyer-${UUID}-([^/]+)$`);
const SUBMISSION_RE = new RegExp(`^submissions/([^/]+)/(${UUID})-([^/]+)$`);

/**
 * Decode a storage key into the owner its path claims. The result is only a
 * hint — ownership is always resolved from the database, never from the key.
 */
export function parseStorageKey(key: string): ParsedStorageKey {
  const media = TOPIC_MEDIA_RE.exec(key);
  if (media) {
    return { kind: 'topic-media', topicId: media[1], mediaId: media[2], fileName: media[3] };
  }
  const flyer = EVENT_FLYER_RE.exec(key);
  if (flyer) {
    return { kind: 'event-flyer', eventId: flyer[1], fileName: flyer[2] };
  }
  const submission = SUBMISSION_RE.exec(key);
  if (submission) {
    return {
      kind: 'submission',
      authorId: submission[1],
      submissionId: submission[2],
      fileName: submission[3],
    };
  }
  return { kind: 'unknown' };
}
