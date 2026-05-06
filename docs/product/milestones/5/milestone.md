# Milestone 5: Engagement & Student Progress

This milestone closes the learner loop. Up to Milestone 4 the platform could **describe**
content and tasks; starting here it **measures engagement**: a student checks into task
stages, marks topics as consumed, and sees their progress aggregated on a personal
dashboard. Admins gain fine-grained access control — granting topics (and therefore
their linked tasks) to specific students or groups.

Scope driven by `docs/product/specification.md §4 Phase 5` and the
`Entities.Progress` + `Entities.Identity` (Enrollment\*) namespaces already declared
in `packages/shared/types/entities.ts`.

---

## 1. Objectives

* **Stage check-in loop:** a student advances through a task's stages one at a
  time; progress is append-only (no skipping), auditable, and idempotent under
  double-click / double-submit.
* **Topic consumption signal:** a student can mark a topic as consumed; the system
  can also infer `IN_PROGRESS` from a first visit and `COMPLETED` from a check-in
  on any task stage linked to that topic.
* **Progress aggregation:** per-topic and per-task completion percentages computed
  deterministically from the raw progress rows — no denormalised counters in M5
  (add them only if dashboard latency measurably suffers).
* **Access control:** admins grant a user (or user group) access to a topic
  subtree. A student only sees tasks whose **required topics are all granted**.
  The existing "all published → all students" behaviour (M4 default) is replaced
  by **"published AND enrolled"**.
* **Student dashboard:** `/dashboard` becomes a live surface showing pending
  tasks, current stage per task, overall completion, and a per-topic progress
  readout.
* **Admin enrollment UX:** an admin panel listing users / groups and their granted
  topic trees, with grant / revoke actions.
* **Quality gate:** a third Playwright scenario covering the full "enrolled
  student advances through a 3-stage task → dashboard reflects completion".

Out of scope (deliberately):
- Badges / points / reward logic (Phase 5 spec calls these out as "future").
- Tutor review workflows ("Peer Review" stages exist semantically but are
  auto-advanced by a self-check-in in M5 — tutor gates land in M6+ if needed).

---

## 2. Functional Requirements

### 2.1 Progress model

* `topic_progress` rows: `(id, user_id, topic_node_id, status, completed_at,
  created_at, updated_at)` with `status ∈ {not_started, in_progress, completed}`.
  Unique index on `(user_id, topic_node_id)`.
* `task_progress` rows: `(id, user_id, task_id, status, current_stage_id,
  completed_at, created_at, updated_at)`. Unique on `(user_id, task_id)`.
* `task_stage_progress` rows: `(id, user_id, task_id, stage_id, checked_in_at)`.
  Unique on `(user_id, stage_id)`; append-only (no updates, no deletes in M5).

### 2.2 Check-in semantics

* A student may check into stage N of task T iff:
  1. Task T is `published` and granted to the student (see §2.4).
  2. Every stage with `order < N.order` already has a `task_stage_progress` row
     for this user.
* Checking into the highest-order stage sets `task_progress.status = completed`
  and stamps `completed_at`.
* Checking into any stage sets (or upserts) `topic_progress` for every topic the
  stage links to, with `status = completed` (teaching goal: stage completion is
  treated as topic completion for the linked topics).
* Double check-in (same stage, same user) is a no-op returning 200 + the
  existing row.

### 2.3 Enrollment

* `enrollments_user` rows: `(id, user_id, topic_node_id, granted_at, granted_by)`.
* `enrollments_user_group` rows: `(id, user_group_id, topic_node_id, granted_at,
  granted_by)`.
* **Inheritance:** granting topic T to user U grants U access to the whole subtree
  rooted at T (descendants included). Revoke is non-cascading by default; an
  optional `cascade=true` flag removes grants on descendants explicitly created
  below T.
* **Effective access for a user** = union of the user's direct grants AND grants
  from every group the user is a member of. Computed on read (no materialised
  table in M5).
* **Task visibility rule:** a published task is visible to a student iff every id
  in its task-level `linkedTopicIds` is in the user's effective-access set.

