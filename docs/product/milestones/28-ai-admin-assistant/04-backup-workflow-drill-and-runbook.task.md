# Task 04 — Backend: Backup workflow, restore drill and restore runbook (Phase 0)

**Status:** 📝 Open
**Milestone:** [28 — AI Admin Assistant](./milestone.md)
**RFC:** [RFC 0025](../../RFCs/0025-ai-admin-assistant.md)
**Team:** Backend API
**Depends On:** [Task 02](./02-d1-export-and-manifest.task.md), [Task 03](./03-r2-media-mirror.task.md)

## Summary

Puts Tasks 02 and 03 on a schedule and proves the backups restore. A new
`.github/workflows/backup.yml` runs daily, offset from the `0 6 * * *` billing cron, with a
`strategy.matrix.label` of the three labels, the D1 export followed by the R2 mirror, and
`workflow_dispatch` for an on-demand run. Weekly, a **restore drill** job
(`scripts/backup/drill.mjs`) downloads the latest dump, verifies its SHA-256 against the
manifest, applies it to a throwaway local D1 (the mechanism the *Demo seed check* job already
uses), compares per-table row counts with the manifest, and writes
`drill: { at, ok, mismatches }` back. A failed export, mirror or drill fails the job, which is
GitHub's notification. Finally, `docs/operations/backup-restore.md` is the human runbook: when to
use D1 Time Travel (minutes to 30 days, in place), when to restore a dump (database lost), and
how to copy an object back from the R2 mirror — each with the exact commands. The assistant
(Task 12, tier 3) links to this runbook and never executes it.

## Dependencies

- [Task 02](./02-d1-export-and-manifest.task.md) and [Task 03](./03-r2-media-mirror.task.md) —
  hard dependencies: the scripts the workflow runs.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `.github/workflows/backup.yml` — new.
  - `scripts/backup/drill.mjs` and `scripts/backup/drill.test.mjs`.
  - `scripts/backup/manifest.mjs` — the `drill` field only.
  - `docs/operations/backup-restore.md` — new.
  - `CLAUDE.md` — a short "Backups" paragraph pointing at the runbook.
- **Credentials.** The workflow uses `CF_API_TOKEN` / `CF_ACCOUNT_ID` from repository secrets,
  like the deploy workflows; no new secret value is committed or echoed.
- **Same CLI as a human.** The workflow calls the scripts with their flags, never re-implements
  them inline.
- **Drill is offline after download.** The throwaway D1 is local and discarded; nothing writes to
  a remote database.
- **Runbook commands are copy-paste exact** and carry the label/env placeholders the deploy CLI
  uses; restore commands are never wrapped in a Make target or script that runs them unattended.

## Scope

In:
- The workflow (daily + weekly + dispatch), the drill script and its tests, the runbook, the
  CLAUDE.md paragraph.

Out:
- Status reporting — Task 11.
- Any automatic restore.
- Staging backups (milestone guardrail).

## Acceptance Criteria

- [ ] `workflow_dispatch` on `backup.yml` succeeds for all three labels and leaves a fresh
      `latest` in each manifest.
- [ ] The drill job restores the latest dump with zero mismatches and writes `drill.ok: true`; a
      tampered dump in a test fails the SHA-256 check before any restore.
- [ ] A row-count mismatch in a test produces `drill.ok: false` with the mismatching tables listed
      and a failing job.
- [ ] Following the runbook on staging, an object deleted from the media bucket is restored from
      the mirror byte-identical.
- [ ] `node --test scripts/backup/` green; `make lint` green; the CI workflow lints.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `node --test scripts/backup/drill.test.mjs`.
2. Dispatch `backup.yml` from the branch; read the job summary and the manifests.
3. Walk the R2 section of the runbook on staging end to end.
4. `git diff --stat` confirms only scope-guardrail files changed.
