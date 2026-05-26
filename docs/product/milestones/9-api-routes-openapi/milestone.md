# Milestone 9 — `apps/api` Route Reorganization and OpenAPI Adoption

**Status:** 📝 Draft
**Scope:** `apps/api/src/routes/**`, `apps/api/src/index.ts`, controller signatures (where strictly required), and the generated OpenAPI contract consumed by `apps/web`. Derived from [RFC 0003](../../RFCs/0003-apps-api-route-organization-and-openapi.md).

> **Hard scope guardrail — read before opening any task.** This milestone reshapes the HTTP layer of `apps/api` and introduces an OpenAPI contract. It may touch: `apps/api/src/routes/**`, `apps/api/src/index.ts`, a new `apps/api/src/container.ts`, a new `apps/api/src/openapi/**` tree, a new `apps/api/scripts/dump-openapi.ts`, the committed `apps/api/openapi.json`, and the generated types consumed by `apps/web/src/lib/api-types.gen.ts`. It is **not** an opportunity to rewrite business logic: controllers under `apps/api/src/controllers/**` keep their behaviour. Domain entities under `packages/shared/**`, migrations, and adapter implementations are **out of scope** unless a phase explicitly calls them out. If a refactor opportunity is spotted outside this scope, file a separate task — do not bundle it.

---

## 1. Objectives

- **Collapse the route topology** from 20 sibling mounts in `routes/index.ts` to 5 cohesive sub-apps (`public`, `auth`, `me`, `admin`, `docs`).
- **Eliminate shared-prefix routers** so that no two `app.route(...)` calls share the same base path; each prefix has a single owner.
- **Adopt OpenAPI 3.1 as the source of truth** for the HTTP contract via `@hono/zod-openapi`, served at `/openapi.json` and rendered at `/docs` (Scalar).
- **Cut handler boilerplate** by centralising the `ControllerResult → Response` mapping in a single envelope helper, replacing the per-handler `if (!result.ok) return ...` pattern.
- **Replace the 30-field `deps` bag** with an `AppContainer` grouped by bounded context (`identity`, `content`, `engagement`, `progress`, `gamification`, `infra`, `controllers`).
- **Introduce explicit versioning** with a `/v1` prefix for all business routes; keep `/health`, `/openapi.json`, and `/docs` unversioned.
- **Wire the contract into the frontend pipeline** by generating `apps/web/src/lib/api-types.gen.ts` from the committed `apps/api/openapi.json` and gating breaking changes in CI with `oasdiff`.

Out of scope (explicit):
- Behavioural changes to controllers, business rules, or persistence under `apps/api/src/controllers/**`, `apps/api/src/adapters/**`, or `packages/shared/**`.
- Database migrations or schema changes.
- Reworking authentication, rate limiting, CORS policy semantics, or cookie handling beyond moving their wiring into the new container.
- A long-lived `v0`/`v1` parallel mode. A short cutover window backed by Worker rewrites is allowed; maintaining two versions in code is not.
- Frontend feature work in `apps/web` beyond consuming the generated types.
- Removing `@ValidateBody` decorators from non-HTTP callers (jobs, CLIs) — only HTTP-facing usages are revisited.

---

## 2. Functional Requirements

The deliverables are observable in the HTTP surface and in the developer workflow, not in new product features.

- `routes/index.ts` exposes **5** top-level mounts: `public`, `auth`, `me`, `admin`, `docs`. No two mounts share a path prefix.
- Every business endpoint lives under `/v1/...`. `/health`, `/openapi.json`, and `/docs` are reachable at the root.
- `GET /openapi.json` returns a valid OpenAPI 3.1 document covering 100% of registered routes (including request bodies, response shapes, and error envelopes).
- `GET /docs` renders the Scalar UI against the live document.
- `apps/api/openapi.json` is committed and kept in sync with the runtime document via a CI guard that fails when the diff is non-empty.
- `apps/web/src/lib/api-types.gen.ts` is generated from `apps/api/openapi.json` and consumed by the existing API clients in `apps/web/src/lib/*-api.ts`.
- A new envelope helper (`respondWith`, `respondCreated`, `respondNoContent`) is the only place that maps a `ControllerResult` to an HTTP response.
- An `AppContainer` (`apps/api/src/container.ts`) replaces the flat `deps` bag in `AppRouter.register`; route registrars receive a typed slice of the container, not the whole world.
- A CI job runs `oasdiff` between the PR and `main` documents and fails on breaking changes unless a `breaking-change` label is present on the PR.

---

## 3. Acceptance Criteria

