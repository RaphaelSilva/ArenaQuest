# Task 09 — Wire OpenAPI dump, frontend type generation, and `oasdiff` CI gate (F9)

**Status:** 📝 Draft
**Milestone:** [9 — `apps/api` Route Reorganization and OpenAPI Adoption](./milestone.md)
**RFC:** [0003 §4.5 and §5 — F9](../../RFCs/0003-apps-api-route-organization-and-openapi.md)

## Summary

Close the contract loop: dump the live OpenAPI document to `apps/api/openapi.json` via a build script, generate `apps/web/src/lib/api-types.gen.ts` from it via `openapi-typescript`, and gate breaking changes between PR and `main` with `oasdiff`. After this task, the committed contract becomes the canonical source of truth and any drift is caught in CI rather than in runtime.

## Dependencies

Depends on Task 08 (the contract must already reflect `/v1`). Blocks Task 10 (Task 10 leans on the gate to confirm validation behaviour stays equivalent after removing decorators).

## Technical Constraints

- **Scope guardrail:** `apps/api/scripts/dump-openapi.ts`, `apps/api/openapi.json` (committed), `apps/api/package.json` (script aliases), `apps/web/package.json` (devDep + script), `apps/web/src/lib/api-types.gen.ts` (committed), one or more clients under `apps/web/src/lib/*-api.ts` (to actually consume a generated type — at least one), and the CI workflow files under `.github/workflows/**`. No changes to controllers, adapters, business logic, or `packages/shared/**`.
- The dump script must run `buildApp(env)` against a minimal stub `env` and serialize the document. It must be deterministic — running it twice produces byte-identical output (stable ordering of keys, no timestamps).
- `apps/api/openapi.json` is committed. CI runs the dump and `git diff --exit-code apps/api/openapi.json` to fail on drift.
- `oasdiff` runs against the previous committed contract on `main` and fails on **breaking** changes (changed/removed paths, removed required fields, narrowed response schemas, etc.). A PR label `breaking-change` overrides the fail (decision from Milestone §6 — confirm before implementing).
- `openapi-typescript` runs in `apps/web` via a `pnpm gen:api-types` script. The generated file is committed and gated by the same drift-check pattern (`git diff --exit-code apps/web/src/lib/api-types.gen.ts`).
- At least **one** `apps/web/src/lib/*-api.ts` client must switch from its hand-rolled types to the generated ones in this task, to prove the pipeline works end-to-end. Pick the smallest one (e.g. `leaderboard-api.ts`).

## Scope

In:
- Implement `apps/api/scripts/dump-openapi.ts` and the corresponding `pnpm --filter @arenaquest/api dump-openapi` script.
- Commit `apps/api/openapi.json`.
- Add `openapi-typescript` as a devDependency of `apps/web` and a `gen:api-types` script.
- Commit `apps/web/src/lib/api-types.gen.ts`.
- Migrate one `apps/web/src/lib/*-api.ts` client to consume the generated types as a proof of concept.
- Add a CI job that: (a) runs the dump and fails on diff, (b) runs `gen:api-types` and fails on diff, (c) runs `oasdiff` against `main` and fails on breaking change unless the PR carries the `breaking-change` label.
- Demonstrate the gate by opening a throwaway PR that introduces a synthetic breaking change and confirming the gate fails (then closing the PR without merging).

Out:
- Migrating every `apps/web/src/lib/*-api.ts` client to generated types (a follow-up task; only one client moves here to validate the pipeline).
- Adding contract tests beyond `oasdiff` (e.g. Pact, Dredd).
- Removing the legacy `@ValidateBody` decorators (handled in F10).

## Acceptance Criteria

- [ ] `pnpm --filter @arenaquest/api dump-openapi` produces deterministic output equal to the committed `apps/api/openapi.json`.
- [ ] `pnpm --filter @arenaquest/web gen:api-types` produces deterministic output equal to the committed `apps/web/src/lib/api-types.gen.ts`.
- [ ] CI fails when `apps/api/openapi.json` is stale relative to the runtime document.
- [ ] CI fails when `apps/web/src/lib/api-types.gen.ts` is stale relative to the committed contract.
- [ ] CI fails when `oasdiff` detects a breaking change against `main`, unless the PR has the `breaking-change` label.
- [ ] At least one `apps/web/src/lib/*-api.ts` client imports types from `api-types.gen.ts` and the app still builds + tests pass.
- [ ] The synthetic-breaking-change PR demonstration is captured (screenshot or link in the PR description).
- [ ] `make test-api`, `make test-web`, `make lint` pass green.

## Verification Plan

1. Run the dump script twice in a row and confirm `git status` is clean after the second run.
2. Run `gen:api-types` twice and confirm `git status` clean.
3. Locally tamper with a response schema, run the dump, confirm the committed file diverges, and confirm CI would fail.
4. Locally remove a path or required field, run `oasdiff` against `main`, and confirm it flags the breaking change. Confirm adding the `breaking-change` label unblocks the CI job in the synthetic PR.
5. Confirm the migrated `apps/web` client compiles and its tests pass.
