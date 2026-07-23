# ArenaQuest

**ArenaQuest** is an open-source, cloud-agnostic engagement and knowledge management portal designed to gamify and track progress in physical and sports activities. Built with a focus on portability and scalability, the platform connects content creators (instructors) and participants (students) through a modular, serverless-ready architecture.

## 🚀 Vision

The project aims to provide a robust framework for managing hierarchical topics, tasks, and student evolution without being locked into a specific cloud provider. Whether you are running on AWS, GCP, Azure, or a private Proxmox-based homelab, ArenaQuest adapts to your infrastructure.

## 🏗️ Technical Architecture

The system is designed following a **Cloud-Agnostic Strategy**:

- **Front-End:** Next.js 15 (React 19) covering the participant catalog, admin backoffice, and authentication flows.
- **Back-End:** Hono-based API running on Cloudflare Workers (Wrangler), organised around a controller layer with `ControllerResult`, Zod-driven `@ValidateBody`/`@Body` decorators, and per-request adapter wiring.
- **Database:** Cloudflare D1 (SQLite) for structured data with a repository-based abstraction layer (users, refresh tokens, topic nodes, tags, media).
- **Cache/Rate-Limit:** Cloudflare KV for transient state and security (login throttling).
- **Storage:** Cloudflare R2 (S3-compatible) with a presigned-upload lifecycle for media handling.

## 🛠️ Key Features (Phase 1 & Beyond)

- **Secure Authentication:** Portable JWT-based auth with PBKDF2 hashing (Web Crypto API), refresh-token rotation, and KV-backed login rate limiting.
- **Hierarchical Content Management:** Topic-tree engine with draft/published/archived states, prerequisites, tags, and Markdown content sanitisation.
- **Media Pipeline:** Presigned uploads to R2/S3, attached to topics and surfaced through dedicated viewers (image, video, document).
- **Engagement Engine:** Tasks and stages to track user milestones (in progress).
- **Student Progress Portal:** A dedicated area for participants to navigate the catalog and visualise their growth.
- **Administrative Backoffice:** Drag-and-drop topic tree, media manager, and user administration with admin lockout guards.

## 🗺️ Roadmap

1. **✅ Foundation & Infrastructure:** Core repository, monorepo setup, and CI/CD.
2. **✅ Auth & User Management:** Secure, portable authentication and admin guards.
3. **✅ Core Content & Media:** Hierarchical topic engine, R2-backed media pipeline, and public catalog.
4. **🚧 Task Engine:** Building the logic for interconnection and progress tracking.

---

## 📂 Repository Structure

