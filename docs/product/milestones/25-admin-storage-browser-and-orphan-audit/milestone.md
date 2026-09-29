# Milestone 25 — Admin storage browser and orphan audit

**Status:** 📝 Draft
**Scope:** `packages/shared` (storage port folder listing, new storage-reference port, key-owner registry), `apps/api` (read-only D1 resolution adapter, admin-only `/v1/admin/storage/*` router and controller, guarded orphan delete), `apps/web` (admin-only `/admin/storage` page, sidebar item, i18n). Derived from [RFC 0018](../../RFCs/0018-admin-storage-browser-and-orphan-audit.md).

> **Hard scope guardrail — read before opening any task.** This milestone may touch **only**: `packages/shared/ports/i-storage-adapter.ts` (the `listObjects` options object, `prefixes`, `StorageObject.contentType`) and the matching `apps/api/src/adapters/storage/r2-storage-adapter.ts`; the two existing `listObjects` test doubles in `apps/api/test/controllers/{topics,admin-media}.controller.spec.ts`; the new files `packages/shared/ports/i-storage-reference-repository.ts` (plus its re-export in `ports/index.ts`), `packages/shared/domain/storage/key-owners.ts`, `apps/api/src/adapters/db/d1-storage-reference-repository.ts`, `apps/api/src/controllers/admin-storage.controller.ts`, `apps/api/src/routes/admin/storage.ts`, `apps/api/test/storage/**`; the wiring lines in `apps/api/src/routes/admin/index.ts` and `apps/api/src/container.ts`; new schemas in `apps/api/src/openapi/components/entities.ts` and the regenerated `apps/api/openapi.json`; the new `apps/web/src/lib/admin-storage-api.ts`, `apps/web/src/app/(protected)/admin/storage/**`, `apps/web/src/components/admin/storage/**`, one item in `apps/web/src/components/layout/admin-sidebar.tsx`, the regenerated `apps/web/src/lib/api-types.gen.ts` and both i18n dictionaries; and, for the closeout only, `docs/product/FEATURES.md`, RFC 0018's `Status:` header and its README row, and — only if the §3 latency criterion fails — one backlog task file under `docs/product/backlog/` for the `media.storage_key` index. It is explicitly **not** an opportunity to: **upload, rename or move objects** from this page (the topic media uploader and the RFC 0014 flyer flow keep owning writes); **open the page to `content_creator`** in any form; add a **scheduled garbage collector** or any Cron Trigger; **fix the root causes** of drift (`deleteMedia`'s swallowed `.catch`, the displaced-flyer delete, `ON DELETE CASCADE` on `media`, the repositories' hard `delete`) — they are made visible here and fixed in separate backlog items; write to **any DB row** (no status change, no hard-delete of `pending` or `deleted` media rows); add a **migration** (no `storage_objects` inventory, no audit table, no index on `media.storage_key` unless the §3 latency criterion fails and it is filed as its own task); or build a **cross-tenant** view. If a refactor opportunity is spotted outside this scope, file a separate task — do not bundle it.

---

## 1. Objectives

- **The bucket can be browsed as folders.** `IStorageAdapter.listObjects` accepts a `delimiter` and returns `prefixes`, so `topics/` lists one entry per topic folder instead of every object (RFC §1).
- **"Which columns hold an R2 key" lives in one place and CI enforces it.** `STORAGE_KEY_OWNERS` + `parseStorageKey`, guarded by a spec that fails on any unregistered `*_key` column in the migrations (RFC §2).
- **Every object is resolved to its owner by name.** One batched D1 lookup over `media` and `events` returns topic title, event title, original file name and uploader for each key (RFC §3).
- **One server-side classification.** `linked` · `pending` (+ `stale`) · `displaced` · `deleted-row` · `orphan` (+ hint), and the row-side `missing-object` (RFC §4).
- **An admin can audit the whole bucket on demand.** Stateless cursor pages, driven and stoppable from the browser, in both directions: objects nobody owns and rows whose object is gone (RFC §5).
- **An admin can remove a true orphan — and nothing else.** The delete re-classifies at request time and refuses anything referenced or younger than 24 h (RFC §6).
- **Admin-only, end to end.** `requireRole(ROLES.ADMIN)` on the router, `requiredRoles: [ROLES.ADMIN]` in the sidebar, a redirect on the page (RFC §5, §7).

Out of scope (explicit, from RFC 0018 Non-Goals):
- **Uploading, renaming or moving objects** — stays with the topic media uploader and the RFC 0014 flyer flow.
- **Access for `content_creator`** — the bucket view crosses every topic and event, including drafts and restricted events (RFC Alternative 5).
- **Automatic / scheduled garbage collection** — deferred until the classification has been observed correct in production; would reuse `/audit` (RFC Alternative 4).
- **Fixing the drift root causes** — separate backlog items; this milestone makes them visible.
- **Cleaning stale `pending` uploads** — shown, never removed here; cleanup belongs to the owning flows (Decision 1).
- **Cross-tenant views** — one Worker, one bound `R2` bucket, one label.

