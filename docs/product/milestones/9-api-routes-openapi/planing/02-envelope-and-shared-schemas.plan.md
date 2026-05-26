# Plan — 02-envelope-and-shared-schemas

**Task:** [02-envelope-and-shared-schemas.task.md](../02-envelope-and-shared-schemas.task.md)
**Source:** Milestone 9
**Assigned personas:** backend-developer
**Branch:** feature/m9/02-envelope-and-shared-schemas.task

## Objective

Introduce shared single-source-of-truth envelope response helpers (`respondWith`, `respondCreated`, `respondNoContent`) and Zod-OpenAPI components for responses (`ErrorBody`, `ValidationErrorBody`, and a generic `PaginatedResponse<T>`). We will verify these in isolation via unit tests, and register the schemas inside the OpenAPI doc components.

## Affected areas

- `apps/api/src/routes/_shared/envelope.ts` [NEW]
- `apps/api/src/openapi/components/errors.ts` [NEW]
- `apps/api/src/openapi/components/pagination.ts` [NEW]
- `apps/api/src/openapi/document.ts`
- `apps/api/test/routes/_shared/envelope.spec.ts` [NEW]

## Step-by-step

### Backend

1. **Create Shared OpenAPI Error Schemas**:
   Create `apps/api/src/openapi/components/errors.ts`. Define:
   - `ErrorBody`: `{ error: string }` with freeform metadata (e.g. `z.record(z.unknown()).optional().openapi({ additionalProperties: true })`).
   - `ValidationErrorBody`: `{ error: 'ValidationError', issues: z.array(z.unknown()) }` matching `@hono/zod-openapi` Zod validation errors.

2. **Create Shared OpenAPI Pagination Schemas**:
   Create `apps/api/src/openapi/components/pagination.ts`. Define:
   - `PaginationQuery`: Zod schema for query strings `limit` and `offset`.
   - `PaginatedResponse<T>`: Generic schema factory yielding `{ data: T[], total?: number }`.

3. **Create Envelope Helpers**:
   Create `apps/api/src/routes/_shared/envelope.ts`. Define and export:
   - `respondWith<T>(c: Context, r: ControllerResult<T>): Response`
   - `respondCreated<T>(c: Context, r: ControllerResult<T>): Response`
   - `respondNoContent<T>(c: Context, r: ControllerResult<T>): Response`
   These helpers should handle mapping `ok=true` to 200, 201, and 204 respectively, and mapping `ok=false` to their corresponding status codes, including merging any `meta` fields.

4. **Wire Schemas into OpenAPI Configuration**:
   Import `ErrorBody` and `ValidationErrorBody` in `apps/api/src/openapi/document.ts` and ensure they are registered under `components.schemas` inside the `app.doc31` call.

5. **Unit Tests**:
   Create `apps/api/test/routes/_shared/envelope.spec.ts`. Write comprehensive tests covering:
   - Success cases mapping `ok=true` to 200, 201, and 204.
   - Error cases mapping `ok=false` to the controller status and structure `{ error: r.error, ...r.meta }`.

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| Exports the three helpers with explicit return types | Step 3 | backend-developer | Compile check and code review |
| Unit tests cover happy/error status codes and meta merging | Step 5 | backend-developer | Run unit tests and ensure all cases pass |
| `ErrorBody` and `ValidationErrorBody` appear in `openapi.json` | Step 1, 4 | backend-developer | Fetch `/openapi.json` and verify components exist |
| `PaginatedResponse<T>` factory produces schema with `items`/`data` and `total` | Step 2 | backend-developer | Verify generated schema structures in tests/code |
| `make test-api` and `make lint` pass green | Steps 1-5 | backend-developer | Run `make lint` and `make test-api` |

## Risks & open questions

- **Hono Context types**: Envelope helpers need `Context` from `hono` to return standard responses. Make sure types are clean.

## Verification

- Run `pnpm --filter api test shared/envelope.spec.ts`
- Run `make lint && make test-api`
