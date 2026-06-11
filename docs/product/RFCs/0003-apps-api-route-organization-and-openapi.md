# RFC 0003 — Route reorganization and OpenAPI/Swagger adoption in `apps/api`

- **Status:** Draft
- **Author:** raphaelsilva
- **Date:** 2026-05-24
- **Scope:** `apps/api/src/routes/**`, `apps/api/src/index.ts`, `apps/api/src/controllers/**` (signatures), public API documentation

## 1. Context

`apps/api` has grown from a Worker with ~5 routes (Milestone 01) to **~74 endpoints** distributed across **20 routers** under `apps/api/src/routes/`. The current organization reflects the historical accumulation of milestones (auth → topics → tasks → progress → gamification → comments) rather than a deliberate design decision.

Current state of `routes/index.ts`:

```ts
app.route('/', buildCommentsRouter(...));
app.route('/auth', buildAuthRouter({...}));                    // login, refresh, logout, register, activate, password
app.route('/admin/users', buildAdminUsersRouter(...));
app.route('/admin/topics', buildAdminTopicsRouter(...));       // Node CRUD
app.route('/admin/topics', buildAdminMediaRouter(...));        // ⚠️ same prefix, another router
app.route('/admin/tasks', buildAdminTasksRouter(...));
app.route('/tasks', buildTasksRouter(...));
app.route('/tasks', buildProgressTaskRouter(...));             // ⚠️ same prefix
app.route('/topics', buildTopicsRouter(...));
app.route('/topics', buildProgressTopicRouter(...));           // ⚠️ same prefix
app.route('/me', buildMeProgressRouter(...));
app.route('/me', buildMeGamificationRouter(...));              // ⚠️ same prefix
app.route('/leaderboard', buildLeaderboardRouter(...));
app.route('/admin', buildAdminEnrollmentRouter(...));          // ⚠️ admin at root, not under /admin/enrollments
app.route('/account', buildAccountRouter(...));
app.route('/auth', buildOAuthRouter(...));                     // ⚠️ /auth registered in two places
app.route('/admin/badges', buildAdminBadgesRouter(...));
app.route('/admin/missions', buildAdminMissionsRouter(...));
```

Each handler follows the same manual pattern:

```ts
router.post('/', async (c) => {
  const body = await c.req.json();
  const result = await controller.create(body);
  if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 400 | 404 | 422);
  return c.json(result.data, 201);
});
```

There is no published OpenAPI/Swagger contract — the frontend (`apps/web`) consumes the API using manually copied types in `src/lib/*-api.ts`, and the QA team lacks a single source of truth for the available routes.

## 2. Identified Problems

### P1. Multiple routers share the same prefix

`/admin/topics`, `/tasks`, `/topics`, `/me`, and `/auth` are mounted **more than once** using different routers. Hono resolves this based on registration order, but a human reader needs to open 2–3 files to find out what handles `GET /tasks/:id`. Observable symptoms:

- `buildTopicsRouter` and `buildProgressTopicRouter` both receive `topics`, `enrollmentRepo`, `xpEngine`, `streakEngine`, `questEvaluator`, `badgeEngine` — dependency injection (DI) duplication because the boundary between "content" and "progress" has been blurred.
- Silent collisions: if two routers define `GET /:id` under the same prefix, the second one becomes dead code without warning.

### P2. Inconsistent administrative hierarchy

- `buildAdminEnrollmentRouter` is mounted at `/admin` (root), not `/admin/enrollments`. The resource prefix is declared **inside** the router, diverging from the pattern of the other admin routers.
- `buildOAuthRouter` is mounted at `/auth` but adds `/auth/google/*` routes — making it hard to know which endpoints exist under `/auth` just by reading `routes/index.ts`.

### P3. `AppRouter.register` is a bag of dependencies

