# Epic: End-to-end test phase — Playwright suite gating main

**Date:** 2026-09-29
**Status:** Draft
**Author:** raphaelsilva
**Derived from:** —
**Affected:**
- `e2e/` (new pnpm workspace — Playwright config, fixtures, page objects, specs)
- `pnpm-workspace.yaml`, `turbo.json` (register the workspace; `e2e` is **not** part of `turbo run test`)
- `Makefile` (new `e2e`, `e2e-ui`, `e2e-report`, `e2e-db-reset` targets — all local, per the naming rule)
- `apps/api/migrations/seed/0100_e2e_fixtures.sql` (new — deterministic E2E baseline on top of `0001_test_users.sql`)
- `apps/api/.dev.vars.e2e` (new, committed — non-secret E2E config: console mail, `COOKIE_SAMESITE=Lax`, loopback origins)
- `.github/workflows/e2e.yml` (new — runs the suite on every PR to `main`, uploads traces on failure)
- `.github/workflows/ci.yml` (no change to `verify`; `e2e` is a sibling required check)
- `apps/web/src/**` (only additive `aria-label`/role fixes where a flow has no accessible selector — no `data-testid` sweep)
- `docs/onboarding.md`, `CONTRIBUTING.md` (how to run, debug and add a spec)
- `docs/product/backlog/test-debt/10-e2e-task-flow.task.md`, `11-e2e-playwright-scaffold.task.md`, `11-e2e-progress-flow.task.md` (superseded by this epic)

> **Scope guardrail — read before opening any task.** This epic may touch the new
> `e2e/` workspace, `pnpm-workspace.yaml`, `turbo.json`, the `Makefile` (local `e2e*`
> targets only), `apps/api/.dev.vars.e2e`, `apps/api/migrations/seed/0100_e2e_fixtures.sql`,
> `.github/workflows/e2e.yml`, `scripts/doctor.sh`, `docs/onboarding.md`, `CONTRIBUTING.md`
> and the three `docs/product/backlog/test-debt/*e2e*` tasks; in `apps/web/src/**` it may
> only add accessible names (`aria-label`, roles) a journey needs. It is **not** an
> opportunity to: test against staging or production, drive a real Google OAuth consent
> or real e-mail delivery, add visual-regression / axe / performance checks, run the
> cross-browser matrix on PRs, move assertions out of the Vitest suites, or change
> production behaviour to make a test easier. If a refactor opportunity is spotted
> outside this scope, file a separate task — do not bundle it.

---

## Summary

Add an **end-to-end test phase** to the delivery pipeline: a root-level Playwright workspace
(`e2e/`) that boots the real stack locally — `wrangler dev` (API, local D1/KV/R2 via Miniflare)
and the Next.js production build — seeds a deterministic baseline, and drives the critical user
journeys through a real browser. It runs with `make e2e` on a developer machine and as a
**required `e2e` check on every PR to `main`**, so a change that compiles and passes unit tests
but breaks a journey (login, catalog, task check-in, the public events board, the admin backoffice)
can no longer reach staging. The suite is deliberately small (≈10 journeys, < 5 min in CI) and
never touches a deployed environment: E2E here means *whole stack, locally*, not "tests against
staging".

## Motivation

Today every layer is tested in isolation, and nothing tests them together:

| Failure mode | Caught today? | With this epic |
|---|---|---|
| API contract drifts from what a page actually sends | Partly — `oasdiff` flags *breaking* spec changes, not a page that sends the wrong body | Journey fails at the form submit |
| Refresh-token cookie not stored/sent (SameSite, CORS, `credentials`) | No — Vitest in Workers pool has no browser cookie jar | Login → wait → navigate journey |
| Protected route renders for the wrong role / RBAC nav regression | Component tests mock the auth context | Role-matrix spec with real tokens |
| Server-rendered public events page fetches with the wrong base URL | No | Anonymous events journey |
| i18n key renders as the raw key on a real page | `check-i18n-coverage.js` checks presence, not rendering | Assertions are on visible text |
| Migration + seed leave the app unusable | No | Suite boots from a fresh local D1 every run |
| Media presign → PUT → finalize lifecycle broken in the browser | No — needs real R2 credentials locally | Uploader journey with an intercepted PUT (§4.6) |

