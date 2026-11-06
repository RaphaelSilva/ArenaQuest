# Task 11 — Tooling: E2E scaffold (Playwright workspace, fixtures, CI job)

**Status:** 📝 Open
**Kind:** Chore
**Team:** Tooling
**Priority:** Medium
**Found in:** Milestone 3 closeout (deferred 2026-04-29 as test debt); re-planned 2026-11-06
**Depends On:** [Task 12 — Ephemeral S3 store](./12-e2e-s3-store.task.md),
[Task 13 — Binding-less S3 storage adapter](./13-s3-storage-adapter.task.md)

> This file keeps the number it had when it was deferred, so the references in
> Task 10 and in `11-e2e-progress-flow.task.md` stay valid. The duplicate `11`
> inside the topic is known and deliberate.

## Summary

ArenaQuest has no test that drives a real browser. `apps/api` runs 1 868 Vitest
cases on the Workers pool (Miniflare D1, R2 and KV) and `apps/web` runs 1 066
under jsdom, so an endpoint contract and a component contract are each covered —
but nothing proves that the two apps agree end to end, that a presigned upload
lands from a real browser, or that any page works at a phone width (jsdom applies
no CSS, so `md:hidden` is invisible to every existing test; the comment at the
top of `apps/web/src/components/events/__tests__/board-a11y.test.tsx` says so).

Target state: a root workspace `e2e/` running `@playwright/test` against the two
apps started on the host, with **ephemeral state per run** — a fresh local D1/KV
replica through `wrangler dev --persist-to <run dir>` and an S3 store from
Task 12 — three viewport projects (`desktop`, `mobile`, `tablet`), API-backed
fixtures for login and seeding, `make e2e*` targets, and a CI job that uploads
traces on failure. This task ships the framework plus the first eight journeys
(auth and RBAC, and the authoring-to-consumption smoke). No product behaviour
changes.

## Why It Is Worth Fixing

- Every milestone since M3 has shipped UI that only a human has opened in a
  browser (M26 preview banner, M27 mission editor, the catalog redesign with its
  mobile drawer). The `qa` skill exists precisely because this gap is
  filled by hand today.
- The upload lifecycle (`presign → PUT → finalize`) is the one path that crosses
  browser, Worker and object store, and it is the one no suite exercises
  together; Task 13 records a local mismatch that only an E2E run would have
  caught.
- Tasks 10 and `11-e2e-progress-flow` have been waiting on this scaffold since
  Milestones 4 and 5.

## Design

**Workspace.** `e2e/` is added to `pnpm-workspace.yaml` as package
`@arenaquest/e2e` with `@playwright/test` pinned. It imports
`apps/web/src/i18n/dict-pt.ts` directly for every accessible name it queries,
so a copy change breaks the test at compile time rather than at run time.
Browsers: Chromium only in phase 1 (the Pages target is Chromium-first;
WebKit is a follow-up once the suite is stable).

**Projects** (`playwright.config.ts`):

| Project | Device | Viewport | Why |
|---|---|---|---|
| `desktop` | Desktop Chrome | 1280 × 800 | above every breakpoint |
| `mobile` | `Pixel 7` preset | 412 × 915, touch | below `md` (768) and `lg` (1024) |
| `tablet` | `iPad Mini` preset, portrait | 768 × 1024, touch | exactly `md`: desktop nav, catalog drawer |

Every spec runs in every project unless it opts out through a documented
`test.skip(({ isMobile }) => …)`. Task 14 owns the mobile-only specs and the
assertions that make the shared journeys hold at 412 px.

**Servers** (`webServer` entries, both on the host, no container):

- API: `wrangler dev --port 8787 --persist-to <run dir>` with its vars passed on
  the command line from the committed `e2e/.env.e2e` (`ALLOWED_ORIGINS=http://localhost:3000`,
  `COOKIE_SAMESITE=Lax`, `MAIL_DRIVER=console`, a fixed test `JWT_SECRET`, the S3
  endpoint/bucket/keys of Task 12 and `STORAGE_DRIVER=s3` of Task 13). It reads
  no `.dev.vars`. `globalSetup` applies the migrations and
  `apps/api/migrations/seed/0001_test_users.sql` to that run dir first; the dir
  is created under the OS temp folder and removed in `globalTeardown`, so two runs
  never share a row.
- Web: `next build` once, then `next start -p 3000` with
  `NEXT_PUBLIC_API_URL=http://localhost:8787` and `NEXT_PUBLIC_SITE_URL=http://localhost:3000`
  (a production build, not `next dev`: on-demand compilation is the main source of
  first-navigation timeouts).