The signature contains **30+ fields** in a single flat object (`auth`, `users`, `tokens`, `topics`, `tags`, `media`, `storage`, `taskRepo`, `taskStages`, `taskLinks`, `progressRepo`, `enrollmentRepo`, `questRepo`, `badgeRepo`, `gamificationRepo`, `missionRepo`, `commentRepo`, `xpEngine`, `streakEngine`, `questEvaluator`, `badgeEngine`, `authService`, `loginLimiter`, `registerController`, `registerLimiter`, `activateController`, `activateLimiter`, `passwordController`, `forgotPasswordLimiter`, `accountController`, `googleOAuthController`, `mailer`, `cookieSameSite`, `allowedOrigins`, `strictCors`).

Adding a new endpoint requires editing **3 files** (`index.ts` to instantiate the adapter, `routes/index.ts` to forward it, and the destination router), and the type of the `deps` parameter keeps growing.

### P4. Boilerplate repeated in every handler

Each of the ~74 routes repeats:

```ts
const body = await c.req.json();                                 // no try/catch ⇒ throws 500 on malformed JSON
const result = await controller.xxx(body);
if (!result.ok) return c.json({ error: ..., ...result.meta }, result.status as 400 | 404 | 422);
return c.json(result.data);
```

Problematic points:
- `c.req.json()` without parsing handling — an invalid payload generates a 500 error instead of a 400.
- Cast `result.status as 400 | 404 | 422` differs between handlers (some use `as never`, others list different codes).
- Response envelope structure varies: `{ data }`, `{ data: ... }`, loose `result.data`, `c.body(null, 204)` — with no single standard.

### P5. No OpenAPI/Swagger

Practical consequences:
- The frontend maintains manually mirrored types; when the backend changes a field, the error only appears at runtime.
- The `qa-tester` skill needs to read the source code to discover endpoints.
- There is no `/docs` for stakeholders and onboarding.
- The Zod schemas used via `@ValidateBody` (in `src/core/decorators.ts`) remain isolated within controllers and do not become an exportable contract.

### P6. Inconsistent naming and granularity

- `progress.router.ts` exports **three** different routers (`buildProgressTaskRouter`, `buildProgressTopicRouter`, `buildMeProgressRouter`) — a single file with three responsibilities.
- `me-gamification.router.ts` vs `/me` progress scattered in `progress.router.ts`.
- `tasks.router.ts` (public) vs `admin-tasks.router.ts` (backoffice) is a good pattern, but `comments.router.ts` is mounted at the root (`/`) with no prefix and handles comments for both topics **and** tasks internally.

### P7. No versioning

All routes live at `/` without `/v1`. When a contract break occurs (there are already backlog tickets for refactoring `TopicProgress`), there is no migration path other than breaking the client.

## 3. Proposed Principles

1. **One prefix, one sub-app.** Each top-level path (`/auth`, `/admin`, `/me`, `/catalog`, `/leaderboard`) owns a single Hono module. Sub-resources are mounted **inside** that module, rather than as siblings in `index.ts`.
2. **Declarative routing with schema.** Migrate to `@hono/zod-openapi`: each route declares its method, path, request schema, response schema(s), and tags. OpenAPI 3.1 is generated as a byproduct of the route definition.
3. **Thin handlers via envelope helper.** Centralize `ControllerResult → Response` into a single utility, eliminating repeated `if (!result.ok) ...` checks.
4. **DI by domain.** Replace the "bag of 30 fields" with an `AppContainer` grouped by bounded context (`identity`, `content`, `engagement`, `progress`, `gamification`, `infra`).
5. **Explicit versioning.** A `/v1` prefix on all business routes (keeping `/health` and `/openapi.json` unversioned).
6. **OpenAPI = source of truth.** The JSON is generated at build-time, committed to `apps/api/openapi.json`, served at `/openapi.json`, and rendered at `/docs` via Scalar. The frontend derives types with `openapi-typescript`.

## 4. Detailed Proposal

### 4.1. New folder structure

