# Milestone 26 — Release-candidate previews and demo seed

**Status:** 📝 Draft
**Scope:** `scripts/demo/` (new), `scripts/db/` (new), `scripts/deploy/core.mjs`, `scripts/cloudflare/{deploy,provision-label}.mjs`, `scripts/label.mjs`, `apps/api/scripts/check-no-dev-seed.ts`, `apps/api/wrangler.jsonc`, `config/labels/*.jsonc`, `.github/workflows/`, `Makefile`, one web banner component, `docs/onboarding.md`. Derived from [RFC 0021](../../RFCs/0021-release-candidate-previews-and-demo-seed.md).

> **Hard scope guardrail — read before opening any task.** This milestone may touch
> only: the new `scripts/demo/**` (seed CLI, `ids.mjs`, `dataset/`), the new
> `scripts/db/{reset-remote,check-migrations}.mjs`, the deploy/provisioning tooling
> (`scripts/deploy/core.mjs`, `scripts/cloudflare/deploy.mjs`,
> `scripts/cloudflare/provision-label.mjs`, `scripts/label.mjs`),
> `apps/api/scripts/check-no-dev-seed.ts`, the generated blocks of
> `apps/api/wrangler.jsonc`, `config/labels/*.jsonc` (staging `mail.driver` and the
> spaziord staging `webOrigin` only), `.github/workflows/{ci,deploy-api,deploy-web,preview-candidate}.yml`,
> the `Makefile`, the wrangler version in `apps/{api,web}/package.json` (+ lockfile),
> the preview banner in `apps/web` (one component, its mount point and both
> dictionaries), a demo-seed test, and `docs/onboarding.md` / `CLAUDE.md` runbook
> text. It is **not** an opportunity to: add a third persistent environment
> (`rc`/`preview`/`qa`) or any new D1/KV/R2/Pages resource; give a preview its own
> database; make Google OAuth work on previews; build a production-clone /
> anonymisation pipeline; change XP rules (`xp-config.ts`), quest/badge definitions or
> any migration's schema; change API routes, controllers or repositories; or trigger
> previews automatically on push. If a refactor opportunity is spotted outside this
> scope, file a separate task — do not bundle it.

---

## 1. Objectives

- **A candidate is testable on real URLs without a new environment.**
  `make deploy-preview-staging LABEL=x CANDIDATE=m21` publishes a Workers Preview of
  the label's staging API and a Pages branch deployment of its staging web, both bound
  to staging's D1/KV/R2, and prints both links.
- **Previews cannot break live staging through the schema.** Migrations added by a
  PR are additive (expand/contract) and applied migrations are frozen, enforced by a
  lint in CI and in the preview CLI; a Time Travel bookmark is recorded before every
  preview migration.
- **Any local or staging D1 becomes a faithful demo in one command.** `seed-demo`
  writes the baseline dataset (users per role, 3×3-level topic trees, markdown, media,
  gamification) plus events, billing, tasks and comments, idempotently.
- **Staging is disposable.** `make db-reset-staging LABEL=x` wipes the database in
  place, re-applies migrations and re-seeds the demo, keeping the `database_id`.
- **Demo data can never reach production.** The seed refuses production targets and
  the no-dev-seed guard recognises demo accounts before every production deploy.
- **Staging sends no real e-mail.** Every staging profile uses the console mail driver.

Out of scope (explicit, from RFC 0021 Non-Goals):
- **A third persistent environment** — rejected in RFC 0021 *Alternatives 1*; it costs
  a D1 per label against the free tier.
- **Per-preview data isolation** — rejected (*Alternatives 2*); the Time Travel
  bookmark and `db-reset-staging` are the recovery path.
- **Google OAuth on previews** — deferred (RFC OQ4); a fixed preview name would be
  registered only when a candidate needs it.
- **Production clone / anonymisation** — deferred (*Alternatives 6*), a possible later
  demo source.
- **Changing XP rules** — the demo seeds state against the existing
  `packages/shared/domain/gamification/xp-config.ts`.
- **Automatic previews on push** — decided against (RFC OQ1); previews are manual.

---

## 2. Functional Requirements

