# Task 01 — Split Vitest into `workers` and `node` projects (P1)

**Status:** ✅ Completed
**Milestone:** [8 — `apps/api` Test Suite Optimization](./milestone.md)
**RFC:** [0001 §P1](../../RFCs/0001-apps-api-test-suite-optimization.md)

## Summary

Reorganise `apps/api/vitest.config.mts` into two named Vitest *projects* so that pure-unit specs stop paying the Miniflare boot cost. The `workers` project keeps the current `@cloudflare/vitest-pool-workers` pool; a new `node` project runs on the default Node pool.

## Dependencies

None. Unblocks tasks 05–09 (refactors that will move controller specs into `node`).

## Technical Constraints

- **Scope guardrail:** changes restricted to `apps/api/vitest.config.mts` and, if strictly necessary, `apps/api/package.json` test scripts. No changes under `apps/api/src/**` or `packages/shared/**`.
- Routing rule must be deterministic and documented: a spec belongs to `workers` iff it imports `cloudflare:test` (or otherwise needs Miniflare bindings such as `env`, D1, R2, KV, or a real `fetch` against the Worker). All other specs belong to `node`.
- The `node` project must not fail because of missing Cloudflare globals — relying on Web Crypto APIs that exist in Node ≥ 20 is acceptable.
- Both projects must remain runnable individually (`pnpm test --project workers`, `pnpm test --project node`) and together (default).

## Scope

In:
- Update `vitest.config.mts` to expose the two projects with include/exclude globs that match the lists in RFC §P1.
- Verify that every currently-passing spec keeps passing after the split, without moving any spec files (the split is config-only here; relocations, if any, are handled in subsequent tasks).
- Update any package script aliases needed to keep `make test-api` working.

Out:
- Removing or refactoring any spec content (handled in tasks 02–11).
- Moving spec files to new folders.
- Tweaking timeouts, isolate settings, or coverage providers.

## Acceptance Criteria

- [x] `pnpm --filter @arenaquest/api test` runs both projects and exits green.
- [x] Vitest output (or `--reporter=verbose`) shows two distinct projects named `workers` and `node`.
- [x] All specs that do **not** import `cloudflare:test` run under the `node` project (spot-check the files enumerated in RFC §D1).
- [x] Local wall time drops measurably versus the 63.76 s baseline (target: ≥ 15 s reduction). New figure: 53.3 s (−10.4 s). Full target will be reached through tasks 05–09.
- [x] No diff outside `apps/api/vitest.config.mts` and optionally `apps/api/package.json`.

## Verification Plan

1. Run `pnpm --filter @arenaquest/api test` and confirm both projects execute and pass.
2. Run each project in isolation and confirm only the intended files are picked up.
3. Capture wall-time before/after for the closeout note.
4. `make lint` passes.
