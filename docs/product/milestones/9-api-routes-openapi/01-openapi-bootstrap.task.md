# Task 01 — Bootstrap `OpenAPIHono` root and expose `/openapi.json` + `/docs` (F1)

**Status:** 📝 Draft
**Milestone:** [9 — `apps/api` Route Reorganization and OpenAPI Adoption](./milestone.md)
**RFC:** [0003 §5 — F1](../../RFCs/0003-apps-api-route-organization-and-openapi.md)

## Summary

Add `@hono/zod-openapi` and `@scalar/hono-api-reference` to `apps/api`, swap the root `Hono` instance for an `OpenAPIHono`, and expose two new unversioned endpoints: `GET /openapi.json` (initially containing only `/health`) and `GET /docs` (Scalar UI). No existing route is migrated in this task — the goal is purely to land the foundation that subsequent phases build on, with zero behavioural change to current endpoints.

## Dependencies

None. Blocks every other task in this milestone.

## Technical Constraints

- **Scope guardrail:** changes restricted to `apps/api/package.json`, `apps/api/pnpm-lock.yaml` (regenerated), `apps/api/src/index.ts`, `apps/api/src/routes/index.ts`, and a new `apps/api/src/openapi/document.ts`. No changes to controllers, adapters, or `packages/shared/**`.
- The root `OpenAPIHono` must be a drop-in for the current `Hono` instance — every legacy route registered through `AppRouter.register` keeps responding with the same status codes, headers, and bodies.
- Bundle size: after this task, measure the compressed Worker size and record it in the PR description. If the delta exceeds **150 KB compressed**, stop and surface the finding before merging.
- Scalar UI must be served from `/docs` without requiring auth (matches the public nature of the docs endpoint).
- The OpenAPI document must declare `openapi: 3.1.0`, the `info` block (title `ArenaQuest API`, version sourced from `apps/api/package.json`), and the `servers` list (local, staging, production placeholders sourced from `wrangler.toml` environments — values can be hardcoded in this task and externalised later).

## Scope

In:
- Add `@hono/zod-openapi` and `@scalar/hono-api-reference` as runtime dependencies of `apps/api`.
- Replace the `new Hono()` call inside `buildApp(env)` with `new OpenAPIHono()`.
- Create `apps/api/src/openapi/document.ts` exporting the configured root document (info, servers, security schemes placeholder for `bearerAuth`).
- Register `GET /openapi.json` and `GET /docs` in `routes/index.ts` (or a dedicated `routes/docs.ts` if cleaner). At this stage the document only needs to include `/health` so the contract is non-empty.
- Verify that all existing legacy routes still resolve with no behavioural change.

Out:
- Migrating any existing route to the declarative `createRoute(...)` style (handled in F4–F7).
- Introducing the `/v1` prefix (handled in F8).
- Introducing the envelope helpers or `AppContainer` (handled in F2 and F3).
- Wiring CI dumps or frontend type generation (handled in F9).

## Acceptance Criteria

- [ ] `pnpm --filter @arenaquest/api install` succeeds and the lockfile is updated.
- [ ] `apps/api/src/index.ts` instantiates `OpenAPIHono`; the existing `AppRouter.register` continues to operate against it.
- [ ] `GET /openapi.json` returns a valid OpenAPI 3.1 JSON document with `info.title === 'ArenaQuest API'` and at least the `/health` path described.
- [ ] `GET /docs` returns an HTML page rendering Scalar against `/openapi.json`.
- [ ] All current API tests (`make test-api`) pass green with no spec edits.
- [ ] Compressed Worker bundle size delta is recorded in the PR description and stays under the 150 KB threshold (or the threshold breach is justified in the PR).
- [ ] No diff outside the files listed in the scope guardrail.

## Verification Plan

1. Run `pnpm --filter @arenaquest/api install` and confirm the lockfile change is limited to the two new packages and their transitive deps.
2. Run `make test-api` and confirm green.
3. Run `make dev-api` locally and:
   - `curl http://127.0.0.1:8787/openapi.json` returns valid JSON; pipe through `jq` and confirm `openapi === "3.1.0"`.
   - Open `http://127.0.0.1:8787/docs` in a browser and confirm the Scalar UI renders.
4. Hit a couple of legacy endpoints (`POST /auth/login`, `GET /health`) to confirm no behavioural regression.
5. Run `pnpm --filter @arenaquest/api build` (or equivalent) and capture the compressed bundle size for the PR description.