The backlog already asked for this three times (`test-debt/11-e2e-playwright-scaffold`,
`10-e2e-task-flow`, `11-e2e-progress-flow`), deferred on 2026-04-29 "until after UX review to
avoid rework". The catalog (M11), dashboard and events board (M20) have since stabilised, and
upcoming work — notes (RFC 0016), event extras (RFC 0015), billing (RFC 0013) — adds
multi-role flows whose value is exactly the cross-layer behaviour unit tests cannot see.
Those three tasks also assumed an infrastructure (`e2e/`, `e2e.yml`, `make e2e`) that was never
built; this epic designs it once and folds them in.

## Goals & Non-Goals

**Goals**
- A reproducible local E2E run: `make e2e` from a clean checkout after `make setup`, no Cloudflare
  account, no network beyond package install.
- A required `e2e` status check on PRs to `main`, with traces, screenshots and videos uploaded on
  failure.
- Deterministic data: a fresh local D1 per run, seeded baseline + per-test data created through the
  **public API** (never raw SQL from a spec).
- A thin, typed fixture layer (`asAdmin`, `asStudent`, `api.createTopic(...)`) and page objects
  that later milestones extend — every new user-facing milestone ships its journey spec.
- Coverage of ~10 critical journeys (§4.8), with an explicit time budget.

**Non-Goals**
- **Tests against staging or production.** A post-deploy smoke run is a separate, later concern
  (Alternatives §4); nothing in this epic holds credentials to a deployed environment.
- Google OAuth end-to-end (a real third-party consent screen) — covered by API unit tests; the
  callback page is exercised with a stubbed API response at most.
- Real e-mail delivery (Resend). Mail runs with `MAIL_DRIVER=console`; the suite reads the link
  from the API log (§4.5).
- Visual regression / pixel diffing, accessibility audits (axe) and performance budgets — possible
  follow-ups once the suite is stable.
- Cross-browser matrix on every PR. Chromium only on PRs; Firefox/WebKit on a nightly schedule
  (task 09).
- White-label brands other than the stock build on PRs (the nightly job may add `budo`).
- Replacing Vitest suites. E2E adds a layer; it does not move assertions out of unit tests.

## Current State (for reference)

- **Tests.** `make test` = `test-scripts` (node:test) + `turbo run test` → `apps/api` Vitest in the
  Workers pool (`apps/api/vitest.config.mts`) and `apps/web` Vitest + JSDOM
  (`apps/web/vitest.config.ts`, preceded by `scripts/check-i18n-coverage.js`). No browser runner
  exists anywhere in the repo.
- **CI.** `.github/workflows/ci.yml` has a single `verify` job: lint → build → test → OpenAPI
  freshness → generated types freshness → `oasdiff` on PRs. `deploy-api.yml` / `deploy-web.yml`
  deploy on push to `main`.
- **Local stack.** `make setup` creates `apps/api/.dev.vars` and `apps/web/.env.local`, migrates
  and seeds the local D1 (`db-seed-local`: `0001_test_users.sql`, `0002_billing_local.sql`,
  `0003_events_local.sql`). Seeded accounts: `admin@arenaquest.dev`, `student@arenaquest.dev`,
  `professor@arenaquest.dev` (passwords in the seed header).
- **Auth in the browser.** Access token in memory + refresh token in an httpOnly cookie;
  `COOKIE_SAMESITE=Lax` is required over plain `http://localhost` (`apps/api/.dev.vars.example`).
  The login limiter only counts failures and resets on success
  (`apps/api/src/routes/auth/login.ts:138-161`), so repeated successful logins do not trip it.
- **Media.** `R2StorageAdapter` presigns uploads against the real S3 endpoint
  (`apps/api/src/adapters/storage/r2-storage-adapter.ts:12`) but finalize checks the object through
  the **binding** (`headObject` → `this.bucket.head`, line 109–110), which locally is Miniflare's R2.
  `setup-local.sh:165` already warns that upload needs real credentials.
- **Mail.** `MAIL_DRIVER=console` writes activation/reset links to the Wrangler stdout.
- **Selectors.** Components use Tailwind classes and no `data-testid`; most controls have visible
  text or labels, so `getByRole`/`getByLabel` is viable.

## Proposed Approach

### 1. Workspace layout

