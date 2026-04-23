# Task 04: Admin Topics CRUD + Move API

## Metadata
- **Status:** Pending
- **Complexity:** Medium
- **Milestone:** 3 — Content & Media Core
- **Dependencies:** Task 01, Task 07

---

## Summary

Expose the topic authoring endpoints under `/admin/topics`. Admins and content creators can build the tree, update node metadata, move nodes safely, and advance nodes through the `draft → published → archived` lifecycle. Markdown content is sanitized on write (Task 07) before persistence.

---

## Scope

**Router:** `apps/api/src/routes/admin-topics.router.ts`, guarded by `authGuard + requireRole(ADMIN, CONTENT_CREATOR)`.

**Endpoints:**

| Method   | Path                        | Purpose                                              |
|----------|-----------------------------|------------------------------------------------------|
| `GET`    | `/admin/topics`             | Full tree (all statuses), flat array sorted by parent + order |
| `POST`   | `/admin/topics`             | Create a node under an optional `parentId`           |
| `GET`    | `/admin/topics/:id`         | Single node with children and media                  |
| `PATCH`  | `/admin/topics/:id`         | Update title, content, status, tags, prerequisites, estimated minutes |
| `POST`   | `/admin/topics/:id/move`    | Re-parent and/or reorder; rejects cycles             |
| `DELETE` | `/admin/topics/:id`         | Archive (soft); cascades to all descendants          |

**Validation:** Zod schemas on all request bodies; clear field-level errors on failure.

**Error contract:** `400` bad input · `404` not found · `409 WOULD_CYCLE` on illegal move · `422 UNKNOWN_PREREQ` on unknown prerequisite ID.

**Response shape:** `GET /admin/topics` returns a flat array — the frontend assembles the tree. This avoids server-side recursion for the volumes expected.

**Integration tests** (`apps/api/test/routes/admin-topics.router.spec.ts`): 401/403 guards, full CRUD round-trip, cycle detection for move-to-self and move-to-descendant, archive cascade, and leaf-first publishing (allowed).

---

## Acceptance Criteria

- [ ] All six endpoints exist and are guarded by `authGuard + requireRole(ADMIN, CONTENT_CREATOR)`.
- [ ] Creating a node with a non-existent `parentId` returns `404`.
- [ ] Creating a node with an unknown prerequisite ID returns `422 UNKNOWN_PREREQ`.
- [ ] Moving a node under itself or any descendant returns `409 WOULD_CYCLE`.
- [ ] Archiving a parent archives all descendants.
- [ ] `PATCH { status: 'published' }` is immediately reflected in `GET`.
- [ ] Markdown content is sanitized before persistence.
- [ ] Integration tests cover every case above; `make lint` is clean.
