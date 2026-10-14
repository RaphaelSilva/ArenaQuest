# Task 01 — Backend: E2E workspace, stack boot and fresh-D1 global setup

**Status:** 📝 Open
**Epic:** [End-to-end test phase — Playwright suite gating main](./2026-09-29-e2e-test-phase.epic.md)
**Team:** Backend API

## Summary

Create the `e2e/` pnpm workspace and make `make e2e` boot the **real stack locally**
against an isolated state directory: the API through `wrangler dev` with a committed,
non-secret `apps/api/.dev.vars.e2e` (console mail, `COOKIE_SAMESITE=Lax`, loopback
`ALLOWED_ORIGINS`, `WEB_BASE_URL=http://localhost:3000`) persisting D1/KV/R2 under
`e2e/.state`, and the web through a **production** Next.js build (`next build` +
`next start`, `NEXT_PUBLIC_LANGUAGE=en`, `NEXT_PUBLIC_API_URL=http://localhost:8787`).
Playwright owns both processes (`webServer`, readiness on the existing `GET /health`
and on `/`), and a global setup deletes `e2e/.state`, applies every migration and runs
the existing local seeds plus a new `0100_e2e_fixtures.sql` (a second student with no
enrollments, a `content_creator`, an `inactive` user). The task ends with one trivial
spec that opens `/` and passes. Every later task builds on this boot and on the fresh
database it guarantees.

## Dependencies

- None — independent. First task of the epic.
- Reads the stack as it is today: `apps/api/wrangler.jsonc`, `apps/api/migrations/**`,
  `apps/api/migrations/seed/0001–0003`, `apps/api/src/routes/public/health.ts`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `e2e/**` — new workspace: `package.json` (`@arenaquest/e2e`, `@playwright/test`
    only), `tsconfig.json`, `playwright.config.ts`, `global-setup.ts`, one
    placeholder spec under `e2e/specs/`, and an ESLint config matching the repo's.
  - `pnpm-workspace.yaml` — add `e2e`; `pnpm-lock.yaml` regenerated with
    `pnpm install`, never by hand.
  - `turbo.json` — only if needed to keep `e2e` **out** of `turbo run test`; the
    workspace exposes `e2e` / `e2e:ui` scripts, never a `test` script.
  - `apps/api/.dev.vars.e2e` (new, committed, no secret values) and
    `apps/api/migrations/seed/0100_e2e_fixtures.sql` (new, local-only header like
    `0001_test_users.sql`).
  - `Makefile` — new local targets `e2e`, `e2e-ui`, `e2e-smoke`, `e2e-report`,
    `e2e-db-reset` under a new `##@` section.
  - `.gitignore` — `e2e/.state/`, `e2e/.auth/`, `e2e/playwright-report/`,
    `e2e/test-results/`.
- **No production code change.** Neither the API nor the web source trees are edited.
- **Isolation.** The E2E state never shares the developer's `apps/api/.wrangler`
  replica; `make e2e` must not modify local `make dev` data.
- **Naming rule.** All new Makefile targets are unsuffixed (local); none touches a
  deployed environment or holds a Cloudflare credential.
- **Seed guard.** `0100_e2e_fixtures.sql` lives in `migrations/seed/`, so
  `apps/api/scripts/check-no-dev-seed.ts` derives its matcher from it automatically —
  confirm, don't special-case.
- **Reuse locally.** Outside CI, Playwright reuses already-running servers so a
  developer can iterate against `make dev`.

## Scope

In:
- The `e2e/` workspace wired into pnpm, lint-clean, with Chromium as the only project.
- `webServer` entries for API and web with readiness URLs, a capped startup timeout
  and piped API stdout (task 05 reads it).
- Global setup: reset `e2e/.state`, migrate, run seeds `0001–0003` and `0100`.
- `0100_e2e_fixtures.sql` with the three extra accounts, passwords documented in its
  header the same way `0001` does.
- The five Makefile targets and the `.gitignore` entries.
- One placeholder spec proving the boot.

Out:
- Fixtures, page objects and real journeys — tasks 02, 03.
- The GitHub workflow — task 04.
- Mail reading and R2 interception — tasks 05, 06.

## Acceptance Criteria

- [ ] On a clean checkout after `make setup`, `make e2e` boots both servers from a
      freshly created `e2e/.state`, runs the placeholder spec green and shuts both
      servers down.
- [ ] Running `make e2e` twice in a row gives the same result (the database is
      rebuilt each run); `make dev` data in `apps/api/.wrangler` is untouched.
- [ ] The web under test is a production build in English (a known English label
      is visible on `/`).
- [ ] `turbo run test` / `make test` do not run the E2E workspace.
- [ ] `apps/api/.dev.vars.e2e` contains no secret value; `check-no-dev-seed.ts`
      matches the accounts of `0100_e2e_fixtures.sql`.
- [ ] `make lint` green, including the new workspace.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make setup && make e2e` — placeholder spec passes; both servers exit.
2. `make e2e` again — same result; inspect `e2e/.state` timestamps to confirm reset.
3. Start `make dev`, create a topic, run `make e2e`, confirm the topic still exists
   in the dev replica.
4. `make test` — confirm no Playwright run is triggered.
5. `make lint`.
6. `git diff --stat` confirms only scope-guardrail files changed.
