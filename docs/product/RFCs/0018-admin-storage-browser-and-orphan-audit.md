# RFC 0018: Admin storage browser and orphan audit

**Date:** 2026-09-29
**Status:** Draft
**Author:** raphaelsilva
**Affected:**
- `packages/shared/ports/i-storage-adapter.ts` (`listObjects` gains an options object with `delimiter`; result gains `prefixes`)
- `apps/api/src/adapters/storage/r2-storage-adapter.ts` (pass `delimiter`, map `delimitedPrefixes`)
- `packages/shared/ports/i-storage-reference-repository.ts` (new port — resolve storage keys to the DB rows that own them)
- `packages/shared/ports/index.ts` (export the new port)
- `packages/shared/domain/storage/key-owners.ts` (new — the registry of tables/columns that hold an R2 key, and the key-shape parsers)
- `apps/api/src/adapters/db/d1-storage-reference-repository.ts` (new adapter — batched lookups over `media` and `events`)
- `apps/api/src/controllers/admin-storage.controller.ts` (new — browse, classify, audit, orphan delete)
- `apps/api/src/routes/admin/storage.ts` (new — `/v1/admin/storage/*`, carries its own `requireRole(ROLES.ADMIN)`)
- `apps/api/src/routes/admin/index.ts`, `apps/api/src/container.ts` (wiring)
- `apps/api/src/openapi/components/entities.ts` (new schemas)
- `apps/api/test/storage/key-owners-coverage.spec.ts` (new — fails when a migration adds a key column the registry does not know)
- `apps/web/src/lib/admin-storage-api.ts` (new client)
- `apps/web/src/app/(protected)/admin/storage/page.tsx` (new — folder browser + orphan scan)
- `apps/web/src/components/admin/storage/*` (new — breadcrumb, object table, status badge, scan panel)
- `apps/web/src/components/layout/admin-sidebar.tsx` (new *Storage* item, `requiredRoles: [ROLES.ADMIN]`)
- `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (new `adminStorage:` section, identical keys)

---

## Summary

Add an **admin-only Storage page** to the backoffice that lets an administrator browse the
tenant's R2 bucket **as a folder tree** (`topics/` → `<topicId>/` → files, `events/` →
`<eventId>/` → flyers) and, for every object listed, shows **who owns it in the database**:
the media row and its topic, or the event whose flyer it is — with the human names
(topic title, event title, original file name, uploader) instead of the opaque key. Each
object is classified as `linked`, `pending`, `deleted-row`, `displaced` or **`orphan`**
(no row references it). An on-demand **orphan scan** walks the whole bucket page by page and
reports only the objects that are not `linked`, plus — in the reverse direction — the DB rows
whose object is **missing**. Phase 1 is strictly read-only; Phase 2 adds a guarded
"delete orphan" action that re-verifies the classification server-side before removing
anything. No migration is needed: the resolution is a join over columns that already exist.

## Motivation

Today the bucket and the database can drift apart and **nobody can see it**. The only view
into R2 is the Cloudflare dashboard, which shows keys like
`topics/9f1c…/4be2…-kata_final.mp4` with no link to the topic they belong to, and which
content creators and most admins cannot (and should not) access.

Drift is not hypothetical; the code creates it on purpose in several places, because
"orphan rather than wrong answer" is the house rule:

| Case | How it happens | Visible today? | Covered here? |
|---|---|---|---|
| Upload presigned and PUT landed, finalize never called | Browser closed, importer interrupted (`import-media.mjs` recovers only what its own ledger knows) | No | Yes — `pending` with object present |
| Presign issued, PUT never landed | Presigned URL expired | No | Yes — reverse scan: row with **missing** object |
| Media soft-deleted, object delete failed | `deleteObject(...).catch(() => {})` swallows the error | No | Yes — `deleted-row` |
| Flyer replaced, displaced object delete failed | `logStorageFailure('delete replaced flyer', …)` logs and moves on | Only in Worker logs | Yes — `orphan` (or `displaced` while pending) |
| Topic / event row removed | `media.topic_node_id … ON DELETE CASCADE`; `DELETE FROM topic_nodes` / `DELETE FROM events` drop rows, never objects | No | Yes — `orphan` |
| Object written out of band | `wrangler r2 object put`, a manual repair, a past bug | No | Yes — `orphan` |
| Ready row whose object vanished | Manual deletion in the dashboard | Only as a broken player in the catalog | Yes — reverse scan |

Orphans cost money (R2 storage is billed per GB-month; the Budo import alone moves videos
up to 100 MB each) and, worse, the reverse case — a `ready` row pointing at nothing — is a
broken lesson a student hits before any admin does.

## Goals & Non-Goals

**Goals**
- An admin-only page to navigate the bucket by "folder" (key prefix split on `/`), with
  pagination, breadcrumb and object details (size, upload date, content type).
- For every listed object, resolve the owning DB record and show its human-readable
  identity and a link to its backoffice page (topic → `/admin/topics`, event →
  `/admin/events/<id>`).
- Classify every object (`linked` · `pending` · `deleted-row` · `displaced` · `orphan`) with
  one server-side rule, not a heuristic in the browser.
- An on-demand, resumable, stateless orphan scan over the whole bucket, and a reverse scan
  for rows whose object is missing.
- A single registry of "which columns hold an R2 key", enforced by a test, so the next
  feature that stores a key cannot silently turn all its objects into false orphans.
- Phase 2: a guarded delete for objects that are *still* orphans at the moment of deletion.

**Non-Goals**
- Uploading, renaming or moving objects from this page — the upload lifecycle stays owned by
  the topic media uploader and the event flyer flow (RFC 0014).
- Access for `content_creator` — bucket-wide visibility crosses every topic and event,
  including drafts and restricted events; it is an operator tool.
- An automatic/scheduled garbage collector (Cron Trigger). Deferred — see Alternatives §4.
- Fixing the root causes listed in Motivation (e.g. hard-deleting topics without deleting
  their media objects). Those are separate backlog items; this RFC makes them *visible*.
- Cross-tenant views. Each label has its own bucket and Worker; the page only ever sees the
  bucket bound as `R2` in the current deployment.

## Current State (for reference)

**Storage port.** `IStorageAdapter.listObjects(prefix, cursor?, limit?)`
(`packages/shared/ports/i-storage-adapter.ts:166`) returns a flat list — there is no
`delimiter`, so no way to ask for "the folders under this prefix". The R2 implementation
(`apps/api/src/adapters/storage/r2-storage-adapter.ts:145`) calls `bucket.list` with
`include: ['customMetadata', 'httpMetadata']`. **No production code calls `listObjects`
today** (only two test doubles stub it), so its signature can change freely.

**Key shapes** — the only two writers of R2 keys:
- Topic media: `topics/${topicId}/${mediaId}-${safeName}`
  (`apps/api/src/controllers/admin-media.controller.ts:98`), stored in `media.storage_key`.
- Event flyer: `events/${id}/flyer-${uuid}-${safeName}`
  (`apps/api/src/controllers/admin-events.controller.ts:455`), stored in `events.flyer_key`,
  with the previous key parked in `events.flyer_replaced_key` until finalize
  (`apps/api/migrations/0027_create_events.sql:48-57`).

**Where drift is introduced.**
- `admin-media.controller.ts:151` — `deleteMedia` soft-deletes the row, then
  `deleteObject(...).catch(() => {})`.
- `admin-events.controller.ts:566-570` — displaced flyer delete failure is logged only.
- `apps/api/migrations/0006_create_media.sql` — `topic_node_id … ON DELETE CASCADE`; with
  `D1TopicNodeRepository.delete` (`apps/api/src/adapters/db/d1-topic-node-repository.ts:381`)
  and `D1EventRepository.delete` (`apps/api/src/adapters/db/d1-event-repository.ts:468`)
  rows disappear and their objects stay.

**Admin gating.** `/v1/admin/*` admits `admin` and `content_creator`
(`apps/api/src/routes/admin/index.ts:23`); admin-only sub-routers add their own
`requireRole(ROLES.ADMIN)`, as billing does (`apps/api/src/routes/admin/billing.ts:774`).
The web sidebar hides items through `requiredRoles` (`admin-sidebar.tsx:57-69`).

## Proposed Design

### 1. Storage port: folder listing

Replace the positional signature with an options object and surface R2's
`delimitedPrefixes`:

```ts
export interface ListObjectsOptions {
  cursor?: string;
  /** Default 100, max 1000 (R2 hard limit). */
  limit?: number;
  /** When set (always '/' in practice), keys below the next delimiter are folded into `prefixes`. */
  delimiter?: string;
}

