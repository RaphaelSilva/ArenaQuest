# Task 01 — Backend: Storage port folder listing and key-owner registry (Phase 0)

**Status:** ✅ Done
**Milestone:** [25 — Admin storage browser and orphan audit](./milestone.md)
**RFC:** [RFC 0018](../../RFCs/0018-admin-storage-browser-and-orphan-audit.md)
**Team:** Backend API

## Summary

Gives the storage port the two things every later task stands on. First, **folder listing**:
`IStorageAdapter.listObjects` moves from positional arguments to an options object carrying
`cursor`, `limit` (default 100, capped at R2's 1000) and an optional `delimiter`; the result
gains `prefixes` (the "sub-folders" directly under the prefix, each ending with the delimiter,
empty when no delimiter is passed), and every `StorageObject` gains the `contentType` the R2
adapter already fetches through `httpMetadata` and currently drops. The adapter documents that,
with `include` set, R2 may return a short page that is still truncated, so callers loop on
`nextCursor` only. Second, the **key-owner registry** in
`packages/shared/domain/storage/key-owners.ts`: the list of every table/column that holds an R2
key (`media.storage_key`, `events.flyer_key`, `events.flyer_replaced_key`), `parseStorageKey`
(decodes `topics/<topicId>/<mediaId>-<name>` and `events/<eventId>/flyer-<uuid>-<name>`, else
`unknown`), and the fixed 24 h `ORPHAN_GRACE_MS` constant (Milestone Decision 2). A coverage
spec reads every migration and fails when a `*_key` / `storage_key` column exists that is
neither registered nor on the explicit non-storage allow-list (`idempotency_key`,
`period_key`). Task 02 resolves keys against this registry; Task 03 uses the folder listing.

## Dependencies

- None — independent. `listObjects` has no production caller today, so the signature change
  only touches the adapter and the two existing test doubles.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `packages/shared/ports/i-storage-adapter.ts` — `ListObjectsOptions`, `ListObjectsResult.prefixes`,
    `StorageObject.contentType`, the new `listObjects` signature.
  - `packages/shared/domain/storage/key-owners.ts` (new) and, if the package exposes domain
    barrels, its re-export.
  - `apps/api/src/adapters/storage/r2-storage-adapter.ts` — pass `delimiter`, map
    `delimitedPrefixes` and `httpMetadata.contentType`, document the short-page caveat.
  - `apps/api/test/controllers/topics.controller.spec.ts`,
    `apps/api/test/controllers/admin-media.controller.spec.ts` — only the `listObjects` stub
    shape.
  - `apps/api/test/storage/**` (new) — adapter listing spec and the key-owner coverage spec.
- **Ports & Adapters.** The port stays provider-neutral: "delimiter" and "prefixes" are generic
  object-store concepts; no `R2*` type appears in `packages/shared`.
- **Cloud-agnostic.** R2 symbols stay inside `apps/api/src/adapters/storage/`.
- **No migration.** The registry describes existing columns; it adds none.
- **Registry is data, not behaviour.** `key-owners.ts` holds no DB access — Task 02 turns it
  into queries.

## Scope

In:
- The new `listObjects` options object and result shape in the port.
- R2 adapter support for `delimiter`, `prefixes` and `contentType`, with the short-page caveat
  written next to the list call.
- `STORAGE_KEY_OWNERS`, `parseStorageKey` and `ORPHAN_GRACE_MS` in shared domain.
- A miniflare R2 spec for the folder listing (with and without delimiter, pagination to the
  end on `nextCursor`).
- A unit spec for `parseStorageKey` over both shapes, a nested unknown key and a key with
  slashes in the file name.
- The coverage spec over `apps/api/migrations/*.sql`.

Out:
- Resolving keys against D1 — Task 02.
- Any route, controller or frontend change.
- Any migration or index.

## Acceptance Criteria

- [x] `listObjects('topics/', { delimiter: '/' })` over two topic folders returns two
      `prefixes` and zero `objects`; the same call without `delimiter` returns every object and
      `prefixes: []`.
- [x] A listing over more objects than `limit` reaches every key by following `nextCursor`
      until it is absent.
- [x] Each returned object carries the `contentType` it was put with.
- [x] `parseStorageKey` returns `topic-media` with topic id, media id and file name for a media
      key, `event-flyer` with the event id for a flyer key, and `unknown` for anything else.
- [x] The coverage spec passes on the current migrations and fails, naming the column, when fed
      a fixture migration that adds an unregistered `thumbnail_key` column.
- [x] No provider-specific (R2) import leaks into `packages/shared`.
- [x] Changed files lint clean; `make test-api` green for the affected specs.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api` — the new storage specs and the two updated controller specs pass.
2. Temporarily add a `thumbnail_key` column to a scratch migration copy and confirm the coverage
   spec fails with that column named; discard the scratch file.
3. `make lint`.
4. `git diff --stat` confirms only scope-guardrail files changed.