---

## 2. Functional Requirements

**Folder browsing**
- `GET /v1/admin/storage/browse?prefix=&cursor=&limit=` returns `{ prefix, folders, objects, nextCursor? }` for one folder; `prefix` is `''` (bucket root) or ends with `/`, otherwise `400`. `limit` defaults to 100, max 1000.
- Folders are the delimited prefixes directly under `prefix`; a `topics/<id>/` or `events/<id>/` folder carries the owner's title when the topic/event exists, or a "no longer exists" flag when it does not.
- Each object carries key, display name (last path segment), size, upload date, content type, status, `stale` (for `pending`), its references and an orphan `hint`.
- Pagination continues strictly on `nextCursor`; a short page with a cursor is not the end.

**Resolution and classification**
- A key referenced by a `ready` media row or by `events.flyer_key` with `flyer_status = 'ready'` is `linked`, showing topic/event title, original name and uploader.
- A key referenced by a `pending` media row or a `pending` flyer is `pending`; it is flagged `stale` when older than 24 h.
- A key referenced only as `events.flyer_replaced_key` is `displaced`.
- A key referenced only by `deleted` media rows is `deleted-row`.
- A key with no reference is `orphan`, with hint `owner-topic-gone`, `owner-event-gone`, `row-gone` or `unknown-shape` from `parseStorageKey`.

**Object detail**
- `GET /v1/admin/storage/object?key=` returns head, all references, the classification and a presigned download URL valid for 5 minutes; an unknown key returns `404`.

**Audit**
- `GET /v1/admin/storage/audit?cursor=&limit=` walks the bucket flat and returns only non-`linked` objects plus `{ scanned, nextCursor? }`; `limit` defaults to and caps at 1000.
- `GET /v1/admin/storage/audit/missing?cursor=&limit=` walks every `ready`/`pending` reference and returns those whose object does not exist; `limit` defaults to and caps at 50.
- Neither audit writes anything or keeps server-side state.

**Guarded delete (Phase 2)**
- `DELETE /v1/admin/storage/object?key=` deletes the object only when, at request time, it is `orphan` or `deleted-row` **and** older than 24 h; otherwise `409` with the current classification. A missing key is `404`.
- It never changes a DB row. Each deletion emits one structured `storage.orphan.deleted` log line (key, size, admin user id).

**Cross-cutting**
- Every `/v1/admin/storage/*` route answers `401` without a token and `403` for `content_creator` and `student`.
- The *Storage* sidebar item is visible only to `admin`; the page redirects any other role.
- Every user-facing string comes from `adminStorage:` in both dictionaries, with identical keys.

---

## 3. Acceptance Criteria

- [ ] `listObjects('topics/', { delimiter: '/' })` against a miniflare R2 with two topic folders returns two `prefixes` and zero `objects`; without `delimiter`, `prefixes` is `[]`.
- [ ] `key-owners-coverage.spec.ts` passes on the current migrations and fails on a fixture migration that adds an unregistered `thumbnail_key` column.
- [ ] `D1StorageReferenceRepository.resolveKeys` returns correct references for 91 keys (crossing the 90-key chunk boundary) using one `db.batch` per chunk.
- [ ] With one fixture object per status (`linked` media, `linked` flyer, `pending`, stale `pending`, `displaced`, `deleted-row`, orphan with each hint), `/browse` and `/audit` classify every object as specified in §2; `/audit` omits the `linked` ones.
- [ ] `/audit/missing` reports exactly the fixture `ready` row whose object was never put, and nothing else.
- [ ] A `content_creator` token gets `403` and a `student` token gets `403` on each of `/browse`, `/object`, `/audit`, `/audit/missing` and `DELETE /object`; no token gets `401`.
- [ ] `DELETE /object` returns `409` for a `linked`, `pending`, `displaced` and a 1-hour-old orphan, and leaves each object in the bucket; on a 25-hour-old orphan it returns `200`, the object is gone, no D1 row changed, and one `storage.orphan.deleted` line is logged.
- [ ] An `/audit` page of 1000 keys completes in under 2 s on staging (if not, an index task is filed — not bundled).
- [ ] In the web app, an admin navigates root → `topics/` → a topic folder and sees the topic title and each file's original name; the sidebar item is absent for a `content_creator` session (RTL test).
- [ ] The scan panel accumulates pages until `nextCursor` is absent, shows the `scanned` count, stops on demand, and totals reclaimable bytes by status (RTL test with a mocked client).
- [ ] `check-i18n-coverage.js` passes; `dict-en.ts` and `dict-pt.ts` have identical `adminStorage` keys.
- [ ] `make lint`, `make test-api` and `make test-web` pass green.
- [ ] No diff outside the files listed in the guardrail; no new file under `apps/api/migrations/`.

---

## 4. Specific Stack