```
e2e/
  package.json               # @arenaquest/e2e — @playwright/test, dotenv; no app deps
  playwright.config.ts
  global-setup.ts            # reset D1, migrate, seed, log in each role → storageState
  fixtures/
    test.ts                  # extended `test` with api / asAdmin / asStudent / uniq
    api-client.ts            # typed over apps/web/src/lib/api-types.gen.ts
    mail.ts                  # reads the console-mail log (§4.5)
    r2.ts                    # intercepted-PUT → local R2 writer (§4.6)
  pages/                     # page objects: LoginPage, CatalogPage, TopicPage, TasksPage, ...
  specs/
    smoke/                   # @smoke — the always-on PR set
    auth/ catalog/ tasks/ progress/ events/ admin/ billing/
  .auth/                     # storageState per role (gitignored)
```

`e2e` is a pnpm workspace so it shares the lockfile, but it is **excluded from `turbo run test`**:
unit tests must stay fast and dependency-free, and E2E needs running servers.

### 2. Booting the stack

`playwright.config.ts` owns the servers through `webServer` (one entry each), so `make e2e` is one
command and Playwright tears everything down:

```ts
webServer: [
  {
    command: 'pnpm --filter api exec wrangler dev --port 8787 --env-file .dev.vars.e2e --persist-to ../../e2e/.state',
    url: 'http://localhost:8787/health',   // existing route: apps/api/src/routes/public/health.ts
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',          // captured for the mail reader (§4.5)
  },
  {
    command: 'pnpm --filter web build && pnpm --filter web start --port 3000',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    env: { NEXT_PUBLIC_API_URL: 'http://localhost:8787', NEXT_PUBLIC_LANGUAGE: 'en',
           NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' },
  },
],
```

- **Production build, not `next dev`**: on-demand compilation makes the first hit of each route
  take seconds and is the main source of E2E flakiness. Locally `reuseExistingServer` lets a
  developer point the suite at an already-running `make dev` for fast iteration.
- **`--persist-to e2e/.state`** isolates E2E's D1/KV/R2 from the developer's `make dev` replica,
  so running the suite never wipes local data.
- **English build** (`NEXT_PUBLIC_LANGUAGE=en`): assertions read naturally and `dict-en`/`dict-pt`
  parity is already enforced by the i18n check. A single nightly `pt` run guards the default build.
- The next-on-pages build (`pages:build`) is **not** used on PRs — it needs the Pages runtime and
  adds minutes; `deploy-web.yml` keeps building it. Divergence between `next start` and
  next-on-pages is accepted and noted in Risks.

### 3. Data strategy

Three tiers, cheapest first:

1. **Fresh database per run.** `global-setup.ts` deletes `e2e/.state`, runs
   `wrangler d1 migrations apply --local --persist-to e2e/.state`, then executes the existing seeds
   plus `0100_e2e_fixtures.sql` (additional stable accounts: a second student with no enrollments,
   a `content_creator`, an `inactive` user). This also turns "migrations + seed boot an empty D1"
   into a tested property.
2. **Per-test data through the public API.** Specs create what they assert on
   (`api.createTopic({ title: uniq('Topic') })`) using the same endpoints the backoffice uses. The
   `uniq()` helper suffixes titles with the worker index + a short random id, so specs are
   parallel-safe without cleanup and the suite never depends on test order.
3. **No SQL from specs.** If a state is unreachable through the API, that is a finding (the product
   has no way to reach it either), not a reason to write to D1 directly.

Topic creation stays **sequential within a spec** (`D1TopicNodeRepository.create` derives
`sort_order` from a non-transactional `MAX`, see CLAUDE.md); parallelism is across spec files,
each owning its own subtree.

### 4. Fixtures

#### 4.1 Authentication
`global-setup` logs in once per role through the **UI** (so the login page itself is exercised),
saves `storageState` to `e2e/.auth/<role>.json`, and specs opt in:

```ts
test.use({ storageState: roles.student });
```

Because the access token is in memory and only the refresh cookie persists, a stored state
re-authenticates via the silent refresh on first navigation — which is exactly the path the
cookie regressions in §Motivation break.

#### 4.2 API client
`fixtures/api-client.ts` is a small `fetch` wrapper typed with `apps/web/src/lib/api-types.gen.ts`
(already kept fresh by CI). It logs in with the role's credentials, keeps its own bearer token, and
exposes only the seeding operations specs need (`createTopic`, `publishTopic`, `createTask`,
`addStage`, `linkTopics`, `grantAccess`, `createEvent`, ...). Its paths come from the generated
types, so an API rename fails `tsc` in `e2e/` rather than at runtime.

