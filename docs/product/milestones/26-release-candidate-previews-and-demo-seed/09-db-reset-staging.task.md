# Task 09 — Backend: Disposable staging: db-reset-staging (Phase 2)

**Status:** ✅ Done (live staging run pending — see Acceptance Criteria)
**Milestone:** [26 — Release-candidate previews and demo seed](./milestone.md)
**RFC:** [RFC 0021](../../RFCs/0021-release-candidate-previews-and-demo-seed.md)
**Team:** Backend API
**Depends On:** [Task 08](./08-demo-seed-ci-and-make.task.md)

## Summary

Makes staging disposable. `make db-reset-staging LABEL=<l>` (prompt names the database;
`CONFIRM=1` bypasses) forwards to `scripts/db/reset-remote.mjs --label <l> -e staging`,
which: (1) records a D1 Time Travel bookmark and prints the exact restore command, so the
reset itself can be undone; (2) lists every table from `sqlite_master` except `sqlite_%` and
`_cf_%` and drops them all — `d1_migrations` included — with foreign-key checks deferred;
(3) re-applies every migration from the current checkout with `d1 migrations apply
--remote`; (4) runs the demo seed with `--yes`. The database is emptied **in place**: its
`database_id` never changes, so neither the label profile nor `wrangler.jsonc` needs an edit.
The bucket is not emptied — the demo re-uses its own objects, and any non-demo objects left
behind become orphans for the RFC 0018 audit. The script refuses `-e production` and any D1
listed in a production block, exactly like the seed.

## Dependencies

- [Task 08](./08-demo-seed-ci-and-make.task.md) — hard: the seed and its Make wiring.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `scripts/db/reset-remote.mjs` (new) and `scripts/db/reset-remote.test.mjs` (new).
  - `Makefile` — `db-reset-staging` and the `test-scripts` line.
  - `docs/onboarding.md`, `CLAUDE.md` — "Recovering staging" runbook.
- **Reuse.** Target resolution and the production refusal come from the same helper the seed
  uses; the seed is invoked as its CLI, not re-implemented.
- **Order is fixed**: bookmark → drop → migrate → seed. If the bookmark cannot be read, the
  reset aborts before dropping anything.
- **No `-prod` target**, no `--force` flag that bypasses the production refusal.
- **Staging only.** Local keeps `make db-reset-local` (delete the replica, re-migrate,
  re-seed) unchanged.

## Scope

In:
- Bookmark capture and printed restore command.
- Table enumeration and drop, deferred FK checks.
- Re-migration and demo re-seed.
- Unit tests for the planned command sequence, the refusal rules and "abort when the bookmark
  step fails" (wrangler stubbed).
- Runbook text.

Out:
- Emptying or garbage-collecting the bucket.
- Resetting production (never).

## Acceptance Criteria

- [ ] `make db-reset-staging LABEL=budo` leaves `budo-db-staging` with the same `database_id`,
      every migration listed as applied, and the demo counts of Task 08. _(Pending live run — needs Cloudflare credentials. Proven locally on a throwaway store: 47 objects dropped incl. `d1_migrations`, 27 migrations re-applied, budo demo seeded.)_
- [ ] The run prints a bookmark and a restore command; running that command restores the
      pre-reset data. _(The dry run prints both commands; reading a real bookmark and restoring from it need Cloudflare credentials — pending.)_
- [x] `reset-remote.mjs --label budo -e production` exits non-zero before any wrangler call.
- [x] A migration present in staging but absent from the checkout (abandoned candidate) is
      gone after the reset.
- [x] `make test-scripts` and `make lint` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `node scripts/db/reset-remote.mjs --label budo -e staging --dry-run` — read the plan.
2. Real run on budo staging; check `wrangler d1 info`, `d1 migrations list --remote` and the
   demo counts.
3. Restore from the printed bookmark on a scratch run to prove the undo path.
4. `make test-scripts && make lint`; `git diff --stat` confirms only scope-guardrail files
   changed.

## Implementation notes

- Reuses `resolveTarget`, `loadAllProfiles`, `readPassword`, `parseD1Json` exported by `scripts/demo/seed-demo.mjs`.
- Views are dropped before tables; excluded names match with `substr` (not `LIKE`, where `_` is a wildcard).
  The drop batch starts with `PRAGMA defer_foreign_keys = on` (verified locally: a parent-with-child drop fails alone,
  succeeds in the batch).
- `AQ_DEMO_PASSWORD` is checked before the bookmark step; a failure after the bookmark repeats the restore command.
- To confirm on the first live run: `time-travel info --json` exposes `bookmark` (taken from wrangler 4.144 source),
  and remote D1 runs the multi-statement drop as one batch.
