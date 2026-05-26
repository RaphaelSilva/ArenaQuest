# Task 07 — Migrate `/admin` module: users, topics+media, tasks+stages+linking, badges, missions, enrollments (F7)

**Status:** 📝 Draft
**Milestone:** [9 — `apps/api` Route Reorganization and OpenAPI Adoption](./milestone.md)
**RFC:** [0003 §4.1 and §5 — F7](../../RFCs/0003-apps-api-route-organization-and-openapi.md)

## Summary

Consolidate every admin-side router (users, topics, media, tasks, stages, task linking, badges, missions, enrollments) into a single declarative sub-app under `apps/api/src/routes/admin/**`. Eliminates the `/admin/topics` shared-prefix collision (currently shared by `buildAdminTopicsRouter` and `buildAdminMediaRouter`) and re-homes `buildAdminEnrollmentRouter` (today incorrectly mounted at `/admin` instead of `/admin/enrollments`). The `requireRole(ADMIN)` guard is applied once at the sub-app level.

## Dependencies

Depends on Tasks 01, 02, 03. Can run in parallel with F5 and F6. Largest module of the milestone — expect the biggest PR.

## Technical Constraints

- **Scope guardrail:** new files under `apps/api/src/routes/admin/**`. Removal of every existing `admin-*.router.ts` file in `apps/api/src/routes/`. No changes to admin controllers, the auth guard implementation, or `packages/shared/**`.
- **Path parity required.** Each existing admin endpoint resolves at the same URL. The single intentional path move is `buildAdminEnrollmentRouter`: today it sits at `/admin/...` with the resource prefix declared inside the router; after this task it lives at `/admin/enrollments/...`. If today's external URL is exactly `/admin/enrollments/...` already (because the inside-the-router prefix matches), then there is no externally observable change. Confirm this with a request capture **before** merging; if the external path would change, defer the move to F8.
- The `requireRole(ADMIN)` (or current equivalent) guard is applied once at the sub-app level, not per-route. Per-route handlers no longer call the guard directly.
- Media endpoints (today on `buildAdminMediaRouter` mounted at `/admin/topics`) become sub-routes under `admin/topics.ts` (or a dedicated `admin/topics.media.ts` if the file becomes too large). Either way, the shared-prefix collision is gone.
- Task stages and task linking endpoints fold into `admin/tasks.ts` as sub-resources, not as separate top-level mounts.
- Every route declares `security: [{ bearerAuth: [] }]` and is tagged under `admin:<resource>` (e.g. `admin:users`, `admin:topics`, `admin:tasks`, `admin:badges`).
- Existing admin guards (last-admin protection, self-lockout prevention) remain in the controllers — this task does **not** move them.

## Scope

In:
- Create `apps/api/src/routes/admin/index.ts` aggregator (applies the role guard once) and modules: `users.ts`, `topics.ts` (including media sub-routes), `tasks.ts` (including stages + linking sub-routes), `badges.ts`, `missions.ts`, `enrollments.ts`.
- Migrate every handler to `createRoute(...)` + envelope helpers.
- Add the necessary Zod-OpenAPI schemas (admin payloads for create/update/delete on each resource, presigned-upload responses for media, task-stage and task-link shapes).
- Delete the legacy `admin-*.router.ts` files and remove their mounts from `routes/index.ts`. The admin block collapses to a single mount.
- Update existing admin specs minimally to keep them green (imports, paths if the test helper was hardcoded).

Out:
- Changing any admin controller behaviour, including last-admin guards.
- Adding new admin endpoints.
- Wiring `/v1` (F8) or CI dump (F9).

## Acceptance Criteria

- [ ] `routes/index.ts` mounts `/admin` exactly once. No `admin-*` legacy router files remain.
- [ ] Every previously existing `/admin/*` endpoint resolves at the same URL with the same payload, status, and headers (verified per resource).
- [ ] The role guard is applied once at the sub-app level; no per-route admin guard call remains.
- [ ] The `/admin/topics` prefix has exactly one owner (the new admin topics module, with media as sub-routes).
- [ ] `GET /openapi.json` lists every admin route with full schemas, `bearerAuth`, and the correct `admin:<resource>` tag.
- [ ] All existing admin specs pass green with at most cosmetic edits.
- [ ] Last-admin protection and self-lockout prevention specs continue to pass unchanged (the controller logic is untouched).
- [ ] `make test-api`, `make test-web`, `make lint` pass green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. Per resource, capture a before/after of a representative call (list, create, update, delete; for media also the presigned-upload start/complete). Diff headers + JSON.
2. Confirm the `/admin/topics` prefix has a single owner via a code-side check (grep `app.route('/admin/topics'`).
3. Inspect `GET /openapi.json` and confirm every admin route has schemas + security + tags.
4. Run `apps/api/test/routes/admin/**` specs and confirm green.
5. Backoffice smoke in `apps/web`: create/edit a topic with media upload, create/edit a task with stages, create a badge, create a mission, list enrollments — confirm no UI regression.
