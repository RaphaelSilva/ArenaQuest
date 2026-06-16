# RFC 0003 — Route reorganization and OpenAPI/Swagger adoption in `apps/api`

- **Status:** Implemented — Revised 2026-06-16 (originally Draft 2026-05-24; "Partially Implemented" revision 2026-06-11)
- **Author:** raphaelsilva
- **Scope:** `apps/api/src/routes/**`, `apps/api/src/index.ts`, `apps/api/src/controllers/**` (signatures), `apps/web/src/lib/*-api.ts`, `apps/api/test/**`, public API documentation

> **Revision note.** Most of this RFC has already shipped on `develop`. The original document was written as a greenfield/incremental plan; it no longer matches reality and contained a few technical inaccuracies (auth on "public" routes, comments placement, the migration framing). This revision reframes the document as **current state + remaining gaps**, corrects those inaccuracies, brings the frontend and tests into scope, and resolves the Pending Decisions. The application is **not yet in production**, which removes the need for backward-compatibility machinery the original roadmap assumed.

## 0. Implementation Status

| Item | Status | Evidence |
|---|---|---|
| `/v1` prefix on all business routes | ✅ Done | `routes/index.ts:76` (`app.route('/v1', v1)`) |
| Folder structure (`public/`, `auth/`, `me/`, `admin/`, `_shared/`, `openapi/`) | ✅ Done | `routes/public/catalog.topics.ts`, `routes/me/index.ts`, `routes/auth/*` |
| `OpenAPIHono` + declarative routes with schema | ✅ Done | All mounted routers use `createRoute`/`router.openapi` (incl. `comments.router.ts`, `routes/auth/*`) |
| Unified envelope (`respondWith`/`respondCreated`/`respondNoContent`) | ✅ Done | imported in `catalog.topics.ts:4` (`@api/routes/_shared/envelope`) |
| `AppContainer` per bounded context | ✅ Done | `routes/index.ts:28`, `@api/container` |
| Scalar `/docs` + `/openapi.json` | ✅ Done | `index.ts:13,32`, `openapi/document.ts:12` (`doc31`) |
| `dump-openapi` script + committed `openapi.json` | ✅ Done | `apps/api/scripts/dump-openapi.ts`, `apps/api/openapi.json` |
| Generated types in `apps/web` | ✅ Wired | `api-types.gen.ts` now consumed by the clients (e.g. `topics-api.ts`); coverage expands as clients are touched |
| Comments router migrated to OpenAPI | ✅ Done | `comments.router.ts` is `OpenAPIHono`; `/topics/{id}/comments` present in `openapi.json` (Task 03 / R1) |
| Controller input standardized | ✅ Done | Pattern B everywhere in scope: `routes/auth/*` + `admin/badges.ts` declarative + `c.req.valid('json')` (Task 04 / R2) |
| Frontend aligned to `/v1` | ✅ Done | `/v1` centralized in `api-client.ts` (`API_VERSION`), `auth-api.ts`, OAuth link in `login/page.tsx` (Tasks 01/02/05 / R3) |
| Tests aligned to the new paths | ✅ Done | `test/helpers/v1.ts` prepends `/v1`; legacy-rewrite shim removed from `src/index.ts` (Task 06 / R4) |
| `oasdiff` contract gate in CI | ⏸️ Deferred | postponed until production (see §9, PD3) |
| **Residual cleanup** — orphaned legacy routers | ✅ Done (2026-06-16) | `routes/{register,password,activate}.router.ts` (dead duplicates left by Task 04, superseded by `routes/auth/*.ts`) deleted; suite green (62 files / 621 tests), build passes. |

## 1. Context

`apps/api` grew from a Worker with ~5 routes (Milestone 01) to **~74 endpoints** distributed across **20 routers** under `apps/api/src/routes/`. The original organization reflected the historical accumulation of milestones (auth → topics → tasks → progress → gamification → comments) rather than a deliberate design decision.

The reorganization described in §3–§4 has since been **largely executed**: routes now live under a single `/v1` sub-app composed from a small number of domain modules, validation is declarative via `@hono/zod-openapi`, a unified response envelope replaced the per-handler boilerplate, and OpenAPI is served at `/openapi.json` with a Scalar UI at `/docs`. What remains is the long tail captured in §0: migrating the comments router, standardizing controller signatures, wiring the frontend and tests to the new contract, and (post-launch) the CI contract gate.

