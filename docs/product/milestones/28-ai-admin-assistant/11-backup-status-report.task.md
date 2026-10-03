# Task 11 — Backend: Backup status report (Phase 4)

**Status:** 📝 Open
**Milestone:** [28 — AI Admin Assistant](./milestone.md)
**RFC:** [RFC 0025](../../RFCs/0025-ai-admin-assistant.md)
**Team:** Backend API
**Depends On:** [Task 04](./04-backup-workflow-drill-and-runbook.task.md)

## Summary

Adds `scripts/backup/status.mjs`, the single answer to "was a backup made, and what do I do if
not?". For one `--label` and `-e production`, it reads the backup manifest and the D1 Time Travel
info and reports: age of the last D1 dump, size delta versus the previous one, last drill result
and age, R2 mirror lag (objects and bytes pending, tombstones), the Time Travel window, and the
off-account copy (reported as missing while milestone Decision 8 defers it). Each line is
green/amber/red against stated thresholds (dump older than 26 h, drill older than 8 days or
failed, size drop beyond a set percentage, mirror lag above a set count), and each non-green line
carries the **command that fixes it** — never runs it. A dump whose drill has not passed is
reported as *unverified*. Human output by default, `--json` for Task 12's `backup_status` and
`time_travel_status` tools. It needs only read access: the read-only token is enough.

## Dependencies

- [Task 04](./04-backup-workflow-drill-and-runbook.task.md) — hard dependency: the drill field and
  the runbook the fix lines point to (and, through it, Tasks 02 and 03).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `scripts/backup/status.mjs` and `scripts/backup/status.test.mjs`.
  - `scripts/backup/manifest.mjs` — read helpers only, no schema change.
  - `Makefile` — `backup-status-prod` (read-only, so no confirmation).
- **Read-only.** No write to the bucket, the D1 or anything else; a test asserts only read calls
  are made.
- **Works with `AQ_CF_READ_TOKEN`.** No step requires a write-capable credential.
- **Fix commands, not actions.** Commands are rendered with the label filled in, matching the
  runbook and Make targets exactly.
- **Thresholds are named constants** in one place, documented in the script header.

## Scope

In:
- The report, its thresholds, the fix-command table, `--json`, tests for each state (fresh,
  stale, failed drill, unverified, missing manifest, size drop, mirror lag).

Out:
- MCP wrapping — Task 12.
- Any alerting channel (GitHub's failed-job notification from Task 04 is the alert).

## Acceptance Criteria

- [ ] With a fresh dump and a passing drill, the D1 lines are green and the off-account line is
      red with its explanation.
- [ ] A dump older than 26 h, a failed drill, or a missing manifest each turn red and print the
      matching fix command from the runbook.
- [ ] A dump with no passing drill is reported as unverified.
- [ ] `--json` returns the same states and commands in a stable shape (snapshot test).
- [ ] Only read calls are issued (asserted); `node --test scripts/backup/` and `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `node --test scripts/backup/status.test.mjs`.
2. `make backup-status-prod LABEL=budo` with `AQ_CF_READ_TOKEN` only; compare with the manifest.
3. `git diff --stat` confirms only scope-guardrail files changed.
