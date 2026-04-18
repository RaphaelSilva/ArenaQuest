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

**Cloudflare type generation:**
```bash
make cf-typegen   # regenerate Worker bindings types
```

**Deploy:**
```bash
make deploy-api           # API → production Workers
make deploy-api-staging   # API → staging Workers
make deploy-web           # Web → production Pages
make deploy-web-staging   # Web → staging Pages
```

## Architecture

Pnpm workspaces + Turborepo monorepo with three packages:

### `packages/shared`
Cloud-agnostic foundation. Two key areas:
- **`ports/`** — TypeScript interfaces (adapter contracts) for auth, database, and storage. The API implements these; swapping implementations (e.g. JWT → Auth0, D1 → Postgres) only requires a new adapter without touching business logic.
- **`types/entities.ts`** — Canonical entity schema organized in namespaces: `Entities.Config` (enums), `Entities.Identity` (User, Profile, UserGroup, Enrollments), `Entities.Content` (TopicNode hierarchy, Media, Tag), `Entities.Engagement` (Task, TaskStage), `Entities.Progress` (TopicProgress, TaskProgress). All apps import types from here.

### `apps/api`
Cloudflare Workers serverless backend. Patterns to follow:
- **Adapter pattern** — adapters are instantiated per-request inside the fetch handler (`src/index.ts`). Workers have no shared memory between requests, so never put adapter instances in module scope.
- **Auth** — `JwtAuthAdapter` (`src/adapters/jwt-auth-adapter.ts`) implements `IAuthAdapter` using the Web Crypto API (no external deps): PBKDF2-SHA256 for passwords, HS256 JWTs.
- **Bindings** — `JWT_SECRET` is the only current binding. `D1` (database) and `R2` (storage) bindings are Phase 2. Wrangler environment `staging` maps to the `api-staging` Worker.
- **Tests** — Vitest with `@cloudflare/vitest-pool-workers` so tests run inside an actual Worker runtime. Config: `vitest.config.mts`. Test types: `test/env.d.ts`.

### `apps/web`
Next.js 15 + React 19 frontend deployed to Cloudflare Pages via `@cloudflare/next-on-pages`. The build output directory is `.vercel/output/static`.

## Key Conventions

- **Commit style** — Conventional Commits (`feature:`, `hotfix:`, etc.). See CONTRIBUTING.md.
- **Branch strategy** — `main` (production), `develop` (staging), feature branches off `develop`.
- **Package manager** — pnpm with frozen lockfile. Use `pnpm --filter <name>` to scope commands to a workspace.
- **TypeScript** — strict mode throughout. Shared types live in `packages/shared`; never duplicate entity definitions across workspaces.
- **No external auth deps** — Auth is intentionally implemented with Web Crypto API only. Do not introduce `jsonwebtoken`, `bcrypt`, or similar packages.