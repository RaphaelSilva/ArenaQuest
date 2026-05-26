# Plan — 01-openapi-bootstrap

**Task:** [01-openapi-bootstrap.task.md](../01-openapi-bootstrap.task.md)
**Source:** Milestone 9
**Assigned personas:** backend-developer
**Branch:** feature/m9/01-openapi-bootstrap.task

## Objective

Bootstrap the OpenAPI and Scalar documentation foundation in the `apps/api` service. This involves adding `@hono/zod-openapi` and `@scalar/hono-api-reference` dependencies, replacing the standard Hono instance with `OpenAPIHono`, and exposing the root unversioned routes `GET /openapi.json` and `GET /docs` while ensuring that all legacy routes registered through the flat `AppRouter.register` keep functioning identically.

## Affected areas

- `apps/api/package.json`
- `apps/api/src/index.ts`
- `apps/api/src/routes/index.ts`
- `apps/api/src/openapi/document.ts` [NEW]

## Step-by-step

### Backend

1. **Add runtime dependencies**:
   Add `@hono/zod-openapi` and `@scalar/hono-api-reference` to `apps/api/package.json` runtime dependencies. Run `pnpm install` in root to update `pnpm-lock.yaml`.

2. **Create the OpenAPI root document**:
   Create `apps/api/src/openapi/document.ts`. Define the default OpenAPI configuration object with:
   - `openapi: "3.1.0"`
   - `info: { title: "ArenaQuest API", version: "1.0.0" }` (or read from package.json if desired, otherwise hardcode 1.0.0 for now)
   - `servers`: list local, staging, and production urls
   - `securitySchemes`: bearerAuth placeholder

3. **Swap to OpenAPIHono and register documentation routes**:
   In `apps/api/src/index.ts` (or `buildApp`), replace `new Hono()` with `new OpenAPIHono()`.
   Import the OpenAPI document definition and register:
   - `GET /openapi.json` serving the generated OpenAPI JSON.
   - `GET /docs` serving Scalar UI referencing `/openapi.json`.
   Configure the `/health` route as a declarative Zod-OpenAPI route to satisfy the "non-empty document" requirement, or describe it in the OpenAPI schema.

4. **Ensure legacy compatibility**:
   Verify that `AppRouter.register` operates cleanly against `OpenAPIHono` (which extends Hono, so it is backward compatible).

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| pnpm install succeeds and lockfile is updated | Step 1 | backend-developer | Run install and verify git diff of pnpm-lock.yaml |
| `apps/api/src/index.ts` instantiates `OpenAPIHono` | Step 3, 4 | backend-developer | Verify instantiation compiles and runs |
| `GET /openapi.json` returns valid OpenAPI 3.1 document | Step 2, 3 | backend-developer | Fetch and check JSON validity and values |
| `GET /docs` returns HTML rendering Scalar | Step 3 | backend-developer | Fetch /docs and verify Scalar script/HTML elements |
| All current API tests pass green | Step 3, 4 | backend-developer | Run `make test-api` |
| Worker bundle size delta under 150 KB | Step 3 | backend-developer | Run bundle build and check size |

## Risks & open questions

- **Hono vs OpenAPIHono types**: Ensure middleware type signatures or generic types used in routing don't conflict. If they do, cast them or resolve using appropriate `@hono/zod-openapi` middleware adapters.

## Verification

- Backend: `make lint && make test-api`
- Manual checks: `curl http://127.0.0.1:8787/openapi.json` and `curl http://127.0.0.1:8787/docs`.
