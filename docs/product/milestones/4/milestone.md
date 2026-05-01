# Milestone 4: Task Engine & Interconnection

This milestone delivers the **engagement engine**: the system that lets content creators
design multi-stage tasks, link each task (and each individual stage) to one or more
topics from the knowledge tree built in Milestone 3, and surface those tasks to the
student — **read-only for this milestone**. The check-in / progress loop is intentionally
deferred to Milestone 5.

Scope is driven by `docs/product/specification.md §4 Phase 4` and the
`Entities.Engagement` namespace already declared in `packages/shared/types/entities.ts`.

---

## 1. Objectives

* **Task as a first-class authoring entity:** a `Task` is a persistent record with
  title, description, a lifecycle status (`draft` / `published` / `archived`), and an
  ordered list of `TaskStage` children.
* **Stages with semantics:** each `TaskStage` has a human label (e.g. "Reading",
  "Practice", "Peer Review", "Completion"), an integer `order`, and its own link set to
  the knowledge tree — a stage is not just a step; it is a scoped learning objective.
* **Interconnection (N-to-N linking):** a task links to N topics; each stage links to
  a (typically narrower) subset of those same topics. Links survive topic moves and
  never dangle — deleting a topic either refuses (default) or cascades only when the
  admin explicitly asks.
* **Admin authoring UX:** a `/admin/tasks` surface — list, create, edit, reorder
  stages, attach/detach topics per stage, toggle status. Re-uses the M3 topic tree as
  a picker.
* **Read-only student surface:** a `/tasks` page where any signed-in user sees the
  tasks published to them (in M4: "all published tasks"; fine-grained assignment is
  M5). Each task renders its stages with the topics linked to them — clicking a topic
  deep-links into `/catalog/:topicId`.
* **Referential integrity:** published tasks MUST NOT link to unpublished / archived
  topics. Enforced on write (API) and surfaced in the UI.
* **Quality gate:** extend Playwright with a second smoke test — "admin creates a task
  with 2 stages and 3 linked topics → student sees it in `/tasks`".

Out of scope (reserved for Milestone 5):
- Stage check-in / progress mutation.
- Per-student or per-group assignment.
- Dashboards, badges, reward logic.

---

## 2. Functional Requirements

### 2.1 Task entity

* Fields: `id`, `title`, `description` (Markdown), `status`
  (`draft`/`published`/`archived`), `createdBy` (userId), `createdAt`, `updatedAt`.
* `status` transitions: `draft → published`, `published → archived`, `archived → draft`
  (restore); direct `archived → published` is forbidden.
* A task with zero stages MAY NOT transition to `published`.
* Task description is sanitized on write using `sanitizeMarkdownSource` from the M3
  shared helper.

### 2.2 TaskStage entity

* Fields: `id`, `taskId` (FK), `label`, `order` (integer, unique within task),
  `createdAt`.
* Stages are ordered via the same move semantics as topic siblings (integer `order`,
  gaps allowed, renumbered on move).
* Deleting a task deletes its stages (cascade); deleting a single stage is allowed if
  the parent task is in `draft` or `archived` (forbidden on `published` to keep the
  student surface stable).

### 2.3 Linking

Two junction tables:

* `task_topic_links` — `(taskId, topicNodeId)` unique — represents
  "this task is relevant to these topics as a whole".
* `task_stage_topic_links` — `(stageId, topicNodeId)` unique — represents
  "this specific stage requires / teaches these topics".

Invariants:
* A stage link MUST reference a `topicNodeId` that is also present in the parent
  task's `task_topic_links` set (the stage narrows; it does not introduce). Enforced
  on write.
* When a task is `published`, every linked topic MUST have `status = 'published'`.
* When a topic is archived, any `published` task referencing it surfaces a warning in
  the admin UI (but the link is not silently removed).

### 2.4 Admin API (`/admin/tasks`)

Protected by `authGuard + requireRole(ADMIN | CONTENT_CREATOR)`.