```
apps/api/src/
├── routes/
│   ├── index.ts                       ← minimal composition (3 mounts, not 20)
│   ├── _shared/
│   │   ├── envelope.ts                ← respondWith(result), respondCreated(result)
│   │   ├── openapi.ts                 ← createRoute, registerCommonSchemas
│   │   └── error-schemas.ts           ← ErrorBody, ValidationErrorBody (Zod)
│   ├── public/
│   │   ├── health.ts
│   │   ├── catalog.topics.ts          ← GET /v1/catalog/topics/*
│   │   ├── catalog.tasks.ts           ← GET /v1/catalog/tasks/*
│   │   └── leaderboard.ts             ← GET /v1/leaderboard
│   ├── auth/
│   │   ├── index.ts                   ← compose login + register + activate + password + oauth
│   │   ├── login.ts
│   │   ├── register.ts
│   │   ├── activate.ts
│   │   ├── password.ts
│   │   └── oauth.google.ts
│   ├── me/
│   │   ├── index.ts                   ← compose progress + gamification + account
│   │   ├── account.ts                 ← /v1/me, PATCH profile, delete
│   │   ├── progress.ts                ← /v1/me/progress
│   │   ├── enrollments.ts             ← /v1/me/enrollments
│   │   ├── gamification.ts            ← /v1/me/xp, /v1/me/badges, /v1/me/quests
│   │   └── comments.ts                ← /v1/me/comments (write paths)
│   └── admin/
│       ├── index.ts                   ← requireRole(ADMIN) guard applied once
│       ├── users.ts
│       ├── topics.ts                  ← includes media (sub-route /:id/media)
│       ├── tasks.ts                   ← includes stages and linking (sub-routes)
│       ├── badges.ts
│       ├── missions.ts
│       └── enrollments.ts
└── openapi/
    ├── document.ts                    ← OpenAPIHono root, info, servers, security
    └── components/
        ├── entities.ts                ← reusable Zod schemas (User, Topic, Task...)
        ├── pagination.ts
        └── errors.ts
```

The controllers remain where they are; only the routing layer changes.

### 4.2. Declarative route pattern

Example of what replaces the manual handler in `admin-topics.router.ts`:

```ts
// routes/admin/topics.ts
import { createRoute, z } from '@hono/zod-openapi';
import { TopicNodeSchema, CreateTopicSchema } from '@api/openapi/components/entities';
import { respondWith, respondCreated } from '@api/routes/_shared/envelope';

export const createTopicRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['admin:topics'],
  summary: 'Create a topic node',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: CreateTopicSchema } } },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: TopicNodeSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ValidationErrorBody } } },
    404: { description: 'Parent not found', content: { 'application/json': { schema: ErrorBody } } },
    422: { description: 'Domain rule violated', content: { 'application/json': { schema: ErrorBody } } },
  },
});

export function registerAdminTopics(app: OpenAPIHono, ctx: AdminCtx) {
  app.openapi(createTopicRoute, async (c) => {
    const body = c.req.valid('json');
    return respondCreated(c, await ctx.controllers.adminTopics.create(body));
  });
  // ... other routes
}
```

Direct gains:
- End-to-end typing: `c.req.valid('json')` is the inferred Zod type, with no casting.
- Automatic 400 validation with a standardized body (`{ error: 'ValidationError', issues: [...] }`).
- `respondWith`/`respondCreated` centralize the `ControllerResult → Response` mapping.
- The route itself is the OpenAPI documentation.

### 4.3. Unified envelope

`routes/_shared/envelope.ts`:

```ts
export function respondWith<T>(c: Context, r: ControllerResult<T>) {
  if (r.ok) return c.json(r.data, 200);
  return c.json({ error: r.error, ...(r.meta ?? {}) }, r.status);
}
export function respondCreated<T>(c: Context, r: ControllerResult<T>) {
  if (r.ok) return c.json(r.data, 201);
  return c.json({ error: r.error, ...(r.meta ?? {}) }, r.status);
}
export function respondNoContent<T>(c: Context, r: ControllerResult<T>) {
  if (r.ok) return c.body(null, 204);
  return c.json({ error: r.error, ...(r.meta ?? {}) }, r.status);
}
```

