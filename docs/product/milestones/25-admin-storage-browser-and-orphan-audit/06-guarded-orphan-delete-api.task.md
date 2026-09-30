# Task 06 — Backend: Guarded orphan delete API (Phase 2)

**Status:** 📝 Open
**Milestone:** [25 — Admin storage browser and orphan audit](./milestone.md)
**RFC:** [RFC 0018](../../RFCs/0018-admin-storage-browser-and-orphan-audit.md)
**Team:** Backend API
**Depends On:** [Task 03](./03-admin-storage-api-browse-object-audit.task.md)

## Summary

Adds the milestone's only write: `DELETE /v1/admin/storage/object?key=`, admin only, which
removes an object **only if it is still safe to remove at the moment of the request**. The
controller re-resolves the key through the reference repository and re-reads its head, and
deletes only when the object is `orphan` or `deleted-row` **and** its upload time is older than
`ORPHAN_GRACE_MS` (24 h, well above the 1 h media presign TTL and the flyer TTL, so an upload
between PUT and finalize can never be removed from under its owner). Anything else — `linked`,
`pending`, `displaced`, or too recent — answers `409` with the current classification and leaves
the object in place; an absent key answers `404`. The delete touches storage only: no DB row is
changed, including the soft-deleted `media` row of a `deleted-row` object (Milestone Decisions
1, 4). Each successful deletion emits one structured `storage.orphan.deleted` log line with
key, size and acting admin id (Decision 3). Task 07 wires it into the browser.

## Dependencies

- [Task 03](./03-admin-storage-api-browse-object-audit.task.md) — hard code dependency: the
  router, controller and classification rule this route reuses.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/controllers/admin-storage.controller.ts` — the delete method.
  - `apps/api/src/routes/admin/storage.ts` — the `DELETE /object` route.
  - `apps/api/src/openapi/components/entities.ts` — the `409` body schema, if not already
    covered by `ClassifiedObject`.
  - `apps/api/openapi.json` — regenerated with `pnpm dump-openapi`.
  - `apps/api/test/storage/**` — delete specs.
- **One classification rule.** The delete reuses Task 03's classifier; it must not carry a second
  copy of the rules.
- **Re-verify at request time.** Classification and age come from reads made inside the same
  request, never from what the client last saw.
- **Storage only.** No D1 write of any kind; the reference repository stays read-only.
- **Audit line shape.** Structured (one JSON object), fixed event name, no secret, no presigned
  URL, no user-supplied string used as a format template.
- **Admin only.** Inherited from the sub-router's `requireRole(ROLES.ADMIN)`; covered by tests.

## Scope

In:
- The route with OpenAPI schema and regenerated `openapi.json`.
- The guarded delete in the controller (re-classify, grace check, delete, log).
- Specs for every refusal and the success path, plus role checks.

Out:
- Deleting or discarding `pending` uploads, hard-deleting any `media` row, bulk delete — fenced
  out by the milestone.
- Frontend — Task 07.

## Acceptance Criteria

- [ ] `DELETE /object` returns `409` with the current classification for a `linked` media
      object, a `linked` flyer, a `pending` object, a `displaced` object and an orphan uploaded
      1 hour ago; each object is still in the bucket afterwards.
- [ ] On an orphan uploaded 25 hours ago it returns `200`, the object is gone, and exactly one
      `storage.orphan.deleted` line with key, size and admin id is logged.
- [ ] On a `deleted-row` object older than 24 h it returns `200`, the object is gone and the
      `media` row is unchanged (still `deleted`).
- [ ] No D1 row changes during any delete call (row counts and `updated_at` values compared
      before/after in the spec).
- [ ] An absent key returns `404`; no token returns `401`; `content_creator` and `student`
      tokens return `403`.
- [ ] No D1 or R2 import in the controller.
- [ ] Changed files lint clean; `make test-api` green for the affected specs.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api` — delete specs pass.
2. `make dev-api`: put a stray object locally, call `DELETE /object` and confirm `409` (too
   recent); back-date by using a fixture in the spec rather than waiting 24 h.
3. Call `DELETE /object` on a linked media key and confirm `409` and that the media still plays
   in the catalog.
4. `pnpm dump-openapi` produces no further diff.
5. `git diff --stat` confirms only scope-guardrail files changed.
