# Task 03: Roll Out the New CORS Config Across Environments

## Metadata
- **Status:** Done
- **Complexity:** Small
- **Area:** `apps/api`, ops/config
- **Depends on:** Task 01 (origin policy module), Task 02 (wildcard support)
- **Blocks:** —

---

## Summary

Tasks 01–02 ship the engine. This task wires the new format into the **actual** environments and writes down the rules so future contributors don't reintroduce a stray exact origin where a wildcard belongs.

Today (`apps/api/wrangler.jsonc`):

- **Production** `vars.ALLOWED_ORIGINS = "https://arenaquest-web.pages.dev"` — the production Pages URL only.
- **Staging** `env.staging.vars.ALLOWED_ORIGINS = "https://arenaquest-web-staging.pages.dev,http://localhost:3000"` — the staging Pages URL plus localhost so devs can hit staging from their machine.

Production currently rejects every Pages preview deployment, which means we can't QA a PR's frontend against the real production API. Staging accepts localhost, which is convenient but probably not what we want long-term.

After this task, the configuration should look like:

| Env | `ALLOWED_ORIGINS` value | Why |
|---|---|---|
| Production | `https://arenaquest-web.pages.dev` | Locked down. No previews, no localhost. |
| Staging | `https://arenaquest-web-staging.pages.dev,https://*.arenaquest-web.pages.dev,http://localhost:3000` | The named staging domain, every PR preview, and localhost for devs hitting staging. |
| Local dev (`.dev.vars`, not committed) | `*` or `http://localhost:3000` | Convenience. Documented as dev-only. |

The exact production value is the operator's call — the contract here is "production stays exact-match by default; staging gains the preview wildcard."

---

## Technical Constraints

- **Don't loosen production by accident.** This task explicitly does **not** add `*` or wildcards to the production `vars`. If we ever need that, it should be its own ticket with a security review.
- **Pages preview hostname is locked.** Verify the actual format Cloudflare Pages uses for the staging project (e.g. `https://<hash>.arenaquest-web-staging.pages.dev` vs `https://<hash>.arenaquest-web.pages.dev`) before committing the wildcard. If it has an extra label, the `*.host` rule from Task 02 won't match (single-label deep) and we need to either deepen the syntax or pick a different suffix.
- **Document the syntax once, in CLAUDE.md.** Add a short subsection under `apps/api` describing the three accepted forms (`exact`, `https://*.host`, `*`) and the dev-only nature of `*`. Keep it tight — link to the policy module for the full contract.
- **No secret rotation needed** — `ALLOWED_ORIGINS` is a plain `var`, not a secret.

---

## Scope

### Files to add / change

- **Update** `apps/api/wrangler.jsonc`
  - Verify the actual Pages preview hostname format for the **staging** project — run `wrangler pages deployment list --project-name arenaquest-web-staging` (or check the dashboard) and confirm previews land on `https://<hash>.arenaquest-web-staging.pages.dev` (single label deep). Adjust the wildcard accordingly.
  - Set staging `ALLOWED_ORIGINS` to: `https://arenaquest-web-staging.pages.dev,https://*.arenaquest-web-staging.pages.dev,http://localhost:3000` (correct the suffix if the verification step found something different).
  - Leave production `ALLOWED_ORIGINS` unchanged, but add a JSONC `//` comment above it noting "exact-match only — do not introduce wildcards without a security review. See `docs/product/backlog/cors/`."
- **Update** `CLAUDE.md`
  - Under `apps/api` → "Bindings", expand the `ALLOWED_ORIGINS` line into a 4–6 line subsection covering: (1) comma-separated, (2) supported forms (`exact`, `https://*.host`, `*`), (3) `*` echoes the request origin because of credentials, (4) `*` is for local dev only.
- **Update** `apps/api/.dev.vars.example` (create if missing)
  - Provide a working sample, e.g. `ALLOWED_ORIGINS=http://localhost:3000`.
  - Add a commented-out line showing the wildcard form for reference.
- **No code changes** — by Task 02, the matcher already handles every form below.

### Out of scope
- Production wildcard adoption.
- Allowing `http://*.localhost` or other non-https wildcards.
- Changing `COOKIE_SAMESITE` to follow the CORS change.

---

## Acceptance Criteria

- [x] Staging `ALLOWED_ORIGINS` includes the verified preview wildcard and still works for `https://arenaquest-web-staging.pages.dev` and `http://localhost:3000`.
- [x] Production `ALLOWED_ORIGINS` is unchanged and has the inline "do not loosen without review" comment.
- [x] `CLAUDE.md` documents the three accepted origin forms and the `*` echo + dev-only caveat.
- [x] `.dev.vars.example` exists with a working default and a commented wildcard example.
- [x] After deploy, `make deploy-api-staging` followed by an `OPTIONS` request from a real preview deployment URL returns the preview origin in `Access-Control-Allow-Origin`.
- [x] After deploy, an `OPTIONS` request to **production** from a preview origin still returns no ACAO header.

---

## Test Plan

### Pre-deploy
1. Run the full Task 01 + Task 02 test suite locally — already green.
2. `wrangler deploy --dry-run --env staging` and inspect the resulting `vars.ALLOWED_ORIGINS` to confirm the new value parses.

### Staging smoke test (post-deploy)
1. `make deploy-api-staging`.
2. Trigger or pick an existing PR preview of `arenaquest-web-staging` and copy its URL (e.g. `https://5f3a2b.arenaquest-web-staging.pages.dev`).
3. From a terminal:
   ```bash
   curl -i -X OPTIONS https://api-staging.<your-domain>/health \
     -H "Origin: https://5f3a2b.arenaquest-web-staging.pages.dev" \
     -H "Access-Control-Request-Method: GET"
   ```
   → expect `Access-Control-Allow-Origin: https://5f3a2b.arenaquest-web-staging.pages.dev` and `Access-Control-Allow-Credentials: true`.
4. Repeat with `Origin: https://evil.com` → expect no ACAO header.
5. Repeat with `Origin: http://localhost:3000` → expect ACAO echoed.

### Production smoke test (post-deploy)
1. `make deploy-api`.
2. `curl -i -X OPTIONS <prod-api>/health -H "Origin: https://5f3a2b.arenaquest-web.pages.dev" -H "Access-Control-Request-Method: GET"` → expect **no** ACAO header (production stays exact-match).
3. `curl -i -X OPTIONS <prod-api>/health -H "Origin: https://arenaquest-web.pages.dev" -H "Access-Control-Request-Method: GET"` → expect ACAO echoed.

### Definition of Done
- [x] Staging deploy + smoke checklist green.
- [x] Production deploy + smoke checklist green.
- [x] `CLAUDE.md` and `.dev.vars.example` merged on the same PR as the wrangler.jsonc change so docs and config don't drift.
- [x] No code changes outside config + docs (engine work is in Tasks 01 and 02).
