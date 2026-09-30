# Task 02 — Backend: Storage reference port and D1 resolver (Phase 1)

**Status:** 📝 Open
**Milestone:** [25 — Admin storage browser and orphan audit](./milestone.md)
**RFC:** [RFC 0018](../../RFCs/0018-admin-storage-browser-and-orphan-audit.md)
**Team:** Backend API
**Depends On:** [Task 01](./01-storage-port-folder-listing-and-key-owner-registry.task.md)

## Summary

Answers "who owns this key?" for a batch of keys in two D1 statements. A new provider-neutral
port, `IStorageReferenceRepository`, with its `StorageReference` union (a `media` reference
carrying media id, status, original name, type, size, uploader id + name, topic id + title +
status and creation date; an `event-flyer` or `event-flyer-displaced` reference carrying event
id, title, slug, flyer status and flyer name), exposes three reads: `resolveKeys` (every
reference for each key; keys with none are absent from the result), `existingOwners` (which of
a set of topic ids / event ids still exist, with their titles — used for folder labels and for
orphan hints) and `listReferencedKeys` (a cursor-paged walk over every `ready`/`pending`
reference, for the missing-object scan). `D1StorageReferenceRepository` implements it by
reading the columns named in `STORAGE_KEY_OWNERS`: keys are chunked at **90 per statement**
(D1 caps bound parameters at 100) and each chunk's media and event lookups run in one
`db.batch`. The repository is read-only — it exposes no write of any kind (Milestone
Decisions 1, 4). Task 03 composes it with the storage adapter into the classification.

## Dependencies

- [Task 01](./01-storage-port-folder-listing-and-key-owner-registry.task.md) — hard code
  dependency: the adapter reads `STORAGE_KEY_OWNERS`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `packages/shared/ports/i-storage-reference-repository.ts` (new) and its re-export in
    `packages/shared/ports/index.ts`.
  - `apps/api/src/adapters/db/d1-storage-reference-repository.ts` (new).
  - `apps/api/src/container.ts` — construct the repository per request and expose it where the
    admin storage controller will read it.
  - `apps/api/test/storage/**` — repository spec against a migrated local D1.
- **Ports & Adapters.** The port speaks in keys and references only; SQL, `D1Database` and
  chunking live in the adapter. Adapters are built per request inside the container, never in
  module scope.
- **Registry-driven.** The adapter covers exactly the owners in `STORAGE_KEY_OWNERS`; a new
  owner is added there first, and the coverage spec from Task 01 enforces it.
- **Read-only.** No `INSERT`, `UPDATE` or `DELETE` in this adapter.
- **No migration, no index.** `media.storage_key` stays unindexed unless the milestone's latency
  criterion fails, and then as a separate task.

## Scope

In:
- The port, the `StorageReference` union, and its export.
- `resolveKeys`: media rows joined to their topic and uploader, events matched on `flyer_key`
  or `flyer_replaced_key` (tagged `event-flyer` or `event-flyer-displaced` accordingly),
  chunked at 90 keys per statement, one `db.batch` per chunk.
- `existingOwners`: topic and event existence + titles for a set of ids, chunked the same way.
- `listReferencedKeys`: stable-ordered paging over `ready`/`pending` media keys and non-null
  flyer keys, with an opaque cursor.
- Container wiring.
- Specs for each read, including the 90/91 chunk boundary and a key referenced by both a
  `deleted` and a `ready` media row.

Out:
- Classification rules and HTTP — Task 03.
- Any write to D1.
- Frontend.

## Acceptance Criteria

- [ ] `resolveKeys` over 91 keys returns the correct references for all of them and issues one
      `db.batch` per 90-key chunk (two batches).
- [ ] A media key resolves with its topic title and uploader name; a key whose topic row is gone
      resolves with `topic: null`; a key whose media row is gone is absent from the result.
- [ ] A key stored in `events.flyer_key` resolves as `event-flyer` with the event's title, slug
      and flyer status; a key stored only in `flyer_replaced_key` resolves as
      `event-flyer-displaced`.
- [ ] A key referenced by a `deleted` and a `ready` media row returns both references.
- [ ] `existingOwners` returns only the ids that exist, with their titles.
- [ ] `listReferencedKeys` walks every `ready`/`pending` media key and every non-null flyer key
      exactly once across pages, and omits `deleted` media.
- [ ] No D1 import leaks into the port or into any controller.
- [ ] Changed files lint clean; `make test-api` green for the affected specs.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make db-migrate-local` on a fresh replica (no new migration expected — confirm nothing new is
   applied).
2. `make test-api` — the repository spec passes, including the chunk boundary.
3. `make lint`.
4. `git diff --stat` confirms only scope-guardrail files changed.