Eliminates ~3 lines of boilerplate × 74 handlers ≈ **220 fewer lines**.

### 4.4. Dependency container by domain

Replaces the bag object of `AppRouter.register`:

```ts
// src/container.ts
export interface AppContainer {
  identity: {
    authService: AuthService;
    users: IUserRepository;
    tokens: IRefreshTokenRepository;
    activationTokens: IActivationTokenRepository;
    passwordResetTokens: IPasswordResetTokenRepository;
    oauthAccounts: IOAuthAccountRepository;
  };
  content: { topics: ITopicNodeRepository; tags: ITagRepository; media: IMediaRepository; storage: IStorageAdapter };
  engagement: { taskRepo: ITaskRepository; taskStages: ITaskStageRepository; taskLinks: ITaskLinkingRepository; commentRepo: ICommentRepository };
  progress: { progressRepo: IProgressRepository; enrollmentRepo: IEnrollmentRepository };
  gamification: { questRepo: IQuestRepository; badgeRepo: IBadgeRepository; gamificationRepo: IGamificationRepository; missionRepo: IMissionRepository; xpEngine: XpEngine; streakEngine: StreakEngine; questEvaluator: QuestEvaluator; badgeEngine: BadgeEngine };
  infra: { auth: IAuthAdapter; mailer: IMailer; rateLimiters: { login: IRateLimiter; register: IRateLimiter; activate: IRateLimiter; forgotPassword: IRateLimiter }; cors: { allowedOrigins?: string; strict: boolean }; cookies: { sameSite: CookieSameSite } };
  controllers: { /* already aggregated by feature */ };
}

export function buildContainer(env: AppEnv): AppContainer { /* ... */ }
```

`buildApp(env)` reduces to:

```ts
const ctx = buildContainer(env);
const app = new OpenAPIHono();
registerMiddleware(app, ctx.infra);
registerPublic(app, ctx);
registerAuth(app.basePath('/v1/auth'), ctx);
registerMe(app.basePath('/v1/me'), ctx);
registerAdmin(app.basePath('/v1/admin'), ctx);
registerDocs(app);
return app;
```

### 4.5. Generation and exposure of OpenAPI

- `/openapi.json` — OpenAPI 3.1 JSON generated at runtime by `OpenAPIHono`.
- `/docs` — Scalar UI (`@scalar/hono-api-reference`), lighter than Swagger UI and runs within the Worker bundle limit.
- Build script `apps/api/scripts/dump-openapi.ts` exports the committed `apps/api/openapi.json`, used by:
  - `apps/web` via `openapi-typescript apps/api/openapi.json -o apps/web/src/lib/api-types.gen.ts`;
  - contract validator in CI (`oasdiff` between PR and `main`, fails on unannotated breaking changes).

### 4.6. Versioning

- All business routes move to `/v1/...`.
- `/health`, `/openapi.json`, `/docs` remain outside of versioning.
- `v0` (current state) can be maintained for a deprecation period via rewrites in the Worker if needed — outside the scope of this RFC.

## 5. Migration Roadmap

The migration is **incremental** — there is no big-bang. `@hono/zod-openapi` is a superset of `Hono`; both APIs coexist within the same `app`.

