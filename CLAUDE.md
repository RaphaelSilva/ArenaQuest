# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Makefile naming rule** — an unsuffixed target is **always local**. A target
that touches a deployed environment **names that environment in its own name**
(`db-migrate-staging`, `deploy-prod`). `-api` / `-web` / `-shared` are *scope*,
not environment. There is no implicit production: every `-prod` target prompts
for confirmation (`CONFIRM=1` bypasses). Never introduce a `-dev` suffix for an
environment — `dev` means "development server", and `local` means the local
replica.

**First run on a new machine:**
```bash
make setup        # deps + .dev.vars/.env.local + local D1 migrate & seed (idempotent)
make doctor       # read-only diagnosis; exit 0 clean / 1 hard gap / 2 soft gap
```
See `docs/onboarding.md` for the full runbook and known issues.

**Run all apps locally:**
```bash
make dev          # all apps in parallel (Turborepo)
make dev-web      # Next.js only (localhost:3000)
make dev-api      # Cloudflare Worker only (localhost:8787)
```

**Build, lint, test:**
```bash
make build             # build all workspaces (with Turborepo caching)
make lint              # lint entire monorepo
make test              # run all tests
make test-api          # run API tests only (Vitest + Cloudflare Workers pool)
make test-web          # run Web tests only
```

**Run a single test (Vitest in apps/api):**
```bash
cd apps/api && pnpm test test/index.spec.ts
cd apps/api && pnpm test --grep "test name"
```

**Git worktrees (one per feature):**
```bash
make worktree-open KIND=rfc NUMBER=16 SLUG=x      # planning: docs/rfc-0016-x → .worktrees/rfc-0016-x
make worktree-open KIND=milestone MILESTONE=21    # execution: feature/m21/candidate → .worktrees/m21-candidate
make worktree-sweep DRY_RUN=1                     # preview removing worktrees whose PR merged
```

**Cloudflare & Database:**
```bash
make cf-typegen            # regenerate Worker bindings types
make db-migrate-local      # apply migrations to the local D1 replica
make db-seed-local         # seed local test accounts (idempotent, local only)
make db-reset-local        # delete the local replica, re-migrate, re-seed
make db-migrate-staging    # apply migrations to remote staging D1
make db-migrate-prod       # apply migrations to remote production D1 (confirms)
make create-db-prod        # create production D1 database (confirms)
make create-kv-prod        # create RATE_LIMIT_KV namespace (confirms)
```

**Deploy:**
```bash
make deploy-staging        # both apps → staging
make deploy-api-staging    # API → staging Workers
make deploy-web-staging    # Web → staging Pages
make deploy-prod           # both apps → production (confirms)
make deploy-api-prod       # API → production Workers (confirms)
make deploy-web-prod       # Web → production Pages (confirms)
```
`deploy`, `deploy-api` and `deploy-web` were removed — they used to mean
production implicitly. Every `deploy-*` target is now a thin wrapper that
forwards to the label-aware deploy CLI, `scripts/cloudflare/deploy.mjs` (stock
`arenaquest` label), e.g.:

```bash
node scripts/cloudflare/deploy.mjs --label arenaquest -e <staging|production> \
     [--scope api|web|all] [--yes] [--dry-run]
```

The CLI resolves the tenant profile from `config/labels/<label>.jsonc`, runs the
no-dev-seed guard (`apps/api/scripts/check-no-dev-seed.ts`) and the production
confirmation itself, migrates the profile's D1 database, deploys the Worker, and
builds + deploys the Pages project with the brand vars baked from the profile —
so the Makefile targets no longer hardcode a database name or brand env.
Cloudflare credentials are resolved by context: `wrangler login` locally, or
`CF_API_TOKEN` + `CF_ACCOUNT_ID` in CI. CI runs the same CLI over a
`strategy.matrix.label` of `[arenaquest, spaziord, budo]`. See
`docs/onboarding.md` for the full invocation and the manual release path.

