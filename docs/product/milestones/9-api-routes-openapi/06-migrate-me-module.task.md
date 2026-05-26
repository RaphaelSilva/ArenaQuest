# Task 06 — Migrate `/me` module: account, progress, enrollments, gamification, comments (F6)

**Status:** ✅ Completed
**Milestone:** [9 — `apps/api` Route Reorganization and OpenAPI Adoption](./milestone.md)
**RFC:** [0003 §4.1 and §5 — F6](../../RFCs/0003-apps-api-route-organization-and-openapi.md)

## Summary

Consolidate the four routers currently sharing the `/me` (and adjacent `/account`, `/topics`, `/tasks`, `/`) surface into a single declarative sub-app under `apps/api/src/routes/me/**`. Eliminates the three shared-prefix mounts on `/me`, `/topics`, and `/tasks` flagged in RFC §P1 by giving each sub-resource its own module and a single owner. Covers account read/update/delete, progress on topics and tasks, enrollments, gamification (XP/badges/quests/missions), and authored comments.

## Dependencies

Depends on Tasks 01, 02, 03. Must land **after** F4 so the public catalog routes no longer share a prefix with the migrated progress routes. Can run in parallel with F5 and F7.

## Technical Constraints

- **Scope guardrail:** new files under `apps/api/src/routes/me/**`. Removal of `progress.router.ts`, `me-gamification.router.ts`, `account.router.ts`, and the `/me`-related portions of `comments.router.ts`. No changes to controllers (`MeProgressController`, `MeGamificationController`, `AccountController`, `CommentController`).
- All `/me/*` routes require authentication. Apply the bearer-auth guard once at the sub-app level rather than per-route. Every route declares `security: [{ bearerAuth: [] }]` in its OpenAPI definition.
- **Path parity required** for every existing endpoint, including the `/topics/:topicId/progress` and `/tasks/:taskId/progress` paths that today live on the progress router. If a path needs to **move** to a `/me/...` prefix to satisfy the "one prefix, one owner" rule, that move is a behavioural change and must be flagged in the PR with a documented client-side migration plan **before** merging. Default expectation: keep paths as-is in this task; path moves come in F8 alongside the `/v1` cutover.
- The comments router currently handles both topic-level and task-level comments under `/`. Only the **author-side write** paths move into `/me/comments` (per RFC §4.1). Public comment reads stay on whatever router serves them today; document the split clearly.
- The envelope helpers from Task 02 are the only response shaper used.

## Scope

In:
- Create `apps/api/src/routes/me/index.ts` aggregator and modules: `account.ts`, `progress.ts`, `enrollments.ts`, `gamification.ts`, `comments.ts`.
- Migrate every handler from `progress.router.ts` (the three sub-routers — `buildProgressTaskRouter`, `buildProgressTopicRouter`, `buildMeProgressRouter`), `me-gamification.router.ts`, `account.router.ts`, and the `/me`-side of `comments.router.ts`.
- Add the necessary Zod-OpenAPI schemas (account read/update payloads, progress snapshots, enrollment shapes, XP/badge/quest/mission payloads, comment authoring shapes).
- Apply the bearer-auth guard at sub-app level.
- Update `routes/index.ts`: the three `/me` duplicate mounts collapse into one; the `/account` mount disappears (folded into `/me`); progress-on-topics/-tasks mounts disappear from the `/topics`/`/tasks` prefixes (their paths remain in F8 via legacy rewrites if needed).

Out:
- Path moves for legacy `/topics/:id/progress` style endpoints (defer to F8 cutover window).
- Migrating admin-side comments handling (covered by F7 if applicable, otherwise out of scope).
- Changing controller behaviour.

## Acceptance Criteria

- [x] `routes/index.ts` mounts `/me` exactly once. The `/account` mount is gone (folded into `/me`).
- [x] Every previously existing `/me/*`, `/account/*`, and progress endpoint resolves at the same URL with the same payload, status, and headers.
- [x] The bearer-auth guard is applied once at the `/me` sub-app level; no per-route auth boilerplate remains inside the sub-app.
- [x] `GET /openapi.json` lists each `/me/*` route with full request/response schemas and `bearerAuth` security.
- [x] All existing specs covering progress, gamification, account, and `/me`-side comments pass green with at most cosmetic edits (imports, file paths).
- [x] Legacy files `progress.router.ts`, `me-gamification.router.ts`, `account.router.ts` are deleted; `comments.router.ts` either shrinks to its non-`/me` responsibilities or is deleted if those moved elsewhere.
- [x] `make test-api`, `make test-web`, `make lint` pass green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. Capture before/after snapshots for representative endpoints: `GET /me`, `PATCH /me`, `GET /me/progress`, `GET /me/badges`, `POST /me/comments`, the progress writes on topics/tasks. Diff JSON and headers.
2. Inspect `GET /openapi.json` and confirm full schema coverage with `bearerAuth`.
3. Run all `apps/api/test/routes/{me,progress,account,gamification,comments}/**` specs and confirm green.
4. `make dev-web` + login flow: confirm the dashboard still renders progress and gamification widgets.
5. Confirm `routes/index.ts` no longer registers any `/me` prefix more than once.
