import type { OrphanHint, StorageStatus } from '@web/lib/admin-storage-api';

/**
 * Locale-agnostic formatting for the storage browser. `Intl.*` is deferred to
 * RFC 0002 Phase 4 (see `docs/architecture/web/i18n-spec.md` §3.5), so sizes
 * and dates keep the neutral shape the rest of the backoffice uses.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** `2026-09-29T12:00:00.000Z` → `2026-09-29 12:00 UTC`. */
export function formatTimestamp(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return match ? `${match[1]} ${match[2]} UTC` : iso;
}

/** Dictionary key for each server status (dictionary keys are camelCase). */
export const STATUS_KEY = {
  linked: 'linked',
  pending: 'pending',
  displaced: 'displaced',
  'deleted-row': 'deletedRow',
  orphan: 'orphan',
} as const satisfies Record<StorageStatus, string>;

/** Dictionary key for each orphan hint. */
export const HINT_KEY = {
  'owner-topic-gone': 'ownerTopicGone',
  'owner-event-gone': 'ownerEventGone',
  'row-gone': 'rowGone',
  'unknown-shape': 'unknownShape',
} as const satisfies Record<OrphanHint, string>;
