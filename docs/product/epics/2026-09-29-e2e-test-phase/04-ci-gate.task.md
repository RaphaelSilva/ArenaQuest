# Task 04 — Backend: CI gate — e2e workflow as a required check

**Status:** 📝 Open
**Epic:** [End-to-end test phase — Playwright suite gating main](./2026-09-29-e2e-test-phase.epic.md)
**Team:** Backend API
**Depends On:** [Task 03](./03-smoke-journeys.task.md)

## Summary

Turn the suite into a merge gate. Add `.github/workflows/e2e.yml`, triggered on pull
requests to `main`, on push to `main`, and on manual dispatch. The job installs with
the frozen lockfile, caches the Playwright browser keyed on the `@playwright/test`
version, installs Chromium with its system dependencies, runs `make e2e` in CI mode
(one retry, two workers, trace on first retry, screenshot and video kept on failure)
and uploads the HTML report and test results as artifacts when the run fails. The
workflow holds **no Cloudflare secret** and never contacts a deployed environment.
Once green on `main`, the `e2e` job is marked a required status check alongside
`verify`, so a PR that breaks a journey cannot merge.

## Dependencies

- [Task 03](./03-smoke-journeys.task.md) — hard dependency: there must be a real
  suite to gate on.
- Existing CI: `.github/workflows/ci.yml` (`verify` job, unchanged).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `.github/workflows/e2e.yml` (new).
  - `e2e/playwright.config.ts` — CI-mode settings only (retries, workers,
    reporters, artifact options).
  - `CONTRIBUTING.md` — one short section on the new required check and where to
    download traces.
- **No secrets.** The workflow uses no repository secret and no `CF_*` variable;
  it must work on PRs from forks.
- **Parallel, not serial.** `e2e` runs beside `verify`, not after it; `ci.yml` is not
  modified.
- **Budget.** A 15-minute job timeout; the PR run targets under 5 minutes.
- **Retries capture evidence, not green.** A test passing only on retry is reported
  as flaky in the report, never treated as clean.
- **Branch protection** is a repository setting changed by a maintainer; the task
  documents the exact check name to require.

## Scope

In:
- The workflow file with install, browser cache, run and failure-artifact upload.
- CI-mode Playwright settings.
- The CONTRIBUTING note, including how to reproduce a CI failure locally.

Out:
- Nightly cross-browser and `pt` runs — task 09.
- Any change to `ci.yml`, `deploy-api.yml` or `deploy-web.yml`.

## Acceptance Criteria

- [ ] On a PR to `main`, an `E2E` check runs next to `Verify` and passes.
- [ ] A PR that deliberately breaks a smoke selector shows a red `E2E` check and a
      downloadable artifact containing the HTML report, a trace, a screenshot and a
      video.
- [ ] A second run on the same commit reuses the cached browser.
- [ ] The workflow references no secret.
- [ ] `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. Open a draft PR with this task — the `E2E` check runs and passes.
2. Push a commit breaking one selector — the check fails; download the artifact and
   open the trace; revert the commit.
3. Re-run the job — the browser cache step reports a hit.
4. Ask a maintainer to add the check to the `main` branch protection.
5. `git diff --stat` confirms only scope-guardrail files changed.