**Accounts.** The three seed accounts of `0001_test_users.sql` (`admin`,
`professor`, `student` at `arenaquest.dev`). Their passwords are already
documented in that file's header and in `CONTRIBUTING.md`, and
`check-no-dev-seed.ts` refuses to deploy any database that holds them, so they
are local fixtures, not secrets: `e2e/.env.e2e` carries them and `.envs.test`
(gitignored, used by the `qa` skill) overrides them when present. Nothing
else reads `.envs.test`.

**Fixtures** (`e2e/fixtures/`):

- `auth`: `loginAs(role)` posts to `POST /v1/auth/login` and stores the
  resulting cookies as a `storageState` per worker, once; specs never type the
  login form except in the login specs themselves.
- `api`: thin seeding helpers over the public API — create topic, publish
  (admin), upload media (presign → PUT → finalize), grant access, create event,
  create task and stages (Task 10 extends it). Every created title carries a
  per-run suffix so projects and workers can run in parallel against one D1.
- `nav`: the only way a spec navigates through the top bar. On a project whose
  viewport is below `md` it opens the hamburger (`dict.layout.nav.openMenu`)
  and clicks the link inside the drawer; on desktop it clicks the bar. A spec
  that reaches for the top bar directly fails review.
- `s3`: exposes the store mode of Task 12 (`docker` | `embedded` | `skip`) so
  upload specs can `test.skip` with a visible reason under `skip`.

**Make targets** (unsuffixed, therefore local — the Makefile naming rule):
`e2e` (every project), `e2e-desktop`, `e2e-mobile`, `e2e-tablet`, `e2e-ui`
(Playwright UI mode), `e2e-report` (open the last HTML report). `E2E_S3_MODE`
and `E2E_GREP` pass through.

**CI.** A new `e2e` job in `.github/workflows/ci.yml`, alongside `verify` and
`demo-seed` (not after them: they share nothing and the critical path stays the
longest job), Node 22, `pnpm install --frozen-lockfile`,
`pnpm exec playwright install --with-deps chromium`, the Task 12 store, then
`make e2e` with `--trace retain-on-failure`. `playwright-report/` and
`test-results/` are uploaded with `actions/upload-artifact` only on failure.
`timeout-minutes: 15`; the budget is 6 minutes on a cold runner.

**Where it cannot run.** A Claude Code cloud session has the Docker CLI but no
daemon, and its network allowlist does not reach `github.com` releases, so Task
12's `embedded` mode is the mode there; on a developer machine the default is
`docker`. The suite itself has no Docker dependency.

## Scenario roadmap

The inventory the track delivers, numbered so later tasks can reference it.
This task ships **1–8**; the rest is listed so the fixtures are designed for it.

| # | Area | Scenario | Task |
|---|---|---|---|
| 1 | Auth | Valid login lands on `/dashboard` | 11 |
| 2 | Auth | Invalid password shows the dictionary error, stays on `/login` | 11 |
| 3 | Auth | Sign out clears the session; `/dashboard` redirects to `/login` | 11 |
| 4 | Auth | Unauthenticated visit to a protected route redirects to `/login` | 11 |
| 5 | Auth | Forgot password accepts the form; the console mail driver logs the link | 11 |
| 6 | RBAC | A student visiting `/admin` is denied | 11 |
| 7 | RBAC | A `content_creator` sees no *Users* / *Levels* entry and gets `403` on `/admin/users` | 11 |
| 8 | Catalog | Admin creates a draft, publishes it, uploads a video; the student sees topic and media | 11 |
| 9 | Catalog | A draft is invisible to the student (list and direct URL → not found) | follow-up |
| 10 | Catalog | A `content_creator` cannot publish (publish gate) | follow-up |
| 11 | Catalog | Search finds a topic by title | follow-up |
| 12 | Catalog | Tag filter narrows the list | follow-up |
| 13 | Catalog | Video and PDF viewers open for seeded media | follow-up |
| 14 | Notes | Private note is invisible to a second student; shared note is visible | follow-up |
| 15 | Submissions | Upload a demonstration, open it, move it, delete it | follow-up |
| 16 | Comments | Post and read a comment thread | follow-up |
| 17 | Tasks | Task authoring → `/tasks` → detail → topic chip deep link | Task 10 |
| 18 | Missions | Join and leave an `open` mission; progress updates | follow-up |
| 19 | Progress | Enroll → consume → check in → dashboard 100 %; revoke hides the task | 11-progress |
| 20 | Events | Anonymous board lists only `public`; a `members` slug is `404` | follow-up |
| 21 | Events | The same `members` event opens for a logged-in student | follow-up |
| 22 | Events | Admin creates an event; it appears on the board | follow-up |
| 23 | SEO | `robots.txt`, `sitemap.xml` and `og:url` carry `NEXT_PUBLIC_SITE_URL` | follow-up |
| 24 | Admin | Create a user; reset their password through the modal | follow-up |
| 25 | Admin | The last active admin cannot be deleted or demoted | follow-up |
| 26 | Billing | Admin issues an invoice; the student sees it in the statement | follow-up |