| Method  | Path                                                     | Purpose                                                  |
|---------|----------------------------------------------------------|----------------------------------------------------------|
| `GET`   | `/admin/tasks`                                           | List (all statuses), pagination, `?status=` filter.      |
| `POST`  | `/admin/tasks`                                           | Create (title, description, initial topic link set).     |
| `GET`   | `/admin/tasks/:id`                                       | Task + stages + link sets, hydrated with topic titles.   |
| `PATCH` | `/admin/tasks/:id`                                       | Update title / description / status.                     |
| `DELETE`| `/admin/tasks/:id`                                       | Archive (soft).                                          |
| `POST`  | `/admin/tasks/:id/topics`                                | Replace task-level topic link set.                       |
| `POST`  | `/admin/tasks/:id/stages`                                | Create a stage.                                          |
| `PATCH` | `/admin/tasks/:id/stages/:stageId`                       | Update label, reorder.                                   |
| `DELETE`| `/admin/tasks/:id/stages/:stageId`                       | Delete (forbidden on published parents).                 |
| `POST`  | `/admin/tasks/:id/stages/:stageId/topics`                | Replace stage-level topic link set.                      |
| `POST`  | `/admin/tasks/:id/stages/reorder`                        | Bulk reorder.                                            |

### 2.5 Read API (`/tasks`)

Protected by `authGuard`. Returns `published` tasks only; hydrates stages and link
sets.

| Method | Path        | Purpose                                          |
|--------|-------------|--------------------------------------------------|
| `GET`  | `/tasks`    | Published tasks, paginated.                      |
| `GET`  | `/tasks/:id`| Single task + stages + linked topics (title/id).|

### 2.6 Frontend — admin

