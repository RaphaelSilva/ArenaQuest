# Task 02 — Backend: D1 export and backup manifest (Phase 0)

**Status:** 📝 Open
**Milestone:** [28 — AI Admin Assistant](./milestone.md)
**RFC:** [RFC 0025](../../RFCs/0025-ai-admin-assistant.md)
**Team:** Backend API
**Depends On:** [Task 01](./01-backup-bucket-and-provision-check.task.md)

## Summary

Adds `scripts/backup/export-d1.mjs`, which takes a production label's D1 off the database. For
one `--label`, it resolves the profile, runs a remote D1 export, gzips the dump, computes its
SHA-256, counts rows per table, and writes the object
`d1/production/YYYY/MM/DD/<iso-ts>.sql.gz` to the label's backup bucket (Task 01). It then
updates `d1/production/manifest.json`: a `latest` entry and an appended history entry, each
carrying timestamp, bytes, SHA-256, per-table row counts and the export duration. On the first
run of a calendar month it also copies the dump under `monthly/`. The manifest is the contract
Tasks 04 (drill writes back into it) and 11 (status reads it) depend on, so its shape is
versioned (`manifestVersion: 1`) and documented in the script header. Staging and local targets
are refused before any wrangler call, like the demo seed's `resolveTarget`.

## Dependencies

- [Task 01](./01-backup-bucket-and-provision-check.task.md) — hard dependency: the bucket name
  comes from the profile's `backup` block.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `scripts/backup/export-d1.mjs` and `scripts/backup/export-d1.test.mjs`.
  - `scripts/backup/manifest.mjs` and `scripts/backup/manifest.test.mjs` — read, validate,
    append and write the manifest; shared with Tasks 03, 04 and 11.
  - `Makefile` — `backup-d1-prod` (confirms; `CONFIRM=1` bypasses).
- **No write to D1.** The script only reads the database; no statement other than the export and
  `SELECT COUNT(*)` per table reaches it.
- **Production only.** `-e staging`, `-e local` and any non-production database name are refused
  before any wrangler call.
- **Integrity first.** The manifest is updated only after the object upload succeeds and its
  stored size matches; a failed run leaves the previous `latest` intact and exits non-zero.
- **No secrets on argv or in the manifest.** Credentials come from the wrangler context or the
  CI environment.
- **Measure the cost.** The export duration is recorded so the "export holds the database" risk
  (RFC Tradeoffs) is observable.

## Scope

In:
- Export, gzip, hash, row counts, upload, manifest update, monthly copy.
- The manifest module with its schema, used by later tasks.
- Tests with wrangler and storage stubbed: happy path, upload failure, refused environments,
  monthly-copy rule.

Out:
- Scheduling — Task 04.
- R2 objects — Task 03.
- Restore — tier 3, the runbook in Task 04.

## Acceptance Criteria

- [ ] `node scripts/backup/export-d1.mjs --label budo -e production --dry-run` prints the plan
      (export, object key, manifest update) and performs no call.
- [ ] A real run stores one `.sql.gz` whose SHA-256 equals the manifest's `latest.sha256`, and
      row counts in the manifest equal `SELECT COUNT(*)` per table at export time.
- [ ] A simulated upload failure leaves `manifest.json` byte-identical and exits non-zero.
- [ ] `-e staging` and `-e local` exit non-zero before any wrangler invocation (asserted in tests).
- [ ] The first run in a month writes the `monthly/` copy; a second run that month does not.
- [ ] `node --test scripts/backup/` green; `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `node --test scripts/backup/export-d1.test.mjs scripts/backup/manifest.test.mjs`.
2. Dry run against `budo` production; read the plan.
3. One real run by the operator (`make backup-d1-prod LABEL=budo`), then download the object and
   compare its hash with the manifest.
4. `git diff --stat` confirms only scope-guardrail files changed.
