# Milestone 3: Content & Media Core

This milestone builds the **content backbone** of ArenaQuest: the hierarchical topic tree,
the media assets attached to every node, and the first editorial surface where content
creators actually put material into the platform. Students gain a read-only browser so
they can consume what has been published.

The scope is driven by `docs/product/specification.md §4 Phase 3` and the
`Entities.Content` namespace already declared in `packages/shared/types/entities.ts`.

---

## 1. Objectives

The success of this phase is defined by:

* **Hierarchical Topic Engine:** a persistent, tree-structured catalogue of `TopicNode`
  records (unlimited depth) with reorderable children, tags, and lifecycle status
  (draft / published / archived).
* **Media as a First-Class Asset:** PDFs, MP4 videos, and Markdown body text attach to
  topic nodes through a dedicated `media` entity, stored in S3-compatible object
  storage, served via **presigned URLs** (client uploads directly — zero bytes through
  the Worker).
* **Cloud-Agnostic Storage:** a concrete `R2StorageAdapter` implementing the existing
  `IStorageAdapter` port, wired via a Worker binding, with no R2-specific API leaking
  into business logic.
* **Content Authoring UX:** an admin / content-creator dashboard where the knowledge
  tree is visible, reorderable (drag-drop), editable inline, and where attachments are
  uploaded with live progress.
* **Content Consumption UX:** a student surface that browses the published tree, renders
  safe Markdown, embeds PDFs, and streams video.
* **Quality Gate:** unit and integration tests (Vitest) covering the core logic and UI components. (E2E tests deferred to Test Debt).

---

## 2. Functional Requirements

### 2.1 Topic tree

* TopicNodes form a tree: `parentId: string | null`, plus an integer `order` used for
  sibling display order.
* A TopicNode has: `id`, `parentId`, `title`, `content` (Markdown), `status`
  (`draft`/`published`/`archived`), `estimatedMinutes`, `prerequisiteIds` (array of
  sibling or ancestor node ids), `createdAt`, `updatedAt`.
* A TopicNode has a many-to-many relation with `Tag` (`id`, `name`, `slug`) and a
  one-to-many relation with `Media`.
* Move semantics: a node may be re-parented (change `parentId`) and siblings may be
  reordered. Moves MUST NOT create cycles.

### 2.2 Media

* Each `Media` row has: `id`, `topicNodeId` (FK), `storageKey` (string, unique),
  `type` (MIME), `sizeBytes`, `originalName`, `uploadedBy` (user id), `createdAt`.
* Supported MIME types on upload: `application/pdf`, `video/mp4`, `image/jpeg`,
  `image/png`, `image/webp`.
* Media lifecycle: **PENDING** (presigned URL issued but no confirmation yet) →
  **READY** (client notified success) → **DELETED** (soft). The backend refuses to
  surface PENDING media to students.

### 2.3 Storage

* A `R2StorageAdapter` implementing every method of `IStorageAdapter`.
* `wrangler.jsonc` declares an `R2` bucket binding.
* Upload path is presigned-URL based; downloads use presigned URLs for private media and
  `getPublicUrl` for public assets.
* A maximum per-object size is enforced in the presigned request:
  100 MB for video, 25 MB for PDF, 5 MB for images.

### 2.4 Admin API (`/admin/topics`, `/admin/topics/:id/media`)

Protected by `authGuard + requireRole(ADMIN | CONTENT_CREATOR)`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/admin/topics` | Full tree (all statuses), flat-or-nested response. |
| `POST` | `/admin/topics` | Create node under `parentId` (null = root). |
| `GET`  | `/admin/topics/:id` | Node + children + media. |
| `PATCH`| `/admin/topics/:id` | Update title, content, status, tags, prerequisites, etimated minutes. |
| `POST` | `/admin/topics/:id/move` | Re-parent and/or reorder. |
| `DELETE`| `/admin/topics/:id` | Archive (soft); cascade archives children. |
| `POST` | `/admin/topics/:id/media/presign` | Request an upload URL. |
| `POST` | `/admin/topics/:id/media/:mediaId/finalize` | Mark PENDING → READY. |
| `DELETE`| `/admin/topics/:id/media/:mediaId` | Delete media row + storage object. |

### 2.5 Public / Authed Read API (`/topics`)

Protected by `authGuard` only (any signed-in user). Excludes draft/archived content and
PENDING media.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/topics` | Published tree (paginated if > 500 nodes). |
| `GET` | `/topics/:id` | Single node with children + READY media + download URLs. |

### 2.6 Frontend — admin

* `/admin/topics` page: tree view with expand/collapse, drag-drop to reorder/re-parent,
  inline title edit, status chip (draft/published/archived).
* Detail pane on select: Markdown editor (textarea is acceptable in this milestone),
  tags, prerequisites, estimated minutes, media list with uploader.
* Uploader: drag-drop area, shows progress bar per file, uses presigned URLs.

### 2.7 Frontend — student

* `/catalog` page: sidebar tree of published nodes, main pane renders selected node
  (title, Markdown body, attached media).
* Markdown renderer: safe (no script tags, sanitized); code blocks, headings, links,
  lists supported.
* PDF: iframe/`<object>` embed using presigned download URL.
* Video: native `<video controls>` using presigned download URL.

### 2.8 Cross-cutting

* Markdown sanitization lives in `packages/shared` (so backend can sanitize on write and
  the frontend can re-sanitize on read).
* (Deferred) Playwright E2E scaffold.
* Every new endpoint has at least one Vitest integration test; every new React page
  has at least one React-Testing-Library test.

---

## 3. Acceptance Criteria

