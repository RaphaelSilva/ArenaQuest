# Milestone 8 — `apps/api` Test Suite Optimization

**Status:** Planning
**Scope:** Test infrastructure and test code in `apps/api/test/**` and `apps/api/vitest.config.mts` only. Derived from [RFC 0001](../../RFCs/0001-apps-api-test-suite-optimization.md).

> **Hard scope guardrail — read before opening any task.** This milestone touches **only** test-related artefacts: Vitest configuration, files under `apps/api/test/**`, and new test helpers under `apps/api/test/helpers/**`. Production code (`apps/api/src/**`), shared packages (`packages/shared/**`), the web app (`apps/web/**`), migrations (`apps/api/migrations/**`), and CI workflows are **out of scope**. If a finding here suggests a fix to production code, file a separate issue/task — do not bundle it.

---

## 1. Objectives

- **Cut local wall time** for `pnpm --filter @arenaquest/api test` from ~64 s to ~30–40 s.
- **Eliminate dead weight**: remove tests that assert constants/literals, collapse duplicates between controller and router specs, and remove repetitive auth-enforcement loops already covered generically.
- **Stop the Miniflare tax on pure-unit tests** by splitting Vitest into two projects: `workers` (current pool) and `node` (no Cloudflare pool).
- **Codify a clear convention** for what belongs in a router spec versus a controller spec, and document it in `apps/api/test/README.md`.
- **Stop schema drift** in tests by replacing the ~29 inline `CREATE TABLE` blocks with a shared `apply-migrations` helper that reads from the canonical migrations folder.
- **Keep coverage intact** — any removal/refactor must keep ≥ 1 HTTP smoke per endpoint and rely on the controller spec for business-rule branches.

Out of scope (explicit):
- Any change to production source files in `apps/api/src/**`.
- Any change to `packages/shared/**` or `apps/web/**`.
- Modifying actual migrations (`apps/api/migrations/**`).
- Touching CI workflow files or adding new tooling (mutation testing, coverage gates, etc.).
- Changing the `pbkdf2Iterations` default in production code — this milestone only audits and lowers iterations **inside test setup**.

---

## 2. Functional Requirements

The deliverables are observable in the test suite, not in product features.

- A Vitest config exposing two projects (`workers`, `node`) with a documented routing rule: "if the file imports `cloudflare:test`, it belongs to `workers`; otherwise `node`."
- A `apps/api/test/README.md` documenting the **router vs controller** convention (HTTP concerns vs business rules), the **auth-enforcement consolidation** policy (auth-guard spec is the single source for 401/403 matrix), and the **migrations helper** usage.
- A reusable helper at `apps/api/test/helpers/apply-migrations.ts` exposing a function that applies migrations against a D1 binding, selecting from the canonical `apps/api/migrations/**` SQL files.
- All controller/router pairs listed in RFC §D2 conform to the documented convention. Router specs keep only HTTP smokes (1–2 per endpoint); controller specs own the business-rule matrix.
- Low-signal specs called out in RFC §D5 are removed or reduced as specified.

---

## 3. Acceptance Criteria

- [ ] `pnpm --filter @arenaquest/api test` wall time is **≤ 40 s** locally on the developer baseline (compare against the 63.76 s baseline recorded in RFC §Contexto).
- [ ] Vitest reports two projects (`workers`, `node`); files not importing `cloudflare:test` run under `node` and do not boot Miniflare.
- [ ] `apps/api/test/README.md` exists and documents the router-vs-controller convention, the auth-guard consolidation rule, and the migrations helper.
- [ ] No spec file contains an inline `CREATE TABLE IF NOT EXISTS …` block; all schema setup goes through the shared helper.
- [ ] `middleware/auth-guard.spec.ts` is the single source for the "401 without token" and "403 with wrong role" matrix; per-router specs hold at most one auth smoke.
- [ ] For every controller/router pair listed in RFC §D2, the router spec contains only HTTP-shaped assertions; business-rule branches live in the controller spec.
- [ ] All RFC §D5 removals/reductions are applied (`shared-roles.spec.ts`, `health.controller.spec.ts`, `/health` duplicates, `parse-cookie-samesite` reduced to 4 tests, CORS router reduced to HTTP smoke).
- [ ] `make lint` and `make test-api` pass green; total test count is within the band declared in RFC §"Impacto esperado" (~680–700).
- [ ] No diff outside `apps/api/test/**`, `apps/api/vitest.config.mts`, and (if needed) `apps/api/package.json` test scripts.

