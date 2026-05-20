# Media Upload Lifecycle — Presigned R2 Pipeline

## Overview

Media uploads (PDFs, video, images attached to a topic) **never flow through
the Worker**. The Worker hands the client a short-lived presigned URL, the
client `PUT`s the file directly to R2, and the Worker is then asked to
*finalize* the row. This sidesteps Worker memory/CPU limits and keeps large
binary transfers off the API hot path.

This document specifies the three-step lifecycle, the database states that
back it, and the recovery story when a step is lost.

## Quick Reference

| Step | Endpoint | Who | Result |
|---|---|---|---|
| 1. Presign | `POST /admin/topics/:topicId/media/presign` | Worker | Inserts a `pending` row, returns `{ uploadUrl, media }` |
| 2. Upload | `PUT <uploadUrl>` | Browser → R2 (direct) | Object lands in R2 under `topics/:topicId/:mediaId-:safeName` |
| 3. Finalize | `POST /admin/topics/:topicId/media/:mediaId/finalize` | Worker | Verifies object exists, flips row to `ready` |

Status states on the `media` table: `pending` → `ready` → `deleted`. Rows are
**never hard-deleted from admin endpoints**; `softDelete` flips status and
the storage object is removed best-effort.

> [!IMPORTANT]
> The DB row is created **before** the upload happens. This is deliberate —
> the `mediaId` must be embedded in the storage key so the object is
> addressable by the same id throughout the lifecycle. Pending rows are the
> system's record of "an upload was authorised."

---

## The Three Steps in Detail

### Step 1 — Presign

```typescript
POST /admin/topics/:topicId/media/presign
{
  "fileName":    "intro.pdf",
  "contentType": "application/pdf",
  "sizeBytes":   1450231
}
```

Inside `AdminMediaController.presignUpload`:

1. **Topic existence check.** Missing topic → `404`.
2. **Per-type size cap.** PDF ≤ 25 MB, MP4 ≤ 100 MB, JPEG/PNG/WebP ≤ 5 MB.
   Over-limit → `422 FileTooLarge` with the cap returned in `meta.maxBytes`.
3. **Generate id and storage key.** `mediaId = crypto.randomUUID()`, then
   `storageKey = topics/${topicId}/${mediaId}-${sanitizeFileName(fileName)}`.
4. **Mint the presigned URL.** `getPresignedUploadUrl(key, { expiresInSeconds: 3600, contentType, maxSizeBytes: sizeBytes })`.
5. **Insert the `pending` row** carrying `mediaId`, `storageKey`,
   `sizeBytes`, `originalName`, `type`, `uploadedById = c.get('user').sub`.

Response (201):

```json
{ "uploadUrl": "https://…r2.cloudflarestorage.com/…?X-Amz-Signature=…", "media": { /* pending row */ } }
```

### Step 2 — Direct upload (no Worker involvement)

The client `PUT`s to `uploadUrl`:

```http
PUT <uploadUrl>
Content-Type: application/pdf
Content-Length: 1450231

<binary>
```

The presigned URL pins both `Content-Type` and `Content-Length`. Mismatched
headers cause R2 to reject the upload — the row stays `pending` and the
client is expected to retry by requesting a new presign.

> [!TIP]
> Don't add the Worker's CORS origin allowlist to the upload step. The browser
> talks directly to R2's S3 endpoint, not the Worker. R2's bucket-level CORS
> policy is what governs that request.

### Step 3 — Finalize

```typescript
POST /admin/topics/:topicId/media/:mediaId/finalize
```

Inside `AdminMediaController.finalizeUpload`:

