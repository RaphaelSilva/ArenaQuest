# Task 03 — Define `AppContainer` and refactor `buildApp` wiring (F3)

**Status:** ✅ Done
**Milestone:** [9 — `apps/api` Route Reorganization and OpenAPI Adoption](./milestone.md)
**RFC:** [0003 §4.4 and §5 — F3](../../RFCs/0003-apps-api-route-organization-and-openapi.md)

## Summary

Replace the 30+ flat-field `deps` argument of `AppRouter.register` with an `AppContainer` grouped by bounded context (`identity`, `content`, `engagement`, `progress`, `gamification`, `infra`, `controllers`). Refactor `buildApp(env)` in `src/index.ts` to construct the container via a new `buildContainer(env)` factory and pass typed slices into the existing route builders. **No route is moved** in this task — the existing `buildXxxRouter(...)` builders keep their current external behaviour; only their argument shape changes.

## Dependencies

Depends on Task 01. Blocks Tasks 04–07 (they assume route registrars receive a container slice).

## Technical Constraints

- **Scope guardrail:** `apps/api/src/index.ts`, `apps/api/src/routes/index.ts`, all existing files under `apps/api/src/routes/**` (signature changes only), and a new `apps/api/src/container.ts`. No changes to controllers, adapters, business logic, or `packages/shared/**`.
- The container groups defined in RFC §4.4 are authoritative: `identity`, `content`, `engagement`, `progress`, `gamification`, `infra`, `controllers`. If a dependency does not obviously belong to one, document the chosen home in the PR description before merging.
- Route builders that today take `deps: { authService, taskRepo, ... }` must be updated to take their bounded-context slice (e.g. `{ identity, engagement }`). They must **not** receive the whole container — keeping the slice tight is the whole point.
- Adapter instantiation order is unchanged: per-request inside `buildApp(env)`. Do not hoist any adapter into module scope (Workers have no shared memory between requests).
- The `controllers` group on the container holds the already-aggregated controller instances; this task does not split or reshape controllers.

## Scope

In:
- Create `apps/api/src/container.ts` exporting the `AppContainer` interface and the `buildContainer(env: AppEnv): AppContainer` factory.
- Refactor `buildApp(env)` to construct the container and pass slices into existing route builders.
- Update each `buildXxxRouter(deps)` to take its bounded-context slice. Adjust the calls in `routes/index.ts` accordingly.
- Keep `routes/index.ts` topology identical to today (still 20 mounts); the topology collapse happens in F4–F8.
- Add a TypeScript-only smoke test (a `vitest --typecheck` or a `tsc --noEmit` step, whichever is already wired) confirming the container shape compiles end-to-end.

Out:
- Collapsing the route topology (handled in F4–F8).
- Changing controller signatures or splitting them by domain.
- Wiring OpenAPI to the new container groups (each domain task handles its own OpenAPI registration).

## Acceptance Criteria

- [x] `apps/api/src/container.ts` exports `AppContainer` and `buildContainer`, with the seven groups from RFC §4.4.
- [x] `buildApp(env)` no longer constructs the flat `deps` bag; it calls `buildContainer(env)` and passes slices to each route builder.
- [x] Every route builder under `apps/api/src/routes/**` receives a container slice typed as a subset of `AppContainer`. No builder imports more than its bounded-context slice plus `infra` (when needed).
- [x] `routes/index.ts` still produces the same 20 mounts in the same order, with the same paths. (Topology collapse comes later.)
- [x] `make test-api`, `make test-web`, and `make lint` pass green with no behavioural diff on any endpoint.
- [x] No diff to controllers, adapters, or `packages/shared/**`.

## Verification Plan

1. Implement `container.ts` and refactor `buildApp`. Compile with `tsc --noEmit` (or the project's equivalent type-check step) and confirm zero errors.
2. Run `make test-api` and `make test-web` and confirm green.
3. Smoke-test 4–5 representative endpoints (`POST /auth/login`, `GET /me`, `POST /admin/topics`, `GET /leaderboard`, `GET /health`) against a local dev server to confirm payload-shape parity.
4. Review the diff to confirm every route builder takes a slice, not the whole container.
