# Plan — 05-convention-and-auth-pair

**Task:** [05-convention-and-auth-pair.task.md](../05-convention-and-auth-pair.task.md)
**Source:** Milestone 8
**Assigned personas:** backend-developer
**Branch:** feature/m8/05-convention-and-auth-pair.task (from feature/m8/04-consolidate-auth-enforcement.task)

## Objective

Write `apps/api/test/README.md` to codify the router-vs-controller convention, then apply it as a pilot refactor on the `auth` controller/router pair. The `auth.router.spec.ts` is trimmed to HTTP smokes only (wiring, cookie headers, rate-limiting); business-rule 401 branches already covered in `auth.controller.spec.ts` are removed.

## Affected areas

### New file
- `apps/api/test/README.md`

### In scope (spec edits)
- `apps/api/test/routes/auth.router.spec.ts` — remove 5 business-rule 401 tests
- `apps/api/test/controllers/auth.controller.spec.ts` — no changes needed (already covers all removed cases)

### Out of scope
- `apps/api/src/**` — no production code
- Any other spec not listed above

## Step-by-step

### Backend

1. **Create `apps/api/test/README.md`** with the following content:

   ```markdown
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
   ```

2. **Trim `auth.router.spec.ts` to HTTP smokes only.**

   The current spec has 11 tests across 4 describes. Removing the business-rule 401 tests
   that duplicate `auth.controller.spec.ts`:

   **Remove from `POST /auth/login`:**
   - `'returns 401 with InvalidCredentials on wrong password'` → covered: controller "returns 401 InvalidCredentials on wrong password"
   - `'returns 401 for unknown email'` → covered: controller "returns 401 InvalidCredentials for unknown email"

   **Remove from `POST /auth/logout`:**
   - `'returns 401 when refresh_token cookie is absent'` → covered: controller "returns 401 Unauthorized when token is undefined"

   **Remove from `POST /auth/refresh`:**
   - `'returns 401 for an already-used (rotated) refresh token'` → covered: controller "returns 401 Unauthorized for an already-used token"
   - `'returns 401 when refresh_token cookie is absent'` → covered: controller "returns 401 Unauthorized when token is undefined"

   **Keep all 3 rate-limiting tests** — they test HTTP infrastructure (KV rate-limiter, 429 status, Retry-After header, bucket isolation). These are HTTP/infra concerns, not business rules.

   After trimming, `auth.router.spec.ts` has **6 tests**:
   - POST /auth/login: 1 (success + cookie shape)
   - POST /auth/logout: 1 (success + clear cookie)
   - POST /auth/refresh: 1 (success + rotation)
   - Rate limiting: 3

3. **Verify coverage is intact in `auth.controller.spec.ts`.**
   Read the file and confirm every removed scenario is present. It already is (see cross-list below).

4. **Run verification:**
   ```bash
   cd apps/api && pnpm test test/routes/auth.router
   cd apps/api && pnpm test test/controllers/auth.controller
   cd apps/api && pnpm test
   ```

## Coverage cross-list (removed from router → covered in controller)

| Removed from router | Covered in controller |
|---|---|
| POST /login — 401 wrong password | `login > returns 401 InvalidCredentials on wrong password` |
| POST /login — 401 unknown email | `login > returns 401 InvalidCredentials for unknown email` |
| POST /logout — 401 absent cookie | `logout > returns 401 Unauthorized when token is undefined` |
| POST /refresh — 401 already-used token | `refresh > returns 401 Unauthorized for an already-used token` |
| POST /refresh — 401 absent cookie | `refresh > returns 401 Unauthorized when token is undefined` |

## Acceptance Criteria mapping

| AC | Plan step | Persona | Verification |
|---|---|---|---|
| `apps/api/test/README.md` exists with convention, auth-guard rule, migrations helper | 1 | backend | File exists + lint |
| `auth.router.spec.ts` contains only HTTP-shaped assertions (≥ 1 smoke per endpoint) | 2 | backend | 6 tests, no business-rule 401s |
| Every removed scenario is present in `auth.controller.spec.ts` | 3 | backend | Cross-list above |
| `make test-api` and `make lint` pass | 4 | backend | exit 0 |
| No diff outside `apps/api/test/**` | all | backend | `git diff --stat` |

## Expected test count delta

| Change | Delta |
|--------|-------|
| Remove 5 tests from auth.router.spec.ts | −5 |
| New README (no tests) | 0 |
| **Total** | **−5** |

Expected new total: 682 − 5 = **677 tests**.

## Verification

```bash
make lint
make test-api
```

## Out of scope

- Tasks 06–09 (other controller/router pairs).
- `apps/api/src/**` — no production code.
