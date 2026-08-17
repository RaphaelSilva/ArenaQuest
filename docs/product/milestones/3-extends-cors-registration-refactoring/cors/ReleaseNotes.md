# Release Notes: Dynamic CORS Origin Policy

This release introduces a robust, centralized CORS management system for the ArenaQuest API, moving from static strings to a rule-based `OriginPolicy` engine. This enables seamless support for Cloudflare Pages preview deployments while maintaining strict security for production.

## Key Features

### 1. Adaptive Origin Matching
The API now supports three distinct forms of origin configuration via the `ALLOWED_ORIGINS` environment variable:
- **Exact Match**: (e.g., `https://arenaquest-web.pages.dev`) Literal strings are checked in O(1) time using a hash set.
- **Wildcard Subdomains**: (e.g., `https://*.pages.dev`) Support for single-label deep subdomains. This is primarily used in staging to allow every PR preview deployment to communicate with the API.
- **Full Wildcard**: (`*`) Accepts any origin. To comply with browser security specs for credentialed requests, the API "echoes" the request's actual origin rather than returning a literal `*`.

### 2. Environment Rollout
Configuration has been updated across all environments in `apps/api/wrangler.jsonc`:
- **Production**: Locked to exact-match only (`https://arenaquest-web.pages.dev`). A protective comment has been added to prevent accidental loosening of security.
- **Staging**: Configured to accept the main staging domain, localhost, and all PR previews via `https://*.arenaquest-web-staging.pages.dev`.
- **Local Dev**: Defaults to `http://localhost:3000` via `.dev.vars.example`, with support for `*` for testing.

### 3. Security & Robustness
- **Validation at Boot**: All origin patterns are validated when the app starts. Invalid patterns (e.g., missing schemes, multiple wildcards, or unsafe deep wildcards) will prevent the worker from starting with a clear error message.
- **Precedence**: Exact matches always take precedence over wildcards.
- **Safety Guardrails**: 
  - Host wildcards are restricted to one label deep (e.g., `https://*.pages.dev` will NOT match `https://evil.sub.pages.dev`).
  - A console warning is emitted at boot if `*` is used alongside credentials, explaining the "echo" behavior.
  - No regular expressions are constructed from user-provided strings, preventing ReDoS or injection attacks.

## Developer Experience (DX)
- **Centralized Documentation**: The `CLAUDE.md` file now contains a dedicated section on `ALLOWED_ORIGINS` explaining the syntax and security implications.
- **New Template**: `apps/api/.dev.vars.example` has been added to simplify local environment setup for new contributors.
- **Zero Boilerplate**: The core matching logic is abstracted into a module, so individual routes don't need to know about patterns or wildcards.

## Files Impacted
- `apps/api/src/core/cors/origin-policy.ts`: The core matching engine.
- `apps/api/wrangler.jsonc`: Environment configuration.
- `apps/api/.dev.vars.example`: Local dev template.
- `CLAUDE.md`: Architecture and binding documentation.
- `docs/product/backlog/cors/`: Task tracking and design records.

---
*Date: 2026-04-30*  
*Milestone: 3 — Security & Infrastructure*
