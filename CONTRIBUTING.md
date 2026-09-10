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

`main` is the trunk. Feature branches are cut from it and merged back into it;
there is no long-lived integration branch in between.

| Branch | Environment | Auto Deploy? |
|---|---|---|
| `main` | Staging, then Production | ✅ Yes — staging and production, on every merge |
| `feature/*` | PR Preview | ✅ Yes — Cloudflare Pages Preview per PR |
| `feature/*` (on demand) | Staging | ▶️ Manual — `workflow_dispatch` on the branch |

### Rules

- **`main`** is the trunk and the only long-lived branch. Direct pushes are **not
  allowed**: changes land through a reviewed Pull Request. A merge deploys
  **staging first, then production** in one pipeline — see *What a merge deploys*.
- **`feature/*`** branches are short-lived and created from `main`. They are
  merged back into `main` via Pull Request.
- **`hotfix/*`** branches are also cut from `main` and follow the same path; the
  only difference is urgency, not mechanics.
- There is **no `develop` branch**. Its two former jobs are covered directly:
  staging validation by dispatching the deploy workflow on the feature branch,
  and the production gate by the environment approval below. A long-lived
  integration branch that lags behind `main` is worse than none — pushing to a
  stale one redeploys staging with *older* code, silently.

### What a merge deploys

The deploy workflows (`.github/workflows/deploy-{api,web}.yml`) run three jobs in
sequence:

```
verify (lint · build · test)
   └─► deploy-staging      # no branch condition
          └─► deploy-production   # if: github.ref_name == 'main'
```

So production is never reached without staging having just been deployed from the
same commit — but that is a pipeline step, not a soak period. **The human gate is
the environment approval**: the production jobs declare
`environment: production | prod-spaziord | prod-budo`, so a *required reviewer*
configured on those GitHub Environments pauses the run and waits for an explicit
approval before anything touches production.

### Validating on staging before merging

`deploy-staging` has no branch condition and both workflows expose
`workflow_dispatch`, so any branch can be deployed to staging on demand — from
the Actions tab, run *Deploy API* / *Deploy Web* against your feature branch.
Production is skipped automatically, because the ref is not `main`. Locally, the
equivalent is `make deploy-staging`.

---

## 🔄 Workflow Overview

```
main ◄──────────────────── PR (reviewed, CI green)
  │
feature/my-feature ◄───── your work here
```

### Step-by-step

1. **Sync your local `main`**
   ```bash
   git checkout main
   git pull origin main
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

4. **Open a Pull Request** targeting `main`.
   - A Cloudflare Pages Preview URL will be generated automatically.
   - Ensure all CI checks pass before requesting review.

5. **For a delicate change**, deploy the branch to staging first
   (`workflow_dispatch`, see above) and validate there before requesting review.

6. **After approval**, the branch is merged into `main` via squash or merge
   commit. The pipeline deploys staging, then waits for the production
   environment approval.

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

- **Target branch:** Always target `main`. Merging deploys staging and then queues production, so the PR is the review gate.
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
