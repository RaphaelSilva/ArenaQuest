# Task 03 — Backend: Admin storage API: browse, object and audit (Phase 1)

**Status:** 📝 Open
**Milestone:** [25 — Admin storage browser and orphan audit](./milestone.md)
**RFC:** [RFC 0018](../../RFCs/0018-admin-storage-browser-and-orphan-audit.md)
**Team:** Backend API
**Depends On:** [Task 02](./02-storage-reference-port-and-d1-resolver.task.md)

## Summary

Ships the whole **read-only** admin storage API under `/v1/admin/storage`, admin only. A new
sub-router carries its own `requireRole(ROLES.ADMIN)` (the `/v1/admin` umbrella also admits
`content_creator`, as billing already works around), and `AdminStorageController` returns
`ControllerResult<T>` for four routes: `GET /browse?prefix=&cursor=&limit=` (one folder:
delimited sub-folders labelled with their topic/event title or a "no longer exists" flag, then
classified objects; `prefix` is `''` or ends with `/`, `limit` 1–1000, default 100);
`GET /object?key=` (head, references, classification, and a presigned download URL valid 5
minutes; unknown key → `404`); `GET /audit?cursor=&limit=` (a flat page of up to 1000 keys,
returning only non-`linked` objects plus `scanned` and `nextCursor`); and
`GET /audit/missing?cursor=&limit=` (up to 50 referenced keys per page, returning those whose
object does not exist). Classification is one controller rule — `linked`, `pending` (with
`stale` past `ORPHAN_GRACE_MS`), `displaced`, `deleted-row`, `orphan` with a hint
(`owner-topic-gone`, `owner-event-gone`, `row-gone`, `unknown-shape`) — and the row-side
`missing-object`, exactly as in the milestone's §2. Nothing is written and no scan state is
kept. Task 04/05 consume these routes; Task 06 adds the only write.

## Dependencies

- [Task 02](./02-storage-reference-port-and-d1-resolver.task.md) — hard code dependency (the
  resolver), and transitively Task 01 (folder listing, registry, grace constant).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/controllers/admin-storage.controller.ts` (new).
  - `apps/api/src/routes/admin/storage.ts` (new) and one mount line in
    `apps/api/src/routes/admin/index.ts`.
  - `apps/api/src/container.ts` — only to hand the controller its dependencies, if Task 02's
    wiring is not enough.
  - `apps/api/src/openapi/components/entities.ts` — `ClassifiedObject`, `StorageReference`,
    browse/audit response schemas.
  - `apps/api/openapi.json` — regenerated with `pnpm dump-openapi`, not hand-edited.
  - `apps/api/test/storage/**` — controller and router specs.
- **Validation & results.** Routes are declared with `@hono/zod-openapi` `createRoute` (the
  house pattern — there are no `@ValidateBody` decorators); query parsing and the `prefix`
  shape rule live in the route schema; the controller returns explicit `400`/`404` branches.
- **Admin only.** `requireRole(ROLES.ADMIN)` on the whole sub-router; `401` without a token,
  `403` for `content_creator` and `student`.
- **Keys are untrusted input.** A key or prefix is only ever an R2 key or a bound SQL value —
  never interpolated into a path, SQL string or log message template.
- **Bounded work per request.** `/audit` ≤ 1000 keys; `/audit/missing` ≤ 50 `head` calls; the
  controller loops the storage listing on `nextCursor` only when filling a page, never across
  pages.
- **Read-only.** No storage delete, no D1 write.

## Scope

In:
- The four routes with their OpenAPI schemas and the regenerated `openapi.json`.
- The classification rule and the orphan hint, using `parseStorageKey` and `existingOwners`.
- Folder labels for `topics/<id>/` and `events/<id>/` prefixes.
- The 5-minute presigned preview URL on `/object`.
- Specs with one fixture per status (linked media, linked flyer, pending, stale pending,
  displaced, deleted-row, orphan per hint), the missing-object case, role checks and the `400`
  prefix rule.

Out:
- `DELETE /object` — Task 06.
- Frontend — Tasks 04, 05.
- Fixing any drift root cause (swallowed deletes, cascades) — milestone guardrail.

## Acceptance Criteria

- [ ] `/browse?prefix=topics/` returns one folder per topic, each labelled with its topic title,
      and a folder for a deleted topic flagged as gone.
- [ ] `/browse` on a topic folder classifies each fixture object with the status and hint listed
      in the milestone's §2; `stale` is set only on the pending object older than 24 h.
- [ ] `/browse?prefix=topics` (no trailing slash) returns `400`.
- [ ] `/object` returns references, classification and a presigned URL for a known key, and
      `404` for an unknown key.
- [ ] `/audit` over the fixtures returns every non-`linked` object and none of the `linked`
      ones, with `scanned` equal to the number of keys walked; following `nextCursor` reaches
      the end.
- [ ] `/audit/missing` returns exactly the `ready` row whose object was never put.
- [ ] Each route returns `401` without a token and `403` for `content_creator` and `student`
      tokens.
- [ ] No D1 or R2 import in the controller; the storage and reference ports are its only
      dependencies.
- [ ] `apps/api/openapi.json` is regenerated and matches the routes.
- [ ] Changed files lint clean; `make test-api` green for the affected specs.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api` — controller and router specs pass.
2. `make dev-api`, sign in as the seeded admin, upload one topic media through the backoffice,
   then `curl` `/browse` from the root down to that topic folder and `/object` on the key.
3. Put an object by hand with `wrangler r2 object put --local` under `topics/<random-uuid>/` and
   confirm `/audit` reports it as `orphan` / `owner-topic-gone`.
4. Repeat one call with the seeded content-creator account and confirm `403`.
5. `pnpm dump-openapi` produces no further diff.
6. `git diff --stat` confirms only scope-guardrail files changed.