* [x] An admin can create a root topic and a nested child topic via the UI; both
      persist across reloads.
* [x] A topic can be moved to a new parent via drag-drop; the order persists.
* [x] A circular move (A → descendant of A) returns `409 Conflict` and the UI surfaces
      the error without corrupting state.
* [x] An admin can upload a PDF and an MP4 to a topic using presigned URLs; the upload
      bypasses the Worker (observable via the Network tab — direct POST to R2).
* [x] The "upload progress" bar updates in real time (uses `XMLHttpRequest.upload` or
      `fetch` stream).
* [x] Media larger than the type limit is rejected before upload.
* [x] PENDING media is not listed on the student surface.
* [x] A topic in `draft` status is not visible to a student; publishing it makes it
      visible within one request.
* [x] A student can open the catalogue, navigate the tree, and see Markdown rendered
      without script execution when the source contains `<script>` tags (XSS test).
* [x] A student can open a PDF inline and stream an MP4 in the same page.
* [x] `DELETE /admin/topics/:id` cascades to archive descendants; media remains
      accessible via the admin surface but hidden from students.
* [x] Deleting a media row also removes the underlying storage object (verify by
      listing the R2 bucket before and after).
* [x] (Deferred) Playwright smoke test passes in CI.
* [x] All Vitest suites (api + web) remain green; `make lint` clean.
* [x] `make cf-typegen` still produces a clean types file after the new binding is
      added.

---

## 4. Specific Stack

* **Database:** Cloudflare D1 (relational). New tables: `topic_nodes`, `tags`,
  `topic_node_tags`, `topic_node_prerequisites`, `media`.
* **Storage:** Cloudflare R2 via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`
  for presigning (R2 is S3-compatible). These libraries are allowed because they live
  ONLY inside the adapter file; the business layer imports the `IStorageAdapter` port.
* **Markdown:** `marked` + `dompurify` (server-safe build: `isomorphic-dompurify`).
* **Drag-drop:** `@dnd-kit/core` on the admin tree UI.
* **E2E:** Playwright + Chromium.
* **Types:** All TopicNode, Media, Tag, Progress types already exist in
  `packages/shared/types/entities.ts` — reuse, do not duplicate.

---

## 5. Task Breakdown

Each task is designed to fit **1–2 coding sessions** and is owned by a single PR.

| # | Task File | Status |
|---|-----------|--------|
| 01 | [Topics & Tags Data Layer (port + D1 adapter + migration)](./01-topics-data-layer.task.md) | ✅ Done |
| 02 | [Media Data Layer (entity + migration + linking)](./02-media-data-layer.task.md) | ✅ Done |
| 03 | [R2 Storage Adapter (implement IStorageAdapter)](./03-r2-storage-adapter.task.md) | ✅ Done |
| 04 | [Admin Topics CRUD + Move API](./04-admin-topics-crud-api.task.md) | ✅ Done |
| 05 | [Admin Media API (presigned upload + finalize + delete)](./05-admin-media-api.task.md) | ✅ Done |
| 06 | [Public Topics Read API (published-only catalogue)](./06-public-topics-read-api.task.md) | ✅ Done |
| 07 | [Markdown Sanitization Helper (shared package)](./07-markdown-sanitization.task.md) | ✅ Done |
| 08 | [Frontend: Admin Topic Tree Dashboard](./08-frontend-admin-topic-tree.task.md) | ✅ Done |
| 09 | [Frontend: Admin Media Uploader (presigned flow + progress)](./09-frontend-admin-media-uploader.task.md) | ✅ Done |
| 10 | [Frontend: Student Catalogue + Content Viewers](./10-frontend-student-catalogue.task.md) | ✅ Done |
| 11 | [E2E Scaffolding (Playwright smoke test)](../../backlog/test-debt/11-e2e-playwright-scaffold.task.md) | ⏩ Deferred |

Dependency graph (strict prerequisites):

```
01 ─┬─ 04 ─┬─ 06 ─┐
    │      │       └─ 10
    └─ 02 ─┼─ 05 ──┘
           │
03 ────────┘
07 ─── (feeds 04 writes + 10 reads; independent of the rest)
08 ── depends on 04
09 ── depends on 05 and 08
```

**Recommended execution order:** `01, 03, 07` in parallel → `02` → `04, 05` → `06, 08`
→ `09, 10`. (Task 11 deferred).

---

## 6. Definition of Done (milestone level)

* [x] All 11 tasks in §5 are marked `✅ Done` (or Deferred) with every acceptance box checked.
* [x] All 15 milestone-level acceptance criteria in §3 pass.
* [x] `make lint`, `make test` are green in CI. (E2E deferred).
* [x] The demo walk-through works end-to-end on a fresh deploy: admin logs in, builds a
      small tree (e.g. `Futebol → Fundamentos → Passe`), uploads one PDF + one video,
      publishes the leaf, logs out, logs in as a student, finds the topic in the
      catalogue, views it, and streams the media.
* [x] `docs/product/milestones/3/ReleaseNotes.md` is generated summarising entities, endpoints, and UI surfaces added.
* [ ] `docs/product/milestones/3/closeout-analysis.md` is authored following the same
      template as Milestone 2's close-out (tests, gaps, security, go/no-go).
* [x] The agnosticism contract still holds: `grep -R "R2Bucket\|@aws-sdk" apps/api/src`
      returns hits **only** inside `apps/api/src/adapters/storage/`; nothing in `core/`,
      `controllers/`, `routes/`, or `middleware/`.
* [x] No regression on Milestone 2 hardening: the security findings closed in
      `2-extends/` remain green (re-run those test suites).
