# Plan — 04-consolidate-auth-enforcement

**Task:** [04-consolidate-auth-enforcement.task.md](../04-consolidate-auth-enforcement.task.md)
**Source:** Milestone 8
**Assigned personas:** backend-developer
**Branch:** feature/m8/04-consolidate-auth-enforcement.task (from feature/m8/03-migrations-helper-pilot.task)

## Objective

Make `test/middleware/auth-guard.spec.ts` the single source of truth for the "401 without token" and "403 with wrong role" matrix. Remove repetitive `endpoints.forEach(…)` loops and redundant inline auth tests from per-router specs, keeping at most one smoke test per router so we know the route IS protected.

`auth-guard.spec.ts` already covers:
- 401 when Authorization header is absent
- 401 when token is invalid/expired
- 403 when user lacks the required role
- 200 when valid token + correct role

No extensions to `auth-guard.spec.ts` are needed — the generic middleware tests are sufficient.

## Affected areas

### In scope (5 router specs to reduce)
- `apps/api/test/routes/admin-users.router.spec.ts` — forEach loop (5 endpoints × 2 = 10 tests → 1 smoke)
- `apps/api/test/routes/admin-topics.router.spec.ts` — forEach loop (6 endpoints × 2 = 12 tests → 1 smoke)
- `apps/api/test/routes/admin-media.router.spec.ts` — forEach loop (3 endpoints × 2 = 6 tests → 1 smoke)
- `apps/api/test/routes/topics.router.spec.ts` — 2 inline Auth enforcement tests → 1 smoke
- `apps/api/test/routes/admin-enrollment.router.spec.ts` — 2 individual auth tests → 1 smoke

### Read-only reference
- `apps/api/test/middleware/auth-guard.spec.ts` — not modified; already covers the generic matrix

### Out of scope
- `apps/api/src/**` — no production code changes
- `apps/api/test/middleware/auth-guard.spec.ts` — not modified
- Any file not listed above

## Step-by-step

### Backend

1. **`test/routes/admin-users.router.spec.ts`** — Replace the entire `Auth enforcement` describe block (lines ~99–122) with a single smoke:
   ```typescript
   it('requires admin: GET /admin/users -> 401 without token', async () => {
     const res = await req('GET', '/admin/users');
     expect(res.status).toBe(401);
   });
   ```
   Also remove the `// Auth enforcement — every endpoint must guard 401/403` comment and separator lines above it.

2. **`test/routes/admin-topics.router.spec.ts`** — Replace the entire `Auth enforcement` describe block (lines ~133–160) with:
   ```typescript
   it('requires admin: GET /admin/topics -> 401 without token', async () => {
     const res = await req('GET', '/admin/topics');
     expect(res.status).toBe(401);
   });
   ```

3. **`test/routes/admin-media.router.spec.ts`** — Replace the entire `Auth enforcement` describe block (lines ~155–178) with:
   ```typescript
   it('requires admin: POST presign -> 401 without token', async () => {
     const res = await req('POST', '/admin/topics/some-topic/media/presign');
     expect(res.status).toBe(401);
   });
   ```

4. **`test/routes/topics.router.spec.ts`** — Reduce the `Auth enforcement` describe block (lines ~265–278) to a single test:
   Keep only `'GET /topics -> 401 without token'`; remove the second test `'GET /topics/:id -> 401 without token'`.

5. **`test/routes/admin-enrollment.router.spec.ts`** — Remove the 403 auth test, keep only the 401 test:
   Keep: `it('GET enrollments → 401 without token', ...)`
   Remove: `it('GET enrollments → 403 for students', ...)`

6. **Verify no forEach loops remain:**
   ```bash
   grep -rn "endpoints.forEach\|for.*of endpoints" apps/api/test/routes/
   ```
   Expect zero hits.

7. **Run full suite:**
   ```bash
   cd apps/api && pnpm test 2>&1 | tail -8
   ```

## Acceptance Criteria mapping

| AC | Plan step | Persona | Verification |
|---|---|---|---|
| `auth-guard.spec.ts` covers every 401/403 shape | (already covered) | — | Existing tests |
| No `endpoints.forEach` loop in any router spec | 1–5, 6 | backend | grep step |
| Each router spec keeps at most one auth smoke | 1–5 | backend | Manual scan |
| `make test-api` and `make lint` pass | 7 | backend | exit 0 |
| No diff outside `apps/api/test/**` | all | backend | `git diff --stat` |

## Expected test count delta

| File | Change | Delta |
|------|--------|-------|
| admin-users.router.spec.ts | 10 tests → 1 | −9 |
| admin-topics.router.spec.ts | 12 tests → 1 | −11 |
| admin-media.router.spec.ts | 6 tests → 1 | −5 |
| topics.router.spec.ts | 2 tests → 1 | −1 |
| admin-enrollment.router.spec.ts | 2 tests → 1 | −1 |
| **Total** | | **−27** |

Expected new total: 709 − 27 = **~682 tests**.

## Verification

```bash
make lint
make test-api
```

## Out of scope

- `test/middleware/auth-guard.spec.ts` — already sufficient; not modified.
- Controller specs.
- Production source files.