#### 4.3 Page objects
One class per page under test, exposing intent (`catalog.openTopic(title)`), built on
`getByRole` / `getByLabel` / `getByText`. `data-testid` is allowed only where no accessible
selector exists, and adding a missing `aria-label` is preferred — it fixes accessibility at the
same time.

#### 4.4 Test isolation
`fullyParallel: true`, `workers: 2` in CI (4 locally). Each spec file owns its data (§3.2). The
three shared accounts are read-only for specs that mutate *account* state (password reset,
deactivation) — those specs create their own user via the admin API.

#### 4.5 Mail
`.dev.vars.e2e` sets `MAIL_DRIVER=console`. `webServer.stdout: 'pipe'` plus a small log sink writes
the API output to `e2e/.state/api.log`; `mail.waitForLink(email, /activate\?token=/)` polls that
file. No new mail adapter, no production code path changes.

#### 4.6 Media uploads without R2 credentials
The uploader journey stays hermetic by intercepting the presigned PUT in the browser:

```ts
await page.route(/r2\.cloudflarestorage\.com/, async (route) => {
  await r2.putLocal(keyFrom(route.request().url()), route.request().postDataBuffer());
  await route.fulfill({ status: 200 });
});
```

`r2.putLocal` writes the bytes into the **same** Miniflare R2 store the API's binding reads
(`wrangler r2 object put --local --persist-to e2e/.state`), so the subsequent *finalize*
(`bucket.head`) sees a real object with the right size and content type. The presign, the browser
upload code, finalize and the viewer are all real; only the network hop to Cloudflare is replaced.

#### 4.7 Diagnostics
`trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`, `video: 'retain-on-failure'`,
`retries: 1` in CI (0 locally). A test that only passes on retry is reported as **flaky** in the
HTML report and tracked (§Tradeoffs) — retries exist to collect a trace, not to hide failures.

### 5. Journey inventory (the initial suite)

| # | Journey | Roles | Tag | Absorbs |
|---|---|---|---|---|
| J1 | Login, silent refresh after reload, logout; wrong password shows error | student | `@smoke` | — |
| J2 | RBAC: student cannot reach `/admin/*`; admin nav shows backoffice | student, admin | `@smoke` | — |
| J3 | Register → activation link from console mail → first login | anonymous | | — |
| J4 | Forgot password → reset link → login with the new password | anonymous | | — |
| J5 | Admin authors a topic tree + Markdown content, publishes; student sees it in `/catalog` | admin, student | `@smoke` | test-debt 11 (scaffold) |
| J6 | Admin uploads media to a topic (intercepted PUT); student opens the viewer | admin, student | | test-debt 11 (scaffold) |
| J7 | Admin builds a task with stages linked to topics; student opens it and follows a topic chip to `/catalog/:id` | admin, student | | test-debt 10 |
| J8 | Enrollment: before grant the task is hidden; after grant the student checks in every stage; dashboard shows 100%; revoke hides it again | admin, student | | test-debt 11 (progress) |
| J9 | Events board: anonymous sees only `public` events, `members` event 404s anonymously and renders logged in; flyer loads | anonymous, student | `@smoke` | — |
| J10 | Admin user management: create user, deactivate, last-admin lockout guard message | admin | | — |

Billing (RFC 0013), notes (RFC 0016) and event extras (RFC 0015) add their journey as part of
their own milestones (§6).

### 6. Process: the E2E phase in the delivery flow

- **Definition of Done.** A milestone or epic that adds or changes a user-facing flow ships (or updates)
  its journey spec. `write-tasks` gains a convention: the last task of such a milestone or epic is
  `NN-e2e-<journey>.task.md`.
- **Order in CI.** `verify` (lint/build/unit) and `e2e` run in parallel; both are required checks
  on `main`. A red `e2e` blocks merge exactly like a red unit test.
- **`qa-tester` skill.** Stays the manual, exploratory counterpart. When a QA run finds a bug in a
  golden path, the fix PR adds the regression as an E2E spec.

### 7. CI workflow (`.github/workflows/e2e.yml`)

