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
make db-migrate-local      # apply migrations to local D1 (dev)
make db-migrate-staging    # apply migrations to staging D1
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
Cloud-agnostic foundation. Two key areas:
- **`ports/`** — TypeScript interfaces (adapter contracts) for auth, database, and storage. The API implements these; swapping implementations (e.g. JWT → Auth0, D1 → Postgres) only requires a new adapter without touching business logic.
- **`types/entities.ts`** — Canonical entity schema organized in namespaces: `Entities.Config` (enums), `Entities.Identity` (User, Profile, UserGroup, Enrollments), `Entities.Content` (TopicNode hierarchy, Media, Tag), `Entities.Engagement` (Task, TaskStage), `Entities.Progress` (TopicProgress, TaskProgress). All apps import types from here.

### `apps/api`
Cloudflare Workers serverless backend (Hono). Patterns to follow:
- **Adapter pattern** — adapters are instantiated per-request inside the fetch handler (`src/index.ts`). Workers have no shared memory between requests, so never put adapter instances in module scope.
- **Auth** — `JwtAuthAdapter` implements `IAuthAdapter` using Web Crypto API. **PBKDF2 uses 100,000 iterations** (Cloudflare limit).
- **Bindings** — `JWT_SECRET` (secret), `DB` (D1 database), `RATE_LIMIT_KV` (KV namespace), `ALLOWED_ORIGINS` (CORS), and `COOKIE_SAMESITE` (security policy).
- **User Management** — Includes admin lockout guards to prevent deleting the last active admin or self-lockout.
- **Tests** — Vitest with `@cloudflare/vitest-pool-workers`. Config: `vitest.config.mts`.

### `apps/web`
Next.js 15 + React 19 frontend deployed to Cloudflare Pages via `@cloudflare/next-on-pages`. Uses `NEXT_PUBLIC_API_URL` for environment-specific backend targeting.

## Key Conventions

- **Commit style** — Conventional Commits (`feature:`, `hotfix:`, etc.). See CONTRIBUTING.md.
- **Branch strategy** — `main` (production), `develop` (staging), feature branches off `develop`.
- **Package manager** — pnpm with frozen lockfile.
- **TypeScript** — strict mode. Shared types live in `packages/shared`.
- **No external auth deps** — Auth is intentionally implemented with Web Crypto API only. Do not introduce `jsonwebtoken`, `bcrypt`, or similar.