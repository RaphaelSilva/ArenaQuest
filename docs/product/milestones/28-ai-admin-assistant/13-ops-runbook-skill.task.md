# Task 13 — Backend: ops-runbook skill and read-only token procedure (Phase 4)

**Status:** 📝 Open
**Milestone:** [28 — AI Admin Assistant](./milestone.md)
**RFC:** [RFC 0025](../../RFCs/0025-ai-admin-assistant.md)
**Team:** Backend API
**Depends On:** [Task 05](./05-job-runs-recording.task.md), [Task 12](./12-aq-mcp-ops-tools.task.md)

## Summary

Writes the `ops-runbook` Claude Code skill — the semantic layer for ad-hoc operational questions
answered with SQL through the Cloudflare connector — and settles RFC Open Question 5. The skill
gives the assistant, without rediscovering it each session: the D1 name per label and
environment (read from the profiles, not copied), a commented map of the tables operators ask
about (users, enrollments, progress, comments, billing, events, submissions metadata,
`job_runs`), canned `SELECT`s for the recurring questions (today's billing run, overdue invoices,
activity per student over a period, comments on a topic since a date, submissions waiting), the
computed predicates that are not columns ("past" events, effective topic access), and the rules:
**`SELECT` only**, production only when the operator asks, never `topic_notes` bodies with
`visibility = 'private'`, never password hashes, tokens or secret values, emails and phone numbers
only for a named person on request; and where to look first (`aq-mcp` tools from Task 12) before
writing SQL. The task also documents how to mint `AQ_CF_READ_TOKEN` with the minimum scopes and
tests whether a D1-read-scoped token can run `SELECT` through the query endpoint; the answer is
recorded in RFC 0025 as a Resolved Decision.

## Dependencies

- [Task 05](./05-job-runs-recording.task.md) — the `job_runs` table the runbook queries.
- [Task 12](./12-aq-mcp-ops-tools.task.md) — the tools the runbook points to first.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `.claude/skills/ops-runbook/SKILL.md` and any reference file under that folder (the path is a
    symlink to `.agents/skills/`; write through the real path if needed).
  - `docs/onboarding.md` — the read-only token procedure.
  - `docs/product/RFCs/0025-ai-admin-assistant.md` — moving OQ 5 into Resolved Decisions with the
    date and the tested answer.
- **Documentation only.** No code, no migration, no new tool; if OQ 5's answer is "yes", the
  query tool is filed as a follow-up task, not built here.
- **Queries verified, not invented.** Every canned query is run against the local replica (and
  read-only against staging) before it is written into the skill; table and column names match
  the migrations on `main`.
- **No data in the skill.** No real names, emails, ids or row samples.

## Scope

In:
- The skill, its canned queries, the privacy rules, the token procedure, the OQ 5 test and its
  recorded answer.

Out:
- `ops_*` SQL views (RFC §3.3 optional) and the daily brief (RFC Phase 5) — backlog.
- Any change to `apps/**` or `scripts/**`.

## Acceptance Criteria

- [ ] The skill appears in Claude Code's skill list in this repo and its description triggers on
      operational questions (billing ran?, student activity, comments summary, health).
- [ ] Every canned query runs without error against a freshly migrated and seeded local replica.
- [ ] The rules section states `SELECT` only, the private-notes exclusion, the credentials
      exclusion and the "ask before production" rule verbatim.
- [ ] `docs/onboarding.md` describes minting `AQ_CF_READ_TOKEN` with the exact scopes.
- [ ] RFC 0025 records OQ 5's tested answer as a Resolved Decision with date and decider.
- [ ] `make lint` green (docs only, `make test-api` unaffected).
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local`, then run each canned query with `wrangler d1 execute --local`.
2. In a fresh Claude Code session, ask "did billing run today on budo staging?" and "summarise the
   comments on topic X since Monday"; confirm the skill loads and only `SELECT`s are issued.
3. Mint the read-only token and test a `SELECT` through the query endpoint; record the result.
4. `git diff --stat` confirms only scope-guardrail files changed.
