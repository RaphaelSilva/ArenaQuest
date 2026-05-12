# Task 07: Google OAuth Config & Bindings

## Metadata
- **Status:** Completed
- **Complexity:** Small
- **Milestone:** 6 — Auth Self-Service & Social Login
- **Dependencies:**
  - M2 Task 01 — `apps/api/src/types/hono-env.ts` Bindings interface must exist

---

## Summary

Register the Google OAuth configuration values as Cloudflare Worker bindings and document the required Google Cloud Console setup. This task is purely infrastructure and configuration — no application logic changes. It must be completed before the OAuth API endpoints (Task 08) can be tested end-to-end.

---

## Architectural Context

- **Bindings model:** Worker bindings are the correct location for environment-specific config in this stack (not `.env` files). Plain values go in `wrangler.toml` `[vars]`; secrets go in Wrangler secrets and are referenced under `[secrets]`.
- **Secret handling:** `GOOGLE_CLIENT_SECRET` must never appear in `wrangler.toml` or any committed file. It is set via `wrangler secret put` for each environment (dev/staging/production).
- **Cloud-Agnostic note:** Google OAuth is the external dependency, but the Worker binding approach is portable — any serverless platform can inject environment variables at runtime. The OAuth flow itself (PKCE + HTTPS token exchange) is a standard internet protocol, not Cloudflare-specific.

---

## Scope

### 1. Google Cloud Console Setup (documentation only)

Document the required steps in `docs/product/milestones/6/google-oauth-setup.md`:

- Create an OAuth 2.0 Client ID (Web application type) in the Google Cloud Console.
- Authorised redirect URIs to configure per environment:
  - Local dev: `http://localhost:8787/auth/google/callback`
  - Staging: `https://<staging-worker-hostname>/auth/google/callback`
  - Production: `https://<production-worker-hostname>/auth/google/callback`
- How to obtain `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from the console.

### 2. `wrangler.toml` Changes

Add to each environment section (`[env.dev]`, `[env.staging]`, `[env.production]`):

- `GOOGLE_CLIENT_ID` — as a `[vars]` entry (non-secret, per-environment value).
- `GOOGLE_REDIRECT_URI` — as a `[vars]` entry (per-environment callback URL).

Add `GOOGLE_CLIENT_SECRET` to the `[secrets]` list (name only — no value in the file).

Add `FRONTEND_BASE_URL` as a `[vars]` entry (used by the callback to construct the redirect back to the web app). This var is also needed by Task 02's mail template for the password-reset link — confirm it is present or add it now.

### 3. `hono-env.ts` Bindings Interface

Add `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`, `GOOGLE_CLIENT_SECRET`, and `FRONTEND_BASE_URL` to the `Bindings` interface in `apps/api/src/types/hono-env.ts`.

### 4. `.dev.vars.example` Update

Add placeholder entries for:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_CLIENT_SECRET`
- `FRONTEND_BASE_URL`

Add a comment pointing to the Google OAuth setup doc for first-time setup instructions.

---

## Acceptance Criteria

- [x] `apps/api/src/types/hono-env.ts` compiles with the new binding fields and the rest of the codebase continues to type-check.
- [x] `wrangler.toml` has the new vars for all three environments (dev, staging, production).
- [x] `.dev.vars.example` has all new placeholder keys with comments.
- [x] `docs/product/milestones/6/google-oauth-setup.md` documents the console setup steps.
- [x] `GOOGLE_CLIENT_SECRET` does not appear in any committed file.
- [x] `make lint` passes.

---

## Verification Plan

### Automated
- `pnpm turbo run build` — confirms the TypeScript changes compile cleanly across all workspaces.

### Manual
- A developer follows `google-oauth-setup.md`, copies `.dev.vars.example` to `.dev.vars`, fills in their credentials, and starts `make dev-api` without errors.
