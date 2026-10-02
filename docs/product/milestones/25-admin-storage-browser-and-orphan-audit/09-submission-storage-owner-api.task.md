# Task 09 — Backend: Register student submissions as a storage key owner (Phase 2)

**Status:** ✅ Done
**Milestone:** [25 — Admin storage browser and orphan audit](./milestone.md)
**RFC:** [RFC 0018](../../RFCs/0018-admin-storage-browser-and-orphan-audit.md)
**Team:** Backend API
**Depends On:** [Task 06](./06-guarded-orphan-delete-api.task.md)

## Summary

M23 (RFC 0020) landed on `main` after this milestone was planned, and added a fourth column
that holds an R2 key: `topic_submissions.storage_key`. Objects under
`submissions/<authorId>/<submissionId>-<name>` are referenced by no owner the registry knows. So
after merging `main`, every student upload classifies as `orphan` / `unknown-shape`, and the
guarded delete would remove it once it is 24 h old. The coverage spec from Task 01 caught this,
which is what it is for. This task registers the owner end to end:
`STORAGE_KEY_OWNERS` gains `topic_submissions.storage_key`; `parseStorageKey` decodes the
`submissions/` shape; `IStorageReferenceRepository` gains a `submission` reference (submission
id, status, title, original name, content type, size, author id + name, topic id + title +
status, creation date); and `D1StorageReferenceRepository` resolves it within the existing
90-key chunk / one-`db.batch` rule, and includes `ready` / `pending` submission keys in
`listReferencedKeys`. A `ready` submission is `linked` and a `pending` one is `pending` (with
`stale`). A `removed` row has `storage_key = NULL`, so it never references anything. An
unreferenced `submissions/` key is an `orphan` with hint `row-gone`.

## Dependencies

- [Task 06](./06-guarded-orphan-delete-api.task.md) — it extends the classifier the delete
  re-checks, and transitively Tasks 01–03.
- `main` merged into `feature/m25/candidate` (M23's migration `0030_create_topic_submissions.sql`).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `packages/shared/domain/storage/key-owners.ts`
  - `packages/shared/ports/i-storage-reference-repository.ts`
  - `apps/api/src/adapters/db/d1-storage-reference-repository.ts`
  - `apps/api/src/controllers/admin-storage.controller.ts` (classification only)
  - `apps/api/src/openapi/components/entities.ts` and the regenerated `apps/api/openapi.json`
  - `apps/api/test/storage/**`
- **Read-only.** No write to `topic_submissions`; no migration; no change to the M23 flows.
- **One classification rule.** Extend `classifyObject`; do not fork it.
- **D1 parameter cap.** Every statement stays at or under 90 bound keys.

## Scope

In:
- The registry entry, the parser shape, the `submission` reference kind, the resolver
  statement, the `listReferencedKeys` phase, the classifier branch, and the OpenAPI schema.
- Specs: the coverage spec green again; `ready` submission → `linked`; `pending` → `pending`
  (+ `stale`); an unreferenced `submissions/` key → `orphan` / `row-gone`; `DELETE /object` →
  `409` on a 25 h old `ready` submission object; `/audit/missing` reports a `ready` submission
  whose object is gone.

Out:
- Frontend — Task 10.
- Any change to the submissions feature itself.

## Acceptance Criteria

- [x] `key-owners-coverage.spec.ts` passes on the merged migrations, `0030` included.
- [x] `parseStorageKey` returns `submission` with author id, submission id and file name for a
      `submissions/` key.
- [x] `resolveKeys` returns a `submission` reference with author name and topic title, and
      stays at one `db.batch` per 90-key chunk.
- [x] A `ready` submission object is `linked`, a `pending` one is `pending`, and an
      unreferenced `submissions/` key is `orphan` with hint `row-gone`.
- [x] `DELETE /object` returns `409` for a 25 h old `ready` submission object, and the object stays.
- [x] `/audit/missing` includes a `ready` submission whose object was never put.
- [x] `apps/api/openapi.json` is regenerated; changed files lint clean; `make test-api` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api` — the storage specs, the coverage spec included, pass on the merged tree.
2. `pnpm dump-openapi` produces no further diff.
3. `make lint`.
4. `git diff --stat` confirms only scope-guardrail files changed.
