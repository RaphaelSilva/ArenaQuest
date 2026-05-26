# ArenaQuest API — Versioning and Cutover Plan

This document details the versioning policy for the ArenaQuest API and the cutover strategy for the migration from unversioned routes to the `/v1` prefix.

## Versioning Policy

To ensure high reliability, predictable updates, and zero downtime for clients, all business-facing API endpoints have been consolidated under a `/v1` namespace prefix (RFC 0003):

- **Version Carrier**: Path prefix (`/v1`)
- **Versioned Resources**: `/v1/auth/*`, `/v1/me/*`, `/v1/admin/*`, `/v1/topics/*`, `/v1/tasks/*`, `/v1/leaderboard`, `/v1/catalog/*`.
- **Unversioned Resources**: `/health` (health check), `/openapi.json` (OpenAPI contract definition), `/docs` (Scalar interactive API reference).

The active contract payload is documented dynamically at `/openapi.json` and only lists the `/v1/...` routes.

## Cutover Plan & Deprecation Window

To support seamless transitions of existing clients (including `apps/web`) without forcing an immediate break:

1. **Transparent Internal Rewrites (The Bridge)**: 
   A lightweight, zero-overhead rewriter in the Worker entrypoint handles incoming requests on legacy root paths (e.g. `POST /auth/login`) and transparently routes them to the `/v1` equivalents internally without issuing HTTP 302/307 redirects or making extra fetch calls.

2. **Timeline**:
   - **Bridge Launch**: May 2026. All legacy clients remain fully functional.
   - **Client Migration Window**: May 26, 2026 – June 30, 2026. All active client developers must update their API base path config to append `/v1`.
   - **Deprecation Date**: July 1, 2026. The legacy rewrite bridge will be decommissioned, and root-level legacy paths will return `404 Not Found`.

3. **Client Health Metrics**:
   Migration progress will be monitored via Cloudflare Analytics and Worker Logs using request path counts:
   - Target: `Count(Path does not start with /v1 or /health or /openapi.json or /docs)` must reach `0` before decommissioning.