export interface ListObjectsResult {
  objects: StorageObject[];
  /** "Sub-folders" directly under the prefix, each ending with the delimiter. Empty without a delimiter. */
  prefixes: string[];
  nextCursor?: string;
}

listObjects(prefix: string, options?: ListObjectsOptions): Promise<ListObjectsResult>;
```

`StorageObject` gains `contentType?: string` (from `httpMetadata.contentType`), which the
adapter already fetches and currently drops. Caveat to encode in the adapter's comment: with
`include` set, R2 may return **fewer than `limit` objects on a page that is still
truncated** — callers must loop on `nextCursor`, never on `objects.length < limit`.

### 2. Key-owner registry (`packages/shared/domain/storage/key-owners.ts`)

One table of every place a key can live, and the parser for each key shape:

```ts
export const STORAGE_KEY_OWNERS = [
  { table: 'media',  column: 'storage_key',        kind: 'media' },
  { table: 'events', column: 'flyer_key',          kind: 'event-flyer' },
  { table: 'events', column: 'flyer_replaced_key', kind: 'event-flyer-displaced' },
] as const;

/** Best-effort decode of a key's *intended* owner, used when no row matches. */
export function parseStorageKey(key: string):
  | { shape: 'topic-media'; topicId: string; mediaId: string; fileName: string }
  | { shape: 'event-flyer'; eventId: string; fileName: string }
  | { shape: 'unknown' };