| Phase | Deliverable | Estimated Effort |
|---|---|---:|
| F1 | Add `@hono/zod-openapi` + `@scalar/hono-api-reference`; create root `OpenAPIHono`; expose empty `/openapi.json` and `/docs` | 0.5 days |
| F2 | `respondWith`/`respondCreated`/`respondNoContent` helpers + common schemas (`ErrorBody`, `ValidationErrorBody`, `Pagination`) | 0.5 days |
| F3 | `AppContainer` and `buildContainer`; refactor `index.ts` and `routes/index.ts` to the new format **without moving routes yet** | 1 day |
| F4 | Migrate **public** domain (`/health`, `/catalog/topics`, `/catalog/tasks`, `/leaderboard`) — smaller domain, no auth | 1 day |
| F5 | Migrate `/auth` (login, register, activate, password, oauth) — consolidate the 5 routers into a single module | 1.5 days |
| F6 | Migrate `/me` (progress + gamification + account + enrollments) — eliminates the 3 duplicate mounts | 1.5 days |
| F7 | Migrate `/admin` (users, topics+media, tasks+stages+linking, badges, missions, enrollments) — largest module | 2 days |
| F8 | Introduce global `/v1` prefix; configure legacy rewrites in `wrangler.toml` for `/auth/*` → `/v1/auth/*` (only for legacy clients during cutover) | 0.5 days |
| F9 | Generate `apps/api/openapi.json` in CI; generate types in `apps/web`; add `oasdiff` contract check to PR pipeline | 1 day |
| F10 | Remove redundant `@ValidateBody` decorators in controllers (validation is now at the router level via Zod-OpenAPI) | 1 day |

**Total:** ~10.5 person-days, incremental, each phase independently deliverable and with tests passing.

Each phase maintains path compatibility with the previous version — frontend will not break during the migration.

## 6. Alternatives Considered

- **`hono-openapi`** (community library) instead of `@hono/zod-openapi` — discarded: less active maintenance, lacks first-class Zod 3 support.
- **tRPC** over Hono — discarded: breaks the REST contract that mobile and external integrations (e.g., future Resend webhooks) need to consume; it also adds an adapter in `apps/web` for something OpenAPI already solves.
- **Keep Hono "raw" and generate OpenAPI manually** (standalone `zod-to-openapi`) — discarded: schema and route would reside in different files, making drift inevitable.
- **No changes, just add Swagger** — discarded: P1–P4 would continue wasting time on every new feature; documenting the mess does not fix it.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Regression in critical routes (`/auth/login`, `/admin/users`) during migration | Each phase has an isolated PR with the existing test suite (61 files, 737 tests) required to pass |
| Worker bundle size increase (1 MB compressed limit) | `@hono/zod-openapi` + `@scalar/hono-api-reference` add ~120 KB; measure after F1 and move Scalar to `/docs` lazy-load if necessary |
| Drift between committed `openapi.json` and code | CI job runs `pnpm dump-openapi` and fails if the diff is non-empty |
| Implicit breaking changes during refactoring | `oasdiff` in the pipeline starting from F9; phases F4–F7 maintain 1:1 path compatibility |
| Legacy client breaks when introducing `/v1` (F8) | Worker rewrites keep `/auth/*` active during a documented deprecation window |

## 8. Success Metrics

- `routes/index.ts` decreases from **20 mounts** to **5** (`public`, `auth`, `me`, `admin`, `docs`).
- Handlers drop from **~5 average boilerplate lines** to **1 line** (`return respondWith(c, await ctrl.x(input))`).
- **0** shared prefixes across multiple routers.
- `apps/web` consumes types generated from `apps/api/openapi.json` — type drift is detected in CI, not at runtime.
- `/docs` accessible in staging and production with 100% of routes listed and interactive examples.

## 9. Pending Decisions (to be resolved before F1)

1. Versioning: `/v1` in the path or in the `Accept: application/vnd.arenaquest.v1+json` header? Recommendation: path (more readable in Cloudflare Analytics and curl).
2. Docs renderer: Scalar (recommended) vs Swagger UI vs Redoc.
3. Contract policy: does `oasdiff` fail on any breaking change or require a `breaking-change` label in the PR? Recommendation: hard failure; label overrides.
4. Retain `@ValidateBody` decorators in controllers for non-HTTP usage (jobs, tests), or remove them completely? Recommendation: remove them — the validation boundary is the router.
