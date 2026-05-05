# Task 06: Public Tasks Read API

## Metadata
- **Status:** Completed
- **Complexity:** Low
- **Milestone:** 4 — Task Engine & Interconnection
- **Dependencies:** Task 03, Task 04, Task 05

---

## Summary

Implement the student-facing read API for Tasks. Returns only `published` tasks enriched with their stages and topic references, enabling students to explore available learning journeys.

---

## Technical Constraints

- **Router:** `apps/api/src/routes/tasks.router.ts`.
- **Service:** Logic implemented in `apps/api/src/controllers/public-tasks.controller.ts`.
- **Security:** Guarded by `authGuard` only — any authenticated user can read.
- **Access Control:** Strictly limited to `published` tasks. Draft and archived tasks are invisible.

---

## Scope (no code)

### 1. Public Task Endpoints

| Method | Path        | Description                                                                        |
|--------|-------------|------------------------------------------------------------------------------------|
| `GET`  | `/tasks`    | Paginated list of published tasks (summary view with title, stage count, topic count). |
| `GET`  | `/tasks/:id`| Full detail for a published task: description, ordered stages, and topic references per stage. |

### 2. Response Content

- **List View:** Each task summary includes `id`, `title`, `stageCount`, `topicCount`, `updatedAt`.
- **Detail View:** Full task with ordered stages; each stage includes its linked topics as lightweight tuples (`{ id, title }`), allowing the UI to deep-link into the catalogue.
- **Stale Link Handling:** If a linked topic has become unpublished, it is silently omitted from the public response (no error surfaced to the student).

### 3. Performance

- **Pagination:** Offset-based (`?limit`, `?offset`). Default limit: 50, max: 200.
- **Caching:** `Cache-Control: private, max-age=30` on the list endpoint.

---

## Acceptance Criteria

- [x] Both endpoints are correctly guarded by `authGuard`.
- [x] Draft and archived tasks are not accessible.
- [x] Hydrated task details include correct stages and topic references.
- [x] Stale topic links are filtered from public responses without causing errors.
- [x] Caching headers are present on the list endpoint.
- [x] Integration tests (Controller level) cover visibility and RBAC boundaries.
- [x] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- `pnpm --filter api test` — integration suite for `tasks-public.spec.ts`.

### Manual Verification
- Log in as a student and request `/tasks`; confirm draft tasks are absent.
- Verify `Cache-Control` headers using a REST client or `curl -i`.