```

`key-owners-coverage.spec.ts` scans `apps/api/migrations/*.sql` for columns named
`*_key` / `storage_key` (excluding an explicit allow-list of the non-storage keys that exist today,
`idempotency_key` and `period_key` in the billing tables) and fails if one is missing from `STORAGE_KEY_OWNERS`. This is
the mechanism that keeps "orphan" meaning orphan: a new feature that stores keys in a new
column without registering it breaks CI instead of making its whole prefix look deletable.

### 3. Resolution port and D1 adapter

```ts
export type StorageReference =
  | { kind: 'media'; mediaId: string; status: 'pending' | 'ready' | 'deleted';
      originalName: string; type: string; sizeBytes: number; uploadedBy: { id: string; name: string } | null;
      topic: { id: string; title: string; status: string } | null; createdAt: string }
  | { kind: 'event-flyer' | 'event-flyer-displaced'; eventId: string; eventTitle: string;
      eventSlug: string; flyerStatus: 'none' | 'pending' | 'ready'; originalName: string | null };

export interface IStorageReferenceRepository {
  /** Every row that references each key. Keys with no reference are absent from the map. */
  resolveKeys(keys: string[]): Promise<Map<string, StorageReference[]>>;
  /** Existence of the topics / events a key's *path* points at (for orphans whose row is gone). */
  existingOwners(ids: { topicIds: string[]; eventIds: string[] }): Promise<{ topicIds: Set<string>; eventIds: Set<string> }>;
  /** Paged walk over every referenced key, for the reverse (missing-object) scan. */
  listReferencedKeys(cursor?: string, limit?: number): Promise<{ items: { key: string; ref: StorageReference }[]; nextCursor?: string }>;
}
```

`D1StorageReferenceRepository.resolveKeys` issues, per chunk of **at most 90 keys** (D1
caps a statement at 100 bound parameters):

```sql
SELECT m.*, t.title AS topic_title, t.status AS topic_status, u.name AS uploader_name
  FROM media m
  LEFT JOIN topic_nodes t ON t.id = m.topic_node_id
  LEFT JOIN users u       ON u.id = m.uploaded_by
 WHERE m.storage_key IN (?, ?, …);

SELECT id, title, slug, flyer_status, flyer_name, flyer_key, flyer_replaced_key
  FROM events
 WHERE flyer_key IN (?, …) OR flyer_replaced_key IN (?, …);