## 2. Identified Problems

> These problems motivated the reorganization. Items marked **✅ resolved** are kept for historical context; items still open drive the remaining work in §5.

### P1. Multiple routers shared the same prefix — ✅ resolved

`/admin/topics`, `/tasks`, `/topics`, `/me`, and `/auth` were each mounted more than once with different routers, making it hard to know what handled a given path and risking silent route collisions. Each top-level path now owns a single module (`routes/index.ts` mounts `public`, `auth`, `admin`, `me`, `topics`, `comments` under `/v1`).

### P2. Inconsistent administrative hierarchy — ✅ resolved

`buildAdminEnrollmentRouter` used to mount at `/admin` (root) and OAuth at `/auth` from a second file. Admin sub-resources are now composed inside `routes/admin/index.ts` with a single `requireRole` guard, and auth is composed inside `routes/auth/index.ts`.

### P3. `AppRouter.register` was a bag of dependencies — ✅ resolved

The 30+ flat-field `deps` object was replaced by an `AppContainer` grouped by bounded context (`identity`, `content`, `engagement`, `progress`, `gamification`, `infra`, `controllers`) — see `@api/container` and `routes/index.ts:28`.

### P4. Boilerplate repeated in every handler — ✅ resolved (mostly)

The manual `c.req.json()` + `if (!result.ok)` + status-cast pattern was centralized into `routes/_shared/envelope.ts` (`respondWith`/`respondCreated`/`respondNoContent`) and the automatic 400 from `c.req.valid('json')`. **Exception:** `comments.router.ts` still uses the old manual pattern (`c.req.json()` without try/catch, hand-rolled envelope, `result.status as 400 | 403 | 422`) — see P6 and §5.

### P5. No OpenAPI/Swagger — ✅ resolved

`/openapi.json` (OpenAPI 3.1 via `OpenAPIHono.doc31`) and `/docs` (Scalar) are live; `apps/api/openapi.json` is committed and `apps/web/src/lib/api-types.gen.ts` is generated from it. **Caveat:** any route still on raw `Hono` (comments) does **not** appear in the document — closing that gap is part of the remaining work.

### P6. Inconsistent naming and granularity — 🟡 partially open (comments)

Progress/gamification routers were split into the `me/` module. The remaining inconsistency is **comments**:

- Create/list comments live at `/v1/topics/:id/comments` inside `comments.router.ts`, which is still raw `Hono` and mounted at the `/v1` root (`routes/index.ts:70`). Because it is not an `OpenAPIHono` route, it is **invisible in `/docs` and `openapi.json`**.
- Like/delete live at `/v1/me/comments/:id` (`routes/me/comments.ts`), correctly under the `/me` module.