* `/admin/tasks` list: title, status chip, stage count, "Open" / "Archive" actions.
* `/admin/tasks/new` and `/admin/tasks/:id` editor:
  - Title + Markdown description (re-use `MarkdownViewer` preview from M3).
  - Topic picker (multi-select against the M3 published tree; include drafts when the
    task itself is draft).
  - Stages panel: sortable list (reuse `@dnd-kit` setup from M3 topic tree); per
    stage, show a stage-scoped topic picker constrained to the task's link set.
  - Status toggle with guard messages ("cannot publish without stages", "all linked
    topics must be published").

### 2.7 Frontend — student

* `/tasks` page: card list of published tasks.
* `/tasks/:id` detail: title, description (sanitized Markdown render), stage list
  with labels, each stage showing the topics linked to it as deep links into
  `/catalog/:topicId`. **No check-in controls this milestone.**

### 2.8 Cross-cutting

* New Vitest integration tests for every endpoint; at least one RTL test per new page.
* Playwright smoke test extended with a task-flow scenario.
* `docs/ReleaseNotes.md` updated at milestone close.

---

## 3. Acceptance Criteria

* [ ] An admin can create a task with a title, description, and at least one topic
      linked; it persists across reloads.
* [ ] An admin can add three stages to a task, reorder them via drag-drop, and rename
      the middle stage inline.
* [ ] Each stage can have its own topic link subset; the picker refuses topics not
      present in the parent task.
* [ ] A task cannot be published when it has zero stages — the API returns
      `409 Conflict` and the UI surfaces the reason.
* [ ] A task cannot be published when any linked topic is not published — same
      behaviour.
* [ ] Deleting a stage on a `published` task is rejected (`409`); deleting on `draft`
      succeeds.
* [ ] Archiving a topic that is linked to a published task surfaces a warning banner
      on the `/admin/tasks/:id` view; the link is preserved.
* [ ] A student can see the published task in `/tasks`; draft/archived tasks are
      absent.
* [ ] On the student task detail page, clicking a topic chip navigates to
      `/catalog/:topicId` (already built in M3).
* [ ] All moves/reorders are parallel-safe — concurrent reorder requests converge
      (last-write-wins on `order`, but no duplicate `(taskId, order)` rows).
* [ ] Playwright extended scenario passes in CI.
* [ ] `make lint`, `make test`, and `make e2e` green.

---

## 4. Specific Stack

* **Database:** Cloudflare D1. New tables:
  `tasks`, `task_stages`, `task_topic_links`, `task_stage_topic_links`.
* **Adapters:** `D1TaskRepository` and `D1TaskStageRepository` under
  `apps/api/src/adapters/db/`. New ports `ITaskRepository` and `ITaskStageRepository`
  in `packages/shared/ports/`.
* **Frontend:** re-uses `@dnd-kit` from M3 and the `MarkdownViewer` / picker
  primitives. No new heavyweight deps expected.
* **Types:** `Entities.Engagement.Task` and `TaskStage` already exist in
  `packages/shared/types/entities.ts` — extend with `status`, `createdBy`,
  `createdAt`, `updatedAt` fields. Do not duplicate.

---

## 5. Task Breakdown

Each task is sized for **1–2 coding sessions** and is owned by a single PR.

| #  | Task File | Status |
|----|-----------|--------|
| 01 | [Tasks & Stages Data Layer (ports + D1 adapters + migration)](./01-tasks-stages-data-layer.task.md) | ✅ Done |
| 02 | [Topic Linking Junctions (task↔topic, stage↔topic)](./02-topic-linking-junctions.task.md) | ✅ Done |
| 03 | [Admin Tasks CRUD API (`/admin/tasks`)](./03-admin-tasks-crud-api.task.md) | ✅ Done |
| 04 | [Admin Task Stages API (nested + reorder)](./04-admin-task-stages-api.task.md) | ✅ Done |
| 05 | [Admin Task-Topic Linking API (task and stage scopes)](./05-admin-task-topic-linking-api.task.md) | ✅ Done |
| 06 | [Public Tasks Read API (`/tasks`)](./06-public-tasks-read-api.task.md) | ✅ Done |
| 07 | [Frontend: Admin Tasks Dashboard (list + editor skeleton)](./07-frontend-admin-tasks-dashboard.task.md) | ⬜ Pending |
| 08 | [Frontend: Admin Stage Editor (sortable + per-stage topic picker)](./08-frontend-admin-stage-editor.task.md) | ⬜ Pending |
| 09 | [Frontend: Student Task View (list + detail, read-only)](./09-frontend-student-task-view.task.md) | ⬜ Pending |
| 10 | [E2E Extension: task authoring → student view](./10-e2e-task-flow.task.md) | ⬜ Pending |

Dependency graph (strict prerequisites):

```
01 ─┬─ 02 ─┬─ 03 ─┬─ 04 ─┐
    │      │      │      ├─ 06 ─┐
    │      └──────┴─ 05 ─┘      │
    │                            ├─ 09 ─ 10
    └─────────────────── 07 ─ 08 ┘
```

**Recommended execution order:** `01` → `02` → `03, 07` (parallel-safe) →
`04, 05, 08` → `06` → `09` → `10`.

---

## 6. Definition of Done (milestone level)

* [ ] All 10 tasks in §5 are marked `✅ Done` with every acceptance box checked.
* [ ] All milestone-level acceptance criteria in §3 pass.
* [ ] `make lint`, `make test`, and `make e2e` green in CI.
* [ ] The demo walk-through works end-to-end on a fresh deploy: admin logs in, opens
      `/admin/tasks`, creates a task "Passe de bola — fundamentos" with two linked
      topics and three stages (Reading, Practice, Review), publishes it, logs out,
      logs in as student, sees the task in `/tasks`, opens it, clicks a linked topic
      chip → lands on `/catalog/:topicId`.
* [ ] `docs/ReleaseNotes.md` gains a **Milestone 4 — Task Engine & Interconnection**
      section summarising entities, endpoints, and UI surfaces added.
* [ ] `docs/product/milestones/4/closeout-analysis.md` is authored following the
      same template as Milestones 2 & 3 (tests, gaps, security, go/no-go).
* [ ] The agnosticism contract still holds: no provider SDK imports outside
      `apps/api/src/adapters/`.
* [ ] No regression on Milestones 2 & 3: the full test suite of earlier milestones
      remains green.
