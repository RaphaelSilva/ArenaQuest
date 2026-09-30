# Task 04 — Backend: topic media finalize must enforce the stored object's real size

**Status:** 📝 Open
**Team:** Backend API
**Complexity:** Small
**Priority:** Medium (recommended)
**Category:** Security / Media integrity
**Found in:** Milestone 20, Tasks 01 and 04; RFC 0014 §3
**Dependencies:** None. Related to, but independent from, [Backlog Refactoring 08](../refactoring/08-presigned-max-size-pins-rather-than-caps.task.md).

## Summary

The topic-media presign endpoint validates the client-declared `sizeBytes` against the
shared media ceiling, but `AdminMediaController.finalizeUpload()` only calls
`storage.objectExists()`. It therefore marks any object at the pending row's key as
`ready` without checking how many bytes actually reached storage.

The normal presigned path is narrower than this first appears: R2 signs the declared
`Content-Length`, so a caller cannot use that URL to upload a differently sized body.
The remaining gap is an object written or replaced out of band, for example with bucket
credentials. Finalize is the last trust boundary before the object becomes readable and
must enforce the ceiling against storage metadata, not only against the earlier claim.

Change topic-media finalize to read the object through the existing
`IStorageAdapter.headObject()`, compare `stored.size` with the ceiling for the media row's
persisted `type`, delete an oversized object, keep its row `pending`, and return the
existing `422 FileTooLarge` error. This matches the event-flyer precedent without adding a
port method, schema migration, service or second limits table.

Recommended priority is **Medium**: the normal presigned flow already pins the exact size,
so this is not an unauthenticated direct-upload exploit; however, the missing server-side
invariant allows an out-of-band object to bypass a documented security and cost control,
and the fix is small and already proven by the event lifecycle.

## Context and current behaviour

The current topic flow is:

```text
client/importer
  ├─ POST /v1/admin/topics/{topicId}/media/presign
  │    ├─ validate declared type and size
  │    ├─ create media(status=pending, sizeBytes=declared)
  │    └─ sign PUT with declared Content-Length
  ├─ PUT bytes directly to R2
  └─ POST /v1/admin/topics/{topicId}/media/{mediaId}/finalize
       ├─ objectExists(storageKey)
       └─ markReady(mediaId)             ← no stored-size check
```

Relevant existing contracts:

- `packages/shared/domain/media/limits.ts` is the source of truth for the five accepted
  MIME types and their ceilings (images 5 MB, PDF 25 MB, MP4 100 MB).
- `IStorageAdapter.headObject(key)` already returns `{ key, size, lastModified, ... }` or
  `null`; the R2 adapter implements it through the bound bucket.
- `AdminEventsController.finalizeFlyer()` already uses this primitive, distinguishes a
  missing object from an oversized one, deletes oversized bytes and leaves the row
  pending.
- `scripts/content/import-media.mjs` uses the public API's same
  `presign → PUT → finalize` lifecycle. It preflights source bytes and sends the exact
  `Content-Length`; it does not write to R2 through a privileged side channel.

## Objectives

1. Make the configured media ceiling a server-side invariant at the transition from
   `pending` to `ready`.
2. Remove an oversized object instead of leaving rejected bytes consuming storage.
3. Preserve all successful backoffice and bulk-import flows, including resume after an
   interrupted upload.
4. Reuse the existing storage port, error shape and shared limits table.
5. Keep this change independently deployable and reversible, with no data migration.

## Non-goals

- Renaming or changing `PresignedUrlOptions.maxSizeBytes`. Its misleading name and exact
  `Content-Length` semantics remain exclusively in Backlog Refactoring 08.
- Replacing presigned `PUT` with an S3 POST policy, proxying bytes through the Worker, or
  changing R2 credentials and bucket policy.
- Changing accepted MIME types or any size ceiling.
- Comparing stored size for exact equality with the declared `media.sizeBytes`. The
  security invariant here is `stored.size <= ceiling`; the presigned path already pins
  equality. Enforcing equality for privileged/out-of-band writes is a separate product
  decision.
- Rewriting importer retry, ledger or preflight logic.
- Revalidating or scanning media rows already marked `ready`. This task protects future
  pending-to-ready transitions only.
- Adding a queue, cron cleanup, metrics service or database column.

## Recommended design

### Finalize algorithm

For a pending media row that belongs to the requested topic:

```text
find media row
  ├─ absent/wrong topic      → 404 NotFound
  ├─ already ready           → 200 current row (idempotent; no HEAD)
  └─ pending
       ├─ persisted type unknown → 422 UnsupportedMediaType; keep pending
       └─ known type → headObject(storageKey)
            ├─ null          → 422 NotUploaded; do not delete; keep pending
            ├─ size > limit  → deleteObject(storageKey)
            │                  keep pending; never call markReady
            │                  return 422 FileTooLarge
            └─ size <= limit → markReady(mediaId); return 200
```

Implementation rules:

- Derive the ceiling from the row's persisted `type` through
  `mediaSizeLimitFor(record.type)` or the existing shared table. Never trust a type sent to
  finalize; finalize has no body.