This project is organized as a **monorepo** using [pnpm workspaces](https://pnpm.io/workspaces) and [Turborepo](https://turbo.build/repo).

```
ArenaQuest/
├── apps/
│   ├── web/               # Next.js front-end application
│   └── api/               # Cloudflare Workers API (Wrangler)
├── packages/
│   └── shared/            # Shared types, ports (interfaces), and utilities
├── turbo.json             # Turborepo pipeline configuration
├── pnpm-workspace.yaml    # pnpm workspace declarations
├── package.json           # Root package (dev tooling)
└── Makefile               # Developer shortcuts (see below)
```

---

## ⚙️ Getting Started

**Prerequisites:** Node.js ≥ 20 and pnpm ≥ 9.

```bash
# 1. Clone the repository
git clone https://github.com/your-org/ArenaQuest.git
cd ArenaQuest

# 2. Bring the machine to a working local stack (idempotent)
make setup

# 3. Start all apps in development mode (parallel)
make dev
```

`make setup` installs dependencies, creates `apps/api/.dev.vars` and
`apps/web/.env.local` from their committed templates, generates a local
`JWT_SECRET`, then migrates and seeds the local D1 database. It never
overwrites a file you already have, so it is safe to re-run at any time.

> The web app will be available at **http://localhost:3000** and the API Worker at **http://localhost:8787** by default.
> Log in with the seed account `admin@arenaquest.dev` / `Admin1234!`.

**Local development requires no Cloudflare account.** Only media upload (R2),
Google sign-in, and staging/production targets need real credentials.

If anything looks wrong, `make doctor` diagnoses the machine without changing
it and names the exact target that fixes each gap. The full runbook —
optional credentials, troubleshooting, known issues — lives in
**[docs/onboarding.md](docs/onboarding.md)**.

---

## 🧰 Makefile Reference

A `Makefile` is provided at the root of the repository with convenient shortcuts for the most common development tasks. Run `make help` at any time to list all available commands.

> **Naming rule:** an unsuffixed target is **always local**. A target that
> touches a deployed environment **names that environment**. `-api` / `-web` /
> `-shared` are *scope*, not environment. There is no implicit production —
> every `-prod` target asks you to type `production` before it runs
> (`CONFIRM=1` bypasses it for scripts).

### 🩺 Local — first run & diagnosis

| Command | Description |
|---|---|
| `make setup` | Bring a fresh machine to a working local stack (idempotent) |
| `make doctor` | Diagnose the local environment — read-only, never mutates |
| `make install` | Install all workspace dependencies via `pnpm install` |
| `make bootstrap-admin` | Interactively create the first admin account (prompts for the environment) |

### 🚀 Local — development

| Command | Description |
|---|---|
| `make dev` | Start **all** apps in parallel (via Turborepo) |
| `make dev-web` | Start only `apps/web` (Next.js dev server, `:3000`) |
| `make dev-api` | Start only `apps/api` (Wrangler dev server, `:8787`) |

### 🏗️ Local — build, lint & test

| Command | Description |
|---|---|
| `make build` | Build all apps and packages via Turborepo |
| `make lint` | Lint all workspaces |
| `make test` | Run all tests across the monorepo |

Each accepts an `-api` / `-web` scope suffix, e.g. `make test-api`.

### 🗄️ Local — database

| Command | Description |
|---|---|
| `make db-migrate-local` | Apply D1 migrations to the local replica |
| `make db-seed-local` | Insert the three local test accounts (idempotent) |
| `make db-reset-local` | Delete the local replica, then re-migrate and re-seed |
| `make cf-typegen` | Regenerate Worker binding types |

### 🟡 Staging — remote

| Command | Description |
|---|---|
| `make deploy-staging` | Deploy **both** apps to staging |
| `make deploy-api-staging` / `deploy-web-staging` | Deploy one app to staging |
| `make db-migrate-staging` | Apply D1 migrations to the remote staging database |
| `make create-db-staging` / `create-kv-staging` / `list-kv-staging` | Manage staging resources |
| `make cf-info-staging` | List staging R2 buckets, D1 databases and KV namespaces |
| `make secret-staging NAME=JWT_SECRET` | Set a staging Worker secret |

### 🔴 Production — remote (each target asks for confirmation)

| Command | Description |
|---|---|
| `make deploy-prod` | Deploy **both** apps to production |
| `make deploy-api-prod` / `deploy-web-prod` | Deploy one app to production |
| `make db-migrate-prod` | Apply D1 migrations to the remote production database |
| `make create-db-prod` / `create-kv-prod` / `list-kv-prod` | Manage production resources |
| `make cf-info-prod` | List production R2 buckets, D1 databases and KV namespaces |
| `make secret-prod NAME=JWT_SECRET` | Set a production Worker secret |

Both `deploy-*-staging` and `deploy-*-prod` first run
`apps/api/scripts/check-no-dev-seed.ts` against the target database and abort
if the local dev-seed accounts are found there.

> **Renamed:** `db-migrations-dev` → `db-migrate-local`, `db-seed-dev` →
> `db-seed-local`, `create-db` → `create-db-prod`, and so on. The old names
> still work but print a deprecation pointer. The exceptions are `make deploy`,
> `make deploy-api` and `make deploy-web`: they used to mean *production*
> implicitly, so they now fail and tell you to name the environment.

### 🧹 Clean

| Command | Description |
|---|---|
| `make clean` | Remove `.next`, `.vercel`, and `dist` build artefacts |
| `make clean-cache` | Remove Turborepo caches |
| `make clean-all` | Run both of the above |

---

## 🚀 CI / CD & GitHub Secrets

The following GitHub Actions workflows are defined in `.github/workflows/`:

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | Push / PR → `main`, `develop` | Lint → Build → Test |
| `deploy-web.yml` | Push → `main`, `develop` | Build & deploy `apps/web` |
| `deploy-api.yml` | Push → `main`, `develop` | Build & deploy `apps/api` |

### Required GitHub Secrets

| Secret | Description |
|---|---|
| `CF_API_TOKEN` | Cloudflare API token (Pages & Workers edit permissions) |
| `CF_ACCOUNT_ID` | Your Cloudflare account ID |

---

## 🤝 Contributing

As an open-source project, we welcome contributions! Please read the [CONTRIBUTING.md](CONTRIBUTING.md) guide before opening a Pull Request.

## 📄 License

This project is licensed under the [MIT License](LICENSE).