This split is defensible as a **resource model** (a comment belongs to a *topic*; `/me/comments` holds actions on the caller's own comments), but it must be documented explicitly and the topic-comments endpoints must be migrated to OpenAPI. The original RFC's label `me/comments.ts ← (write paths)` was misleading — the primary write (creating a comment) is **not** under `/me`.

### P7. No versioning — ✅ resolved

All business routes live under `/v1`; `/health`, `/openapi.json`, and `/docs` remain unversioned.

## 3. Design Principles

1. **One prefix, one sub-app.** Each top-level path (`/auth`, `/admin`, `/me`, catalog, `/leaderboard`) owns a single Hono module. Sub-resources mount **inside** that module.
2. **Declarative routing with schema.** `@hono/zod-openapi`: each route declares method, path, request schema, response schema(s), and tags. OpenAPI 3.1 is a byproduct.
3. **Thin handlers via envelope helper.** `ControllerResult → Response` is centralized in `routes/_shared/envelope.ts`.
4. **DI by domain.** `AppContainer` grouped by bounded context instead of a flat dependency bag.
5. **Explicit versioning.** `/v1` on all business routes (`/health`, `/openapi.json`, `/docs` unversioned).
6. **OpenAPI = source of truth.** Generated at build time, committed to `apps/api/openapi.json`, served at `/openapi.json`, rendered at `/docs` via Scalar. The frontend derives types with `openapi-typescript`.

### 3.1. Authentication taxonomy (correction)

The original folder named `public/` and phase F4 described catalog routes as having **no auth**. **That is incorrect** — those routes are authenticated. "Public" here means *publicly browsable catalog content for any logged-in user*, **not** *unauthenticated*. The accurate taxonomy:

| Tier | Routes | Guard |
|---|---|---|
| **Truly unauthenticated** | `/health`, `/openapi.json`, `/docs`, `/v1/auth/*` (login, register, forgot/reset-password, activate, oauth.google) | none |
| **Authenticated (any logged-in user)** | catalog topics (`/v1/topics`), catalog tasks (`/v1/tasks`), `/v1/leaderboard`, `/v1/me/*`, comments | `authGuard` |
| **Admin** | `/v1/admin/*` | `authGuard` + `requireRole(ADMIN, CONTENT_CREATOR)` |

Evidence the catalog is already guarded: `catalog.topics.ts:66-67` (`router.use('/topics', authGuard)` / `'/topics/*'`), `catalog.tasks.ts` (same), `leaderboard.ts` (same). The `public/` directory name is retained for now to mean "catalog/browse"; if it keeps causing confusion, a follow-up may rename it to `catalog/`.

## 4. Detailed Design

### 4.1. Folder structure (as implemented)

```
apps/api/src/
├── routes/
│   ├── index.ts                       ← minimal composition under /v1
│   ├── _shared/
│   │   ├── envelope.ts                ← respondWith / respondCreated / respondNoContent
│   │   └── ...
│   ├── public/                        ← catalog/browse (AUTHENTICATED, not anonymous)
│   │   ├── health.ts                  ← unversioned /health
│   │   ├── catalog.topics.ts          ← GET /v1/topics/*        (authGuard)
│   │   ├── catalog.tasks.ts           ← GET /v1/tasks/*         (authGuard)
│   │   └── leaderboard.ts             ← GET /v1/leaderboard     (authGuard)
│   ├── auth/                          ← unauthenticated
│   │   ├── index.ts                   ← compose login + register + activate + password + oauth
│   │   ├── login.ts / register.ts / activate.ts / password.ts / oauth.google.ts
│   ├── me/                            ← authenticated (authGuard at sub-app level)
│   │   ├── index.ts
│   │   ├── account.ts / progress.ts / gamification.ts
│   │   └── comments.ts                ← /v1/me/comments/:id  (like, delete — actions on own comments)
│   ├── admin/                         ← authGuard + requireRole, composed once in index.ts
│   │   └── users.ts / topics.ts / tasks.ts / badges.ts / missions.ts / enrollments.ts
│   ├── comments.router.ts             ← ⚠️ raw Hono, mounted at /v1 root: /v1/topics/:id/comments (create/list)
│   └── topics.router.ts               ← /v1/topics write/progress paths
└── openapi/
    ├── document.ts                    ← OpenAPIHono root (doc31), info, servers, security
    └── components/                    ← reusable Zod schemas (entities, pagination, errors)
```

**Note on comments:** create/list still live in `comments.router.ts` (raw `Hono`) and therefore do not appear in `/docs`. Migrating it to `OpenAPIHono` is tracked in §5.

### 4.2. Declarative route pattern (as implemented)

```ts
// routes/admin/tasks.ts
router.openapi(createTaskRoute, async (c) => {
  const body = c.req.valid('json');        // inferred Zod type, no cast
  const result = await controller.create(body, c.get('user').sub);
  return respondCreated(c, result);        // single-line envelope
});
```

`c.req.valid('json')` performs the 400 validation at the **route** boundary; the controller receives an already-typed, already-validated value. The route definition is also the OpenAPI documentation.

### 4.3. Controller contract (standardization — open work)

Controllers currently use **three inconsistent input patterns**:

- **Pattern A — `input: unknown` + internal `safeParse`** (validation inside the controller): `register.controller.ts`, `password.controller.ts`, `activate.controller.ts`, `admin-badges.controller.ts`. Error envelopes also diverge (`ValidationFailed` vs `ValidationError` vs `BadRequest`).
- **Pattern B — pre-validated typed input** (`z.infer<...>`), validation already done at the route via `c.req.valid('json')`: `admin-tasks.controller.ts`, `admin-topics.controller.ts`, `admin-task-stages.controller.ts`, `comments.controller.ts`.
- **Pattern D — individual primitive arguments** (context-extracted, no body): `topics.controller.ts`, `me-missions.controller.ts`, etc.

**Decision: converge on Pattern B.** Controllers should receive already-validated, typed input; HTTP-shape validation is the route's job. Pattern A controllers (register/password/activate/admin-badges) get their `safeParse` removed and their corresponding routes migrated to declarative `request.body` schemas, yielding a single standardized 400 body. Pattern D stays as-is (no body to validate).

**The controller's role after this change:**
- Transport-agnostic application/domain logic: orchestrate repositories and engines, enforce **domain invariants** (e.g. last-admin lockout guard, enrollment-based topic access), and return a `ControllerResult<T>` (`{ ok: true, data } | { ok: false, status, error, meta? }`, `core/result.ts`).
- It does **not** parse HTTP and does **not** re-validate request shape.

This directly answers **PD4** (§9): `@ValidateBody`/`@Body` decorators do **not** exist on `develop` (they were a feature-branch artifact). The standing decision is to keep schema validation at the route and **not reintroduce** them.

### 4.4. Unified envelope — implemented

`routes/_shared/envelope.ts` provides `respondWith` (200), `respondCreated` (201), `respondNoContent` (204), each mapping `ControllerResult → Response` and serializing errors as `{ error, ...meta }` with the result's status.

### 4.5. Dependency container by domain — implemented

`AppContainer` groups dependencies by bounded context (`identity`, `content`, `engagement`, `progress`, `gamification`, `infra`, `controllers`); `buildContainer(env)` constructs it per request, and `AppRouter.register` consumes the grouped slices (`routes/index.ts`).

### 4.6. OpenAPI generation & exposure — implemented

- `/openapi.json` — OpenAPI 3.1 generated by `OpenAPIHono.doc31` (`openapi/document.ts`).
- `/docs` — Scalar UI via `@scalar/hono-api-reference` (`index.ts:32`).
- `apps/api/scripts/dump-openapi.ts` exports the committed `apps/api/openapi.json`; `apps/web/src/lib/api-types.gen.ts` is generated from it (consumption still pending — see §6).

## 5. Remaining Work (single cutover) — ✅ completed 2026-06

> **The application is not in production.** There are no live clients to keep compatible, so the original incremental, backward-compatible roadmap (legacy rewrites, deprecation windows, "frontend will not break") no longer applies and has been removed. The remaining work was a single coordinated cutover validated by the test suite — **now complete**. Each deliverable shipped as a `docs/product/backlog/refactoring/` task; see the mapping below.

| # | Deliverable | Backlog task | Status |
|---|---|---|---|
| R1 | **Migrate `comments.router.ts` to `OpenAPIHono`** — `/v1/topics/:id/comments` declarative, in `/docs`/`openapi.json`; `respondWith`/`respondCreated`; try/catch on body parse. | `03-api-comments-openapi-migration` | ✅ Done |
| R2 | **Standardize controllers on Pattern B** — removed `unknown`+`safeParse` from register/password/activate/admin-badges; schemas moved to route `request.body`; unified 400 body. | `04-api-controller-input-standardization` | ✅ Done |
| R3 | **Frontend alignment** (see §6) — `/v1` centralized in `api-client.ts`; clients begin consuming `api-types.gen.ts`. | `01`/`02`/`05-frontend-v1-prefix-alignment` | ✅ Done |
| R4 | **Test alignment + remove legacy shim** (see §7) — `/v1` prepended via `test/helpers/v1.ts`; legacy-rewrite shim deleted from `src/index.ts`. | `06-api-test-v1-paths-and-remove-legacy-shim` | ✅ Done |
| R5 | **Defer `oasdiff` contract gate** | — | ⏸️ Deferred until production (see §9, PD3) |

**Residual (resolved 2026-06-16):** R2's implementation introduced `routes/auth/{register,activate,password}.ts` (declarative, mounted via `routes/auth/index.ts`) but left the superseded top-level `routes/{register,password,activate}.router.ts` files in the tree. They were **orphaned** (imported by nothing; the live routes and tests use `routes/auth/*`) and have now been deleted — suite green (62 files / 621 tests), build passes. Note: `routes/comments.router.ts` and `routes/topics.router.ts` are **not** orphans — those are still imported by `routes/index.ts`.

## 6. Frontend alignment (new — in scope)

**Problem.** The API now serves everything under `/v1`, but the hand-written web clients still call **un-prefixed** paths, and `NEXT_PUBLIC_API_URL` has no `/v1`:

- `apps/web/src/lib/api-client.ts:30` concatenates `${apiUrl}${path}` with no version injection.
- `apps/web/src/lib/topics-api.ts:20` → `http('GET', '/topics')`; `auth-api.ts:48` → `fetch(\`${API_URL}/auth/login\`)`.
- `apps/web/.env.example:4` → `NEXT_PUBLIC_API_URL=http://localhost:8787` (no `/v1`).
- `apps/web/src/lib/api-types.gen.ts` already contains `/v1/...` paths but is **not wired** into the clients.

Today this does **not** 404 only because a transparent **legacy-rewrite shim** in `apps/api/src/index.ts:42-55` rewrites un-prefixed `/auth|/me|/admin|/topics|/tasks|/leaderboard|/catalog` to `/v1/...`. That shim is exactly the backward-compat machinery this RFC wants to drop (no production ⇒ not needed). The goal is to migrate clients to call `/v1` directly and then **remove the shim**. **Scope:**

1. **Centralize the `/v1` prefix in `api-client.ts`** (single source of truth) rather than editing every path string — preferred. The standalone `auth-api.ts` (pre-auth, bypasses the transport) and the hardcoded OAuth link in `login/page.tsx:265` (`${NEXT_PUBLIC_API_URL}/auth/google`) need their own update.
2. **Adopt `api-types.gen.ts`** so request/response types are derived from `openapi.json` and drift surfaces at compile time.

Representative files: `topics-api.ts`, `tasks-api.ts`, `auth-api.ts`, `comments-api.ts`, `progress-api.ts`, `dashboard-api.ts`, `admin-{topics,tasks,users,media,enrollment}-api.ts`, `app/(auth)/login/page.tsx`.

## 7. Test impact (new — in scope)

- ~**64** spec files under `apps/api/test/**`, ~**803** tests; they are **integration-style**, hitting literal paths through a `req()`/`worker.fetch` helper (e.g. `apps/api/test/routes/topics.router.spec.ts`).
- Roughly **117** hardcoded path literals reference the affected prefixes (`/auth/login` ×20, `/admin/users` ×23, `/admin/topics` ×15, `/topics`, `/me/*`, …) across ~13 route spec files.
- **Strategy:** introduce a shared path-constants helper (or prepend `/v1` inside the `req()` helper) so the cutover is a small, centralized change instead of ~117 scattered edits. Because there is no production safety net, **the test suite is the cutover's validation** — every phase must keep it green.
- The suite currently passes **only** because of the legacy-rewrite shim (`src/index.ts:42-55`). Once tests target `/v1` directly and the frontend is migrated (§6), the shim is removed — its deletion is what proves the cutover is complete.

## 8. Alternatives Considered

- **`hono-openapi`** instead of `@hono/zod-openapi` — discarded (less active, weaker Zod support). Decision validated in practice.
- **tRPC over Hono** — discarded: breaks the REST contract needed by mobile/external integrations.
- **Raw Hono + manual `zod-to-openapi`** — discarded: schema/route drift.
- **No changes, just add Swagger** — discarded: documenting the mess does not fix P1–P4.

## 9. Pending Decisions

1. **Versioning — path vs header.** ✅ **Resolved: path (`/v1`)**, already implemented (`routes/index.ts:76`). More readable in Cloudflare Analytics and curl.
2. **Docs renderer.** ✅ **Resolved: Scalar**, already live at `/docs` (`index.ts:32`).
3. **Contract policy (`oasdiff`).** ⏸️ **Deferred until production.** With no live clients, breaking changes are cheap, so the hard gate is premature; for now only the committed-`openapi.json` drift check applies. When enabled (at launch), recommendation is **hard failure with a `breaking-change` label override**. Concrete changes the gate would catch and their blast radius:
   - Rename a response field (`topicId` → `topic_id`) or change its type → regenerated `api-types.gen.ts` breaks the web build.
   - Remove an endpoint or a response field.
   - Flip a request field `required` ↔ `optional`, or tighten a Zod schema (e.g. add `.max(100)`).
   - Change a status code or the response envelope shape.
   - Operational side effects: each schema tweak requires `pnpm dump-openapi`, the drift check fails if `openapi.json` isn't regenerated, and the team must agree on hard-fail-vs-label policy. Deferring avoids this friction during pre-launch churn.
4. **`@ValidateBody` decorators.** ✅ **Resolved: do not reintroduce.** They do not exist on `develop` (feature-branch artifact). The validation boundary is the route (`c.req.valid('json')`); the controller is transport-agnostic domain logic (see §4.3).