**Provisioning a new tenant:**
```bash
make label-new LABEL=x            # write config/labels/x.jsonc, fill the anchors
make set-new-label LABEL=x        # provision staging (DRY_RUN=1 to preview)
make set-new-label LABEL=x PRODUCTION=1   # staging, then production (confirms)
```
`set-new-label` forwards to `scripts/cloudflare/provision-label.mjs`, which creates
**both planes** for a label: D1, KV, R2 and the Pages project, plus the backend —
profile-derived R2 CORS, a generated `JWT_SECRET`, and a real Worker (by spawning
the deploy CLI, so there is still one release code path). Extra knobs:
`WITH_DOMAIN=1` attaches the `apiHost` custom domain when its zone is already active
in the account; `ONLY=cors|secrets|worker|domain` runs one group for a targeted
repair, against a single environment. `make r2-cors-*` now forward to it —
R2 CORS is derived from the profile's `webOrigin`, not from a committed file.
`create-db-*` / `create-kv-*` are superseded by `set-new-label`.

**Secret contract for provisioning.** `JWT_SECRET` is generated per label *and* per
environment (a shared key would let a token minted for one tenant verify on another),
handed to wrangler over stdin, and never overwritten once set. The externally-valued
secrets (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `GOOGLE_CLIENT_SECRET`,
`RESEND_API_KEY`) are only *detected by name* and reported with their fix command —
provisioning never writes them, and no secret value ever reaches argv, disk or a log
line. See RFC 0012 and `docs/onboarding.md`.

**Bulk media import (folder tree → topics):**
```bash
make import-media-staging SOURCE=./content DRY_RUN=1        # preview a local tree
make import-media-staging DRIVE_FOLDER=<id|url> LIMIT=5     # import from Google Drive
make import-media-prod    DRIVE_FOLDER=<id|url>             # production (confirms)
```
Both forward to `scripts/content/import-media.mjs`, which mirrors a folder tree
into the topic hierarchy and uploads its media through the **public API** — the
same `presign → PUT → finalize` lifecycle the backoffice uses, so no new write
path into a deployed environment exists. A directory becomes a topic (created as
`draft`); a file becomes media on the topic of its containing directory. Files
sitting at the source root need `--root-topic <uuid>`. Pass exactly one source:
`SOURCE=` for a local folder or `DRIVE_FOLDER=` for Google Drive.

**`README.md` drives the topic itself.** A `README.md` inside a folder is never
media: its markdown becomes that topic's `content` (the API sanitises it with
`sanitizeMarkdown`), and an optional fenced block declares overrides:

````
```arenaquest
{ "order": 9, "status": "draft", "estimatedMinutes": 90, "title": "9th Kyu" }
```
````

A fence is used rather than `---` front-matter because a Google Doc exported to
markdown turns a lone `---` into a horizontal rule; a missing or malformed block
is a warning, never a failure. `order` is applied after creation through
`POST /v1/admin/topics/{id}/move`, since `CreateTopicSchema` does not accept an
order — that is what fixes a tree whose folder names sort against their real
sequence. On a re-run a reused topic is `PATCH`ed only when its README actually
drifted, and a sibling group already in place is not moved, so a no-op re-run
performs no writes at all.

**Google Drive source.** `scripts/content/drive-source.mjs` lists a folder
recursively (following `nextPageToken`, covering Shared Drives), downloads
binaries with `alt=media`, and exports a `README.md` stored as a *Google Doc*
via `files/{id}/export?mimeType=text/markdown`. Auth is an OAuth refresh token
read from `AQ_GDRIVE_CLIENT_ID` / `AQ_GDRIVE_CLIENT_SECRET` /
`AQ_GDRIVE_REFRESH_TOKEN`; mint it once with
`node scripts/content/drive-source.mjs --login` (loopback PKCE consent against a
"Desktop app" client with the Drive API enabled and scope `drive.readonly`). That
command serves the callback for a local browser *and* accepts the callback URL
pasted back into the prompt, so it works on a headless box; `--port <n>` pins the
loopback port for `ssh -L` forwarding.
Note that a Drive dry run *does* need that read-only token in order to list —
it still writes nothing and touches no ArenaQuest credential.