---

## 4. Specific Stack

- **Vitest** with `@cloudflare/vitest-pool-workers` for the `workers` project; default Node pool for the `node` project.
- **Test helpers** under `apps/api/test/helpers/**` written in TypeScript, no runtime dependencies beyond what `apps/api` already declares.
- **Migrations source** for the helper is `apps/api/migrations/**` (canonical SQL). Helpers must not redefine schema inline.
- **Time zones / clock**: any new helper that needs "now" goes through existing shared time utilities — no `Date.now()` in helpers.

---

## 5. Task Breakdown

| # | Task File | Status |
|---|-----------|--------|
| 01 | [Split Vitest into `workers` and `node` projects (P1)](./01-vitest-dual-project-split.task.md) | ⏳ Pending |
| 02 | [Remove low-signal and duplicate specs (P5)](./02-remove-low-signal-specs.task.md) | ⏳ Pending |
| 03 | [Introduce `apply-migrations` helper + pilot 5 files (P4 phase 1)](./03-migrations-helper-pilot.task.md) | ⏳ Pending |
| 04 | [Consolidate auth-enforcement assertions (P3)](./04-consolidate-auth-enforcement.task.md) | ⏳ Pending |
| 05 | [Document router-vs-controller convention + refactor `auth` pair (P2 pilot)](./05-convention-and-auth-pair.task.md) | ⏳ Pending |
| 06 | [Refactor `admin-topics` controller/router pair (P2)](./06-refactor-admin-topics-pair.task.md) | ⏳ Pending |
| 07 | [Refactor `admin-media` controller/router pair (P2)](./07-refactor-admin-media-pair.task.md) | ⏳ Pending |
| 08 | [Refactor `admin-users` controller/router pair (P2)](./08-refactor-admin-users-pair.task.md) | ⏳ Pending |
| 09 | [Refactor small pairs: `register`, `password`, `account`, `activate`, `topics` (P2)](./09-refactor-small-pairs.task.md) | ⏳ Pending |
| 10 | [Roll out migrations helper to remaining ~24 spec files (P4 phase 2)](./10-migrations-helper-rollout.task.md) | ⏳ Pending |
| 11 | [Audit and lower PBKDF2 iterations in remaining test setups (P6)](./11-pbkdf2-test-iterations-audit.task.md) | ⏳ Pending |

Dependency graph:

```
01 ──┐
     ├─► 05 ─► 06, 07, 08, 09  (parallel after 05)
02 ──┘
03 ──► 10
04 (independent, runs anytime after 01)
11 (independent)
```

**Recommended execution order:** `01, 02, 03, 04` (parallel) → `05` → `06, 07, 08, 09` (parallel) → `10` → `11`.

---

## 6. Definition of Done (milestone level)

- [ ] All 11 tasks marked `✅ Done` with every acceptance box checked.
- [ ] All milestone-level acceptance criteria in §3 pass.
- [ ] `make lint` and `make test-api` green in CI.
- [ ] Wall-time delta documented in a short closeout at `docs/product/milestones/8-api-test-optimization/closeout-analysis.md` (before/after table sourced from the same machine).
- [ ] RFC 0001 status updated to `Accepted` (or `Implemented`) in `docs/product/RFCs/README.md` and in the RFC header.
- [ ] No diff outside the scope declared in §"Hard scope guardrail".
