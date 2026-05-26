# Task 08 — Introduce `/v1` prefix and legacy rewrites for cutover (F8)

**Status:** ✅ Completed
**Milestone:** [9 — `apps/api` Route Reorganization and OpenAPI Adoption](./milestone.md)
**RFC:** [0003 §4.6 and §5 — F8](../../RFCs/0003-apps-api-route-organization-and-openapi.md)

## Summary

Move every business route under a global `/v1` prefix while keeping legacy paths reachable during a documented cutover window. The implementation uses `OpenAPIHono.basePath('/v1')` for the new mounts and Cloudflare Worker rewrites (in `wrangler.toml` route patterns, or a thin in-Worker rewriter at the entrypoint) to forward legacy paths (`/auth/*`, `/me/*`, `/admin/*`, `/topics/*`, `/tasks/*`, `/leaderboard`) to their `/v1` counterparts. `/health`, `/openapi.json`, and `/docs` stay unversioned.

## Dependencies

Depends on Tasks 04, 05, 06, 07 (every business module must already be migrated). Blocks Task 09 (the dumped contract must reflect `/v1`).

## Technical Constraints

- **Scope guardrail:** `apps/api/src/index.ts` (or wherever sub-apps are composed), the route aggregators under `apps/api/src/routes/{public,auth,me,admin}/index.ts` (to attach the `/v1` base path), `apps/api/wrangler.toml` (route patterns or rewrite config if used), and possibly a new `apps/api/src/middleware/legacy-rewrite.ts` if an in-Worker rewriter is preferred over wrangler route patterns. No changes to controllers, adapters, or `packages/shared/**`.
- **Cutover policy:** legacy paths must keep responding identically (status, headers, body) for the duration of the cutover window. The window length and deprecation date must be written into the PR description and into `apps/api/README.md` (or equivalent ops doc).
- Decide and document the rewrite mechanism: Cloudflare route-level rewrites vs. in-Worker middleware. RFC default is in-Worker for visibility; either is acceptable as long as the chosen mechanism is the **only** one in use.
- The rewriter must preserve method, query string, request body, headers (especially `Authorization`, `Cookie`, `Origin`), and not introduce an additional fetch round trip — it must dispatch internally.
- `/health`, `/openapi.json`, `/docs` remain at the root. `GET /openapi.json` reflects `/v1/...` paths only (not the legacy ones) — legacy paths are an undocumented cutover bridge, not a contract surface.
- `apps/web` is **not** edited in this task; it continues to call legacy paths. Updating `apps/web` to call `/v1` directly is a follow-up task tracked outside this milestone (or handled by F9 in tandem with type generation).

## Scope

In:
- Attach `.basePath('/v1')` to each business sub-app mount, so every business route lands under `/v1/...`.
- Implement the legacy-path bridge (chosen mechanism documented in the PR) covering `/auth/*`, `/me/*`, `/admin/*`, `/topics/*`, `/tasks/*`, `/leaderboard`, and any other root-level business path still in use by clients.
- Document the cutover window: dates, deprecation date for the legacy bridge, the metrics that will be used to confirm clients have moved (e.g. request counts per path in Cloudflare Analytics or Workers Logs).
- Update `apps/api/README.md` (or create `apps/api/docs/api-versioning.md`) with the versioning policy and the cutover plan.

Out:
- Editing `apps/web` to call `/v1` directly (separate follow-up; F9 may bundle it once types are regenerated).
- Removing the legacy bridge (a separate cleanup task after the deprecation window closes).
- Introducing a `v2` or any second version.

## Acceptance Criteria

- [x] Every business endpoint resolves at `/v1/...`. Spot-check `/v1/auth/login`, `/v1/me`, `/v1/admin/topics`, `/v1/leaderboard`.
- [x] Every legacy path (`/auth/...`, `/me/...`, `/admin/...`, `/topics/...`, `/tasks/...`, `/leaderboard`) keeps responding with the same payload, status, and headers as before.
- [x] `/health`, `/openapi.json`, `/docs` remain unversioned.
- [x] `GET /openapi.json` lists only `/v1/...` paths under `paths`. Legacy bridge does not appear in the contract.
- [x] The cutover window and deprecation date are documented in `apps/api/README.md` (or the dedicated ops doc).
- [x] `make test-api` passes. Specs continue to assert against legacy paths (they exercise the bridge as a side benefit); new smoke specs added to confirm at least one `/v1/...` path per module.
- [x] `make test-web` passes (no `apps/web` changes are required to keep it green; the bridge guarantees it).
- [x] Worker bundle size delta recorded in PR (rewriter overhead should be negligible — flag anything > 20 KB compressed).

## Verification Plan

1. For each module (public, auth, me, admin), `curl` both the legacy path and the `/v1` path and confirm identical responses.
2. Inspect `GET /openapi.json` and confirm only `/v1/...` paths are listed.
3. Run `make test-api` + `make test-web` and confirm green without `apps/web` edits.
4. Local browser smoke against `apps/web` to confirm no UI regression while the frontend still hits legacy paths.
5. Confirm the docs page (`/docs`) renders the `/v1` paths in Scalar.