The run is idempotent and resumable: topics reconcile on `(parentId, title)`
against `GET /v1/admin/topics`, and files are tracked in a JSONL ledger
(`.arenaquest/import-<label>-<env>.jsonl`, gitignored) so a re-run skips what is
already `ready` and recovers whatever was interrupted — including deleting the
stale `pending` row when a presigned URL expired before its PUT landed. The
ledger keys on the file's relative path locally and on its **Drive file id**
remotely (a Drive file can be renamed or moved), and detects a changed file
through one `revision` token: size+mtime locally, `md5Checksum` on Drive. Topic
creation is deliberately **sequential**: `D1TopicNodeRepository.create` derives
`sort_order` from a non-transactional `SELECT MAX(sort_order)`, so concurrent
siblings would collide. Uploads run concurrently (`--concurrency`, default 3).

Preflight validates every file against the API's own limits *before the first
write* (`video/mp4` ≤ 100 MB, `application/pdf` ≤ 25 MB, images ≤ 5 MB — see
`packages/shared/domain/media/limits.ts`, the source of truth since M20 Task 01;
`admin-media.controller.ts`, the event flyer path and this importer all read that
one table) and aborts with a per-file report; `--skip-invalid` imports the rest
instead.
Credentials are read from `AQ_ADMIN_EMAIL` / `AQ_ADMIN_PASSWORD` in the
environment only, never argv, and the account needs role `admin` or
`content_creator`. `AQ_API_BASE_URL` overrides the target for local development
but is rejected unless it points at loopback.

**Rescuing what the import skipped (`.mov` → `.mp4`, `.docx` → `.pdf`):**
```bash
make convert-skipped REPORT=.arenaquest/skipped-budo-production.jsonl \
     SOURCE=./content ONLY=mov DRY_RUN=1
```
`scripts/media/convert-skipped.mjs` closes the loop on the skipped report. It
locates each entry inside a reference folder **by file name + extension** —
matching on the full `relPath` first, then on the bare name, so a flat download
folder works as well as a mirror — and converts it into a format the API
accepts. Matching normalises to NFC and lower case, because the report comes
from Drive in NFC while macOS stores `Chūdan`/`Jō` decomposed; without it every
accented name would miss. A name that appears twice with no path match is
reported as ambiguous rather than guessed.

When both exact tiers miss, a third **relaxed** tier retries against a
transliterated form: diacritics folded, Unicode dashes and quotes mapped to
ASCII, whitespace runs squeezed. A folder that reached the local disk through a
backup or a Windows share routinely arrives ASCII-fied — `Chūdan` as `Chudan`,
`Ro Ryu – Taki` as `Ro Ryu - Taki` — and the bytes are still the same recording.
A relaxed hit is marked `[relaxed: <path>]` in the printed plan and **never**
resolves a collision; `--strict-match` turns the tier off. The converted file
keeps the *report's* spelling, so the media name matches the topic tree rather
than the backup.

`.mov` is **remuxed** (`-c copy`) when it already holds H.264/AAC and
transcoded otherwise (H.264 · `yuv420p` · AAC · `+faststart`); if the result
misses the 100 MB limit, a bounded ladder retries at a higher CRF and then at
720p. `.docx` goes through LibreOffice headless with a per-job
`-env:UserInstallation`, without which concurrent runs sharing a profile exit
cleanly having written nothing. A missing `ffmpeg` or `soffice` is *detected and
reported with its install command*, never installed. `--only mov` narrows a run
to one bottleneck.