**Previews**
- `deploy.mjs --label <l> -e staging --preview <name>` (and
  `make deploy-preview-staging LABEL= CANDIDATE=`) runs, in order: guard →
  migration lint → Time Travel bookmark → migrate staging D1 → `wrangler preview --env
  <l>-staging --name <name>` → web build with `NEXT_PUBLIC_API_URL` = the captured
  Preview URL and `NEXT_PUBLIC_SITE_URL=https://<name>.<webOrigin>` → `pages deploy
  --branch <name>` → prints web URL, API URL and bookmark.
- `--preview` is rejected with `-e production`; `<name>` must match `[a-z0-9-]{1,20}`
  and defaults to the milestone from `feature/m<N>/candidate` (`m<N>`).
- Each `<label>-staging` wrangler env has a generated `previews` block binding the same
  staging D1, KV and R2 and the staging vars (plus `APP_PREVIEW=1`); no cron in it.
- The staging live Worker and Pages production branch are not changed by a preview.
- `make preview-delete-staging LABEL= CANDIDATE=` deletes the Worker preview and the
  Pages branch deployments.
- `.github/workflows/preview-candidate.yml` is `workflow_dispatch` only, inputs `label`
  (a label or `all`) and `candidate`, and calls the same CLI.
- The web shows a banner `preview <name> · <short sha>` when built as a preview; its
  strings live in both dictionaries.
- `WEB_BASE_URL` in the preview is the staging web origin.

**Migrations**
- `scripts/db/check-migrations.mjs` fails when a migration file not on `origin/main`
  contains `DROP`, `RENAME`, or a table rebuild, unless it carries a
  `-- @contract: <reason>` header; it also fails when a migration already on
  `origin/main` is modified. It runs in `ci.yml` and in the preview plan.

**Demo seed**
- `seed-demo.mjs --label <l> -e local|staging [--dry-run] [--yes]` (and
  `make db-seed-demo-local` / `db-seed-demo-staging`) resolves targets from the label
  profile, refuses `-e production` and any D1/bucket listed in a production block,
  and prompts before a remote write.
- All ids are UUIDv5 derived from `<label>:<entity>:<key>`; all writes are
  `INSERT … ON CONFLICT(id) DO UPDATE`; a second run leaves row counts unchanged.
- Passwords come from `AQ_DEMO_PASSWORD` (environment only) and are hashed with the
  `JwtAuthAdapter` PBKDF2 format; timestamps are relative to the run time.
- Dataset: admin, content_creator, tutor and 3 students (`demo.<key>@<label>.demo.invalid`);
  group *Demo class*; 3 roots × (2 modules × 2 lessons) = 21 published topics with
  public / group-granted / user-granted roots, one private lesson and one draft module;
  tags `demo`, `beginner`; every topic's content is the basic-syntax markdown sample
  run through `sanitizeMarkdown`.
- Every topic has ≥ 1 `ready` media whose object exists at
  `topics/<topicId>/<mediaId>-<name>`; objects are reused when present, otherwise taken
  from a SHA-256-pinned CC0 manifest via a local cache, validated by
  `validateMediaFile`, and uploaded with `wrangler r2 object put`.
- Gamification: student-1 at 350 XP (level 3) with *alicerce-solido*, a 3-day streak and
  `weekly-topic` 1/2; student-2 at 950 XP (one completion from level 5); student-3 empty;
  one active mission rewarding *tecnica-afiada*; `user_xp` equals the sum of
  `xp_events`; idempotency keys follow `<kind>:<sourceId>:v1`.
- Extensions: one event per audience (past + upcoming), a monthly and a free plan with
  two subscriptions (one invoice paid, one open), one task with three stages linked to
  Root 1 lessons, one comment thread with a reply and a like.

**Guard and reset**
- `check-no-dev-seed.ts` also matches demo user ids for every label and the
  `*.demo.invalid` e-mail domain, enforced for production targets (staging may hold the
  demo; its deploys keep the dev-seed check only).
- `make db-reset-staging LABEL=` (confirms, naming the database) records a bookmark,
  drops every non-`sqlite_%`/`_cf_%` table including `d1_migrations`, re-applies
  migrations and runs the demo seed; the `database_id` is unchanged.