### 2.4 API surface

All protected by `authGuard`. Role-specific routes additionally use
`requireRole(...)`.

Student routes:

| Method | Path                                      | Purpose                                         |
|--------|-------------------------------------------|-------------------------------------------------|
| `POST` | `/tasks/:id/stages/:stageId/check-in`     | Record a stage check-in.                        |
| `POST` | `/topics/:id/visit`                       | Signal "student opened this topic" (→ in_progress). |
| `POST` | `/topics/:id/complete`                    | Student-initiated mark-as-done.                 |
| `GET`  | `/me/progress/summary`                    | Aggregate: total topics, completed, percent.    |
| `GET`  | `/me/progress/tasks`                      | Per-task status list (hydrated).                |
| `GET`  | `/me/progress/topics`                     | Per-topic status list.                          |

Admin routes (`admin` | `content_creator`):

| Method | Path                                                  | Purpose                                         |
|--------|-------------------------------------------------------|-------------------------------------------------|
| `GET`  | `/admin/users/:userId/enrollments`                    | List user's direct grants.                      |
| `POST` | `/admin/users/:userId/enrollments`                    | Grant a topic to a user.                        |
| `DELETE`| `/admin/users/:userId/enrollments/:topicId`          | Revoke a user's grant (`?cascade=true` optional). |
| `GET`  | `/admin/groups/:groupId/enrollments`                  | Same, per group.                                |
| `POST` | `/admin/groups/:groupId/enrollments`                  | Grant a topic to a group.                       |
| `DELETE`| `/admin/groups/:groupId/enrollments/:topicId`        | Revoke.                                         |

Reads updated (M4 endpoints adjusted):

* `GET /topics` and `GET /tasks` now filter by the caller's effective access set.
  An admin or content creator bypasses the filter (they see everything).

### 2.5 Frontend — student

* `/dashboard` — replaces the placeholder with:
  - Progress summary card (topics consumed / total, tasks completed / total).
  - "Continue" list: the three most recently interacted tasks with their
    current-stage label + "Check in" CTA.
  - Per-topic radial / bar chart (top-level only; subtrees roll up).
* `/tasks/:id` — check-in button per stage; the next-expected stage is primary,
  prior stages show a "Checked in at ⟨date⟩" chip, subsequent stages are
  disabled.
* `/catalog/:id` — "Mark as read" button that sends `/topics/:id/complete`; the
  viewer also fires `/topics/:id/visit` on first mount per session.

### 2.6 Frontend — admin

* `/admin/users/:userId` gains an "Enrollments" tab with a topic picker (multi-
  select over the full tree) and a grant / revoke action list.
* `/admin/groups/:groupId` (new page) provides the same surface at the group
  level; if the group management page does not exist yet, create a minimal list
  UI in this milestone — full group editor can land in a later milestone.

### 2.7 Cross-cutting

* Progress endpoints are covered by Vitest integration tests; dashboard by RTL.
* Playwright extended with scenario 3.
* `docs/ReleaseNotes.md` updated at milestone close.

---

## 3. Acceptance Criteria

* [ ] A student enrolled in topic "Fundamentos" (which has a child "Passe") can
      see a task linked to "Passe" on `/tasks`; an un-enrolled student cannot.
* [ ] Checking into stage 1 of a 3-stage task returns 200; checking into stage 3
      **before** stage 2 returns `409 OUT_OF_ORDER`.
* [ ] Checking into the final stage updates `task_progress.status = completed`
      and `completed_at` is stamped.
* [ ] Checking into a stage that links to topics A and B marks both `A` and `B`
      as `completed` for that user.
* [ ] Two rapid identical check-ins produce exactly one `task_stage_progress`
      row (idempotency test in a parallel harness).
* [ ] `/me/progress/summary` returns deterministic percentages: given 10
      published topics and 4 completed, `topicsPercent === 40`.
* [ ] `/dashboard` loads under 500 ms against a seeded fixture of 50 topics and
      10 tasks.
* [ ] Admin can grant "Futebol" to user Alice; Alice immediately sees all
      descendant topics and their linked tasks (no re-login required after a
      page refresh).
