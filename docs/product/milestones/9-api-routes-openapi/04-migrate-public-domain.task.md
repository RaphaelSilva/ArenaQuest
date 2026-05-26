# Task 04 — Migrate public domain: health, catalog, leaderboard (F4)

**Status:** ✅ Completed
**Milestone:** [9 — `apps/api` Route Reorganization and OpenAPI Adoption](./milestone.md)
**RFC:** [0003 §4.1 and §5 — F4](../../RFCs/0003-apps-api-route-organization-and-openapi.md)

## Summary

Migrate the unauthenticated, public domain to the declarative `@hono/zod-openapi` style under a new `apps/api/src/routes/public/**` tree. Includes `/health`, the public catalog reads for topics and tasks (currently served from `buildTopicsRouter` and `buildTasksRouter`), and `/leaderboard`. This is the **pilot** for the new pattern: handlers move to the envelope helpers, the routes become OpenAPI-described, and paths stay unprefixed (no `/v1` yet — that comes in F8).

## Dependencies

Depends on Tasks 01, 02, 03. Can run in parallel with F5 and F6 once F3 is merged.

## Technical Constraints

- **Scope guardrail:** new files under `apps/api/src/routes/public/**` and `apps/api/src/openapi/components/entities.ts` (only the schemas the public domain needs — `TopicNode`, `Task`, `LeaderboardEntry`, etc.). Removal of the legacy `buildTopicsRouter` / `buildTasksRouter` only for the **read-only public** subset — admin and progress sub-routers in those files stay untouched.
- Path parity is **mandatory**: every endpoint resolves at the same URL it does today (no `/v1` yet). Response shape parity is mandatory.
- Every new route uses `createRoute(...)` with method, path, tags (`public:health`, `public:catalog`, `public:leaderboard`), summary, request schema (if any), response schemas for every status the controller can emit, and security `[]` (no auth).
- The envelope helpers from Task 02 are the only response shaper used by these handlers.
- The public catalog endpoints currently coexist with progress endpoints under `/topics` and `/tasks`. Until F6 migrates the progress side, both routers must still resolve under their shared prefix. Use Hono's `app.route('/topics', publicCatalogRouter)` and keep the legacy progress router mounted; document in the PR that the shared-prefix smell is intentional and resolved by F6.

## Scope

In:
- Create `apps/api/src/routes/public/index.ts` exposing a sub-app that aggregates `health`, `catalog.topics`, `catalog.tasks`, `leaderboard`.
- Create `apps/api/src/routes/public/health.ts`, `catalog.topics.ts`, `catalog.tasks.ts`, `leaderboard.ts` with declarative routes.
- Add the Zod-OpenAPI schemas needed for the public read shapes to `apps/api/src/openapi/components/entities.ts`.
- Remove only the **public read** handlers from `buildTopicsRouter` / `buildTasksRouter` / `buildLeaderboardRouter`. Keep their non-public sibling handlers intact and continue to mount them.
- Confirm `GET /openapi.json` now lists every migrated public route with full request/response shape.

Out:
- Migrating `/me` progress endpoints that share the `/topics` and `/tasks` prefix (handled in F6).
- Introducing the `/v1` prefix (handled in F8).
- Splitting controller files or changing controller behaviour.

## Acceptance Criteria

- [x] `apps/api/src/routes/public/**` exists with the four modules above and an `index.ts` aggregator.
- [x] `routes/index.ts` mounts the new public sub-app and removes the now-empty public read handlers from the legacy routers (without dropping their remaining responsibilities).
- [x] `GET /health`, `GET /topics/...` (public reads), `GET /tasks/...` (public reads), `GET /leaderboard` respond with the same status, headers (excluding `content-length`), and JSON body as before migration.
- [x] `GET /openapi.json` lists every public route with: tags, summary, request schema (where applicable), 200/4xx response schemas using `ErrorBody` / `ValidationErrorBody`.
- [x] Every public handler returns through `respondWith` / `respondCreated` / `respondNoContent`.
- [x] `make test-api` passes green. No new spec files needed beyond minimal smoke coverage for the new modules; existing route specs continue to assert the same behaviour.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. Diff the JSON responses of the public endpoints against a snapshot taken before the change (`curl ... | jq -S` before and after, on representative inputs).
2. Inspect `GET /openapi.json` and confirm each migrated route has request/response schemas, not just a bare path entry.
3. Run `make test-api` and `make lint` green.
4. Local smoke against `make dev-api`: `/health`, one catalog topic read, one catalog task read, `/leaderboard`.
