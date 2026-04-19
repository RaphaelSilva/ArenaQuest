# ArenaQuest — Release Notes

> An initial, ongoing changelog of what has shipped so far. Follow
> [Conventional Commits](https://www.conventionalcommits.org/) in git history for the
> authoritative record; this file is the human-readable summary.

---

## [Unreleased] — Milestone 2: Authentication & User Management

**Status:** feature-complete (9/9 tasks). Pending hardening items tracked in
[`docs/product/milestones/2/closeout-analysis.md`](./product/milestones/2/closeout-analysis.md).

### Added

**Shared package (`packages/shared`)**

- `IUserRepository` port with `UserRecord`, `CreateUserInput`, `UpdateUserInput` types.
- `IRefreshTokenRepository` port.
- `ROLES` constant set + `RoleName` type (`admin`, `content_creator`, `tutor`, `student`)
  exported from `@arenaquest/shared/constants/roles`.
- `Entities.Security.Role` on the `User` entity.

**API (`apps/api`) — Cloudflare Worker**

- Integrated **Hono** as the HTTP framework; worker entry now mounts a single app via
  `AppRouter.register(...)`.
- `JwtAuthAdapter` — zero-dependency, Web-Crypto-only implementation:
  - PBKDF2-SHA256 password hashing with self-describing `pbkdf2:<iter>:<salt>:<hash>`
    format (per-hash iteration upgrades supported).
  - HS256 JWT signing / verification.
  - 256-bit cryptographically random refresh tokens.
  - Constant-time password comparison via HMAC sign+verify.
- `AuthService` — login, logout, refresh-token rotation. Throws typed `AuthError`
  (`INVALID_CREDENTIALS`, `ACCOUNT_INACTIVE`, `INVALID_REFRESH_TOKEN`) with no DB leakage.
- `D1UserRepository` + `D1RefreshTokenRepository` adapters.
- Migrations:
  - `0001_create_users.sql` — `users`, `roles`, `user_roles`.
  - `0002_seed_roles.sql` — idempotent seed of the four canonical roles.
  - `0003_create_refresh_tokens.sql` — refresh-token storage.
- Dev seed under `apps/api/scripts/0004_seed_dev_users.sql` (admin + student with known
  password — local use only).
- Auth endpoints under `/auth`:
  - `POST /auth/login` → 200 + `accessToken` + `HttpOnly; Secure; SameSite=Strict`
    refresh-token cookie.
  - `POST /auth/logout` → 204, revokes refresh token.
  - `POST /auth/refresh` → 200 + new `accessToken`, rotates the cookie.
- `authGuard` and `requireRole(...roles)` Hono middlewares; `GET /protected/ping` sanity
  endpoint.
- Admin CRUD under `/admin/users` (guarded by `authGuard + requireRole(ROLES.ADMIN)`):
  - `GET /admin/users`, `GET /admin/users/:id`, `POST`, `PATCH`, `DELETE` (soft-delete).
  - Zod validation; soft-delete sets `status = 'inactive'`; password hashed before
    persistence; `409 Conflict` on duplicate email.
- `GET /health` reports wired-adapter status.
- CORS middleware driven by the `ALLOWED_ORIGIN` env var; `JWT_SECRET` enforced to
  ≥ 32 characters at startup.

**Web (`apps/web`) — Next.js 15 / React 19**

- `authApi` client (`lib/auth-api.ts`) using `credentials: 'include'` so the HttpOnly
  refresh cookie travels automatically.
- `AuthProvider` / `AuthContext` + hooks `useAuth`, `useCurrentUser`, `useHasRole`.
- Access token kept in memory only; JWT claims decoded client-side to populate the
  current-user object.
- On mount, `AuthContext` calls `authApi.refresh()` to silently restore sessions.
- `/login` page — inline error for `401`, loading spinner, redirects to `/dashboard` on
  success.
- Edge middleware at `apps/web/src/middleware.ts` gate-keeping `/dashboard/*` and
  `/admin/*` on refresh-cookie presence.
- `(protected)` route group with a layout that redirects to `/login` if the auth
  restore finishes with `user === null`.
- `<CanView role="admin">` component + RBAC-aware top nav (`nav.tsx`).
- `/admin/users` dashboard: paginated table, create-user modal, inline edit, deactivate
  confirmation; all requests carry `Authorization: Bearer <accessToken>`.

### Tests

- API: **85** tests across 9 files (Vitest + `@cloudflare/vitest-pool-workers`) — unit,
  integration, and in-runtime D1 round-trips.
- Web: **30** tests across 3 files (Vitest + React Testing Library).

### Security Notes

- `HttpOnly; Secure; SameSite=Strict` on the refresh-token cookie.
- Access tokens short-lived (15 min); refresh tokens rotated on every `/auth/refresh`.
- `JwtAuthAdapter` rejects any secret shorter than 32 chars at construction time.
- All admin endpoints enforce role check server-side; the UI gate is a secondary layer.

### Known Limitations (carried into Milestone 3)

- **No first-login journey.** Admin-created users receive their password out-of-band —
  no invitation email, no forced password change, no use of the `pending` status.
- **No password reset / email verification.**
- **Refresh tokens stored in plaintext** in D1 — planned to hash with SHA-256 before
  Milestone 3 starts.
- **No revocation of active sessions** when an admin deactivates a user or changes roles.
- **No rate-limit / account lockout** on `/auth/login`.
- **No E2E tests** — Playwright/Cucumber deferred to Milestone 3.
- See [`closeout-analysis.md`](./product/milestones/2/closeout-analysis.md) for the full
  list.

---

## [0.1.0] — Milestone 1: Foundation & Infrastructure

### Added

- pnpm workspaces + Turborepo monorepo with `apps/api`, `apps/web`, and
  `packages/shared`.
- Cloudflare Workers setup for the API (`wrangler.jsonc`) and Cloudflare Pages via
  `@cloudflare/next-on-pages` for the web app.
- Ports-and-Adapters foundation in `packages/shared`:
  `IAuthAdapter`, `IDatabaseAdapter`, `IStorageAdapter`.
- Canonical entity namespaces in `packages/shared/types/entities.ts`
  (`Config`, `Identity`, `Content`, `Engagement`, `Progress`).
- GitHub Actions CI (lint + test) and CD (deploy on push to `main` / `develop`).
- Mermaid-based documentation pipeline generating architectural SVGs under
  `docs/product/architecture/`.
- `GET /health` hello-world endpoint and a landing page on the web app.
- Makefile shortcuts (`make dev`, `make test`, `make deploy-api`, etc.).

### Verified

- `pnpm install` + `pnpm turbo run build` green at the root.
- API returns JSON from its Workers URL.
- Web app deploys to a Pages URL.
- `packages/shared` importable from both apps.

---

_For commit-level detail use `git log --oneline --decorate`._