* [ ] Admin grants "Futebol" to group "Turma A"; a member inherits access even
      without a direct grant.
* [ ] Admin revoke with `cascade=true` removes both the grant and any grants on
      descendants; without `cascade`, descendants remain granted if they were
      granted directly.
* [ ] `make lint`, `make test`, and `make e2e` green in CI.

---

## 4. Specific Stack

* **Database:** Cloudflare D1. New tables: `topic_progress`, `task_progress`,
  `task_stage_progress`, `enrollments_user`, `enrollments_user_group`.
* **Access query:** effective-access set computed via a single recursive CTE on
  `topic_nodes` joined with the two enrollment tables (D1 supports recursive
  CTEs — verified in a Task 02 spike test).
* **Ports:** `IProgressRepository`, `IEnrollmentRepository` in
  `packages/shared/ports/`.
* **Frontend charts:** lightweight — use plain SVG / CSS. No heavyweight chart
  library in M5 (defer to M6 if needed).
* **Types:** `Entities.Progress.*` and `Entities.Identity.EnrollmentUser/Group`
  already exist — extend if missing fields (`status` on `EnrollmentUser`? none
  needed in M5).

---

## 5. Task Breakdown

| #  | Task File | Status |
|----|-----------|--------|
| 01 | [Progress Data Layer (topic + task + stage progress)](./01-progress-data-layer.task.md) | ⬜ Pending |
| 02 | [Enrollment Data Layer (user + group grants, effective access CTE)](./02-enrollment-data-layer.task.md) | ⬜ Pending |
| 03 | [Stage Check-in API + idempotency](./03-stage-check-in-api.task.md) | ⬜ Pending |
| 04 | [Topic Progress API (visit + complete)](./04-topic-progress-api.task.md) | ⬜ Pending |
| 05 | [Admin Enrollment API (user + group grants)](./05-admin-enrollment-api.task.md) | ⬜ Pending |
| 06 | [Progress Aggregation Service + `/me/progress/*`](./06-progress-aggregation-service.task.md) | ⬜ Pending |
| 07 | [Access-aware read filter on `/tasks` and `/topics`](./07-access-aware-read-filter.task.md) | ⬜ Pending |
| 08 | [Frontend: Student Dashboard](./08-frontend-student-dashboard.task.md) | ⬜ Pending |
| 09 | [Frontend: Stage check-in UI + topic mark-as-read](./09-frontend-stage-check-in-ui.task.md) | ⬜ Pending |
| 10 | [Frontend: Admin Enrollment Panel](./10-frontend-admin-enrollment.task.md) | ⬜ Pending |

Dependency graph:

```
01 ─┬─ 03 ─┐
    ├─ 04 ─┤
    └─ 06 ─┤
02 ─┬─ 05 ─┤
    └─ 07 ─┤
           ├─ 08, 09, 10 (parallel)
```

**Recommended execution order:** `01, 02` (parallel) → `03, 04, 05, 07` (parallel)
→ `06` → `08, 09, 10` (parallel).

---

## 6. Definition of Done (milestone level)

* [ ] All 11 tasks in §5 are marked `✅ Done` with every acceptance box checked.
* [ ] All milestone-level acceptance criteria in §3 pass.
* [ ] `make lint`, `make test`, and `make e2e` green in CI.
* [ ] Demo walk-through on a fresh deploy: admin enrolls a student into a topic
      subtree, the student logs in, opens `/dashboard` and sees 0 % on the
      enrolled subtree, opens a task, checks into all stages, returns to
      `/dashboard`, and sees 100 % on the affected topics + the task marked
      complete.
* [ ] `docs/ReleaseNotes.md` gains a **Milestone 5 — Engagement & Progress**
      section.
* [ ] `docs/product/milestones/5/closeout-analysis.md` authored (same template
      as Milestones 2 – 4).
* [ ] Agnosticism contract preserved: no provider SDK imports outside
      `apps/api/src/adapters/`.
* [ ] No regression on Milestones 2 – 4 suites.
