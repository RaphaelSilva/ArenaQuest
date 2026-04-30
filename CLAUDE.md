# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Run all apps locally:**
```bash
make dev          # all apps in parallel (Turborepo)
make dev-web      # Next.js only (localhost:3000)
make dev-api      # Cloudflare Worker only (localhost:8787)
```

**Build, lint, test:**
```bash
pnpm turbo run build   # build all workspaces (with Turborepo caching)
make lint              # lint entire monorepo
make test              # run all tests
make test-api          # run API tests only (Vitest + Cloudflare Workers pool)
```

**Run a single test (Vitest in apps/api):**
```bash
cd apps/api && pnpm test test/index.spec.ts
cd apps/api && pnpm test --grep "test name"
```

**Cloudflare & Database:**
```bash
make cf-typegen            # regenerate Worker bindings types
make db-migrations-dev     # apply migrations to local D1 (dev)
make db-migrations-staging # apply migrations to remote staging D1
make db-migrations-prod    # apply migrations to remote production D1
make create-db             # create production D1 database
make create-kv             # create RATE_LIMIT_KV namespace
```

**Deploy:**
```bash
make deploy                # Deploy both Web and API to production
make deploy-staging        # Deploy both Web and API to staging
make deploy-api            # API → production Workers
make deploy-api-staging    # API → staging Workers
make deploy-web            # Web → production Pages
make deploy-web-staging    # Web → staging Pages
```

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