# Task 12 — Backend: aq-mcp ops tools in three tiers (Phase 4)

**Status:** 📝 Open
**Milestone:** [28 — AI Admin Assistant](./milestone.md)
**RFC:** [RFC 0025](../../RFCs/0025-ai-admin-assistant.md)
**Team:** Backend API
**Depends On:** [Task 01](./01-backup-bucket-and-provision-check.task.md), [Task 06](./06-admin-ops-health-api.task.md), [Task 10](./10-aq-mcp-authoring-tools.task.md), [Task 11](./11-backup-status-report.task.md)

## Summary

Adds the operations tools to `aq-mcp`, organised in the RFC's three tiers. **Tier 1 —
diagnose** (read-only, auto-approvable): `system_health` and `job_runs` (Task 06's routes),
`backup_status` and `time_travel_status` (Task 11's `--json`), and `infra_status` (Task 01's
`provision-label --check --json`). **Tier 2 — reversible action**: `backup_now` (runs Task 02's
export for the configured label) and `bookmark_now` (records a Time Travel bookmark), each a
two-call protocol — the first call returns the plan and a single-use confirmation id valid for 5
minutes, the second call with that id executes, using the operator's own `wrangler login`.
**Tier 3 — destructive**: `restore_instructions` returns the exact restore command and the
runbook section from Task 04, filled for the label — it executes nothing. The server loads only
`AQ_CF_READ_TOKEN` as its Cloudflare credential. A static test proves no code path under
`scripts/mcp/` spawns a restore, `d1 execute`, deploy, delete or `secret put`.

## Dependencies

- [Task 01](./01-backup-bucket-and-provision-check.task.md) — `--check` for `infra_status`.
- [Task 06](./06-admin-ops-health-api.task.md) — the ops routes.
- [Task 10](./10-aq-mcp-authoring-tools.task.md) — the server, audit log and client.
- [Task 11](./11-backup-status-report.task.md) — the status report.
- All four are hard dependencies.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `scripts/mcp/tools/ops.mjs`, `scripts/mcp/confirm.mjs` and their `*.test.mjs`.
  - `scripts/mcp/aq-mcp.mjs` — registering the new tools.
  - `scripts/mcp/no-destructive.test.mjs` — the static guard.
  - `docs/onboarding.md` — the read-only token and tier description in the `aq-mcp` section.
- **Wrap, don't re-implement.** Tools call the existing scripts with `--json`; no tool assembles
  a wrangler command of its own except the bookmark read/record already used by the deploy CLI.
- **Credentials per tier** (RFC §5). Tier 1 runs on `AQ_CF_READ_TOKEN`; tier 2 runs only after a
  valid confirmation id and uses the operator's wrangler session; tier 3 has no executor.
- **Confirmation ids** are random, single-use, bound to the tool and its arguments, and expire
  after 5 minutes; an id for one tool cannot confirm another.
- **Annotations.** Tier 1 `readOnlyHint: true`; tier 2 `destructiveHint: false` and not read-only;
  tier 3 `readOnlyHint: true`.
- **Audit.** Every call, including a refused confirmation, is audited (Task 10's log).

## Scope

In:
- The eight tools, the confirmation module, the static guard, tests for each tier, onboarding
  text.

Out:
- An SQL query tool — decided by RFC OQ 5 in Task 13; if the answer is yes, it is a follow-up task.
- Any restore, reset or deploy execution.

## Acceptance Criteria

- [ ] Tier 1 tools return the same data as their underlying script or route (stubbed and one
      staging run).
- [ ] `backup_now` without an id returns a plan and an id and performs no export; with the id it
      runs once; reusing or replaying an expired id is refused; an id from `bookmark_now` cannot
      confirm `backup_now`.
- [ ] `restore_instructions` returns a command string and the runbook anchor and spawns nothing
      (asserted).
- [ ] The static guard fails if any file under `scripts/mcp/` references `time-travel restore`,
      `d1 execute`, `deploy`, `delete` or `secret put` as a spawned command.
- [ ] The server reads no Cloudflare credential other than `AQ_CF_READ_TOKEN` (asserted on the
      environment access list).
- [ ] `node --test scripts/mcp/` and `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `node --test scripts/mcp/`.
2. Register `aq-mcp` against staging/production read-only; ask "was a backup made for budo?"
   and "is the system healthy?"; compare with `make backup-status-prod` and the ops route.
3. Ask for a restore; confirm only instructions come back.
4. `git diff --stat` confirms only scope-guardrail files changed.