- **Backend:** Cloudflare Workers + Hono (`OpenAPIHono`); routes declared with `@hono/zod-openapi` `createRoute`, controllers return `ControllerResult<T>`; adapters built per request in the container. R2 through the native `R2Bucket` binding (`list` with `delimiter`/`include`, `head`, `delete`); presigned preview URLs through the existing S3 client in `R2StorageAdapter`. D1 lookups chunked at 90 bound keys inside `db.batch`.
- **Shared:** `IStorageAdapter` (`ListObjectsOptions`, `ListObjectsResult.prefixes`, `StorageObject.contentType`), new `IStorageReferenceRepository` + `StorageReference`, new `domain/storage/key-owners.ts` (`STORAGE_KEY_OWNERS`, `parseStorageKey`, `ORPHAN_GRACE_MS = 24 h`).
- **Frontend:** Next.js 15 App Router, React 19, Tailwind CSS v4, client page under `(protected)/admin/storage`; `useHasRole(ROLES.ADMIN)` gate; `admin-storage-api.ts` over the centralized `api-client`; `useDict()` with both dictionaries; `check-i18n-coverage.js`.
- **Tests:** Vitest + `@cloudflare/vitest-pool-workers` with miniflare R2 and D1 (API); Vitest + React Testing Library (web).

---

## 5. Task Breakdown

| # | Task File | Phase | Team | Status |
|---|-----------|-------|------|--------|
| 01 | [Storage port folder listing and key-owner registry](./01-storage-port-folder-listing-and-key-owner-registry.task.md) | 0 | Backend | ✅ Done |
| 02 | [Storage reference port and D1 resolver](./02-storage-reference-port-and-d1-resolver.task.md) | 1 | Backend | ✅ Done |
| 03 | [Admin storage API: browse, object and audit](./03-admin-storage-api-browse-object-audit.task.md) | 1 | Backend | ✅ Done |
| 04 | [Admin storage browser page](./04-admin-storage-browser-page.task.md) | 1 | Frontend | ✅ Done |
| 05 | [Orphan and missing-file scan panel](./05-orphan-and-missing-file-scan-panel.task.md) | 1 | Frontend | ✅ Done |
| 06 | [Guarded orphan delete API](./06-guarded-orphan-delete-api.task.md) | 2 | Backend | ☐ Open |
| 07 | [Delete orphan action in the browser](./07-delete-orphan-action.task.md) | 2 | Frontend | ☐ Open |
| 08 | [Docs and rollout closeout](./08-docs-and-rollout-closeout.task.md) | 3 | Backend | ☐ Open |

Dependency graph:

```
01 ──► 02 ──► 03 ──┬──► 04 ──┬──► 05
                   │         │
                   └──► 06 ──┴──► 07
                                   │
                        05, 07 ────┴──► 08
```

**Recommended execution order:** `01` → `02` → `03` → `04` → `05` → `06` → `07` → `08`.

Phase 1 (`01`–`05`) is read-only and shippable on its own: after it merges, admins can browse and audit with no way to delete. Phase 2 (`06`–`07`) adds the only write.

Each task is intended to land as an independent PR into the `feature/m25/candidate` branch with `make lint`, `make test-api`, and `make test-web` passing.

---

## 6. Decisions recorded (from RFC 0018 "Resolved Decisions")

1. **Stale `pending` uploads are shown, never cleaned here** — flagged `stale` in the browser; cleanup belongs to the owning flows (media uploader, flyer), so this milestone writes no DB row. *(owner, 2026-09-29)*
2. **Grace window is a fixed 24 h** — a constant in `packages/shared/domain/storage/key-owners.ts`, well above the 1 h media presign TTL and the flyer TTL; no per-environment binding. *(owner, 2026-09-29)*
3. **Deletions are audited by a structured log line** — `storage.orphan.deleted` (key, size, admin id) in the Worker logs, like billing's audit lines; no audit table, no migration. *(owner, 2026-09-29)*
4. **`deleted` media rows are kept** — deleting a `deleted-row` object removes only the object; the soft-deleted row stays as history. *(owner, 2026-09-29)*
5. **Admin only** — the router carries its own `requireRole(ROLES.ADMIN)`, as billing does; the umbrella's `content_creator` admission does not apply (RFC Alternative 5).
6. **Owners are resolved from the database, not from R2 metadata** — presigned PUTs make metadata client-controlled and it is absent on existing objects; the key path only feeds the orphan hint (RFC Alternative 2).
7. **No inventory table and no server-side full scan** — live join per page; the audit is stateless and client-driven (RFC Alternatives 3, 6).

---

## 7. Definition of Done (milestone level)

- [ ] All tasks marked Done with every acceptance box checked.
- [ ] All milestone-level acceptance criteria in §3 pass.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] Closeout note written at `./closeout-analysis.md`.
- [ ] RFC 0018 status set to `Implemented` in its header and
      `docs/product/RFCs/README.md`; deferred items remain backlog.
- [ ] No diff outside the scope declared in the guardrail.