**Profiles and CI**
- Staging profiles use `mail.driver: "console"`; spaziord staging `webOrigin` is its
  Pages host; wrangler is `>= 4.135`; the staging deploy jobs go through the deploy CLI.

---

## 3. Acceptance Criteria

- [ ] `make db-seed-demo-local LABEL=budo` on a fresh replica yields 6 demo users,
      21 topics, ≥ 21 `ready` media with existing objects, and student-1 `user_xp = 350`;
      a second run changes no row count.
- [ ] `seed-demo.mjs -e production` and a run targeting a production D1 name exit
      non-zero before any write.
- [ ] The guard exits non-zero against a D1 that holds any demo user (test fixture).
- [ ] A CI job applies every migration to a local D1 and runs the seed twice; it
      fails if a migration breaks the seed.
- [ ] `make db-reset-staging LABEL=budo` leaves the same `database_id`, every migration
      applied and the demo loaded.
- [ ] `check-migrations.mjs` fails on a new `DROP COLUMN` migration and passes it with
      `-- @contract:`; it fails when a migration on `origin/main` is edited.
- [ ] `make deploy-preview-staging LABEL=budo CANDIDATE=m21` prints a web and an API URL;
      `demo.admin` logs in on the web preview (CORS + cookie OK), media play, and the
      staging live URLs still serve the previous version.
- [ ] `node scripts/label.mjs` coherence check passes for every label with the
      generated `previews` blocks; production blocks keep exact-origin CORS.
- [ ] A password reset requested on staging makes no Resend call and the link is in
      `wrangler tail`.
- [ ] The events board, billing page, task stage check-in (+20 XP) and comment thread
      work for the matching demo users.
- [ ] `make lint`, `make test-api` and `make test-web` pass; `check-i18n-coverage.js`
      passes with the banner strings.
- [ ] No diff outside the files named in the guardrail.

---

## 4. Specific Stack

- **Tooling (the bulk of this milestone):** Node ≥ 22 ESM scripts, stdlib only (as the
  deploy CLI), driving `wrangler` — `d1 execute --file`, `d1 migrations apply`,
  `d1 time-travel info|restore`, `preview` / `preview delete` /
  `preview base-config secret put`, `r2 object put|get`, `pages deploy --branch`.
  Wrangler `>= 4.135.0` (Workers Previews).
- **Shared:** reads `packages/shared/domain/media/limits.ts` (via the importer's
  `validateMediaFile`) and `utils/sanitize-markdown.ts`; no port or type changes.
- **Backend:** no route/controller change. `apps/api/scripts/check-no-dev-seed.ts`
  (tsx) gains the demo matcher; the PBKDF2 hash format is the one in
  `src/adapters/auth/jwt-auth-adapter.ts`.
- **Frontend:** one Next.js 15 client component (preview banner) behind
  `NEXT_PUBLIC_PREVIEW_NAME`; keys in `dict-en.ts` and `dict-pt.ts`.
- **CI:** GitHub Actions; `preview-candidate.yml` is `workflow_dispatch`; credentials
  `CF_API_TOKEN` + `CF_ACCOUNT_ID` as today.
- **Tests:** Node test runner / Vitest for the pure planners (id derivation, SQL
  builder, migration lint, plan builder); a local-D1 seed integration job in CI.

---

## 5. Task Breakdown

