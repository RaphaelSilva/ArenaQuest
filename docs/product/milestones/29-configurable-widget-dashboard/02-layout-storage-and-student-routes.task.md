# Task 02 — Backend: Layout storage and student layout routes (Phase 1)

**Status:** 📝 Open
**Milestone:** [29 — Configurable Widget Dashboard](./milestone.md)
**RFC:** [RFC 0008](../../RFCs/0008-user-dashboard-with-topic-recommendations-and-badge-achievem.md)
**Team:** Backend API
**Depends On:** [Task 01](./01-widget-registry-and-layout-schema.task.md)

## Summary

Adds the storage for dashboard layouts and the student's own layout routes. Migration `0033`
creates **`dashboard_user_layouts`** (one row per user: the layout document, `based_on` — `code`,
`label` or `group:<id>` — the `updated_at` of that default at copy time, and the row's own
`updated_at`; cascades on user delete) and **`dashboard_group_layouts`** (one row per group: the
layout document, an integer `priority`, `updated_at`, `updated_by`; cascades on group delete — the
table is only read and written from Task 07, but it ships in the same migration to keep numbering
simple). A new `IDashboardLayoutRepository` port and its D1 adapter read and write both. The
student routes: **`GET /v1/me/dashboard/layout`** returns the effective layout, its source, a
`newDefault` flag (always `false` until Task 07) and the widget types the student may add;
**`PUT /v1/me/dashboard/layout`** validates the body with the shared **strict** parser and saves the
copy, recording which default it was based on; **`DELETE /v1/me/dashboard/layout`** removes the copy
(restore default). In this task the only default is the **code default**; Tasks 06 and 07 insert the
label and group tiers into the same resolver. All three routes send `Cache-Control: private,
no-store`, and `PUT`/`DELETE` return the new effective layout.

## Dependencies

- [Task 01](./01-widget-registry-and-layout-schema.task.md) — hard code dependency: the layout
  schema, the readers and the code default.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/migrations/0033_create_dashboard_layouts.sql` (new; renumber if another migration
    lands first) — two new tables, no change to an existing table; rollback is dropping both.
  - `packages/shared/ports/i-dashboard-layout-repository.ts` (new) and `packages/shared/ports/index.ts`.
  - `apps/api/src/adapters/db/d1-dashboard-layout-repository.ts` (new).
  - `apps/api/src/core/dashboard/resolve-layout.ts` (new) — the tier resolver, code tier only here.
  - `apps/api/src/controllers/me-dashboard-layout.controller.ts` (new) and
    `apps/api/src/routes/me/dashboard-layout.ts` (new), mounted in `apps/api/src/routes/me/index.ts`.
  - `apps/api/src/container.ts` — a `dashboard` group with the repository.
  - `apps/api/openapi.json`, `apps/api/src/openapi/components/**` (regenerated) and `apps/api/test/**`.
- **Ports & Adapters.** Persistence behind `IDashboardLayoutRepository`; only the adapter knows D1.
  The layout column holds the serialised document; the controller never parses SQL rows.
- **Validation & results.** `@hono/zod-openapi` `createRoute` at the route; the controller parses
  the body again with the shared strict parser and returns `ControllerResult<T>` — `400` with the
  failing path on an invalid document; `401` without a token.
- **Read is tolerant.** A stored copy that no longer validates (a type removed later) is read
  through the tolerant reader, dropping the bad instance with an ids-only log; it never `500`s.

## Scope

In:
- Migration, port, adapter, resolver (code tier), controller, routes, container wiring.
- The addable-types list: registry types allowed at `student` scope, minus non-`multiple` types
  already present.
- API tests: `GET` with no row returns the code default and `layoutSource.kind = 'code'`; `PUT`
  valid then `GET` returns it with `kind = 'student'` and `based_on = 'code'`; `PUT` with an invalid
  document is `400` and leaves the previous row untouched; `DELETE` restores the code default;
  a stored copy containing an unknown type is returned without that instance; no token → `401`;
  user deletion cascades the row.

Out:
- Rendering and the aggregate — Task 03. Label tier — Task 06. Group tier, locks and `newDefault`
  — Task 07. Any web change — Task 05.

## Acceptance Criteria

- [ ] `make db-migrate-local` applies `0033` on a fresh replica; both tables exist with their
      cascades.
- [ ] `GET`, `PUT`, `DELETE /v1/me/dashboard/layout` behave as listed in Scope, each case covered by
      a test, with `Cache-Control: private, no-store`.
- [ ] An invalid `PUT` writes nothing (row count and content unchanged in the test).
- [ ] No D1 symbol in the port or the controller.
- [ ] `openapi.json` documents the three routes with typed schemas.
- [ ] Changed files lint clean; `make test-api` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make db-migrate-local` on a fresh replica; inspect both tables.
2. `make test-api` — the new route and adapter specs pass.
3. `make dev-api` — `curl` the three routes as a seeded student, including an invalid body.
4. `git diff --stat` confirms only scope-guardrail files changed.
