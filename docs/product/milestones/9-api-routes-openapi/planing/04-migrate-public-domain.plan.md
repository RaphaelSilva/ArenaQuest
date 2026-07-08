# Plan — 04-migrate-public-domain

**Task:** [04-migrate-public-domain.task.md](../04-migrate-public-domain.task.md)
**Source:** Milestone 9
**Assigned personas:** backend-developer
**Branch:** feature/m9/04-migrate-public-domain.task

## Objective

Migrate the unauthenticated public read endpoints to the new declarative `@hono/zod-openapi` style in the newly introduced `src/routes/public/` directory tree.
The routes to migrate are:
- `/health` (already declarative, we will migrate it to `routes/public/health.ts` for clean structural separation)
- `/leaderboard` (from `buildLeaderboardRouter`)
- `/topics` - public reads (from `buildTopicsRouter` - `GET /`, `GET /:id`)
- `/tasks` - public reads (from `buildTasksRouter` - `GET /`, `GET /:id`)

No prefixes (`/v1`) are added yet. Response shape parity is mandatory. We will use the envelope helpers and define Zod-OpenAPI entity schemas in `apps/api/src/openapi/components/entities.ts`.

## Affected areas

- `apps/api/src/openapi/components/entities.ts` [NEW]
- `apps/api/src/routes/public/index.ts` [NEW]
- `apps/api/src/routes/public/health.ts` [NEW]
- `apps/api/src/routes/public/leaderboard.ts` [NEW]
- `apps/api/src/routes/public/catalog.topics.ts` [NEW]
- `apps/api/src/routes/public/catalog.tasks.ts` [NEW]
- `apps/api/src/routes/index.ts`
- `apps/api/src/routes/leaderboard.router.ts` [DELETE / clean up public reads]
- `apps/api/src/routes/topics.router.ts` [Clean up public reads]
- `apps/api/src/routes/tasks.router.ts` [Clean up public reads]

## Step-by-step

### Backend

1. **Define OpenAPI Entity Schemas**:
   Create `apps/api/src/openapi/components/entities.ts`. Define:
   - `TopicNodeSchema` matching existing `TopicNode` / domain serialization.
   - `TaskSchema` matching `Task` domain serialization.
   - `LeaderboardEntrySchema` matching `{ userId: string, name: string, xp: number }`.

2. **Create Health Route (`routes/public/health.ts`)**:
   Move `healthRoute` and registration from `src/openapi/document.ts` to `routes/public/health.ts` for perfect organization.

3. **Create Leaderboard Route (`routes/public/leaderboard.ts`)**:
   Define `GET /leaderboard` using `@hono/zod-openapi`, returning `z.array(LeaderboardEntrySchema)`.
   Register the handler returning through `respondWith`.
   Remove the old `buildLeaderboardRouter` and its import/mount in `routes/index.ts`.

4. **Create Catalog Topics Route (`routes/public/catalog.topics.ts`)**:
   Define `GET /topics` and `GET /topics/:id` using `@hono/zod-openapi`.
   Register the handlers returning through `respondWith`.
   Remove these read endpoints from the legacy `buildTopicsRouter` in `src/routes/topics.router.ts`.

5. **Create Catalog Tasks Route (`routes/public/catalog.tasks.ts`)**:
   Define `GET /tasks` and `GET /tasks/:id` using `@hono/zod-openapi`.
   Register the handlers returning through `respondWith`.
   Remove these read endpoints from the legacy `buildTasksRouter` in `src/routes/tasks.router.ts`.

6. **Create Public Router Aggregator (`routes/public/index.ts`)**:
   Expose `buildPublicRouter` mounting `health`, `catalog.topics`, `catalog.tasks`, and `leaderboard`.

7. **Wire into `routes/index.ts`**:
   Import `buildPublicRouter` and mount under `/` prefix.
   Remove `leaderboard.router.ts` since it's fully migrated. Update other imports/mounts.

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| `routes/public/**` exists with index and 4 modules | Step 2, 3, 4, 5, 6 | backend-developer | Code review |
| `routes/index.ts` mounts new public sub-app, removes old reads | Step 7 | backend-developer | Code review |
| Health, catalog, leaderboard respond with same payloads | Step 3, 4, 5 | backend-developer | Run Vitest suite / manual verify |
| `openapi.json` lists public routes with full schemas | Step 1, 6 | backend-developer | View `/openapi.json` in test / dev |
| Every migrated handler uses envelope helpers | Step 3, 4, 5 | backend-developer | Code review |
| `make test-api` passes green | Steps 1-7 | backend-developer | Run verification command |

## Risks & open questions

- **Conflict on shared prefixes**: `/topics` and `/tasks` are shared between public catalog reads and authenticated progress writes. Ensure both Hono routes coexist correctly (Hono resolves in registration order, so `/topics` will check both).

## Verification

- Run `make lint`
- Run `make test-api`
