# Task 02: Media Data Layer

## Metadata
- **Status:** Pending
- **Complexity:** Low
- **Milestone:** 3 — Content & Media Core
- **Dependencies:** Task 01

---

## Summary

Persist `Media` rows linked to a `TopicNode` and track their three lifecycle states: `PENDING` (upload URL issued, upload not yet confirmed), `READY` (upload confirmed), and `DELETED` (soft-removed). This distinction lets the platform hide in-progress or removed uploads from students.

The `Media` entity shape already exists in shared types — this task adds the persistence fields needed at runtime (`storageKey`, `sizeBytes`, `originalName`, `uploadedBy`, `status`) and wires the repository.

---

## Scope

**Shared types (`packages/shared/types/entities.ts`):**
- Extend `Entities.Content.Media` with the runtime persistence fields and a `MediaStatus` enum (`pending` / `ready` / `deleted`).

**Port (`packages/shared/ports/i-media-repository.ts`):**
- Methods: `findById`, `listByTopic` (with optional inclusion of PENDING rows), `create` (always inserts as PENDING), `markReady`, `softDelete` (status → DELETED), `hardDelete` (row removal).

**Migration (`apps/api/migrations/`):**
- Table: `media` with FK to `topic_nodes` (cascade delete) and FK to `users` (restrict delete).

**D1 Adapter (`apps/api/src/adapters/db/`):**
- `D1MediaRepository` — straightforward CRUD; `listByTopic` filters out DELETED rows and, when `includePending = false`, filters out PENDING rows too.

**Out of scope:** No storage interaction (Task 03), no HTTP routes (Task 05). The repository stores only a `storageKey` string — URL resolution is the storage adapter's responsibility.

---

## Acceptance Criteria

- [ ] `MediaStatus` enum and the extended `Media` interface are exported from `@arenaquest/shared`.
- [ ] `IMediaRepository` port is exported from `@arenaquest/shared/ports`.
- [ ] Migration exists and is idempotent.
- [ ] `create` always inserts with `status = 'pending'`.
- [ ] `markReady` transitions a PENDING row to READY.
- [ ] `listByTopic(..., false)` excludes both PENDING and DELETED rows.
- [ ] `softDelete` hides the row from `listByTopic` but keeps it in the database.
- [ ] `hardDelete` removes the row entirely.
- [ ] Unit tests cover every case above; `make lint` is clean.