```yaml
on: { pull_request: { branches: [main] }, push: { branches: [main] }, schedule: [{ cron: '17 5 * * *' }] }
jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - checkout · pnpm · node 20 (cache pnpm) · pnpm install --frozen-lockfile
      - cache ~/.cache/ms-playwright keyed on the @playwright/test version
      - pnpm --filter @arenaquest/e2e exec playwright install --with-deps chromium
      - make e2e CI=1              # PR/push: chromium, all specs
      - upload-artifact playwright-report/ + test-results/ (if: failure())
```

The nightly schedule adds `firefox`/`webkit` projects and the `pt` build, and reports without
blocking anyone. No Cloudflare secret is exposed to this workflow.

### 8. Makefile

```make
e2e:          ## Run the E2E suite against a fresh local stack (Playwright)
e2e-ui:       ## Same, in Playwright UI mode (debug)
e2e-smoke:    ## Only @smoke journeys
e2e-report:   ## Open the last HTML report
e2e-db-reset: ## Delete e2e/.state (the E2E-only local D1/KV/R2)
```

All unsuffixed → local, per the Makefile naming rule. `make doctor` learns to report a missing
Playwright browser as a soft gap (exit 2).

### 9. Alternatives considered

1. **Cypress.** Mature, but single-tab/same-origin constraints fit poorly with web (:3000) ↔ API
   (:8787) and the anonymous-vs-authenticated contexts J9 needs; parallelism is paid (Dashboard).
   Playwright gives multi-context, `storageState`, network interception (needed for §4.6) and
   traces for free. **Rejected.**
2. **Run E2E against staging after deploy.** Tests the real Cloudflare runtime (incl.
   next-on-pages), but only *after* the merge — a failure means main and staging are already
   broken — needs deployed-environment credentials in CI, and shared staging data makes specs
   order-dependent. **Deferred, not rejected**: a read-only post-deploy smoke (J1, J9) is a good
   follow-up epic once this suite exists.
3. **`next dev` instead of a production build.** Faster to start, but per-route compilation causes
   timeouts and flakiness, and it doesn't match what ships. **Rejected** for CI; kept as the
   local `reuseExistingServer` option.
4. **Seed everything through SQL fixtures.** Faster than API calls, but it bypasses validation and
   business rules (a fixture can create states the product cannot) and duplicates schema knowledge
   into specs that break on every migration. **Rejected** beyond the small stable baseline (§3.1).
5. **Mock the API (MSW) and test only the web.** That is a component/integration test, which
   `apps/web` Vitest already does; it cannot catch cookie, CORS or contract drift. **Rejected.**
6. **Real R2 credentials in CI for media.** Would test the actual presigned PUT, but puts a
   Cloudflare secret in PR workflows (including forks) and makes the suite network-dependent.
   **Rejected** in favour of §4.6.
7. **Keep the three backlog tasks as they are.** They assume infrastructure that doesn't exist and
   have no data, auth or mail strategy. **Superseded** by this epic.

## Task Breakdown

Tasks live next to this file as `NN-<slug>.task.md`. Waves follow the phases
below; each wave is shippable on its own. Total **~7 dev days**.

| # | Task | Team | Depends on | Status |
|---|---|---|---|---|
| 01 | E2E workspace, stack boot and fresh-D1 global setup (`e2e/`, `.dev.vars.e2e`, `0100_e2e_fixtures.sql`, Makefile targets) | infra | — | 📝 Open |
| 02 | Fixtures (role `storageState`, typed API client, `uniq()`) and page objects for login / catalog / events | frontend | 01 | 📝 Open |
| 03 | Smoke journeys J1, J2, J5, J9 (`@smoke`) + missing `aria-label`s they need | frontend | 02 | 📝 Open |
| 04 | CI gate: `.github/workflows/e2e.yml`, browser cache, failure artifacts, required check | infra | 03 | 📝 Open |
| 05 | Console-mail reader + journeys J3 (register → activate) and J4 (password reset) | frontend | 02 | 📝 Open |
| 06 | Local-R2 PUT interception + journey J6 (media upload → viewer) | frontend | 02 | 📝 Open |
| 07 | Journeys J7 (task authoring → student) and J8 (enrollment → check-in → dashboard); close the three `test-debt` tasks | frontend | 02 | 📝 Open |
| 08 | Journey J10 (admin user management, last-admin guard) | frontend | 02 | 📝 Open |
| 09 | Hardening & process: nightly Firefox/WebKit + `pt` run, flaky tracking, `make doctor` check, docs, E2E-task convention | infra | 04 | 📝 Open |

