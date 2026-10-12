# Task 03 — Backend: Layout-driven dashboard aggregate (Phase 1)

**Status:** 📝 Open
**Milestone:** [29 — Configurable Widget Dashboard](./milestone.md)
**RFC:** [RFC 0008](../../RFCs/0008-user-dashboard-with-topic-recommendations-and-badge-achievem.md)
**Team:** Backend API
**Depends On:** [Task 01](./01-widget-registry-and-layout-schema.task.md), [Task 02](./02-layout-storage-and-student-routes.task.md)

## Summary

Rebuilds `GET /v1/me/dashboard` on the layout. **First**, before any code change, it measures the
current endpoint's p95 on the demo-seeded local replica with a documented, repeatable command and
records the baseline — and the target agreed with the product owner (D22) — in the milestone's §6.
Then the controller resolves the effective layout (Task 02's resolver), computes data **only for the
enabled instances**, in parallel, each in its own failure boundary, and answers
`{ layout, layoutSource, widgets }`, where `widgets` maps each instance id to its data or `null` on
failure. The eight current widgets keep their data; two move to the server: **ranking** (the same
global, all-time, top-5 read the web makes today, plus the caller's rank and the total) and the
**roots-only roadmap** (accessible root topics as stages, now with **leaf-based progress** — completed
accessible leaves ÷ accessible leaves of each root's subtree — instead of the 0/50/100 guess). Every
field gets a real schema from the registry, removing the `z.any()` entries from the OpenAPI
document. `Cache-Control: private, max-age=15` is kept. Task 04 switches the web to this response;
Task 09 generalises the roadmap to any start topic.

## Dependencies

- [Task 01](./01-widget-registry-and-layout-schema.task.md) — data schemas and registry.
- [Task 02](./02-layout-storage-and-student-routes.task.md) — the layout resolver and repository.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/controllers/me-dashboard.controller.ts` and the `/dashboard` route and schema in
    `apps/api/src/routes/me/gamification.ts` (no other handler in that file changes).
  - `apps/api/src/core/dashboard/**` — per-widget data providers and the roadmap subtree query.
  - `apps/api/src/container.ts` (wiring only), `apps/api/openapi.json`,
    `apps/api/src/openapi/components/**` (regenerated) and `apps/api/test/**`.
  - `packages/shared/types/dashboard.ts` — retire the old `DashboardShape` once nothing imports it.
  - `docs/product/milestones/29-configurable-widget-dashboard/milestone.md` §6 — the measured
    baseline and target only.
- **Access first.** The roadmap reads only topics in `getEffectiveAccessTopicIds(userId)`, published
  and not archived; the query is restricted to that set before any title is projected.
- **Reuse, do not re-implement.** XP, streak, quests, missions, badges and leaderboard data come
  from the existing controllers/repositories; their rules do not change.
- **Failure isolation.** One provider throwing yields `null` for its instance and an ids-only log;
  the response is still `200`.
- **Breaking contract, single consumer.** The response shape changes; the web is migrated in
  Task 04, which must land in the same release. State this in the PR.

## Scope

In:
- Baseline measurement (command, sample size, p50/p95, data set) written to milestone §6, and the
  target once agreed.
- Layout-driven aggregate with per-instance failure boundary; ranking and roots roadmap providers.
- API tests: default layout returns data for all eight instances; a student layout without
  `ranking` returns no ranking data and does not call the leaderboard read; a throwing provider
  yields `null` for that instance only; roadmap percentages on a fixture tree (mixed completed
  leaves, a leaf root, an inaccessible subtree excluded from both numerator and denominator);
  no title of an inaccessible root appears in the body.

Out:
- Web — Task 04. Start-topic roadmap — Task 09. Label/group tiers — Tasks 06 and 07.

## Acceptance Criteria

- [ ] Milestone §6 records the baseline (with the command to reproduce it) and the target.
- [ ] `GET /v1/me/dashboard` returns `{ layout, layoutSource, widgets }`; each case in Scope is
      covered by a passing test.
- [ ] `openapi.json` has typed schemas for every widget's data (no empty `{}` schema under this
      route).
- [ ] The endpoint meets the recorded target on the same measurement command.
- [ ] Changed files lint clean; `make test-api` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make db-seed-demo-local LABEL=budo`, `make dev-api`, run the measurement command before and
   after the change; record both.
2. `make test-api` — the aggregate specs pass.
3. `curl` the endpoint as a demo student and check the shape and the roadmap percentages.
4. `git diff --stat` confirms only scope-guardrail files changed.