- `mediaSizeLimitFor()` can return `null` because persisted media types are represented as
  `string`. Treat an unknown/corrupt persisted type as `422 UnsupportedMediaType`, keep the
  row pending and perform neither storage I/O nor `markReady()`; never substitute a fallback
  ceiling or let a `null` comparison admit the object.
- Replace `objectExists()` with one `headObject()` call. Do not call both: `HEAD` already
  answers existence and size, and a second check adds latency plus a time-of-check race.
- Keep the existing idempotent early return for a `ready` row. This task does not
  retroactively inspect ready media.
- Call `markReady()` only after a non-null head whose size is at or below the ceiling.
- Preserve the existing `422 NotUploaded` response for a null head.
- For oversize, return `422 FileTooLarge` with `maxBytes` and `storedBytes`, matching the
  event-flyer error semantics. Do not expose storage keys in the response.
- Delete the oversized key before returning `FileTooLarge`. As in the flyer path, a
  deletion failure is logged with operation and key, the row remains pending, and
  `markReady()` is never called. A later finalize retries `HEAD` and cleanup. The bucket is
  private and pending media receives no download URL, so cleanup failure leaves an
  operational orphan, not readable media.
- Let `headObject()` failures follow the existing API error boundary; do not reinterpret a
  storage outage as `NotUploaded` and do not mark the row ready on uncertainty.
- No repository signature changes are required. `media.sizeBytes` continues to hold the
  declared value; on the normal signed path it equals the stored size.

### Bulk importer interaction

No production change to `scripts/content/import-media.mjs` is expected:

- Its preflight still rejects source files above the same limits before the first write.
- Its `PUT` sends the exact scanned length required by the signed URL, so ordinary imports
  pass the new `HEAD` check.
- A run interrupted after `PUT` resumes by calling finalize only; valid stored bytes become
  ready without a re-upload.
- If an uploaded/presigned ledger entry points at an out-of-band oversized object,
  finalize returns `422`. The existing recovery branch treats that pending row as stale,
  deletes it through the API, presigns again and uploads the valid source bytes. Add a
  script-level regression test that pins this behaviour; do not broaden the catch or add a
  direct R2 path.
- A fresh run that unexpectedly receives `FileTooLarge` at its final finalize remains a
  failed file with ledger state `uploaded`; on rerun the recovery path above repairs it.
  The importer must never write `ready` after a failed finalize.

## Scope and guardrails

In scope:

- `apps/api/src/controllers/admin-media.controller.ts` — finalize uses `headObject`, the
  shared limit, cleanup and the existing controller-result vocabulary.
- `apps/api/test/controllers/admin-media.controller.spec.ts` — business-rule and failure
  ordering tests.
- `apps/api/test/routes/admin-media.router.spec.ts` — a real R2-bound adversarial test,
  modelled on the flyer route test, that bypasses presign to place oversized bytes.
- `scripts/content/import-media.test.mjs` — importer compatibility/resume regression only.
- Documentation comments that currently say topic finalize only checks existence.

Guardrails:

- `scripts/content/import-media.mjs` must be byte-unchanged unless a failing regression
  test demonstrates an actual compatibility defect. A speculative importer rewrite fails
  review.
- No change to `packages/shared/ports/i-storage-adapter.ts`,
  `apps/api/src/adapters/storage/r2-storage-adapter.ts`, database migrations,
  `IMediaRepository`, route paths or request schemas.
- No change to `PresignedUrlOptions.maxSizeBytes` or either presign call site; that is
  Backlog Refactoring 08.
- No duplicated limit literal. All ceilings come from
  `packages/shared/domain/media/limits.ts`.
- The `ready` transition must be dominated by the stored-size check: no branch may call
  `markReady()` after a null head, an oversized head or a head failure.
- Do not make storage cleanup a hard delete of the media row. Keeping it pending preserves
  the current retry and importer recovery contracts.

## Alternatives considered

### A. Rely only on the signed `Content-Length` — rejected

This protects the ordinary presigned path, but finalize would still trust an object written
or replaced with bucket credentials. It also makes a storage-independent controller rule
depend implicitly on one adapter's signing behaviour. Cost is lowest, but the documented
ceiling is not an invariant at the state transition.

### B. Recheck the source only in the browser/importer — rejected

Client checks improve UX but are not a security boundary. They do not cover other API
clients or out-of-band writes and cannot decide whether the stored key changed after PUT.

### C. Download the object and count bytes in the Worker — rejected

It verifies size but routes up to 100 MB through Worker memory and bandwidth when metadata
already exposes the authoritative byte count. This is slower, more expensive and more
failure-prone than `HEAD`.

### D. Introduce a generic “validate uploaded object” service/helper — rejected for now

Topic media and event flyers are the only two call sites, and both already have short,
domain-specific finalize logic. A new abstraction would add indirection without removing a
provider leak or a third implementation. Reconsider only if another lifecycle appears or
if the two implementations materially drift.

### E. Make cleanup failure a new `503 StorageCleanupFailed` contract — rejected

