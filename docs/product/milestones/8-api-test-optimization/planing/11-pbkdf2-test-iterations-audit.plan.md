# Plan — 11-pbkdf2-test-iterations-audit

**Task:** [11-pbkdf2-test-iterations-audit.task.md](../11-pbkdf2-test-iterations-audit.task.md)
**Source:** Milestone 8
**Assigned personas:** backend-developer
**Branch:** feature/m8/11-pbkdf2-test-iterations-audit.task (from feature/m8/10-migrations-helper-rollout.task)

## Objective

Audit every spec that instantiates `JwtAuthAdapter` or drives a password hash, and ensure all such paths use ≤ 1 000 PBKDF2 iterations. Add `pbkdf2Iterations: 1` defensively to the five token-signing adapter constructions that omit it today. Document worker-mediated hashing (register, admin-users) as a known limitation that requires a `src/` change to address.

## Affected areas

- `apps/api/test/routes/topics.router.spec.ts`
- `apps/api/test/routes/leaderboard.spec.ts`
- `apps/api/test/routes/me-gamification.spec.ts`
- `apps/api/test/routes/admin-enrollment.router.spec.ts`
- `apps/api/test/routes/admin-users.router.spec.ts`
- `apps/api/test/routes/register.router.spec.ts` (comment only)
- `docs/product/milestones/8-api-test-optimization/.wall-time-log.md`
- `docs/product/milestones/8-api-test-optimization/11-pbkdf2-test-iterations-audit.task.md`
- `docs/product/milestones/8-api-test-optimization/milestone.md`

Out of scope: `apps/api/src/**`, `apps/api/migrations/**`, any test helper.

## Audit results

| Spec | How it hashes | Current iterations | Action |
|------|---------------|-------------------|--------|
| `auth.router.spec.ts` | Direct `JwtAuthAdapter` + `hashPassword` in `beforeAll` | `pbkdf2Iterations: 1` | ✅ Already correct |
| `account.router.spec.ts` | Direct `JwtAuthAdapter` + `hashPassword` in setup | `pbkdf2Iterations: 1` | ✅ Already correct |
| `password.router.spec.ts` | Direct `JwtAuthAdapter` + `hashPassword` in setup | `pbkdf2Iterations: 1` | ✅ Already correct |
| `jwt-auth-adapter.spec.ts` | Direct `JwtAuthAdapter` + `hashPassword` in suite | `pbkdf2Iterations: 1_000` | ✅ Already correct |
| `topics.router.spec.ts` | `JwtAuthAdapter` for token signing only | none (no hash) | Add `pbkdf2Iterations: 1` defensively |
| `leaderboard.spec.ts` | `JwtAuthAdapter` for token signing only | none (no hash) | Add `pbkdf2Iterations: 1` defensively |
| `me-gamification.spec.ts` | `JwtAuthAdapter` for token signing only (×2) | none (no hash) | Add `pbkdf2Iterations: 1` defensively |
| `admin-enrollment.router.spec.ts` | `JwtAuthAdapter` for token signing only | none (no hash) | Add `pbkdf2Iterations: 1` defensively |
| `admin-users.router.spec.ts` | `JwtAuthAdapter` for token signing; user creation via worker | token: none; worker: 100 000 | Token: add defensively; worker: document |
| `register.router.spec.ts` | Via worker (POST /auth/register) | 100 000 | Document — cannot lower without src change |

## Step-by-step

### Backend
1. Add `pbkdf2Iterations: 1` to the five `JwtAuthAdapter` constructions that sign tokens only (topics, leaderboard, me-gamification ×2, admin-enrollment, admin-users).
2. Add an inline comment to `register.router.spec.ts` explaining the limitation.
3. Add an inline comment to the `admin-users.router.spec.ts` `JwtAuthAdapter` construction noting that user-creation hashing goes through the worker.
4. Run `make lint && make test-api`. Record wall time.
5. Update task/milestone status and wall-time log.

## Acceptance Criteria mapping

| AC | Plan step(s) | Verification |
|---|---|---|
| Every spec that exercises password hashing uses ≤ 1 000 or has documented justification | 1–3 | Grep + inline comments |
| No production code change | (scope guardrail) | `git diff src/` is empty |
| `make test-api` and `make lint` pass | 4 | CI |
| Wall-time impact recorded | 5 | `.wall-time-log.md` |
| No diff outside `apps/api/test/**` | (scope guardrail) | `git diff` check |

## Verification

- `make lint && make test-api`
- `grep -rn "pbkdf2Iterations" apps/api/test/` to confirm all adapter constructions are documented
- `git diff --stat` must show no file outside `apps/api/test/**` and `docs/product/milestones/8-api-test-optimization/`

## Out of scope

- Adding `PBKDF2_ITERATIONS` env support to `apps/api/src/` (separate task if needed)
- Changing the iteration count for worker-mediated integration tests in register and admin-users (requires src change)
