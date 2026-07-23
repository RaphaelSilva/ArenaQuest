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
production implicitly. All deploy targets first run
`apps/api/scripts/check-no-dev-seed.ts` against the target database.

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

### `apps/api`
Cloudflare Workers serverless backend (Hono). Patterns to follow:
- **Adapter pattern** — adapters are instantiated per-request inside `buildApp(env)` in `src/index.ts` (Workers have no shared memory between requests, so never put adapter instances in module scope). Implementations live under `src/adapters/{auth,db,rate-limit,storage}/`.
- **Routes vs controllers** — `src/routes/*` only handle HTTP concerns (parsing, auth guards, response shaping). All business logic lives in `src/controllers/*` and returns a `ControllerResult<T>` (`{ ok: true, data } | { ok: false, status, error, meta? }`) defined in `src/core/result.ts`. Use the `@ValidateBody(schema)` method decorator together with the `@Body()` parameter decorator (`src/core/decorators.ts`) to centralise Zod validation; on failure they short-circuit with a `400 BadRequest` `ControllerResult`.
- **Auth** — `JwtAuthAdapter` implements `IAuthAdapter` using Web Crypto API. **PBKDF2 uses 100,000 iterations** (Cloudflare limit). Refresh tokens are persisted hashed via `D1RefreshTokenRepository`.
- **Storage** — `R2StorageAdapter` exposes a presigned-upload lifecycle backed by R2 over the S3-compatible API; `D1MediaRepository` tracks media records and their topic associations.
- **Bindings** — `JWT_SECRET` (secret), `DB` (D1), `RATE_LIMIT_KV` (KV), `R2` (bucket binding), `R2_S3_ENDPOINT`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE`, `R2_ACCESS_KEY_ID` (secret), `R2_SECRET_ACCESS_KEY` (secret), `ALLOWED_ORIGINS` (CORS), `COOKIE_SAMESITE` (security policy).
  - **`ALLOWED_ORIGINS`** — comma-separated list of allowed request origins. Three forms are supported by the `OriginPolicy` core module (`src/core/cors/`):
    1. **Exact** — `https://arenaquest-web.pages.dev` — only that literal origin is accepted.
    2. **Wildcard subdomain** — `https://*.arenaquest-web-staging.pages.dev` — any single-label subdomain of that host (e.g. PR preview deployments). Patterns with multiple wildcard labels are not supported.
    3. **Full wildcard** — `*` — echoes back the actual request `Origin` header (required because browsers block `Access-Control-Allow-Origin: *` on credentialed requests). **For local development only — never set this in staging or production.**
  - Production is locked to exact origins; do not introduce wildcards without a security review (see `docs/product/backlog/cors/`). Staging includes the PR-preview wildcard (`https://*.arenaquest-web-staging.pages.dev`). Local development uses `ALLOWED_ORIGINS=http://localhost:3000` (or `*`) in `.dev.vars` — see `.dev.vars.example`.
- **User Management** — Includes admin lockout guards to prevent deleting the last active admin or self-lockout.
- **Tests** — Vitest with `@cloudflare/vitest-pool-workers`. Config: `vitest.config.mts`.

### `apps/web`
Next.js 15 + React 19 frontend deployed to Cloudflare Pages via `@cloudflare/next-on-pages`. App router layout under `src/app/` is split into `(auth)` (login) and `(protected)` (admin backoffice, catalog, dashboard) groups. Admin tooling includes the topic-tree manager and media uploader; the participant catalog renders sanitised Markdown alongside dedicated media viewers. API clients live in `src/lib/*-api.ts`. Uses `NEXT_PUBLIC_API_URL` for environment-specific backend targeting.

## Key Conventions

- **Commit style** — Conventional Commits (`feature:`, `hotfix:`, etc.). See CONTRIBUTING.md.
- **Branch strategy** — `main` (production), `develop` (staging), feature branches off `develop`.
- **Package manager** — pnpm with frozen lockfile.
- **TypeScript** — strict mode. Shared types live in `packages/shared`.
- **No external auth deps** — Auth is intentionally implemented with Web Crypto API only. Do not introduce `jsonwebtoken`, `bcrypt`, or similar.
- **Internationalization (i18n)** — Build-time dictionary system in `apps/web`.
  - No hardcoded user-facing strings in `src/{app,components,hooks}/**`. Verified by `check-i18n-coverage.js` script.
  - Server Components: import `dict` from `@web/i18n`.
  - Client Components: use the `useDict()` hook from `@web/context/dict-context`.
  - Dictionaries: `dict-en.ts` and `dict-pt.ts` must maintain identical keys.
  - Build: set `NEXT_PUBLIC_LANGUAGE=en` to build/run in English; defaults to `pt`. No runtime switcher UI is implemented.