**Every run prints the files it matched — grouped by target topic — and waits
for confirmation** before converting anything (`--yes` / `CONFIRM=1` bypasses;
no TTY without one aborts). A mismatched `--source` produces a plausible list of
the *wrong* files, and noticing that after two hours of transcoding costs the
whole run. Output mirrors the report's tree under `--out`, conversions land on a
`.part` file renamed into place, and a JSONL ledger makes a re-run skip what is
already done.

**Two reports come out of a run, and together they account for every line of the
input.** The manifest (below) says what can be imported now;
`.arenaquest/unresolved-<name>.jsonl` says what is still owed and why — one row
per entry that did not become a converted file, keyed by `state`: `not-found`,
`ambiguous` (with its `candidates`), `no-converter`, `unsafe-path`, and
`over-limit` for a file that converted but still exceeds the API. Each row keeps
its `topicId`, so it is a valid input for a narrower re-run once the cause is
fixed. The counts are reported separately in the summary because they have
different fixes: `not-found` points at the wrong `--source`, `ambiguous` at a
`--source` that does not mirror the tree.

**The converter's manifest is an importer input.** Alongside the ledger it
writes `.arenaquest/converted-<name>.jsonl`, one row per converted file carrying
the `topicId` its *original* was headed for:

```bash
node scripts/content/import-media.mjs --label budo -e production \
     --source .arenaquest/converted/budo-production \
     --manifest .arenaquest/converted-budo-production.jsonl
```

With `--manifest`, the importer skips the tree walk entirely: no topic is
created, updated or reordered, and no README is read — every row already names
an existing topic. It resolves each `relPath` under `--source` and uploads it
through the same `presign → PUT → finalize` lifecycle, with the same ledger,
resume and retry behaviour. `--manifest` requires `--source` and excludes
`--drive-folder` and `--root-topic` (a root topic could only contradict the
rows). Type and size are re-checked against the bytes **on disk** through
`validateMediaFile`, the single preflight both plan builders share — a manifest
is another route to the upload, not a way around a limit.

**Demo seed (RFC 0021):**
```bash
make db-seed-demo-local LABEL=budo          # local replica (DRY_RUN=1: SQL + plan only)
make db-seed-demo-staging LABEL=budo        # remote staging (prompts; CONFIRM=1 skips)
node scripts/demo/ci-check.mjs                                  # the CI check, offline
```
Both targets forward to `scripts/demo/seed-demo.mjs` (`LABEL` defaults to
`arenaquest`); the dataset is `scripts/demo/dataset/base.json` plus an optional
`config/labels/<label>/demo.json`. **There is no production variant**: the CLI
refuses `-e production` (and any production-named D1/bucket) before writing
anything, and the production deploy guard rejects a database holding a
`*.demo.invalid` account. The demo accounts' password is `AQ_DEMO_PASSWORD` from the
environment, or — when unset on a TTY — asked for (hidden, twice, ≥ 8 chars); never a flag.
The run is idempotent (deterministic ids; a re-run changes no row count). The
local bucket is written in-process through wrangler's `getPlatformProxy`
(`--persist-to <dir>` retargets a local run, D1 and R2 alike). Labels share
group names and tag slugs, so one local replica holds one label's demo.
The CI job *Demo seed check* (`.github/workflows/ci.yml`, Node 22 for wrangler)
applies every migration to a throwaway D1, seeds each label twice and asserts
RFC 0021's counts, the media objects' SHA-256, the student XP/badges and
`user_xp` = ledger — offline, with media from `scripts/demo/fixtures/` and a
generated password — so a migration that breaks the demo fails its PR.

