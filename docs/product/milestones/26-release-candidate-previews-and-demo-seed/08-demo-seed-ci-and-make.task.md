# Task 08 — Backend: Demo seed CI job and Makefile targets (Phase 1)

**Status:** 📝 Open
**Milestone:** [26 — Release-candidate previews and demo seed](./milestone.md)
**RFC:** [RFC 0021](../../RFCs/0021-release-candidate-previews-and-demo-seed.md)
**Team:** Backend API
**Depends On:** [Task 04](./04-seed-demo-cli-core.task.md), [Task 05](./05-seed-demo-media.task.md), [Task 06](./06-seed-demo-gamification.task.md), [Task 07](./07-guard-demo-accounts.task.md)

## Summary

Makes the demo easy to run and impossible to leave broken. Two Makefile targets follow the
naming rule (the environment is in the name, no `-prod` variant exists):
`make db-seed-demo-local LABEL=<l>` and `make db-seed-demo-staging LABEL=<l>` (prompts;
`CONFIRM=1` passes `--yes`), both forwarding to `scripts/demo/seed-demo.mjs`, with
`DRY_RUN=1` mapped to `--dry-run` and `LABEL` defaulting to `arenaquest`. A new CI job in
`.github/workflows/ci.yml` applies every migration to a fresh local D1, runs the demo seed
for each label twice against it (with a throwaway `AQ_DEMO_PASSWORD` and the media served
from a committed tiny fixture set via the cache, so CI needs no external download), and
asserts the row counts of RFC 0021's success criteria plus `user_xp` consistency. A
migration that breaks the demo therefore fails the PR that introduces it. `docs/onboarding.md`
and `CLAUDE.md` gain a short "Demo seed" section.

## Dependencies

- [Task 04](./04-seed-demo-cli-core.task.md), [Task 05](./05-seed-demo-media.task.md),
  [Task 06](./06-seed-demo-gamification.task.md) — hard: the seed must be complete.
- [Task 07](./07-guard-demo-accounts.task.md) — ordering: the guard lands before the staging
  target is advertised.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `Makefile` — `db-seed-demo-local`, `db-seed-demo-staging`, help text.
  - `.github/workflows/ci.yml` — one new job (or step group) for the seed check.
  - `scripts/demo/ci-check.mjs` (new) — runs migrations + seed twice + assertions locally.
  - `scripts/demo/fixtures/**` (new) — tiny CC0 media used only to pre-fill the cache in CI.
  - `docs/onboarding.md`, `CLAUDE.md` — the Demo seed section.
- **Naming rule.** No unsuffixed target touches a remote; no `-prod` demo target exists.
- **CI is offline for media.** The check pre-fills `.arenaquest/demo-media/` from the
  fixtures (matching SHA-256s, or a CI-only manifest override), so a dead public URL can
  never fail CI.
- **No secret in CI** beyond a throwaway password generated in the job.

## Scope

In:
- The two Make targets and their variables.
- `ci-check.mjs` and the CI job.
- Media fixtures for CI.
- Onboarding and CLAUDE.md documentation.

Out:
- The staging reset (Task 09).
- Event/billing/task/comment assertions (Task 14 extends the check).

## Acceptance Criteria

- [ ] `make db-seed-demo-local LABEL=budo` seeds the local replica; `DRY_RUN=1` only writes
      the SQL and plan.
- [ ] `make db-seed-demo-staging LABEL=budo` prompts naming the staging database;
      `CONFIRM=1` skips the prompt.
- [ ] There is no `db-seed-demo-prod` target.
- [ ] The CI job passes on the current migrations and fails on a scratch branch whose new
      migration drops a column the demo writes.
- [ ] The CI job makes no network request to a media source.
- [ ] `make lint`, `make test-api`, `make test-web` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local && make db-seed-demo-local LABEL=budo`; then with `DRY_RUN=1`.
2. `node scripts/demo/ci-check.mjs` locally with the network disabled for media.
3. Push and watch the CI job; on a scratch branch add a breaking migration and watch it fail.
4. `make help` shows the two targets with their descriptions.
5. `git diff --stat` confirms only scope-guardrail files changed.
