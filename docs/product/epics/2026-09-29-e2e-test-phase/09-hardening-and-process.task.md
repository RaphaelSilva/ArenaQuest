# Task 09 — Backend: Hardening — nightly matrix, flake tracking, doctor and docs

**Status:** 📝 Open
**Epic:** [End-to-end test phase — Playwright suite gating main](./2026-09-29-e2e-test-phase.epic.md)
**Team:** Backend API
**Depends On:** [Task 04](./04-ci-gate.task.md)

## Summary

Make the suite durable and part of how the team works. **Nightly matrix:** a scheduled
run of `e2e.yml` adds Firefox and WebKit projects and a Portuguese build
(`NEXT_PUBLIC_LANGUAGE=pt`), reporting without blocking anyone. **Flake policy:** the
HTML report's flaky count is surfaced in the job summary, and a documented quarantine
rule applies — a test flagged flaky twice in a week is fixed or marked `fixme` with a
linked issue, never silently skipped. **Doctor:** `make doctor` reports a missing
Playwright browser as a soft gap (exit 2) with its install command. **Docs and
process:** `docs/onboarding.md` and `CONTRIBUTING.md` explain running, debugging
(`make e2e-ui`, traces) and adding a journey; the `write-tasks` skill documents the
convention that a milestone or epic changing a user-facing flow ends with an
`NN-e2e-<journey>.task.md`.

## Dependencies

- [Task 04](./04-ci-gate.task.md) — hard dependency: the workflow this extends.
- Tasks 05–08 — ordering preference: document the finished journey set.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `.github/workflows/e2e.yml` — the `schedule` trigger and the nightly-only matrix.
  - `e2e/playwright.config.ts` — Firefox/WebKit projects, enabled only in the nightly
    run.
  - `scripts/doctor.sh` — one soft check for the Playwright browser.
  - `docs/onboarding.md`, `CONTRIBUTING.md`.
  - `.claude/skills/write-tasks/SKILL.md` — the E2E-task convention.
- **PRs stay fast.** The PR run stays Chromium-only and English; the matrix never
  runs on `pull_request`.
- **Non-blocking nightly.** A nightly failure notifies but is not a required check.
- **Doctor stays read-only.** It reports and prints the install command; it never
  installs.

## Scope

In:
- Nightly schedule with Firefox, WebKit and the `pt` build.
- Flaky count in the job summary and the written quarantine rule.
- The `doctor` soft check.
- Onboarding, contributing and skill documentation.

Out:
- Post-deploy smoke against staging — deferred follow-up (epic, Alternatives §2).
- Visual regression and accessibility audits.

## Acceptance Criteria

- [ ] A manual dispatch of the nightly configuration runs Chromium, Firefox and
      WebKit plus the `pt` build, and the PR configuration still runs Chromium/`en`
      only.
- [ ] The job summary shows the flaky count.
- [ ] With the browser removed, `make doctor` exits 2 and prints the install command.
- [ ] A new contributor can run, debug and add a journey following
      `docs/onboarding.md` alone.
- [ ] `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. Dispatch the workflow in nightly mode — all projects run; the summary shows the
   flaky count.
2. Open a PR — only the Chromium/`en` run appears.
3. Move the Playwright browser cache away and run `make doctor` — exit 2 with the
   hint; restore.
4. Follow `docs/onboarding.md` from a clean checkout.
5. `git diff --stat` confirms only scope-guardrail files changed.