```

Both run in one `db.batch([...])`. A page of 100 objects costs 2 statements; a 1000-key audit
page costs ~24. `media.storage_key` has no index today; the lookup is an `IN` on a small
table (thousands of rows per tenant), so an index is **not** added in Phase 1 — it is added
(`CREATE INDEX IF NOT EXISTS idx_media_storage_key`) only if the audit page exceeds its
latency budget (Success Criteria).

### 4. Classification (controller, one rule)

For each object, in order:

| Status | Rule |
|---|---|
| `linked` | a `media` row with status `ready`, or an event whose `flyer_key` = key and `flyer_status = 'ready'` |
| `pending` | a `media` row with status `pending`, or `flyer_key` = key with `flyer_status = 'pending'` — shows its age; flagged **stale** past the grace window (§6) |
| `displaced` | referenced only as `flyer_replaced_key` — a replacement is in flight; becomes an orphan if the delete after finalize fails |
| `deleted-row` | only `media` rows with status `deleted` reference it — the object should have been removed |
| `orphan` | no reference at all. Annotated with `parseStorageKey`: *"topic `<id>` no longer exists"*, *"topic exists, media row gone"*, or *"unknown key shape"* |

The reverse direction adds a sixth, row-side status, **`missing-object`**: a `ready` or
`pending` reference whose `headObject` returns null.

### 5. HTTP surface (`/v1/admin/storage`, `requireRole(ROLES.ADMIN)`)

| Method & path | Purpose |
|---|---|
| `GET /browse?prefix=topics/&cursor=&limit=100` | One folder: `{ prefix, folders: string[], objects: ClassifiedObject[], nextCursor? }`. `prefix` must be `''` or end with `/`. |
| `GET /object?key=…` | One object: head + references + a 5-minute presigned download URL for preview. |
| `GET /audit?cursor=&limit=1000` | One page of the flat bucket walk; returns **only non-`linked`** objects, plus `{ scanned, nextCursor? }`. |
| `GET /audit/missing?cursor=&limit=50` | One page of referenced keys; returns those whose object is missing. `limit` is small because each key costs a `head` subrequest. |
| `DELETE /object?key=…` *(Phase 2)* | Delete an orphan. See §6. |

```ts
type ClassifiedObject = {
  key: string; name: string; size: number; uploadedAt: string; contentType?: string;
  status: 'linked' | 'pending' | 'displaced' | 'deleted-row' | 'orphan';
  stale?: boolean;
  references: StorageReference[];
  hint?: 'owner-topic-gone' | 'owner-event-gone' | 'row-gone' | 'unknown-shape';
};
```

The audit is **stateless and client-driven**: the browser calls `/audit` with the returned
cursor until it is absent, accumulating results and showing progress. Each call is one
Worker invocation well inside CPU and subrequest limits; nothing is persisted, so an
abandoned scan leaves nothing behind. Keys are passed as query parameters and used only as
R2 keys and bound SQL values — never interpolated into paths or SQL.

### 6. Guarded orphan delete (Phase 2)

`DELETE /v1/admin/storage/object?key=…` succeeds only when, **re-evaluated at request
time**:
1. the key resolves to **no** reference (`orphan`) or only to `deleted-row` references; and
2. the object's `uploaded` timestamp is older than the **grace window** (default 24 h,
   comfortably above the 1 h media presign TTL and the flyer TTL), so an upload that is
   between PUT and finalize can never be deleted from under its owner.

Otherwise it answers `409 Conflict` with the current classification. Every deletion emits a
structured log line (`storage.orphan.deleted`, key, size, admin user id). Stale `pending`
rows are **not** deletable here in Phase 2 — their cleanup changes a DB row too and belongs
to the owning flow (Open Questions).

### 7. Frontend (`/admin/storage`)

- Sidebar item *Storage* with `requiredRoles: [ROLES.ADMIN]`; the page also checks
  `useHasRole(ROLES.ADMIN)` and redirects otherwise (the API is the real guard).
- **Folder view:** breadcrumb built from the prefix, folder rows first, then objects with
  name, size, date, a status badge and the resolved owner ("Topic *9th Kyu* ·
  `kata_final.mp4` · uploaded by Ana"). Topic folders (`topics/<id>/`) display the topic title
  next to the id, resolved through the same port (`existingOwners` + titles), so the tree
  reads as the content tree. "Load more" on `nextCursor`.
- **Detail drawer:** all references, key, preview (image/PDF/video through the presigned
  URL), and — Phase 2 — *Delete orphan* behind a confirmation that repeats the key and size.
- **Scan panel:** "Scan for orphans" and "Check for missing files" buttons, live progress
  (`scanned` count), a stop button, results grouped by status with total bytes reclaimable.
- All strings through `adminStorage:` in `dict-en.ts` / `dict-pt.ts`.

## Alternatives Considered

1. **Browse through the S3 API (`ListObjectsV2`) instead of the binding.** Rejected: the
   native binding already supports `delimiter` and needs no signing, and the adapter's rule
   is "binding for CRUD, S3 client only for presigning".
2. **Resolve owners from R2 custom metadata** (write `topicId`/`mediaId` into each object at
   upload). Rejected as the primary mechanism: presigned PUTs are written by the browser, so
   metadata is client-controlled and absent on every object uploaded so far. The key path
   already encodes the intended owner, and the DB is the source of truth for *actual*
   ownership. `parseStorageKey` covers the "who was this meant for" question.
3. **Persist an inventory table** (`storage_objects`) synced on upload/delete. Rejected: it
   is a third copy that can itself drift, and it needs a backfill. A live join over the two
   real sources is cheap at this scale. Deferred, not rejected, if a tenant reaches a bucket
   size where a full audit no longer fits a sitting (hundreds of thousands of objects).
4. **Scheduled garbage collector (Cron Trigger).** Deferred: automatic deletion of user
   content should only follow a period in which the classification has been observed to be
   right in production. The audit endpoint is the building block a later cron would reuse.
5. **Open the page to `content_creator`, scoped to their topics.** Rejected for now: the
   bucket view is inherently cross-cutting (events, other creators' drafts, orphans without
   an owner), and there is no per-creator ownership model to scope by.
6. **Server-side full scan in one request.** Rejected: unbounded CPU/subrequest cost in a
   Worker. Cursor pages keep each invocation bounded and make the scan stoppable.

## Implementation Plan

Total **~5 dev days**.

### Phase 0 — Port + registry (~0.5 d)
`ListObjectsOptions`/`prefixes`/`contentType` in the port and R2 adapter (update the two test
doubles); `key-owners.ts` with `parseStorageKey`; coverage spec over migrations.

### Phase 1 — Read-only browser and audit (~3 d)
Backend (~1.5 d): `IStorageReferenceRepository` + D1 adapter (chunked batch), controller
classification, `/browse`, `/object`, `/audit`, `/audit/missing`, OpenAPI schemas, tests
(miniflare R2 + D1: one object per status, chunk boundary at 90/91 keys, content creator gets
403). Frontend (~1.5 d): client, page, breadcrumb, table, detail drawer with preview, scan
panel, i18n.

### Phase 2 — Guarded orphan delete (~1.5 d)
`DELETE /object` with re-verification and grace window, structured log, confirmation UI,
tests for the 409 paths (still referenced, too recent, key reappeared as a pending upload).

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| A key column added later is not registered → its objects show as orphans and could be deleted | `key-owners-coverage.spec.ts` fails CI; Phase 2 delete also refuses objects younger than the grace window |
| Deleting an object that is mid-upload | Grace window (24 h ≫ presign TTL) + server-side re-classification at delete time |
| Bucket-wide listing exposes restricted content to the wrong person | Admin-only on both API (`requireRole(ROLES.ADMIN)`) and UI; previews use 5-minute presigned URLs |
| Large buckets make the audit slow | Stateless cursor pages of 1000 keys; progress and stop in the UI; index on `media.storage_key` if the page budget is missed |
| R2 `list` with `include` returns short pages | Loop strictly on `nextCursor` (documented in the adapter) |
| D1 100-parameter cap | Chunks of 90 keys, tested at the boundary |
| Reverse scan cost (one `head` per key) | Small page size (50), user-triggered only |

## Success Criteria

- *(P0)* `listObjects('topics/', { delimiter: '/' })` returns one `prefixes` entry per topic
  folder and no objects; the coverage spec fails when a test migration adds an unregistered
  `foo_key` column.
- *(P1)* A `content_creator` token gets `403` on every `/v1/admin/storage/*` route; the
  sidebar item is absent for them.
- *(P1)* Given fixtures for each case in the Motivation table, `/browse` and `/audit`
  classify every object correctly and `/audit/missing` reports exactly the rows without an
  object.
- *(P1)* An `/audit` page of 1000 keys completes in < 2 s on staging.
- *(P1)* An admin can navigate from the bucket root to a topic folder and see the topic
  title and each file's original name without reading a UUID.
- *(P2)* `DELETE /object` on a linked, pending, displaced or < 24 h old object returns `409`
  and leaves the object in place; on a true orphan it deletes and logs.

## Open Questions

1. **Stale `pending` cleanup** — should the owning flows (media uploader, flyer) get a
   "discard pending upload" action, or should Phase 2 delete the object *and* hard-delete the
   row? Owner: product owner + lead architect.
2. **Grace window** — is 24 h right, and should it be configurable per environment?
3. **Audit trail** — is a structured log line enough, or do deletions need a persisted admin
   audit table (none exists today)?
4. **Should `deleted-row` rows be hard-deleted** once their object is gone, or kept for
   history?

## References

- Relevant code: `packages/shared/ports/i-storage-adapter.ts:166`,
  `apps/api/src/adapters/storage/r2-storage-adapter.ts:145`,
  `apps/api/src/controllers/admin-media.controller.ts:98,151`,
  `apps/api/src/controllers/admin-events.controller.ts:455,566`,
  `apps/api/migrations/0006_create_media.sql`, `apps/api/migrations/0027_create_events.sql`,
  `apps/api/src/routes/admin/index.ts:23`, `apps/api/src/routes/admin/billing.ts:774`
- Related RFCs: RFC 0014 (events board — owns the flyer lifecycle and `flyer_replaced_key`),
  RFC 0012 (tenant provisioning — one bucket per label and environment)
- `scripts/content/import-media.mjs` (bulk importer; its ledger recovers only its own pending uploads)
- Cloudflare R2 Workers API: `R2Bucket.list` (`delimiter`, `delimitedPrefixes`, `include`)
