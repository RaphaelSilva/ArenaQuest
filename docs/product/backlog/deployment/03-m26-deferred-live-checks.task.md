# Task 03 — Deployment: run the live checks Milestone 26 left unexercised

**Status:** 📝 Open
**Team:** Backend API
**Found in:** Milestone 26 closeout, 2026-09-30

## Summary

[Milestone 26](../../milestones/26-release-candidate-previews-and-demo-seed/milestone.md)
([RFC 0021](../../RFCs/0021-release-candidate-previews-and-demo-seed.md)) is implemented and
its central paths were proven live on budo staging on 2026-09-30: `db-reset-staging` kept the
`database_id` and left exactly the demo dataset, and the `m26` candidate preview logged
`demo.admin` in, played media and left the live staging Worker untouched. The checks below
need Cloudflare credentials and a real run, and were not exercised. None of them is a known
defect; each is an operational path that has only been verified by unit tests and `--dry-run`.

## Checks

- [ ] **Staging mail goes to the log** (RFC 0021 P0, M26 Task 02). Request a password reset
      on budo staging; the mail and its link appear in `wrangler tail --env budo-staging` and
      no Resend call is made.
- [ ] **Bookmark restore works** (M26 Tasks 09 and 12). On a scratch run, take the restore
      command printed by `make db-reset-staging LABEL=budo` (or by a `--preview` run) and
      confirm it restores the pre-reset data. Also confirm on the first real output that
      `wrangler d1 time-travel info --json` exposes `bookmark` as the script expects.
- [ ] **Preview cleanup** (M26 Task 12). `make preview-delete-staging LABEL=budo CANDIDATE=m26`
      removes the Worker preview and only that branch's Pages Preview deployments.
- [ ] **Dispatch for every label** (M26 Task 12). A `preview-candidate.yml` run with
      `label: all` produces three previews and lists their URLs in the job summary.

## Blockers

- arenaquest and spaziord have no staging D1 in the account (only `budo-db-staging`
  exists as of 2026-09-30), so the `label: all` dispatch fails for them until those labels are
  reprovisioned with `make set-new-label LABEL=<l>`.

## Related, out of scope

- The quest evaluator reads `predicate_params.target` while migration 0019 stores `count`,
  so an unstarted quest has target 1 and `weekly-topic` pays on the first completion (found
  in M26 Task 06; see its implementation notes). It is a gamification-engine bug, not a
  deployment check, and should get its own task.
- `Deploy API` / `Deploy Web` on `main` fail in the production job (staging succeeds); that
  is unrelated to these checks.
