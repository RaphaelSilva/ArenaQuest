# RFC 0021: Release-candidate previews on staging and a reproducible demo seed

**Date:** 2026-09-29
**Status:** Proposed
**Revised:** 2026-09-29 (open questions 1–5 resolved)
**Author:** raphaelsilva
**Affected:**
- `scripts/demo/seed-demo.mjs` (new — the demo seed CLI: builds deterministic SQL + uploads demo media, targets `local` or `staging`, refuses `production`)
- `scripts/demo/dataset/base.json` (new — the label-agnostic demo dataset: users, topic tree, media manifest, gamification state)
- `scripts/demo/dataset/sample-topic.md` (new — the markdown sample every demo topic carries)
- `scripts/demo/ids.mjs` (new — UUIDv5 id derivation shared by the seed and the guard)
- `config/labels/<label>/demo.json` (new, optional — per-label overrides: titles, language, extra media)
- `scripts/db/reset-remote.mjs` (new — in-place wipe of a staging D1: drop every table, re-migrate, re-seed; keeps the `database_id`)
- `scripts/db/check-migrations.mjs` (new — CI lint: a migration added by a PR must be additive)
- `apps/api/scripts/check-no-dev-seed.ts` (also recognises demo accounts, so a production deploy refuses a database that holds them)
- `scripts/deploy/core.mjs`, `scripts/cloudflare/deploy.mjs` (new `--preview <name>` mode: `deploy-worker` → `wrangler preview`, `deploy-pages` → `--branch <name>`)
- `scripts/label.mjs` (`scaffoldWranglerText` / `buildEnvBlockObject` emit a `previews` block per staging env; `deriveExpected` gains a preview variant)
- `apps/api/wrangler.jsonc` (a `previews` block under each `<label>-staging` env, bound to the staging D1/KV/R2)
- `apps/api/package.json`, `apps/web/package.json` (wrangler `^4.82` → `>=4.135`, required by Workers Previews)
- `.github/workflows/preview-candidate.yml` (new — `workflow_dispatch` over label × candidate)
- `.github/workflows/deploy-api.yml`, `deploy-web.yml` (staging job goes through the deploy CLI, so the guard runs)
- `Makefile` (`deploy-preview-staging`, `db-seed-demo-local`, `db-seed-demo-staging`, `db-reset-staging`)
- `config/labels/*.jsonc` (staging `mail.driver` → `console`; spaziord staging `webOrigin` fixed)
- `docs/onboarding.md` (preview + demo runbook)

---

## Summary