| # | Task File | Phase | Team | Status |
|---|-----------|-------|------|--------|
| 01 | [Wrangler ≥ 4.135 and staging deploys through the CLI](./01-wrangler-bump-and-staging-ci-via-cli.task.md) | 0 | Backend | ✅ Done |
| 02 | [Staging profiles: console mail driver and spaziord webOrigin](./02-staging-profile-mail-and-origin.task.md) | 0 | Backend | ✅ Done |
| 03 | [Demo ids and baseline dataset](./03-demo-ids-and-dataset.task.md) | 1 | Backend | ✅ Done |
| 04 | [Seed CLI: users, groups, topics, enrollments, tags](./04-seed-demo-cli-core.task.md) | 1 | Backend | ✅ Done |
| 05 | [Seed media: manifest, cache, R2 upload](./05-seed-demo-media.task.md) | 1 | Backend | ✅ Done |
| 06 | [Seed gamification state](./06-seed-demo-gamification.task.md) | 1 | Backend | ✅ Done |
| 07 | [Guard recognises demo accounts](./07-guard-demo-accounts.task.md) | 1 | Backend | ☐ Open |
| 08 | [Demo seed CI job and Makefile targets](./08-demo-seed-ci-and-make.task.md) | 1 | Backend | ☐ Open |
| 09 | [Disposable staging: db-reset-staging](./09-db-reset-staging.task.md) | 2 | Backend | ☐ Open |
| 10 | [Migration lint: additive and frozen](./10-migration-lint.task.md) | 3 | Backend | ☐ Open |
| 11 | [Generated `previews` blocks and preview secrets](./11-wrangler-previews-block.task.md) | 3 | Backend | ☐ Open |
| 12 | [Deploy CLI `--preview` mode, Make targets and workflow](./12-deploy-cli-preview-mode.task.md) | 3 | Backend | ☐ Open |
| 13 | [Preview banner](./13-preview-banner-frontend.task.md) | 3 | Frontend | ☐ Open |
| 14 | [Demo extensions: events, billing, tasks, comments](./14-seed-demo-extensions.task.md) | 4 | Backend | ☐ Open |

Dependency graph:

```
01 ──► 11 ──► 12 ──► 13
02 ─────────► 12
10 ─────────► 12
03 ──► 04 ──► 05
        │ └──► 06
        │ └──► 14
        └────► 07
04,05,06,07 ──► 08 ──► 09
               08 ──► 14
```

**Recommended execution order:** `01` → `02` → `03` → `04` → `05` → `06` → `07` →
`08` → `09` → `10` → `11` → `12` → `13` → `14`. Phases 0–2 alone already give a
disposable, demo-loaded staging; Phase 3 adds previews on top.

Each task is intended to land as an independent PR with `make lint`,
`make test-api`, and `make test-web` passing.

---

## 6. Decisions recorded (from RFC 0021 "Resolved Decisions")

1. **No third environment** — previews run on the label's staging D1/KV/R2 to stay
   within the free tier; rules out new resources in any task.
2. **Previews are named after the candidate** (`m21`), not a fixed `rc` slot — Google
   login is not needed on previews.
3. **Staging is disposable** — recovery is wipe → migrations → demo, not a database
   per candidate; the wipe is in place so the `database_id` never changes.
4. **Baseline dataset** — one user per role and ≥ 3 students; 3 roots with sub-topics to
   3 levels; basic-syntax markdown on every topic; ≥ 1 media per topic (own objects
   reused, CC0 public sources otherwise); minimal gamification against existing rules.
5. **Previews are manual only** (OQ1) — `make` or `workflow_dispatch`; no preview on push.
6. **Demo includes events, billing, tasks and comments** (OQ2) — Phase 4, task 14.
7. **`WEB_BASE_URL` stays the staging web on previews** (OQ3) — no per-preview var.
8. **Google OAuth on previews deferred** (OQ4).
9. **Staging mail goes to the log** (OQ5) — `mail.driver: "console"` on every staging
   profile; `RESEND_API_KEY` no longer required there.
10. **Demo ids are UUIDv5** — route params validate `uuid()`, so `demo-…` ids would be
    unreachable through the admin API.
11. **Existing non-demo media are not re-linked** — a media row owns exactly one object;
    orphans after a reset are left to the RFC 0018 audit.

---

## 7. Definition of Done (milestone level)

- [ ] All tasks marked Done with every acceptance box checked.
- [ ] All milestone-level acceptance criteria in §3 pass.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] `docs/onboarding.md` and `CLAUDE.md` describe preview deploy, demo seed and
      `db-reset-staging`.
- [ ] Closeout note written at `./closeout-analysis.md`.
- [ ] RFC 0021 status set to `Implemented` in its header and
      `docs/product/RFCs/README.md`; deferred items remain backlog.
- [ ] No diff outside the scope declared in the guardrail.