**Waves**
- **Wave 0 — Workspace & boot (~1.5 d):** 01. Exit: an empty spec opening `/` passes via `make e2e`.
- **Wave 1 — Fixtures & smoke (~1.5 d):** 02 → 03. Exit: smoke suite green locally in < 90 s.
- **Wave 2 — CI gate (~0.5 d):** 04. Exit: a PR with a deliberately broken selector fails with a downloadable trace.
- **Wave 3 — Core journeys (~2.5 d):** 05, 06, 07, 08 in parallel.
- **Wave 4 — Hardening & process (~1 d):** 09.

## Acceptance Criteria

- [ ] `make setup && make e2e` passes on a clean checkout with no Cloudflare login (tasks 01–03).
- [ ] `e2e` is a required check on `main`; a PR that breaks J1–J10 cannot merge (task 04).
- [ ] A failed CI run exposes a Playwright trace, screenshot and video as artifacts (task 04).
- [ ] All ten journeys in §5 are green; the PR run takes < 5 min, `@smoke` < 90 s (tasks 05–08).
- [ ] Flake rate < 2 % of runs over the first month, measured from the report's flaky count (task 09).
- [ ] The next user-facing milestone after this epic (e.g. M21 notes) ships its own journey spec
  without changing `e2e/fixtures` beyond adding API operations (task 09).

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| Flaky tests erode trust and get ignored | Production build, API seeding, web-first assertions (`expect(...).toBeVisible()`, no fixed sleeps), `retries: 1` only to capture a trace; any test flagged flaky twice in a week is fixed or quarantined **with an issue**, never silently skipped |
| CI time grows with every milestone | Budget: PR run < 5 min, `@smoke` < 90 s; parallel workers; journeys, not permutations — edge cases stay in unit tests |
| `next start` ≠ next-on-pages runtime in production | Accepted for PRs; the deferred post-deploy smoke (Alt. §2) closes the gap on staging |
| Miniflare D1/R2 ≠ Cloudflare | Same trade already accepted by the API Vitest pool; runtime drift is a staging concern |
| Selectors break on UX redesigns | Semantic selectors + page objects isolate changes to one file; redesign PRs update their page object |
| Parsing Wrangler stdout for mail is brittle | The console adapter's line format becomes a tested contract (a unit test pins it); fallback is an E2E-only mail sink behind `MAIL_DRIVER=file` if it proves fragile |
| Seeded account passwords in repo | Already public in `0001_test_users.sql` and local-only; `check-no-dev-seed.ts` derives its matcher from every `migrations/seed/*.sql`, so `0100_e2e_fixtures.sql` is guarded out of deploys automatically |
| Suite cost of the `pt`/brand/browser matrix | Only nightly, non-blocking |

## Open Questions

- **Web build on PRs** — reuse the `verify` job's `.next` via artifact, or build again in `e2e`?
  Rebuilding is simpler; artifact reuse saves ~1 min. Owner: raphaelsilva.
- **Brand under test** — stock `arenaquest` only on PRs, or also `budo` (the tenant with real
  content) nightly? Owner: product owner.
- **Quarantine mechanism** — `test.fixme` with a linked issue vs. a separate `@quarantine` project
  that runs but does not block. Owner: raphaelsilva.

## References

- Relevant code: `apps/api/src/routes/public/health.ts`, `apps/api/scripts/check-no-dev-seed.ts:33`,
  `apps/api/src/adapters/storage/r2-storage-adapter.ts:12,109`,
  `apps/api/src/routes/auth/login.ts:138`, `apps/api/.dev.vars.example`,
  `apps/api/migrations/seed/0001_test_users.sql`, `.github/workflows/ci.yml`,
  `scripts/setup-local.sh:165`
- Backlog superseded: `docs/product/backlog/test-debt/11-e2e-playwright-scaffold.task.md`,
  `10-e2e-task-flow.task.md`, `11-e2e-progress-flow.task.md`
- Manual QA counterpart: `.agents/skills/qa-tester/SKILL.md`
- Related RFCs: RFC 0001 (API test-suite optimization — the unit layer this complements),
  RFC 0013 / 0015 / 0016 (next features that will add journeys)
