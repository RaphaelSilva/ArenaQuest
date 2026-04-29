# Task 01: Topics & Tags Data Layer

## Metadata
- **Status:** Done
- **Complexity:** Medium
- **Milestone:** 3 — Content & Media Core
- **Dependencies:** none (foundational)

---

## Summary

Define the persistence layer for the topic tree and its tags. This means declaring the repository ports in `packages/shared/ports` and wiring their D1 implementations in `apps/api`. Every other Milestone 3 task that touches topics depends on this landing first.

The `TopicNode` and `Tag` entity shapes already exist in `packages/shared/types/entities.ts` — this task connects them to a real database without leaking Cloudflare-specific types into shared code.

---

## Scope

**Ports (`packages/shared/ports/`):**
- `ITopicNodeRepository` — CRUD, tree traversal, sibling reordering, soft-archive (cascades to descendants), and a cycle-detection method used before any move operation.
- `ITagRepository` — list, find-by-slug, upsert-many.

**Migration (`apps/api/migrations/`):**
- Tables: `topic_nodes`, `tags`, `topic_node_tags` (join), `topic_node_prerequisites` (join).
- `topic_nodes.parent_id` is a nullable self-referential FK with `ON DELETE RESTRICT` (a parent cannot be hard-deleted while children exist).

**D1 Adapters (`apps/api/src/adapters/db/`):**
- `D1TopicNodeRepository` and `D1TagRepository`, following the shape of the existing `D1UserRepository`.
- The `move` operation must run atomically: validate no cycle, update parent + order, renumber siblings.

**Wiring:**
- Instantiate both repositories in `buildApp()` and pass them into `AppRouter.register` so Tasks 04–06 can consume them without touching `index.ts` again.

**Out of scope:** No HTTP routes (those are Tasks 04 and 06).

---

## Acceptance Criteria

- [x] `ITopicNodeRepository` and `ITagRepository` are exported from `@arenaquest/shared/ports`.
- [x] Migration exists and is idempotent (safe to run twice).
- [x] Both adapters implement every method declared in their port.
- [x] Cycle detection: moving a node under itself or any of its descendants is rejected.
- [x] Archiving a node cascades the `archived` status to all descendants.
- [x] `listChildren(null)` returns only root-level nodes.
- [x] Sibling reorder after a move produces a gapless `sort_order` sequence.
- [x] `grep -R "@cloudflare/workers-types" packages/shared` returns zero matches.
- [x] Unit tests cover the above cases; `make lint` is clean.