1. **Lookup + tenancy check.** Row must exist and `record.topicNodeId === topicId`. Otherwise → `404` (don't disclose cross-topic ids).
2. **Idempotent short-circuit.** Already `ready`? Return the row as-is (`200`).
3. **Existence verify.** `storage.objectExists(storageKey)` — if R2 has no object, the upload didn't happen. Return `422 NotUploaded`.
4. **Flip state.** `media.markReady(mediaId)` updates `status = 'ready'`.

The finalize step **must be called explicitly by the client** after the
upload succeeds; there is no R2 webhook driving it. Treat it like a
two-phase commit where the client is the coordinator.

---

## Listing Media

`GET /admin/topics/:topicId/media` returns all rows for the topic
(including `pending`) with **fresh presigned download URLs** materialised on
the fly:

```typescript
if (m.status === Entities.Config.MediaStatus.READY) {
  return { ...m, url: await this.storage.getPresignedDownloadUrl(m.storageKey, { expiresInSeconds: 3600 }) };
}
return m;   // pending rows have no url
```

Notes:

- URLs are **per-request** — they expire in 1 hour. Don't cache them in the
  client beyond that window.
- Pending rows are returned without a `url` so the admin UI can render them
  as "upload in progress" placeholders.
- Public reads (the catalog) go through `topics.router.ts`, which also
  presigns on demand. Storage keys never leak to anonymous clients directly.

---

## Deletion

`DELETE /admin/topics/:topicId/media/:mediaId`:

```typescript
await this.media.softDelete(mediaId);
await this.storage.deleteObject(record.storageKey).catch(() => {});
```

Order matters:

1. **DB first.** Flips status to `deleted` so further reads exclude the row.
2. **Storage second, best-effort.** A failed R2 delete leaves an orphan
   object but never a broken database reference. Orphans are cheap; broken
   references are user-visible.

Topic deletion uses a different path: the `media.topic_node_id` FK is
`ON DELETE CASCADE`, so removing a topic row drops its media rows too. The
storage objects are *not* automatically purged — that's a future sweeper job.

---

## State Machine

```
       presign
   ┌─────────────────┐
   │                 ▼
 (start)        ┌─────────┐  upload + finalize   ┌────────┐
                │ pending │ ───────────────────► │ ready  │
                └────┬────┘                      └───┬────┘
                     │ softDelete                    │ softDelete
                     ▼                               ▼
                ┌─────────┐                     ┌─────────┐
                │ deleted │ ◄──────────────────│ deleted │
                └─────────┘                     └─────────┘
```

Allowed transitions only — anything else is a bug. In particular:

- `pending` → `ready` requires R2 to confirm the object exists.
- `ready` → `pending` is not possible (re-uploads create a new row).
- `deleted` is terminal at the DB layer (no `restore`).

---

## Recovery Stories

### "I requested a presign but never uploaded."

Result: a `pending` row with no R2 object. It's invisible to non-admin
listings and harmless. A future cleanup job can sweep `pending` rows older
than the presign TTL (1 hour). Until that job exists, leave them alone — they
cost nothing.

### "I uploaded but never called finalize."

Result: an R2 object exists but the row is still `pending`. Calling finalize
later succeeds (the existence check passes). If the client gives up, the row
stays `pending` and the storage object is an orphan. Same sweeper concern as
above.

### "Finalize was called twice."

Idempotent. The second call sees `status === 'ready'` and returns the row
without doing anything else.

### "Two presigns for the same file."

Allowed — they produce two distinct `mediaId`s and two distinct storage keys.
Whichever one is finalised becomes the canonical row; the other can be
deleted from the admin UI.

### "Topic deleted while uploads were pending."

The CASCADE drops media rows; storage objects orphan. The future sweeper is
the cleanup mechanism.

---

## Validation Cheat Sheet

| Field | Rule | Source |
|---|---|---|
| `fileName` | 1–255 chars; sanitised to `[a-z0-9._-]`, max 100 chars after slug | `PresignSchema` + `sanitizeFileName` |
| `contentType` | One of `application/pdf`, `video/mp4`, `image/jpeg`, `image/png`, `image/webp` | `ALLOWED_TYPES` enum |
| `sizeBytes` | Positive int, ≤ per-type cap | `PresignSchema` + `SIZE_LIMIT_BYTES` |
| `topicId` | Must reference an existing topic | controller lookup |

Adding a new MIME type means **three coordinated edits**:

1. `ALLOWED_TYPES` in `admin-media.controller.ts`.
2. `SIZE_LIMIT_BYTES` for the same type.
3. The frontend `MediaUploader` accept list (`apps/web/src/components/admin/MediaUploader.tsx`).

---

## Bindings & Configuration

R2 needs **both** the native binding (for fast bucket ops) and the
S3-compatible HTTP client (for presigning). They're not interchangeable.

| Binding | Used by | Notes |
|---|---|---|
| `R2` | `bucket.put/get/delete/head/list` | Cloudflare-native `R2Bucket` binding |
| `R2_S3_ENDPOINT` | `getPresignedUploadUrl/getPresignedDownloadUrl` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `R2_BUCKET_NAME` | Presign URL construction | Bucket name as known to S3 |
| `R2_ACCESS_KEY_ID` (secret) | S3 client credentials | Created in R2 dashboard → Manage R2 API Tokens |
| `R2_SECRET_ACCESS_KEY` (secret) | S3 client credentials | Same |
| `R2_PUBLIC_BASE` (optional) | `getPublicUrl` | Only set if the bucket is publicly served |

> [!IMPORTANT]
> R2 access keys are different from the Worker's R2 binding. The binding gives
> the Worker bucket access; the keys let the Worker **generate URLs the
> browser can use** without going through the Worker. Both are required.

---

## Anti-Patterns

| Don't | Do |
|---|---|
| Stream uploads through the Worker | Presign and let the browser talk to R2 directly |
| Embed the original filename in the storage key | Sanitise via `sanitizeFileName`; prepend the `mediaId` |
| Insert the row only after R2 reports success | Insert `pending` first; finalize on confirmation |
| Skip the `objectExists` check in `finalize` | Always verify — clients can't be trusted to have actually uploaded |
| Hard-delete media on `DELETE` | Soft-delete (`status = 'deleted'`) and best-effort R2 delete |
| Cache the presigned download URL across pages | Re-presign per request (1-hour TTL) |
| Add a new MIME type without updating both `ALLOWED_TYPES` and `SIZE_LIMIT_BYTES` | Edit the two tables in lockstep |
| Trust `topicId` from the URL alone | Always re-check `record.topicNodeId === topicId` to prevent cross-topic enumeration |

---

## Related Files

| File | Role |
|---|---|
| `apps/api/src/controllers/admin-media.controller.ts` | Presign / list / finalize / delete logic, validation tables |
| `apps/api/src/routes/admin-media.router.ts` | HTTP wiring; mounts under `/admin/topics` |
| `apps/api/src/adapters/storage/r2-storage-adapter.ts` | Native R2 + S3 presign implementation |
| `apps/api/src/adapters/db/d1-media-repository.ts` | `pending` / `ready` / `deleted` state transitions |
| `apps/api/migrations/0006_create_media.sql` | `media` table schema |
| `packages/shared/ports/i-storage-adapter.ts` | Storage port (presign / put / delete / list) |
| `packages/shared/ports/i-media-repository.ts` | `IMediaRepository` contract |
| `apps/web/src/components/admin/MediaUploader.tsx` | Browser side: requests presign, PUTs to R2, calls finalize |
| `apps/web/src/components/catalog/MediaViewer.tsx` | Public viewer that consumes presigned download URLs |
| `docs/product/api/adapter-wiring.md` | Where the R2 adapter is constructed (per-request) |
