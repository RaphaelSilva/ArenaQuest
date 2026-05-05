# Milestone 4 — Close-out Analysis

**Date:** 2026-05-05
**Scope:** `docs/product/milestones/4/` — Task Engine & Interconnection
**Goal:** Decide whether the project can advance to Milestone 5.

---

## 1. Executive Summary

All **9 active tasks** listed in `milestone.md` are marked **Done/Complete**, and every acceptance criterion declared in those task files is checked. Task 10 (E2E) was deferred/skipped by the product owner to prioritize staging validation. Both test suites are green.

| Suite | Files | Tests | Status |
|-------|-------|-------|--------|
| `apps/api` (Vitest + `@cloudflare/vitest-pool-workers`) | 36 | **471** | ✅ pass (3 skipped due to sandbox network limits) |
| `apps/web` (Vitest + React Testing Library) | 11 | **91** | ✅ pass |

**Recommendation:** The milestone's functional contract is met and the project **may advance to Milestone 5**. The core task engine, stage management, and student-facing task viewer are fully operational.

---

## 2. Acceptance Criteria — Milestone Level

| # | Criterion | State | Evidence |
|---|-----------|-------|----------|
| 1 | Admin can create tasks and manage their draft/published lifecycle | ✅ | `admin-tasks.router.spec.ts`, Task 07 Dashboard |
| 2 | Tasks can contain an ordered list of stages | ✅ | `admin-task-stages.router.spec.ts`, Task 08 Stage Editor |
| 3 | Tasks and stages can be linked to curriculum topics | ✅ | `admin-task-topic-linking.router.spec.ts`, D1 Junctions |
| 4 | Students can browse published tasks and see linked content | ✅ | `public-tasks.router.spec.ts`, Task 09 Student View |
| 5 | Markdown rendering remains safe and sanitized | ✅ | Sanitization helpers reused in Task 07/09 |
| 6 | Cloud-agnosticism: S3 SDK confined to adapters | ✅ | `r2-storage-adapter.spec.ts` isolation test |

---

## 3. Test Coverage Analysis

### 3.1 What *is* covered

**Backend (`apps/api`)** — 471 tests across 36 files:
- `adapters/db/d1-task-repository.spec.ts` — Task CRUD operations.
- `adapters/db/d1-task-stage-repository.spec.ts` — Nested stage logic and reordering.
- `adapters/db/d1-task-linking-repository.spec.ts` — Task-Topic and Stage-Topic junction persistence.
- `routes/admin-tasks.router.spec.ts` — Admin management endpoints.
- `routes/public-tasks.router.spec.ts` — Student-facing task exploration.

**Frontend (`apps/web`)** — 91 tests across 11 files:
- `components/tasks/__tests__/stage-editor.test.tsx` — Drag-and-drop, renaming, and topic association guards.
- `app/admin/tasks/page.test.tsx` — Task dashboard and list management.
- `app/tasks/page.test.tsx` — Student task grid and visibility rules.

### 3.2 What is **not** covered

| Gap | Severity | Notes |
|-----|----------|-------|
| Task 10 (E2E) | Medium | Deferred/Skipped; full end-to-end task-to-catalogue flow was validated manually in staging. |
| `objectExists` S3 Unit Tests | Low | Skipped in `r2-storage-adapter.spec.ts` due to miniflare sandbox network restrictions. Validated via router integration tests with direct DB mock. |

---

## 4. Outstanding Activities

- **E2E Automation:** Implement the deferred Task 10 flow in a future hardening sprint.
- **Progress Tracking:** Scoped for Milestone 5 (student check-ins, completion states).
- **R2 Connectivity in CI:** Investigate a local S3 emulator (like MinIO or LocalStack) to re-enable unit tests for `objectExists` without bypassing the sandbox.

---

## 5. Security Audit Findings

| # | Severity | Finding | Location | Mitigation |
|---|----------|---------|----------|------------|
| S-11 | Low | Cross-Topic Stage Injection | `AdminMediaController` / `AdminTasksController` | Verified that stage and media operations enforce topic/task ownership checks. | ✅ **Closed** |
| S-12 | Low | Draft Visibility Leak | `PublicTasksController` | Re-verified that the student-facing `/tasks` API strictly filters for `status = 'published'`. | ✅ **Closed** |

---

## 6. Go / No-Go for Milestone 5

| Gate | Status |
|------|--------|
| All Milestone 4 tasks closed | ✅ |
| All acceptance criteria met | ✅ |
| Test suites green | ✅ |
| Cloud-agnosticism verified | ✅ |

**Decision:** **GO** to Milestone 5 (Progress Tracking & Gamification).
