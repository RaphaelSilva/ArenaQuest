# Task 14 — Backend: Home-lab backup pull and local restore (Phase 4)

**Status:** 📝 Open
**Milestone:** [28 — AI Admin Assistant](./milestone.md)
**RFC:** [RFC 0025](../../RFCs/0025-ai-admin-assistant.md)
**Team:** Backend API
**Depends On:** [Task 04](./04-backup-workflow-drill-and-runbook.task.md), [Task 11](./11-backup-status-report.task.md)

## Summary

Gives the operator the off-account copy RFC 0025 Resolved Decision 4 chose: their own disk, on
demand. `scripts/backup/pull.mjs` (`make backup-pull-prod LABEL=x`) reads the label's **backup
bucket only** — never the live media bucket, never the live D1 — and downloads the latest D1 dump
(verifying its SHA-256 against the manifest) plus every mirrored R2 object not yet present under
the local backup directory. It is resumable (objects already on disk with a matching ETag are
skipped, a second run downloads nothing), needs the read-only token alone, and writes
`.arenaquest/backup-pull-<label>-<env>.json` — the ledger Task 11's status line reads
(`{ pulledAt, dumpTs, objects }`). `scripts/backup/restore-local.mjs`
(`make backup-restore-local LABEL=x`) turns that download into a **production replica on the
operator's machine**: it applies the pulled dump to the local D1 replica (the drill's mechanism
from Task 04) and copies the pulled media into wrangler's local bucket in-process through
`getPlatformProxy`, the path the demo seed already uses, so `make dev` then runs against real
data — the operator's way to test a migration or a content change before deploying. Because that
replica holds real student data, the restore target is local only: `-e staging` and
`-e production`, and any production- or staging-named D1 or bucket, are refused through the demo
seed's `resolveTarget` before any write. Replacing the local replica asks for confirmation
(`CONFIRM=1` bypasses; no TTY without it aborts). There is no schedule in the repo; a cron on the
home lab is the operator's.

## Dependencies

- [Task 04](./04-backup-workflow-drill-and-runbook.task.md) — hard dependency: the manifest
  with SHA-256 and row counts, and the "apply a dump to a throwaway local D1" mechanism the
  restore reuses.
- [Task 11](./11-backup-status-report.task.md) — hard dependency: the ledger shape the status
  line reads; this task writes it.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `scripts/backup/pull.mjs`, `scripts/backup/pull.test.mjs`.
  - `scripts/backup/restore-local.mjs`, `scripts/backup/restore-local.test.mjs`.
  - `scripts/backup/manifest.mjs` — read helpers only.
  - `Makefile` — `backup-pull-prod` (read-only against the cloud, so no confirmation) and
    `backup-restore-local` (confirms; `CONFIRM=1`, `DRY_RUN=1`).
  - `docs/operations/backup-restore.md` — a "Pull to the home lab" and a "Replay production
    locally" section.
  - `docs/onboarding.md` — the local backup directory and `.env` note in the `aq-mcp` section.
  - `.gitignore` — the local backup directory (`.arenaquest/backups/`) if not covered.
- **Backup bucket only.** The pull never lists or reads the live media bucket or the live D1; a
  test asserts the only bucket touched is the profile's `backup` bucket and the only D1 call is
  none.
- **Read-only token is enough for the pull.** No step of `pull.mjs` requires a write-capable
  Cloudflare credential.
- **Local only for the restore.** `restore-local.mjs` resolves its target through the demo
  seed's `resolveTarget` and exits non-zero on anything but local, before opening D1 or the
  bucket; `--persist-to <dir>` retargets a local run, D1 and R2 alike, as the seed does.
- **Verify before apply.** The dump's SHA-256 is checked against the manifest on download and
  again before the restore applies it; a mismatch aborts with the re-pull command.
- **No secret, no PII in logs.** Logs carry counts, sizes and keys only; the ledger carries no
  row content.
- **Same CLI as a human.** The Make targets forward to the scripts with their flags.

## Scope

In:
- The two scripts, their tests (fresh pull, resumed pull, SHA mismatch, bucket-only assertion,
  target refusal for staging/production, confirmation, dry run), the Make targets, the ledger,
  the runbook and onboarding sections.

Out:
- A scheduled pull in the repo or in CI — the operator's cron.
- A second cloud destination (RFC Resolved Decision 4).
- Restoring to staging or production — the runbook's human-only path (Task 04).
- Exposing the pull or the restore as `aq-mcp` tools — the restore is tier 3 by definition and
  the pull stays a Make target in this milestone.

## Acceptance Criteria

- [ ] `make backup-pull-prod LABEL=budo` with `AQ_CF_READ_TOKEN` only leaves the latest dump
      and the mirrored media under the local backup directory, with the dump's SHA-256 verified;
      a second run downloads nothing and reports it.
- [ ] After the pull, `node scripts/backup/status.mjs --label budo -e production` shows the
      home-lab line green with the pull's age.
- [ ] `make backup-restore-local LABEL=budo` replaces the local replica; `make dev-api` then
      serves it and per-table row counts equal the manifest's; the local bucket holds the pulled
      objects byte-identical.
- [ ] `restore-local.mjs -e staging` and `-e production` exit non-zero before any D1 or bucket
      write (asserted); a production-named `--persist-to` database is refused the same way.
- [ ] A corrupted dump on disk aborts the restore with the re-pull command.
- [ ] Tests assert the pull touches only the backup bucket; `node --test scripts/backup/` and
      `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `node --test scripts/backup/pull.test.mjs scripts/backup/restore-local.test.mjs`.
2. On the home lab: `make backup-pull-prod LABEL=budo`, then `make backup-status-prod LABEL=budo`,
   then `make backup-restore-local LABEL=budo DRY_RUN=1` followed by the real run; `make dev-api`
   and compare `SELECT COUNT(*)` on three tables with the manifest.
3. `git diff --stat` confirms only scope-guardrail files changed.
