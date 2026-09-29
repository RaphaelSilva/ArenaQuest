# Task 07 — Backend: Guard recognises demo accounts (Phase 1)

**Status:** ✅ Done
**Milestone:** [26 — Release-candidate previews and demo seed](./milestone.md)
**RFC:** [RFC 0021](../../RFCs/0021-release-candidate-previews-and-demo-seed.md)
**Team:** Backend API
**Depends On:** [Task 03](./03-demo-ids-and-dataset.task.md)

## Summary

Makes it impossible to release to production a database that holds demo accounts.
`apps/api/scripts/check-no-dev-seed.ts` keeps its current matcher (the `seed-` rows parsed
from `migrations/seed/*.sql`) and gains a second one: the demo user ids for **every** label
in `config/labels/`, computed with `scripts/demo/ids.mjs`, plus the demo e-mail domain
`*.demo.invalid`. A target D1 containing any such row fails the guard with a message naming
the matched accounts (by id and e-mail, never by hash). Because `deploy.mjs` already runs the
guard before every production deploy, and the production confirmation follows it, a demo
account in production blocks the release. The guard still passes on a fresh database and on
staging databases that hold only non-demo data; staging deploys that legitimately carry the
demo keep running it only against the dev-seed matcher (the demo matcher is enforced for
production targets). The current tuple regex, which breaks on values containing parentheses,
is left as is — out of scope.

## Dependencies

- [Task 03](./03-demo-ids-and-dataset.task.md) — hard: the id derivation and label list.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/scripts/check-no-dev-seed.ts` — the second matcher and the production-only
    enforcement switch.
  - `apps/api/test/core/check-no-dev-seed.spec.ts` (extended).
  - `scripts/deploy/core.mjs` / `scripts/cloudflare/deploy.mjs` — only to pass the env to the
    guard if it cannot already tell production from staging.
- **One id source.** The guard imports the demo id derivation; it never keeps its own list.
- **Query shape.** One read-only query against `users` (`id IN (…) OR email LIKE
  '%.demo.invalid'`); no write, no schema dependency beyond `users`.
- **Staging is allowed to hold the demo**; production is not. The distinction comes from the
  env the CLI passes, not from the database name.

## Scope

In:
- Demo-id and e-mail matchers; production-only enforcement; clear failure output.
- Tests: fresh DB passes; dev-seed row fails (unchanged); demo row fails for production;
  demo row passes for staging.

Out:
- Rewriting the existing SQL tuple parser.
- Any change to what counts as a dev seed.

## Acceptance Criteria

- [x] Against a local D1 seeded with the demo, the guard in production mode exits 1 and lists
      the demo accounts; in staging mode it exits 0.
- [x] Against a fresh D1 (no `users` table) it exits 0 in both modes.
- [x] Existing dev-seed detection behaves exactly as before (existing specs green).
- [x] `deploy.mjs --label budo -e production --dry-run` shows the guard step with the
      production mode.
- [x] `make test-api`, `make test-scripts` and `make lint` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. Local reset + demo seed; run the guard with the production flag and with the staging flag.
2. Run it against a fresh replica.
3. `make test-api && make test-scripts && make lint`.
4. `git diff --stat` confirms only scope-guardrail files changed.

## Implementation notes

- Mode is an explicit `--target production|staging` flag; **absent means production** (fail-safe); an unknown value
  exits 2. `deploy.mjs` always passes it (`Guard (production): no dev-seed or demo accounts in <db>`).
- The staging-mode "exit 0 with demo rows" case was shown on a scratch D1 holding only demo rows: the local replica
  also holds the dev seed, which the unchanged dev-seed check still rejects in both modes.
- The Makefile target `guard-no-dev-seed-staging` passes no `--target` and therefore now runs in production mode;
  it is fixed in Task 08 (Makefile is in that task's scope). Nothing calls it today.
