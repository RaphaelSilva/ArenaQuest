# Contributing to ArenaQuest

Thank you for your interest in contributing to ArenaQuest! This document describes the branch strategy, pull request process, commit conventions, and local development setup so every contributor starts from the same foundation.

> **Language policy:** All code, comments, commit messages, branch names, and documentation **must be written in English**.

---

## 📋 Table of Contents

- [Branch Strategy](#-branch-strategy)
- [Workflow Overview](#-workflow-overview)
- [Commit Convention](#-commit-convention)
- [Pull Request Guidelines](#-pull-request-guidelines)
- [Local Development Setup](#-local-development-setup)
- [Local Test Accounts](#-local-test-accounts)
- [Code Style](#-code-style)
- [Reporting Issues](#-reporting-issues)

---

## 🌿 Branch Strategy

| Branch | Environment | Auto Deploy? |
|---|---|---|
| `main` | Production | ✅ Yes — after PR approval and merge |
| `develop` | Staging / Preview | ✅ Yes — automatically on push |
| `feature/*` | PR Preview | ✅ Yes — Cloudflare Pages Preview per PR |

### Rules

- **`main`** is the stable, production-ready branch. Direct pushes are **not allowed**. Changes land here only via a reviewed and approved Pull Request from `develop`.
- **`develop`** is the integration branch. All completed features are merged here first and deployed to the staging environment automatically.
- **`feature/*`** branches are short-lived and created from `develop`. They are merged back into `develop` via Pull Request.
- **`hotfix/*`** branches may be cut from `main` for critical production fixes and merged back into both `main` and `develop`.

---

## 🔄 Workflow Overview

```
main ◄──────────────────── PR (after staging validation)
  │
develop ◄──────────────── PR (feature complete)
  │
feature/my-feature ◄───── your work here
```

### Step-by-step

1. **Sync your local `develop`**
   ```bash
   git checkout develop
   git pull origin develop
   ```

2. **Create a feature branch**
   ```bash
   git checkout -b feature/short-description
   ```

3. **Develop, commit, and push**
   ```bash
   git add .
   git commit -m "feat(scope): short description"
   git push origin feature/short-description
   ```

4. **Open a Pull Request** targeting `develop`.
   - A Cloudflare Pages Preview URL will be generated automatically.
   - Ensure all CI checks pass before requesting review.

5. **After approval**, the branch is merged into `develop` via squash or merge commit.

6. When `develop` is stable and validated in staging, a **release PR** is opened from `develop` → `main` and deployed to production after approval.

---

## ✍️ Commit Convention

This project follows the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification.

```
<type>(<scope>): <short summary>
```

### Types

| Type | When to use |
|---|---|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation changes only |
| `style` | Formatting, missing semicolons, etc. (no logic change) |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `chore` | Build process, tooling, or dependency updates |
| `ci` | CI/CD configuration changes |

### Scopes (examples)

| Scope | Area |
|---|---|
| `web` | `apps/web` (Next.js front-end) |
| `api` | `apps/api` (Cloudflare Workers) |
| `shared` | `packages/shared` |
| `infra` | Infrastructure and CI/CD |
| `docs` | Documentation |

### Examples

```bash
feat(api): add authentication middleware
fix(web): correct scroll behavior on kyu page
docs: update branch strategy in CONTRIBUTING.md
chore(infra): upgrade wrangler to v4
```

---

## 🔀 Pull Request Guidelines

- **Target branch:** Always target `develop` (never `main` directly, except for hotfixes).
- **Title:** Follow the commit convention format — `type(scope): description`.
- **Description:** Explain *what* changed and *why*. Link related issues with `Closes #<issue-number>`.
- **Size:** Keep PRs focused. Large PRs should be split into smaller, independent changes.
- **Checks:** All CI checks (lint, build, tests) must pass before review.
- **Reviews:** At least **one approval** is required before merging.

---

## 🛠️ Local Development Setup

**Prerequisites:**
- Node.js ≥ 20
- pnpm ≥ 9

```bash
# 1. Clone the repository
git clone https://github.com/your-org/ArenaQuest.git
cd ArenaQuest

# 2. Bring the machine to a working local stack (deps, env files, local DB)
make setup

# 3. Start all apps in development mode
make dev

# — or start apps individually —
make dev-web   # Next.js at http://localhost:3000
make dev-api   # Cloudflare Worker at http://localhost:8787
```

Run `make help` to see the full list of available commands, and `make doctor`
if anything looks wrong — it diagnoses the machine without changing it. New to
the project? Start with **[docs/onboarding.md](docs/onboarding.md)**.

> **Makefile naming rule:** an unsuffixed target is always local
> (`make dev`, `make test`). A target that touches a deployed environment names
> it (`make db-migrate-staging`, `make deploy-prod`). `-api` / `-web` are
> *scope*, not environment.

---

## 🎨 Code Style

- **TypeScript** is enforced across the entire monorepo.
- **ESLint** is the linter — run `make lint` before opening a PR.
- **Prettier** is used for formatting in `apps/api` (see `.prettierrc`).
- Avoid commented-out code. Remove dead code before merging.
- Write meaningful variable and function names — code is read more than it is written.

---

## 🧪 Local Test Accounts

> **WARNING:** These accounts are for **local development only**. Never seed them in staging or production.

Three pre-configured accounts are available for manual testing and cover all three access personas.

### Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@arenaquest.dev` | `Admin1234!` |
| Student | `student@arenaquest.dev` | `Student1234!` |
| Professor (tutor + content_creator) | `professor@arenaquest.dev` | `Professor1234!` |

### Provisioning

`make setup` provisions these for you on a fresh machine. To do it by hand:

```bash
make db-migrate-local   # apply the schema migrations first
make db-seed-local      # insert the three test accounts
```

`make db-seed-local` is idempotent — running it multiple times produces no duplicates or errors.
If the local database ends up in a bad state, `make db-reset-local` deletes the
replica and rebuilds it from scratch.

### Regenerating password hashes

If the seed passwords are changed, regenerate the PBKDF2 hashes and update `apps/api/migrations/seed/0001_test_users.sql`:

```bash
cd apps/api
npx tsx scripts/generate-seed-hashes.ts
```

Copy the output hashes into the migration file. Only commit the hashes — **never commit plain-text passwords**.

---

## 🐛 Reporting Issues

Found a bug or have a feature request? [Open an issue](https://github.com/your-org/ArenaQuest/issues) and use the appropriate template:

- 🐛 **Bug report** — describe the expected vs. actual behaviour, reproduction steps, and environment.
- 💡 **Feature request** — describe the problem you are trying to solve and the proposed solution.

---

## 📄 License

By contributing, you agree that your contributions will be licensed under the same [MIT License](LICENSE) that covers this project.