- [ ] `routes/index.ts` contains exactly 5 mounts (`public`, `auth`, `me`, `admin`, `docs`); no two mounts share a path prefix.
- [ ] Every business route resolves under `/v1/...`. A spot-check of `/v1/auth/login`, `/v1/me/progress`, `/v1/admin/topics`, `/v1/catalog/topics`, and `/v1/leaderboard` returns the same payload shape as their legacy counterparts.
- [ ] `GET /openapi.json` returns a valid OpenAPI 3.1 document; `GET /docs` renders Scalar against it.
- [ ] `apps/api/openapi.json` is committed and a CI job fails the build when the runtime document drifts from the committed file.
- [ ] `apps/web/src/lib/api-types.gen.ts` exists, is generated from `apps/api/openapi.json`, and is consumed by at least one existing `apps/web/src/lib/*-api.ts` client.
- [ ] Every HTTP handler that returns a `ControllerResult` does so via `respondWith` / `respondCreated` / `respondNoContent`. No handler retains the inline `if (!result.ok) return c.json(...)` pattern.
- [ ] `AppRouter.register` (or its successor `buildApp`) takes the `AppContainer` rather than the 30+ flat fields. No route registrar imports more than its bounded-context slice.
- [ ] A request with a malformed JSON body returns `400` with the standard `ValidationErrorBody` envelope (no `500`).
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] `oasdiff` CI job is wired and demonstrably fails on a synthetic breaking-change PR (verified in the PR for the F9 task).
- [ ] Worker bundle stays within Cloudflare's 1 MB compressed limit; a size delta is recorded in the milestone closeout.
- [ ] No diff outside the scope declared in §"Hard scope guardrail".

---

## 4. Specific Stack

- **`@hono/zod-openapi`** for declarative routes with Zod schemas; coexists with raw Hono routes during the migration.
- **`@scalar/hono-api-reference`** for the `/docs` UI (chosen over Swagger UI / Redoc for bundle size on Workers).
- **`openapi-typescript`** in `apps/web` to derive types from the committed contract.
- **`oasdiff`** in CI for breaking-change detection between PR and `main`.
- Existing **Zod** schemas remain authoritative; controller-level `@ValidateBody` is dropped only where the router now owns validation.
- No new persistence, auth, or rate-limiter libraries. The infra adapters under `apps/api/src/adapters/**` keep their current implementations.

---

## 5. Task Breakdown

| # | Task File | Status |
|---|-----------|--------|
| 01 | [Bootstrap `OpenAPIHono` root and expose `/openapi.json` + `/docs` (F1)](./01-openapi-bootstrap.task.md) | 📝 Draft |
| 02 | [Introduce envelope helpers and shared error/pagination schemas (F2)](./02-envelope-and-shared-schemas.task.md) | 📝 Draft |
| 03 | [Define `AppContainer` and refactor `buildApp` wiring (F3)](./03-app-container.task.md) | 📝 Draft |
| 04 | [Migrate public domain: health, catalog, leaderboard (F4)](./04-migrate-public-domain.task.md) | 📝 Draft |
| 05 | [Migrate `/auth` module: login, register, activate, password, OAuth (F5)](./05-migrate-auth-module.task.md) | 📝 Draft |
| 06 | [Migrate `/me` module: account, progress, enrollments, gamification, comments (F6)](./06-migrate-me-module.task.md) | 📝 Draft |
| 07 | [Migrate `/admin` module: users, topics+media, tasks+stages+linking, badges, missions, enrollments (F7)](./07-migrate-admin-module.task.md) | 📝 Draft |
| 08 | [Introduce `/v1` prefix and legacy rewrites for cutover (F8)](./08-v1-prefix-and-rewrites.task.md) | 📝 Draft |
| 09 | [Wire OpenAPI dump, frontend type generation, and `oasdiff` CI gate (F9)](./09-openapi-pipeline-and-contract-gate.task.md) | 📝 Draft |
| 10 | [Remove redundant `@ValidateBody` decorators from HTTP-facing controllers (F10)](./10-remove-redundant-validatebody.task.md) | 📝 Draft |

Dependency graph:

```
01 ──► 02 ──► 03 ──► 04 ──► 05, 06, 07  (parallel after 04)
                                  │
                                  ▼
                                 08 ──► 09 ──► 10
```

**Recommended execution order:** `01` → `02` → `03` → `04` → `05, 06, 07` (parallel where reviewer bandwidth allows) → `08` → `09` → `10`.

Each task is intended to land as an independent PR with the existing test suite passing. No phase is allowed to break the legacy path responses until F8 explicitly performs the cutover.

---

## 6. Pre-flight decisions (close before starting F1)

These are open questions from RFC 0003 §9. The milestone cannot start until each is decided and recorded here.

1. **Versioning carrier:** path (`/v1`) vs. media-type header. RFC recommendation: **path**.
2. **Docs renderer:** Scalar vs. Swagger UI vs. Redoc. RFC recommendation: **Scalar**.
3. **Contract gate policy:** hard fail on any breaking change vs. label-driven override. RFC recommendation: **hard fail, `breaking-change` label unblocks**.
4. **`@ValidateBody` fate:** keep for non-HTTP callers vs. remove entirely. RFC recommendation: **remove from HTTP-facing controllers; keep only where a non-HTTP caller still exists** (audited in Task 10).

Owner of these decisions: product + tech lead. Outcomes must be appended below before F1 opens a PR.

---

## 7. Definition of Done (milestone level)

- [ ] All 10 tasks marked `✅ Done` with every acceptance box checked.
- [ ] All milestone-level acceptance criteria in §3 pass.
- [ ] `make lint`, `make test-api`, `make test-web` green in CI.
- [ ] Closeout note at `docs/product/milestones/9-api-routes-openapi/closeout-analysis.md` records: bundle-size delta, handler line-count delta, number of mounts before/after, and a screenshot of `/docs` against staging.
- [ ] RFC 0003 status updated to `Accepted` (or `Implemented`) in `docs/product/RFCs/README.md` and in the RFC header.
- [ ] No diff outside the scope declared in §"Hard scope guardrail".
