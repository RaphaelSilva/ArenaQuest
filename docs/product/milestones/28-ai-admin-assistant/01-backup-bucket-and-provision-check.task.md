# Task 01 — Backend: Backup bucket in the label profile and provisioner check mode (Phase 0)

**Status:** 📝 Open
**Milestone:** [28 — AI Admin Assistant](./milestone.md)
**RFC:** [RFC 0023](../../RFCs/0023-ai-admin-assistant.md)
**Team:** Backend API

## Summary

Declares a **backup bucket** for every label and creates it on provisioning. The label profile
gains a `backup` block per environment — the bucket name (`<label>-backups` by convention) and
the retention values the later tasks read (daily days, monthly count, mirror tombstone days) —
validated by `config/deployment.schema.jsonc`. `provision-label.mjs` creates the bucket in
**production only** (staging is disposable, RFC 0021 §4) and applies its lifecycle rules: daily
dumps expire after 35 days, `monthly/` objects after 12 months. The same CLI gains a read-only
**`--check`** mode that reports, for one label and environment, which required resources exist
(D1, KV, media bucket, backup bucket, Pages project, Worker) and which secrets are present **by
name**, each missing item with its fix command — the provisioner's existing detection, with no
write path reachable. Tasks 02–04 write into this bucket; Task 12 wraps `--check` as
`infra_status`.

## Dependencies

- None — independent.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `config/deployment.schema.jsonc` — the `backup` block (optional for staging, required for
    production).
  - `config/labels/{arenaquest,budo,spaziord}.jsonc` — the `backup` block for production.
  - `scripts/label.mjs` — derive the expected backup bucket name and expose it in the resolved
    profile, if the existing derivation helpers need it.
  - `scripts/cloudflare/provision-label.mjs` and `scripts/cloudflare/provision-label.test.mjs` —
    the bucket + lifecycle step and the `--check` mode.
  - `Makefile` — one `infra-check-<env>` target forwarding to `--check`, following the naming rule
    (environment in the name; no `-dev`).
  - `CLAUDE.md` — one sentence in the provisioning paragraph.
- **One source of truth.** `--check` reuses the provisioner's existing plan and secret detection
  (`externalSecretNames`, `secretAction`); it must not grow a second list of what a label needs.
- **Read-only by construction.** In `--check` mode no step that creates, puts, deletes or
  deploys is reachable; secrets are listed by name only and no value reaches argv, disk or a log.
- **Production only for backups.** Staging gets no backup bucket and the plan says so.
- **Idempotent.** Re-provisioning a label whose backup bucket and rules already exist performs no
  write.

## Scope

In:
- The schema block, the three profiles, and the derived bucket name.
- Bucket creation and lifecycle rules in the production provisioning plan, shown in `DRY_RUN=1`.
- The `--check` mode with its human report and a `--json` output for Task 12.
- Tests for both, including an assertion that `--check` issues no write command.

Out:
- Writing anything into the bucket — Tasks 02 and 03.
- Any off-account destination (milestone Decision 8).
- Any change to `apps/**`.

## Acceptance Criteria

- [ ] `make set-new-label LABEL=budo PRODUCTION=1 DRY_RUN=1` lists the backup bucket and its two
      lifecycle rules for production and nothing for staging.
- [ ] A profile missing `backup` for production fails schema validation with a message naming the
      block; staging without it validates.
- [ ] `provision-label.mjs --label budo -e production --check` prints each required resource as
      present/missing and each external secret by name, with a fix command per missing item; its
      `--json` output carries the same data.
- [ ] A test asserts that in `--check` mode the planned commands contain no create, put, delete,
      deploy or `secret put` invocation.
- [ ] Re-running provisioning against a label whose bucket and rules exist plans no write.
- [ ] The existing `provision-label.test.mjs` and `label.test.mjs` suites pass; `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `node --test scripts/cloudflare/provision-label.test.mjs scripts/label.test.mjs`.
2. `make set-new-label LABEL=budo PRODUCTION=1 DRY_RUN=1` — read the plan.
3. `node scripts/cloudflare/provision-label.mjs --label budo -e staging --check` against the real
   account (read-only) and compare with the Cloudflare dashboard.
4. `git diff --stat` confirms only scope-guardrail files changed.
