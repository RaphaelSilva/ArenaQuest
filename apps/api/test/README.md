# Test Suite — `apps/api`

## Projects

Vitest runs two projects:

- **`workers`** — specs that import `cloudflare:test` or depend on Miniflare bindings
  (D1, R2, KV, Worker `fetch`). Located under `test/db/`, `test/routes/`, and `test/index.spec.ts`.
- **`node`** — pure-unit specs with no Cloudflare pool dependency. Located under
  `test/controllers/`, `test/core/`, `test/adapters/`, `test/middleware/`.

Run individually: `pnpm test --project workers` / `pnpm test --project node`.

## Router vs Controller convention

Every feature has two spec layers. The rule is strict:

| Layer | File | Covers |
|---|---|---|
| **Router** (`test/routes/`) | `<feature>.router.spec.ts` | HTTP concerns only: status codes, body/cookie parsing, Zod validation shape, response DTO shape, headers (Content-Type, Set-Cookie, Location), rate-limit, CORS, auth smokes |
| **Controller** (`test/controllers/`) | `<feature>.controller.spec.ts` | Business rules with mocks: all error branches, idempotency, state transitions, edge cases |

**Router specs keep ≥ 1 success smoke per endpoint** (200/201/204 + expected response shape)
to guard against wiring regressions. They do NOT repeat business-rule branches already
tested in the controller spec.

**Controller specs use pure mocks** — no Miniflare, no real D1. They run in the `node`
project and execute in < 1 s per file.

### Why?

Router specs pay the Miniflare boot cost (~2–3 s per file). Duplicating business-rule
branches between layers doubles test time and creates drift. Each layer should own one
concern.

## Auth-guard rule

`test/middleware/auth-guard.spec.ts` is the **single source of truth** for the 401/403
matrix (absent token, invalid token, wrong role). Router specs keep **at most one**
auth smoke per guarded resource (e.g., `"admin route: POST /admin/x -> 401 without token"`).

Do NOT add per-endpoint 401/403 loops to router specs — `auth-guard.spec.ts` covers the
behavior generically.

## Migrations helper

Specs that need D1 tables must import the shared helper:

```typescript
import { applyMigrations } from '../helpers/apply-migrations';

beforeAll(async () => {
  await applyMigrations(env.DB);
});
```

The helper reads all files from `apps/api/migrations/*.sql` in sorted order and applies
them as a batch. Do NOT declare inline `CREATE TABLE IF NOT EXISTS …` blocks in spec files.