Make a release candidate **testable by a human on a real URL without a third
environment**. A candidate is deployed as a **preview of staging**: the API as a
[Workers Preview](https://developers.cloudflare.com/workers/previews/) under the
label's staging Worker, the web as a Cloudflare Pages branch deployment of the
staging Pages project. Both previews bind to **the staging D1, KV and R2** — no
new database, bucket or project is created, so the free-tier resource count does
not move. The price of sharing staging's data is paid with two rules
(migrations are additive; applied migrations are frozen) and one safety net: staging
becomes **disposable**. A new `seed-demo` CLI (Node generating SQL, plus media
uploads) turns any local or staging D1 into a **faithful demo** — one user per role,
three students, three topic trees three levels deep with sample markdown and at least
one media each, and a minimal but consistent gamification state — and
`make db-reset-staging` rebuilds staging from scratch (wipe → migrations → demo) in
minutes.

## Motivation

Today a candidate can only be tested locally or after it has already been merged
and shipped to staging, and staging does not look like any tenant:

| Case | Today | With this RFC |
|---|---|---|
| Try milestone M21 on a real URL before merge | ✗ — staging only receives `main`/`develop` | ✓ `m21.<label>-web-staging.pages.dev` + API preview |
| Test the candidate with a label's brand (budo, spaziord) | ✗ — CI deploys only the arenaquest staging | ✓ preview per label, same CLI |
| Open staging and find content to click through | ✗ — only migration reference data (roles, levels, quests, badges) | ✓ demo seed |
| Recover staging after a destructive test | ✗ — no procedure | ✓ `make db-reset-staging LABEL=x` |
| Keep within the D1 free-tier database count | ✓ | ✓ — no new database |

The existing local seed (`apps/api/migrations/seed/*.sql`) is not the answer: it is
deliberately local-only, it ships committed password hashes, and it has no topics,
media, enrollments or gamification rows at all.

## Goals & Non-Goals

**Goals**
- Deploy any candidate branch, for any label, to a pair of preview URLs (web + API)
  with one command or one `workflow_dispatch`, reusing staging's D1/KV/R2.
- Keep CORS, cookie and URL policy **derived from the label profile**, as today —
  no hand-written origin for a preview.
- A demo seed that runs against **local or staging** (any label), is idempotent, and
  produces the baseline dataset in §3.
- A reset that returns a staging database to "migrations + demo" without changing its
  `database_id`.
- Guarantee that demo accounts can never reach production.

**Non-Goals**
- A third persistent environment (`rc`, `preview`, `qa`) — rejected in *Alternatives*.
- Per-preview data isolation (a database per candidate) — rejected; the Time Travel
  bookmark in §2.4 is the undo instead.
- Google OAuth on preview URLs — Google does not accept wildcard redirect URIs; out of
  scope until needed (Resolved Decisions, OQ4).
- A production data clone / anonymisation pipeline — a possible later source for the
  demo, not part of this RFC.
- Changing the XP rules themselves (`xp-config.ts`) — the demo only *seeds state*
  against the existing rules.

## Current State (for reference)

- **Two environments, hard-coded.** `scripts/deploy/core.mjs:34` has
  `ENVS = ['staging','production']`; four copies of
  `env === 'production' ? label : \`${label}-staging\`` (`core.mjs:220`,
  `deploy.mjs:89`, `label.mjs:459`, `provision-label.mjs:229`) name the wrangler env.
- **Derivation.** `deriveExpected` (`scripts/label.mjs:104-127`) builds every URL
  from the profile's `apiHost`/`webOrigin`. For non-production envs
  `ALLOWED_ORIGINS = https://<webOrigin>,https://*.<webOrigin>,http://localhost:3000`,
  and `deriveCorsRules` copies the same list into the bucket's CORS. **A Pages branch
  deployment (`<branch>.<pagesProject>.pages.dev`) is therefore already an allowed
  origin in staging** — for the labels whose staging `webOrigin` is the Pages host.
- **CI.** `.github/workflows/ci.yml` deploys nothing. The staging jobs of
  `deploy-api.yml`/`deploy-web.yml` are hard-wired to arenaquest, call wrangler
  directly (legacy `staging` env block, `wrangler.jsonc:363-407`) and **skip the
  no-dev-seed guard**. Other labels' staging is deployed only by hand. No workflow
  deploys a preview; nothing handles `feature/m<N>/candidate`.
- **Worker versions.** No `previews`, `preview_urls`, `versions upload` or aliases are
  used. The repo pins `wrangler ^4.82.2`; Workers Previews need `>= 4.135.0`.
- **Seed.** Reference data lives in migrations (`0002` roles, `0017` 30 levels,
  `0019` quests, `0021` badges, `0026` BRL currency). Local test accounts live in
  `apps/api/migrations/seed/0001..0003` (committed hashes, `seed-` ids, `INSERT OR
  IGNORE`). `check-no-dev-seed.ts` parses those files and matches rows by `seed-` id or
  hash prefix; it does not look at emails.
- **Ids must be UUIDs.** Route params validate `z.string().uuid()`
  (`routes/admin/topics.ts:18`, `routes/admin/users.ts:25`, …), so a demo row with a
  `demo-…` id would be unreachable through the admin API.
- **Media.** One row per object, `media.topic_node_id NOT NULL`, key
  `topics/<topicId>/<mediaId>-<name>` (`admin-media.controller.ts:97-98`), status
  `pending → ready` only after `objectExists`. Every read is a presigned GET, so a
  `ready` row without an object is a broken link.
- **Visibility.** A student sees a topic when it is `published`, not archived, and
  either `visibility='public'` or granted to the user/their group
  (`d1-enrollment-repository.ts:46-80`, `topics.controller.ts:39-72`).
- **Gamification.** XP amounts are code (`packages/shared/domain/gamification/xp-config.ts:10-19`:
  topic_complete 100, video_watched 50, comment_posted 30, stage_checkin 20); badge and
  quest rewards come from their rows. `user_xp` is maintained next to each
  `xp_events` insert (`d1-gamification-repository.ts:97-110`); the idempotency key is
  `<kind>:<sourceId>:v1` (`xp-engine.ts:22-24`).

## Proposed Design

### 1. Candidate previews on staging

A preview is **named after the candidate** (`m21`), not after a fixed slot. One label
can host several previews at once; they share staging's data.

```bash
make deploy-preview-staging LABEL=budo CANDIDATE=m21
# ≡ node scripts/cloudflare/deploy.mjs --label budo -e staging --preview m21 [--scope api|web|all]
```

`--preview` is only valid with `-e staging` (the CLI rejects it with `production`). The
plan becomes:

| Step | Normal staging deploy | `--preview m21` |
|---|---|---|
| guard | no-dev-seed on staging D1 | same |
| bookmark | — | `wrangler d1 time-travel info <db>` — print and record the bookmark (§2.4) |
| migrate | `d1 migrations apply --remote` | same, after `check-migrations` passes (§2.1) |
| deploy-worker | `wrangler deploy --env <label>-staging` | `wrangler preview --env <label>-staging --name m21` → capture the Preview URL |
| build-web | `NEXT_PUBLIC_API_URL=https://<apiHost>` | `NEXT_PUBLIC_API_URL=<captured Preview URL>`, `NEXT_PUBLIC_SITE_URL=https://m21.<webOrigin>` |
| deploy-pages | `pages deploy --project-name <p>` | `pages deploy --project-name <p> --branch m21` |
| report | — | print both URLs + the bookmark |

**Wrangler config.** Each `<label>-staging` env block gains a `previews` block that
**re-binds the same staging resources** (Previews do not inherit top-level settings):

```jsonc
"budo-staging": {
  "name": "api-budo-staging",
  "d1_databases": [{ "binding": "DB", "database_name": "budo-db-staging", "database_id": "…" }],
  // …
  "previews": {
    "d1_databases": [{ "binding": "DB", "database_name": "budo-db-staging", "database_id": "…" }],
    "kv_namespaces": [{ "binding": "RATE_LIMIT_KV", "id": "…" }],
    "r2_buckets":   [{ "binding": "R2", "bucket_name": "budo-media-staging" }],
    "vars": { /* same derived vars as staging + APP_PREVIEW: "1" */ }
  }
}
```

It is generated by `scaffoldWranglerText` from the profile, so it never drifts from the
staging block. Cron triggers are not allowed in `previews`, so a preview never runs the
daily job twice. Secrets are set once per label with
`wrangler preview base-config secret put` (the provisioner learns this, same stdin
contract as RFC 0012).

**CORS.** Nothing new: a Pages branch deployment `https://m21.<webOrigin>` is matched
by the staging wildcard `https://*.<webOrigin>` in both the API's `ALLOWED_ORIGINS` and
the bucket CORS. The profile policy (`checkPolicy`) keeps production exact-only.
Prerequisite: the staging `webOrigin` must be the Pages host (fix spaziord, §Phase 0).

**Cookies.** The refresh cookie is host-only on the API host (`login.ts:190-196`), so
each preview API has its own session; staging already uses `SameSite=None`. Nothing to
change.

**URLs baked into the API.** `WEB_BASE_URL` (links in e-mails) stays the **staging
web origin** in the `previews` block — no per-preview override (Resolved Decision).
An activation or reset link produced from a preview opens staging web; both share the
same database, so the token is valid there. Since staging mails go to the Worker log
(§2.5), the link is read from `wrangler tail`, not from an inbox.

**Naming.** `<candidate>` is `[a-z0-9-]{1,20}`, validated by the CLI; the default is
derived from the branch (`feature/m21/candidate` → `m21`).

**Cleanup.** `make preview-delete-staging LABEL=x CANDIDATE=m21` runs
`wrangler preview delete --env <label>-staging --name m21` and deletes the Pages
branch deployments. Run after the candidate merges.

**CI.** `.github/workflows/preview-candidate.yml`, `workflow_dispatch` with inputs
`label` (or `all` → matrix `[arenaquest, spaziord, budo]`) and `candidate`, calling the
same CLI. **Manual only** (Resolved Decision): a preview — and therefore a migration
of the shared staging D1 — happens only when someone asks for it, never on push.

A small **preview banner** in the web (`APP_PREVIEW`/`NEXT_PUBLIC_PREVIEW_NAME` set)
shows `preview m21 · <short sha>` so testers always know what they are looking at.

### 2. Sharing staging's data safely

#### 2.1 Migrations are additive (expand/contract)

A preview migrates the **shared** staging D1 before its code is the live staging code,
so the live staging Worker must keep working on the new schema. A migration added by a
PR may only: `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE … ADD COLUMN` (nullable or
with a default), and `INSERT`/`UPDATE` of reference data. `DROP`, `RENAME` and table
rebuilds ship in a **later** release, once no deployed code reads the old shape.
`scripts/db/check-migrations.mjs` (run in `ci.yml` and by the preview CLI) fails on a
non-additive statement in a migration not yet on `origin/main`; an explicit
`-- @contract: <reason>` header marks a reviewed exception.

#### 2.2 Applied migrations are frozen

D1 records migrations by file name. Editing a file after a preview applied it is a
silent no-op on staging. Fixes go in a **new** migration. The lint also fails when a
migration already present on `origin/main` is modified.

#### 2.3 Abandoned candidates

An abandoned candidate leaves its additive migration applied. By §2.1 this is harmless;
when it is not wanted, `make db-reset-staging` removes it (the rebuild only applies
migrations present on the branch being reset from, normally `main`).

#### 2.4 Undo: Time Travel bookmark

Before migrating, the preview CLI records the D1 Time Travel bookmark and prints the
restore command (`wrangler d1 time-travel restore <db> --bookmark <b>`). Time Travel is
included in the free plan, so this is the cheap "undo a bad test" path; the full reset
(§4) is the "start over" path.

#### 2.5 Staging sends no real e-mail

Every label's staging profile switches `mail.driver` from `resend` to `console`
(already an allowed value in `config/deployment.schema.jsonc:54`); `container.ts:267`
then wires `ConsoleMailAdapter`, so activation/reset/notification mails — including
the preview's, which inherits the staging vars — are written to the Worker log instead
of an inbox. Demo addresses (`.demo.invalid`) never bounce, no real person is mailed
from a shared test database, and `RESEND_API_KEY` is no longer required for staging
(its `requiredWhen: MAIL_DRIVER=resend` gate turns off). Production is unchanged.

### 3. Demo seed

#### 3.1 CLI

```bash
make db-seed-demo-local   LABEL=budo
make db-seed-demo-staging LABEL=budo            # prompts; CONFIRM=1 bypasses
node scripts/demo/seed-demo.mjs --label budo -e local|staging [--dry-run] [--yes]
```

- Resolves the D1 name, wrangler env and bucket from `config/labels/<label>.jsonc`,
  exactly like the deploy CLI. **`-e production` is rejected**, and so is any D1 name
  or bucket that appears in a profile's `production` block. There is no `-prod`
  Makefile target.
- Node builds one SQL file (`.arenaquest/demo-<label>-<env>.sql`, gitignored) and runs
  it with `wrangler d1 execute <db> --file … [--remote] --env <label>-staging`.
  `--dry-run` writes the SQL and the media plan and stops.
- **Idempotent.** Every row has a deterministic id and is written with
  `INSERT … ON CONFLICT(id) DO UPDATE`, so a re-run converges instead of duplicating.
- **Ids.** `scripts/demo/ids.mjs` derives UUIDv5 ids from a fixed demo namespace and
  `<label>:<entity>:<key>` (e.g. `budo:topic:root-1/child-2`). They are valid UUIDs,
  so every demo row is reachable through the admin API.
- **Passwords.** Hashed at run time with the same PBKDF2 format as `JwtAuthAdapter`
  (`pbkdf2:100000:<saltHex>:<keyHex>`), from `AQ_DEMO_PASSWORD` read from the
  environment only (never argv; same contract as the importer). No hash is committed.
- **Dates are relative.** Any timestamp (`completed_at`, `earned_at`,
  `last_activity_date`, event dates) is computed from "now" at seed time, so the demo
  never ages.

#### 3.2 Baseline dataset (`scripts/demo/dataset/base.json`)

This is the minimum every label gets. A label may override titles/language and add
media through `config/labels/<label>/demo.json`.

**Users** — one per role, plus three students. E-mails use a reserved domain so they
cannot receive mail: `demo.<role>@<label>.demo.invalid`.

| Key | Roles | Notes |
|---|---|---|
| `admin` | admin | grants enrollments, signs subscriptions |
| `creator` | content_creator | uploader of the demo media |
| `tutor` | tutor | |
| `student-1` | student | member of group *Demo class*; has progress (§3.4) |
| `student-2` | student | member of group *Demo class*; near a level-up |
| `student-3` | student | direct grant only; no progress (the "new user" view) |

**Topics** — three root topics, each with sub-topics down to **three levels**
(root → module → lesson). Shape per root: 1 root, 2 modules, 2 lessons per module =
7 nodes, **21 topics** in total. All `published`, with `estimated_minutes` set. The
three roots exercise the three visibility paths:

| Root | `visibility` | Reached by |
|---|---|---|
| Root 1 | `public` | everyone (also the anonymous-friendly path) |
| Root 2 | `restricted` | group grant → *Demo class* (student-1, student-2) |
| Root 3 | `restricted` | direct grant → student-3 |

One lesson under Root 2 is `private` and one module under Root 3 is `draft`, so the
"hidden" branches of the rules can be seen too. Two tags (`demo`, `beginner`) are
attached across roots so tag search (RFC 0017) has results.

**Markdown** — every topic's `content` is `sample-topic.md` with the topic title
interpolated. The sample covers the whole
[basic syntax](https://www.markdownguide.org/basic-syntax/): headings (h1–h3),
paragraphs and line breaks, bold/italic/bold-italic, blockquote (nested), ordered and
unordered lists (nested), inline code and a fenced code block, horizontal rule, links
and an image link. It is passed through `sanitizeMarkdown` by the seed before it is
written, so what is stored is exactly what the API would store.

#### 3.3 Media

Every topic has **at least one** `ready` media row whose object really exists in the
bucket. The media manifest in the dataset lists each demo file with a **pinned public
source, license and SHA-256**:

```jsonc
{ "key": "sample-video", "type": "video/mp4", "url": "https://…", "sha256": "…", "license": "CC0" }
```

Only CC0 / public-domain sources are accepted; a mix of `image/*`, `application/pdf`
and `video/mp4` so every viewer renders. Resolution order per topic:

1. **Already in the bucket?** The object key is deterministic —
   `topics/<topicId>/<mediaId>-<name>` (the same shape as the upload path, so RFC 0018
   classifies it as `linked`). A `HEAD` that succeeds means no upload.
2. **In the local cache?** `.arenaquest/demo-media/<sha256>` (gitignored).
3. **Download** from the manifest URL, verify the SHA-256, cache it.

Each file is checked by `validateMediaFile` (the importer's preflight, reading
`packages/shared/domain/media/limits.ts`) before upload; the upload uses
`wrangler r2 object put <bucket>/<key> --remote` (local: without `--remote`). The row
is written `ready` only after the object is confirmed. A download failure is fatal for
the run, never a `ready` row without an object.

*Reusing existing media.* Linking objects that are already in a staging bucket but
belong to non-demo rows is **not** done: a media row belongs to exactly one topic, so
"linking" would mean copying the object. The seed only reuses its **own** objects
(step 1). Orphans left in the bucket after a reset are found by the RFC 0018 audit.

#### 3.4 Minimal gamification state

No rule changes. The seed writes a **consistent** state against the existing rules,
using the same idempotency keys as the engine (`<kind>:<sourceId>:v1`), so an action
the tester repeats in the app is not rewarded twice and a new one is:

| Student | State written | What it shows |
|---|---|---|
| student-1 | `topic_progress` completed on 1 lesson of Root 1; `xp_events` topic_complete (100) + badge *alicerce-solido* (250); `user_badges` row; `user_streak` = 3 days ending yesterday; `quest_progress` for `weekly-topic` 1/2 | level 3 (350 XP; L3 starts at 300), a badge, a running streak, a half-done quest |
| student-2 | 2 Root 2 lessons completed (2 × 100) + badge *alicerce-solido* (250) + one `admin_adjustment` of 500 (the same `source_kind` the admin controller writes) = **950 XP** | completing **one** more topic crosses level 5 at 1000 XP — a visible level-up |
| student-3 | nothing | first-completion flow, first badge, daily quests from zero |

`user_xp.total_xp` is always written as the sum of the student's `xp_events`; the seed
asserts it after execution. One **mission** (active window: now → +14 days,
`topic_completed` count 1, rewarding badge *tecnica-afiada*) is created so missions are
testable too.

#### 3.5 Beyond the baseline

All four areas are **in scope** (Resolved Decision) and ship in Phase 4:

- **Events** — one per audience (`public`, `members`, `restricted` → *Demo class*),
  one past and one upcoming, relative dates; `flyer_status='none'` (no flyer object
  needed). Mirrors `seed/0003_events_local.sql`.
- **Billing** — one monthly plan and one free plan; student-1 and student-2 subscribed
  (one invoice paid, one open). Mirrors `seed/0002_billing_local.sql`.
- **Tasks** — one published task with three stages linked to Root 1 lessons, so the
  stage check-in (20 XP) path is testable.
- **Comments** — one thread with a reply and a like on a Root 1 lesson (feeds
  `daily-comment` / `weekly-discussion`).

#### 3.6 Guard: demo never reaches production

`check-no-dev-seed.ts` learns a second matcher: it imports `scripts/demo/ids.mjs`,
computes the demo user ids for **every** label, and also matches the
`@*.demo.invalid` e-mail domain. The demo matcher is **enforced for production targets
only** — staging legitimately holds the demo, so staging and preview deploys keep the
dev-seed check alone. `deploy.mjs` already runs the guard before every production deploy,
so a production database holding a demo account fails the release.

### 4. Disposable staging: `db-reset-staging`

```bash
make db-reset-staging LABEL=budo      # prompts (names the database); CONFIRM=1 bypasses
```

`scripts/db/reset-remote.mjs`, staging only:

1. Record a Time Travel bookmark (the undo for the reset itself).
2. List every table from `sqlite_master` except `sqlite_%` and `_cf_%`, and drop them
   all (including `d1_migrations`) with `PRAGMA defer_foreign_keys = on`.
3. `d1 migrations apply --remote` from the current checkout.
4. `seed-demo -e staging --yes`.

The database is emptied **in place** rather than deleted and recreated: a recreated D1
gets a new `database_id`, which would have to be rewritten into the label profile and
`wrangler.jsonc`. The bucket is not emptied; the demo re-uses its own objects (§3.3).

## Alternatives Considered

1. **A third persistent environment (`rc`) per label** — own Worker, Pages project, D1,
   KV and bucket, reset from the demo on every candidate deploy. Fully isolated and
   exact-origin CORS. **Rejected:** one more D1 per label counts against the free-tier
   database limit, adds a provisioning surface to `provision-label.mjs`, and duplicates
   what staging already is.
2. **A database per candidate** (clone on deploy, delete on merge). Full isolation and
   parallel candidates. **Rejected:** multiplies databases and buckets, needs
   create/delete automation and garbage collection.
3. **Aliased Version URLs** (`wrangler versions upload --preview-alias m21`). Works with
   the current wrangler. **Rejected as the primary path, kept as fallback:** Cloudflare
   now discourages it for branch testing in favour of Workers Previews; a version
   upload re-uses the Worker's own settings, with no preview-specific vars/secrets.
   If the wrangler bump is blocked, the CLI can use it with the same plan.
4. **Seed as static SQL files.** **Rejected:** passwords would need committed hashes,
   dates would age, and media objects cannot be uploaded from SQL.
5. **Seed through the public API** (like `import-media.mjs`). Exercises the real write
   paths. **Deferred:** it cannot write gamification history, progress in the past or
   backdated streaks, and it needs a deployed Worker plus admin credentials. The
   topic/media part may move to it later.
6. **Clone production, anonymised.** The most faithful data. **Deferred:** needs an
   audited anonymisation step; a candidate source for a later label-specific demo.

## Implementation Plan

Total **~9 dev days**.

### Phase 0 — Prerequisites (~1 d)
- Bump wrangler to `>= 4.135` in `apps/api` and `apps/web`; verify `wrangler preview`
  output parsing.
- Staging jobs in `deploy-api.yml`/`deploy-web.yml` call the deploy CLI (guard runs).
- Fix the spaziord staging `webOrigin` so the preview wildcard covers its Pages host.
- Staging profiles: `mail.driver` → `console` (§2.5); regenerate `wrangler.jsonc`.

### Phase 1 — Demo seed, baseline (~3 d)
- `ids.mjs`, `base.json`, `sample-topic.md`, `seed-demo.mjs` (users, groups, topics,
  enrollments, tags, media, gamification §3.4).
- Guard extension (§3.6).
- `make db-seed-demo-local` / `db-seed-demo-staging`.
- CI test: apply all migrations to a local D1, run the seed twice, assert row counts
  and `user_xp` consistency — a migration that breaks the demo breaks the PR.

### Phase 2 — Disposable staging (~1 d)
- `reset-remote.mjs`, `make db-reset-staging`, onboarding runbook.

### Phase 3 — Candidate previews (~3 d)
- `previews` block generation in `label.mjs`; regenerate `wrangler.jsonc`.
- `--preview` mode in `core.mjs`/`deploy.mjs`; bookmark step; `check-migrations.mjs`
  in the CLI and `ci.yml`.
- `make deploy-preview-staging`, `preview-delete-staging`; `preview-candidate.yml`.
- Preview banner in the web (i18n keys in both dictionaries).

### Phase 4 — Demo beyond the baseline (~1 d)
- Events, billing, tasks, comments (§3.5); the CI seed test asserts their row counts
  and that the stage check-in and comment quests start from the seeded state.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| A preview migration breaks the live staging Worker | Additive-only lint (§2.1) in CI and in the CLI; Time Travel bookmark before migrating |
| Two previews + staging write to the same data | Accepted — it is a test environment; `db-reset-staging` restores a known state |
| An edited migration never re-runs on staging | Frozen-migration lint (§2.2) |
| Workers Previews is new; `wrangler preview` output/flags change | CLI parses one field (the URL) behind a helper; aliased Version URLs as fallback (Alt. 3) |
| Previews are public URLs over staging data | Staging is already public and holds only demo data; Cloudflare Access can be added later |
| Demo accounts leak into production | Guard matches demo ids for every label and the `.demo.invalid` domain; runs before every production deploy |
| A public media source disappears | SHA-256-pinned manifest + local cache; the bucket keeps the object once uploaded |
| The demo drifts from the schema | CI test runs the seed on a freshly migrated D1 |
| Reset destroys data someone needed | Prompt names the database; bookmark recorded before the wipe |

## Success Criteria

- **P1** `make db-seed-demo-local LABEL=budo` on a fresh replica yields 6 users,
  21 topics (3 roots × 3 levels), ≥ 21 `ready` media whose objects exist, and
  student-1 at level 3 (350 XP) with one badge; a second run changes no row count.
- **P1** A production deploy against a database containing a demo user exits non-zero.
- **P1** `seed-demo -e production` exits non-zero before touching anything.
- **P2** `make db-reset-staging LABEL=budo` leaves a staging D1 with the same
  `database_id`, all migrations applied and the demo loaded.
- **P3** `make deploy-preview-staging LABEL=budo CANDIDATE=m21` prints a web and an API
  URL; logging in as `demo.admin` on the web preview works (CORS + cookie), media play,
  and the live staging URLs keep serving the previous version.
- **P3** A PR adding a `DROP COLUMN` migration fails CI unless marked `@contract`.
- **P0** A password-reset request on staging produces no Resend call; the reset link
  appears in `wrangler tail`.
- **P4** Events board shows one event per audience for the matching demo user; the
  billing page shows one paid and one open invoice; student-3 checking in a task stage
  earns 20 XP; the demo lesson shows a comment thread with a reply and a like.

## Open Questions

None open. Questions 1–5 were answered on 2026-09-29 and moved below; Google OAuth on
previews stays out of scope until a candidate needs it.

## Resolved Decisions

- **2026-09-29 — No third environment** (raphaelsilva): previews run on staging's
  resources to stay within the free tier.
- **2026-09-29 — Preview names follow the candidate** (`m21`), not a fixed `rc` slot
  (raphaelsilva): Google login is not needed on previews for now.
- **2026-09-29 — Staging is disposable** (raphaelsilva): recovery is wipe → migrations
  → demo seed, not per-candidate databases.
- **2026-09-29 — Baseline dataset** (raphaelsilva): one user per role and ≥ 3 students;
  3 topics with sub-topics to 3 levels; basic-syntax markdown on every topic; ≥ 1 media
  per topic (own objects reused, public sources otherwise); minimal gamification.
- **2026-09-29 — OQ1: previews are manual only** (raphaelsilva): `make
  deploy-preview-staging` or `workflow_dispatch`; no preview on push, so the shared
  staging D1 is migrated only on request.
- **2026-09-29 — OQ2: demo includes events, billing, tasks and comments**
  (raphaelsilva): all four ship in Phase 4 (§3.5).
- **2026-09-29 — OQ3: `WEB_BASE_URL` stays staging web on previews** (raphaelsilva):
  no per-preview var; e-mail links open staging web against the same database.
- **2026-09-29 — OQ4: Google OAuth on previews deferred** (raphaelsilva): not needed
  now; if it becomes needed, one fixed preview name is registered as a redirect URI.
- **2026-09-29 — OQ5: staging mails go to the log** (raphaelsilva): staging
  `mail.driver = console` for every label (§2.5).

## References

- Workers Previews: https://developers.cloudflare.com/workers/previews/ (config,
  `--env` usage, resources & isolation, Wrangler `>= 4.135.0`)
- Markdown basic syntax: https://www.markdownguide.org/basic-syntax/
- Relevant code: `scripts/label.mjs:104-127` (derivation), `scripts/deploy/core.mjs:34,220-277`
  (envs, plan), `apps/api/scripts/check-no-dev-seed.ts:114-192` (guard matcher),
  `apps/api/src/adapters/auth/jwt-auth-adapter.ts:174-207` (hash format),
  `apps/api/src/controllers/admin-media.controller.ts:97-129` (media key + finalize),
  `apps/api/src/adapters/db/d1-enrollment-repository.ts:46-80` (visibility),
  `packages/shared/domain/gamification/xp-config.ts:10-19` (XP amounts)
- Related RFCs: RFC 0007 (deployment preflight), RFC 0011 (branded deploy CLI — the
  single release path this extends), RFC 0012 (tenant provisioning — secret contract),
  RFC 0017 (tag search), RFC 0018 (storage browser — orphan audit after a reset)