It adds a public error and route-schema branch for an object that remains private and
pending. Logging the failure, refusing `ready`, and retrying cleanup on the next finalize
matches the established flyer lifecycle and keeps the API contract smaller. The risk is an
orphan until retry; operational logs make that recoverable.

## Risks and mitigations

- **R2 metadata outage increases finalize failures.** Fail closed: keep rows pending and
  surface the existing server error. Monitor Worker errors during rollout; do not fall back
  to `objectExists()`.
- **Cleanup can fail after oversize detection.** The object stays private and the row stays
  pending; log operation/key, never return a download URL, and retry cleanup on the next
  finalize or API delete.
- **Importer regression.** Keep its production script unchanged and run both API and script
  suites. Pin resume from a finalize `422 FileTooLarge` in `import-media.test.mjs`.
- **Limit drift.** Use the persisted content type with the shared lookup; add adversarial
  cases for image, PDF or MP4 rather than embedding a test-only generic ceiling.
- **TOCTOU replacement after `HEAD`.** The storage key is unguessable and writable only via
  a short-lived exact-size signed URL or privileged bucket credentials. This task closes
  the missing validation at finalize but cannot make compromised storage credentials safe;
  credential rotation and bucket IAM remain the control for that threat.
- **Existing ready oversized objects remain untouched.** Explicit rollout limitation. If an
  audit later finds such rows, file a separate reconciliation task rather than expanding
  this online request path.

## Rollout and rollback

1. Land tests and controller change together; no feature flag or migration is needed.
2. Deploy to staging and exercise one valid object at each boundary class (image/PDF/MP4),
   one missing object and one out-of-band oversized object.
3. Run a small bulk import against staging and then rerun it to confirm the second run is a
   no-op for ready entries.
4. Monitor `FileTooLarge`, storage-head failures and cleanup-error logs before production.
5. Deploy normally. Pending rows created before deployment are compatible and receive the
   stricter check when finalized.

Rollback is a code-only revert from `headObject()` to the previous existence check plus its
tests. There is no schema or data rollback. Ready rows remain readable, pending rows remain
retryable, and importer ledgers remain valid. Rollback reopens the size-validation gap, so
use it only for a demonstrated storage-metadata compatibility problem, not for isolated
malicious or oversized uploads.

## Acceptance criteria

- [ ] `AdminMediaController.finalizeUpload()` calls `headObject()` exactly once for pending
      media and no longer calls `objectExists()`.
- [ ] A missing object returns `422 NotUploaded`, is not deleted and never calls
      `markReady()`.
- [ ] An unknown persisted media type returns `422 UnsupportedMediaType`, performs no
      storage I/O and never calls `markReady()`.
- [ ] Stored bytes at exactly the type's ceiling become `ready`.
- [ ] Stored bytes one byte above the type's ceiling return `422 FileTooLarge` with
      `maxBytes` and `storedBytes`; the object is removed, the row remains `pending`, and
      `markReady()` is not called.
- [ ] If oversized-object deletion fails, the failure is observable in logs, the row stays
      pending, no download URL becomes available, and a repeated finalize retries cleanup.
- [ ] A `headObject()` error does not become `NotUploaded` or `ready`.
- [ ] Repeating finalize for an already-ready row remains idempotent and performs no storage
      read.
- [ ] The route-level adversarial test writes an oversized object directly to the test R2
      binding, bypasses presign, receives `422 FileTooLarge`, and verifies both R2 deletion
      and the persisted `pending` status.
- [ ] The bulk importer still completes a normal `presign → PUT → finalize`, resumes an
      interrupted valid upload with finalize alone, and recovers an uploaded ledger entry
      whose finalize returns `FileTooLarge` without ever recording a false `ready` state.
- [ ] `scripts/content/import-media.mjs`, storage ports/adapters, repository interfaces,
      migrations, limits and presign option names are unchanged.
- [ ] No size literal is introduced outside the shared limits module or test fixtures.
- [ ] Targeted tests, `make test-api`, `make test-scripts` and `make lint` pass.

## Verification commands

```bash
pnpm --filter api test test/controllers/admin-media.controller.spec.ts
pnpm --filter api test test/routes/admin-media.router.spec.ts
node --test scripts/content/import-media.test.mjs
make test-api
make test-scripts
make lint
git diff --check

git diff --exit-code -- \
  scripts/content/import-media.mjs \
  packages/shared/ports/i-storage-adapter.ts \
  apps/api/src/adapters/storage/r2-storage-adapter.ts \
  apps/api/src/adapters/db/d1-media-repository.ts \
  apps/api/migrations
```

## Review checkpoints

Re-evaluate this decision if any of the following becomes true:

- the upload mechanism changes from presigned `PUT` to a policy that expresses an actual
  upper bound;
- more upload lifecycles need identical validation and a shared domain service would remove
  real duplication;
- R2 `head` metadata proves unreliable in staging;
- operations finds already-ready oversized objects, requiring an offline audit/repair;
- Backlog Refactoring 08 changes the signing contract in a way that alters importer retry
  semantics.
