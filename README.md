# ArenaQuest

**ArenaQuest** is an open-source, cloud-agnostic engagement and knowledge management portal designed to gamify and track progress in physical and sports activities. Built with a focus on portability and scalability, the platform connects content creators (instructors) and participants (students) through a modular, serverless-ready architecture.

## 🚀 Vision

The project aims to provide a robust framework for managing hierarchical topics, tasks, and student evolution without being locked into a specific cloud provider. Whether you are running on AWS, GCP, Azure, or a private Proxmox-based homelab, ArenaQuest adapts to your infrastructure.

## 🏗️ Technical Architecture

The system is designed following a **Cloud-Agnostic Strategy**:

- **Front-End:** Next.js 15 (React 19) focused on the participant's journey.
- **Back-End:** Hono-based API running on Cloudflare Workers (Wrangler).
- **Database:** Cloudflare D1 (SQLite) for structured data with a repository-based abstraction layer.
- **Cache/Rate-Limit:** Cloudflare KV for transient state and security.
- **Storage:** Object Storage integration (R2/S3 compatible) for media handling.

## 🛠️ Key Features (Phase 1 & Beyond)

- **Secure Authentication:** Portable JWT-based auth with PBKDF2 hashing (Web Crypto API).
- **Hierarchical Content Management:** Organize sports and activities into logical trees of topics and sub-topics.
- **Engagement Engine:** Define tasks and stages to track user milestones.
- **Student Progress Portal:** A dedicated area for participants to visualize their growth.
- **Administrative Backoffice:** Comprehensive tools for managing users (with lockout protection), content, and system configurations.

## 🗺️ Roadmap

1. **✅ Foundation & Infrastructure:** Core repository, monorepo setup, and CI/CD.
2. **✅ Auth & User Management:** Secure, portable authentication and admin guards.
3. **🚧 Core Content & Media:** Deploying the hierarchical topic engine and media storage.
4. **📅 Task Engine:** Building the logic for interconnection and progress tracking.

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

# 2. Install all workspace dependencies
make install

# 3. Start all apps in development mode (parallel)
make dev
```

> The web app will be available at **http://localhost:3000** and the API Worker at **http://localhost:8787** by default.

---

## 🧰 Makefile Reference

A `Makefile` is provided at the root of the repository with convenient shortcuts for the most common development tasks. Run `make help` at any time to list all available commands.

### 📦 Install & Setup

| Command | Description |
|---|---|
| `make install` | Install all workspace dependencies via `pnpm install` |
| `make bootstrap-admin` | Interactively create the first admin account |

### 🚀 Development

| Command | Description |
|---|---|
| `make dev` | Start **all** apps in parallel (via Turborepo) |
| `make dev-web` | Start only `apps/web` (Next.js dev server) |
| `make dev-api` | Start only `apps/api` (Wrangler dev server) |

### 🏗️ Build & Lint

| Command | Description |
|---|---|
| `make build` | Build all apps and packages via Turborepo |
| `make lint` | Lint all workspaces |
| `make test` | Run all tests across the monorepo |

### 🗄️ Database (D1)

| Command | Description |
|---|---|
| `make db-migrate-local` | Apply migrations to local D1 instance |
| `make db-migrate-staging`| Apply migrations to remote staging D1 |

### ☁️ Deployment

| Command | Description |
|---|---|
| `make deploy` | Deploy both Web and API to **Production** |
| `make deploy-staging` | Deploy both Web and API to **Staging** |
| `make deploy-api` | Deploy only `apps/api` (Production) |
| `make deploy-web` | Deploy only `apps/web` (Production) |

### 🧹 Clean

| Command | Description |
|---|---|
| `make clean-all` | Remove all build artefacts and Turborepo caches |

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