**Recovering staging (disposable staging, RFC 0021 §4):**
```bash
make db-reset-staging LABEL=budo     # asks for the demo password if AQ_DEMO_PASSWORD is unset; prompts (types the DB name); CONFIRM=1 skips, DRY_RUN=1 plans only
```
`scripts/db/reset-remote.mjs` runs, in a fixed order: a D1 Time Travel bookmark
(the printed `wrangler d1 time-travel restore <db> --bookmark=… --env <label>-staging`
undoes the reset; no bookmark → nothing is dropped) → drop every table/view except
`sqlite_*`/`_cf_*`, `d1_migrations` included, with `PRAGMA defer_foreign_keys = on`
→ `d1 migrations apply --remote` from the checkout → the demo seed CLI with `--yes`.
The D1 is emptied in place (same `database_id`); the bucket is not emptied. It
refuses `-e production`, `-e local` and any production-named D1/bucket through the
seed's own `resolveTarget`, before any wrangler call; there is no `-prod` target.

**Previewing a candidate (RFC 0021 §1):**
```bash
make deploy-preview-staging LABEL=budo CANDIDATE=m21 [DRY_RUN=1]   # API Workers Preview + Pages branch on staging data
make preview-delete-staging LABEL=budo CANDIDATE=m21              # remove both after the merge
```
Both forward to `deploy.mjs --label <l> -e staging --preview <name> [--delete]`
(`CANDIDATE` empty → `m<N>` from `feature/m<N>/candidate`; name `[a-z0-9-]{1,20}`;
`-e production` refused). Plan: guard → `check-migrations` against `origin/main` →
D1 Time Travel bookmark → migrate the staging D1 → `wrangler preview --json --secrets-file`
(URL from `preview.urls[0]`, parsed in one helper, `parsePreviewUrl`; the file carries a
per-deploy generated `JWT_SECRET` plus any `AQ_PREVIEW_<NAME>` from the shell — a preview
deployment gets no secret from the staging Worker *nor* the Preview base config, so the
preflight skips the Worker's secrets for a preview) → web build with that
`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL=https://<name>.<pagesProject>.pages.dev`,
`NEXT_PUBLIC_PREVIEW_NAME`/`_SHA` → `pages deploy --branch <name>` → report (both URLs,
bookmark, restore command). The live staging Worker and the Pages production branch are
never touched, and the web preview origin must pass the staging `ALLOWED_ORIGINS`
(`originAllowed`, the API's matching) or the CLI refuses. `--scope web` needs `--api-url`.
`.github/workflows/preview-candidate.yml` runs the same CLI on `workflow_dispatch`
only (`label`: one or `all`), writing the URLs to the job summary. See
`docs/onboarding.md` → "Previewing a candidate".

Renamed targets (`db-migrations-dev` → `db-migrate-local`, `db-seed-dev` →
`db-seed-local`, `create-db` → `create-db-prod`, ...) still work as deprecated
aliases that print a pointer. Use the new names.

## Architecture

Pnpm workspaces + Turborepo monorepo with three packages:

### `packages/shared`
Cloud-agnostic foundation. Key areas:
- **`ports/`** — TypeScript interfaces (adapter contracts) for auth, database (`IUserRepository`, `IRefreshTokenRepository`, `ITopicNodeRepository`, `ITagRepository`, `IMediaRepository`), rate limiting, and storage. The API implements these; swapping implementations (e.g. JWT → Auth0, D1 → Postgres, R2 → S3) only requires a new adapter without touching business logic.
- **`types/entities.ts`** — Canonical entity schema organized in namespaces: `Entities.Config` (enums), `Entities.Identity` (User, Profile, UserGroup, Enrollments), `Entities.Content` (TopicNode hierarchy, Media, Tag), `Entities.Engagement` (Task, TaskStage), `Entities.Progress` (TopicProgress, TaskProgress). All apps import types from here.
- **`utils/sanitize-markdown.ts`** — Shared Markdown sanitiser used before persisting topic content.
- **`domain/time/`** — Shared time helpers used across apps.
- **`domain/media/limits.ts`** — The allowed-type/size table. **The single source of truth** for media limits: `admin-media.controller.ts`, the event flyer path and `scripts/content/import-media.mjs` all read it, so a limit is changed in exactly one place.
- **`domain/contact/whatsapp.ts`** — `normalizeWhatsapp`, shared so the API rejects at write time exactly the numbers the web would refuse to render.

### `apps/api`
Cloudflare Workers serverless backend (Hono). Patterns to follow:
- **Adapter pattern** — adapters are instantiated per-request inside `buildApp(env)` in `src/index.ts` (Workers have no shared memory between requests, so never put adapter instances in module scope). Implementations live under `src/adapters/{auth,db,rate-limit,storage}/`.
- **Routes vs controllers** — `src/routes/*` only handle HTTP concerns (parsing, auth guards, response shaping). All business logic lives in `src/controllers/*` and returns a `ControllerResult<T>` (`{ ok: true, data } | { ok: false, status, error, meta? }`) defined in `src/core/result.ts`. Use the `@ValidateBody(schema)` method decorator together with the `@Body()` parameter decorator (`src/core/decorators.ts`) to centralise Zod validation; on failure they short-circuit with a `400 BadRequest` `ControllerResult`.
- **Auth** — `JwtAuthAdapter` implements `IAuthAdapter` using Web Crypto API. **PBKDF2 uses 100,000 iterations** (Cloudflare limit). Refresh tokens are persisted hashed via `D1RefreshTokenRepository`.
- **Storage** — `R2StorageAdapter` exposes a presigned-upload lifecycle backed by R2 over the S3-compatible API; `D1MediaRepository` tracks media records and their topic associations.
- **Bindings** — `JWT_SECRET` (secret — the HMAC-SHA256 key for HS256 access tokens; auto-generated per label *and* per environment by the label provisioner, never shared across tenants), `DB` (D1), `RATE_LIMIT_KV` (KV), `R2` (bucket binding), `R2_S3_ENDPOINT`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE`, `R2_ACCESS_KEY_ID` (secret), `R2_SECRET_ACCESS_KEY` (secret), `ALLOWED_ORIGINS` (CORS), `COOKIE_SAMESITE` (security policy).
  - **`ALLOWED_ORIGINS`** — comma-separated list of allowed request origins. Three forms are supported by the `OriginPolicy` core module (`src/core/cors/`):
    1. **Exact** — `https://arenaquest-web.pages.dev` — only that literal origin is accepted.
    2. **Wildcard subdomain** — `https://*.arenaquest-web-staging.pages.dev` — any single-label subdomain of that host (e.g. PR preview deployments). Patterns with multiple wildcard labels are not supported.
    3. **Full wildcard** — `*` — echoes back the actual request `Origin` header (required because browsers block `Access-Control-Allow-Origin: *` on credentialed requests). **For local development only — never set this in staging or production.**
  - Production is locked to exact origins; do not introduce wildcards without a security review (see `docs/product/backlog/cors/`). Staging includes the PR-preview wildcard (`https://*.arenaquest-web-staging.pages.dev`). Local development uses `ALLOWED_ORIGINS=http://localhost:3000` (or `*`) in `.dev.vars` — see `.dev.vars.example`.
- **User Management** — Includes admin lockout guards to prevent deleting the last active admin or self-lockout.
- **Events board (the only anonymous data surface)** — `GET /v1/events`, `/{slug}` and `/{slug}/flyer` answer **without a token** and answer *more* when one is present. They are mounted at `/v1/events`, deliberately **not** under `routes/public/` — that directory means "non-admin, authenticated" and reusing it would blur a security boundary. `middleware/optional-auth.ts` is the one middleware that does not reject: an invalid token degrades to anonymous instead of `401`. Audience (`public` · `members` · `restricted`) is resolved server-side in `D1EventRepository`, whose anonymous listing is a **separate statement** with a literal `audience = 'public'` filter rather than the authenticated query with a null user. Out-of-audience detail reads return **404, not 403**, so the open surface is not an enumeration oracle. "Past" is a computed predicate (`COALESCE(ends_at, starts_at + 1 day) < now`), never a column. Anonymous routes carry an IP-keyed `KvRateLimiter` (60 rpm).
- **Tests** — Vitest with `@cloudflare/vitest-pool-workers`. Config: `vitest.config.mts`.

### `apps/web`
Next.js 15 + React 19 frontend deployed to Cloudflare Pages via `@cloudflare/next-on-pages`. App router layout under `src/app/` is split into `(auth)` (login), `(protected)` (admin backoffice, catalog, dashboard) and `(public)` (the events board and detail pages, readable with no account) groups. The `(public)` pages are **server-rendered** — a client-side fetch would hand a crawler an empty shell — and ship the SEO baseline with them (`robots.ts`, `sitemap.ts`). Admin tooling includes the topic-tree manager, the media uploader and the events backoffice; the participant catalog renders sanitised Markdown alongside dedicated media viewers. API clients live in `src/lib/*-api.ts`. Uses `NEXT_PUBLIC_API_URL` for environment-specific backend targeting and **`NEXT_PUBLIC_SITE_URL` for its own public origin** — the latter is baked into `sitemap.xml`, `robots.txt`'s `Sitemap:` line, `og:url` and the canonical tags, defaults to `http://localhost:3000`, and is derived per environment from the label profile's `webOrigin` by the deploy CLI, so a real deploy never publishes a sitemap pointing at loopback.

## Key Conventions

- **Commit style** — Conventional Commits (`feature:`, `hotfix:`, etc.). See CONTRIBUTING.md.
- **Branch strategy** — `main` is the trunk and the only long-lived branch (a merge deploys staging, then production behind an approval); every branch is cut from `main` and returns through a reviewed PR. There is no `develop`.
- **One git worktree per feature** — the root checkout stays on `main`, clean, and is only used to open worktrees. A feature is opened with `make worktree-open` (`scripts/git/worktree.mjs`) under `.worktrees/` (gitignored), named after its candidate (`feature/m<N>/candidate` → `.worktrees/m<N>-candidate`), and every branch hop, commit and merge for it happens inside that worktree. Run `make setup` in a new worktree (deps, env files and local D1 are per worktree). Planning is a separate, earlier worktree and PR: the RFC → milestone/backlog/epic → task files chain is written in `.worktrees/rfc-<NNNN>-<slug>` (branch `docs/rfc-<NNNN>-<slug>`) and merged into `main` before the feature worktree is opened. A worktree stays on disk through review and is removed only after its PR is merged into `main`, by `make worktree-sweep` — run automatically by the Claude Code `SessionStart` hook in `.claude/settings.json` (needs `gh auth login`). The sweep only touches worktrees carrying the marker `worktree-open` writes, and skips a dirty one or one with commits the PR lacks. Never touch a worktree you did not open — others may belong to another process. See CONTRIBUTING.md, `write-rfc` and the `developer` skill.
- **Package manager** — pnpm with frozen lockfile.
- **TypeScript** — strict mode. Shared types live in `packages/shared`.
- **No external auth deps** — Auth is intentionally implemented with Web Crypto API only. Do not introduce `jsonwebtoken`, `bcrypt`, or similar.
- **Internationalization (i18n)** — Build-time dictionary system in `apps/web`.
  - No hardcoded user-facing strings in `src/{app,components,hooks}/**`. Verified by `check-i18n-coverage.js` script.
  - Server Components: import `dict` from `@web/i18n`.
  - Client Components: use the `useDict()` hook from `@web/context/dict-context`.
  - Dictionaries: `dict-en.ts` and `dict-pt.ts` must maintain identical keys.
  - Build: set `NEXT_PUBLIC_LANGUAGE=en` to build/run in English; defaults to `pt`. No runtime switcher UI is implemented.