Mobile-only scenarios M1–M12 live in Task 14. "follow-up" rows become one or
two further backlog tasks once this scaffold is merged; they are not part of
this task's acceptance.

## Delivery order

The six files of this track ship through one backlog candidate,
`feature/backlog/test-debt/e2e/candidate` (`make worktree-open KIND=backlog
TOPIC=test-debt FEATURE=e2e`), in this order: **12 → 13 → 11 → 14 → 10 →
11-progress**. 12 and 13 have no E2E dependency and can be verified on their
own; 11 is the first green run; 14 makes it green on every project; 10 and
11-progress add the journeys that were waiting.

## Scope

In:
- `e2e/` workspace: `package.json`, `playwright.config.ts`, `tsconfig.json`,
  `.env.e2e`, `global-setup.ts` / `global-teardown.ts`, `fixtures/`
  (`auth`, `api`, `nav`, `s3`), `specs/auth/*.spec.ts`,
  `specs/catalog/authoring-to-consumption.spec.ts` (scenarios 1–8).
- `pnpm-workspace.yaml` entry; root `.gitignore` entries for
  `e2e/playwright-report/`, `e2e/test-results/`, `e2e/.auth/`.
- `Makefile`: the `e2e*` targets in a new `##@ 🧪 LOCAL — end-to-end` block, and
  `e2e` wired into `help`.
- `.github/workflows/ci.yml`: the `e2e` job.
- `docs/onboarding.md`: an *End-to-end tests* section (how to run, the three
  projects, the S3 modes, where traces land, how to add a spec).
- `.envs.test.example`: the `QA_*` keys E2E honours, with placeholder values.

Out:
- Scenarios 9–26 and M1–M12 (Tasks 10, 11-progress, 14 and the follow-ups).
- WebKit / Firefox projects, visual snapshots, Lighthouse, axe-core scans.
- Any change under `apps/web/src/**` or `apps/api/src/**`: a missing accessible
  name found while writing a spec is filed as a frontend bug, not fixed here.
- Running E2E against staging or production — the suite only knows `localhost`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `e2e/**`
  - `pnpm-workspace.yaml`, `.gitignore`, `pnpm-lock.yaml`
  - `Makefile` (the `e2e*` block and the `help` wiring only)
  - `.github/workflows/ci.yml` (the `e2e` job only)
  - `docs/onboarding.md`, `.envs.test.example`
- No behaviour change: nothing under `apps/**` or `packages/**` is touched.
- Selectors are `getByRole` / `getByLabel` / `getByText` with names taken from
  `dict-pt.ts`; no CSS or XPath selectors, no `data-testid` added for this task.
- Each spec owns the data it creates (per-run suffix) and never depends on
  another spec's side effects; `fullyParallel: true` must stay on.
- The API is started with `--persist-to` on a temporary directory; a spec must
  never point wrangler at the developer's `.wrangler/state`.
- No credential beyond the documented seed accounts is read or written.

## Acceptance Criteria

- [ ] `make e2e` boots both servers from a clean checkout after `make setup`,
      runs scenarios 1–8 in the three projects and exits 0 locally.
- [ ] `make e2e-mobile` runs only the `mobile` project; scenarios 1–8 pass at
      412 px through the `nav` fixture with no viewport branch in any spec.
- [ ] Two consecutive runs leave no row in the developer's local replica and no
      file under `.wrangler/state` (the run dir is temporary and removed).
- [ ] With `E2E_S3_MODE=skip`, scenario 8 is reported as *skipped* with the
      reason text, never as passed.
- [ ] Breaking one accessible name in `dict-pt.ts` fails the suite at compile
      time (type error), not only at run time.
- [ ] The CI job `e2e` runs on a pull request, finishes under 6 minutes on
      `ubuntu-latest`, and a forced failure uploads a `playwright-report` artifact
      containing a trace.
- [ ] `docs/onboarding.md` tells a new developer how to run, filter and debug the
      suite in under one screen.
- [ ] `make lint` and `make test` green (unchanged suites).
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make setup && make e2e` — all projects green; then `make e2e-mobile` and
   `make e2e-tablet` individually.
2. `E2E_S3_MODE=skip make e2e-desktop` — the upload scenario is skipped with a
   reason in the report.
3. Break a selector on purpose (rename a dictionary key used by the login spec)
   and confirm a type error; revert. Break an assertion on purpose and confirm a
   trace is written under `e2e/test-results/`; revert.
4. Push a branch with a deliberately failing spec; confirm the `e2e` job is red
   and the artifact is attached. Revert, confirm green, read the job duration.
5. `make lint && make test` — unchanged.
6. `git diff --stat` confirms only scope-guardrail files changed.
