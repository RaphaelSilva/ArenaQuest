# Milestone 17 — Closeout Analysis

**Status:** ✅ Completed (on `feature/m17/candidate`)
**Derived from:** [RFC 0011](../../RFCs/0011-branded-deploy-cli-label-parametrized-ci-independent-release.md)
**Delivered:** 2026-07-28

## What shipped

A label-aware, cloud-agnostic deploy CLI plus the Makefile/CI wrappers that call it.

| # | Task | Result |
|---|------|--------|
| 01 | Fix `wrangler-action@v3raphael` typo | `deploy-api.yml` lines 167/209 → `@v3`; zero `@v3raphael` remain. |
| 02 | Cloud-agnostic core + Cloudflare adapter | `scripts/deploy/core.mjs` (agnostic), `scripts/cloudflare/deploy.mjs` (adapter), `scripts/lib/log.mjs`, `scripts/deploy/core.test.mjs`. Arg parse, profile resolve via `label.mjs`, fail-closed preflight, provider-neutral plan, `--dry-run`. |
| 03 | Credential resolution + prod confirmation | `resolveCredential()` (CF_API_TOKEN → `wrangler login` session → abort), `confirmProduction()` (type-the-label, `--yes`/`CONFIRM=1` bypass, TTY fail-closed), `guard-no-dev-seed` preflight. |
| 04 | Wire Makefile + CI matrix | Makefile deploy targets forward to the CLI (stock `arenaquest` default, no hardcoded db name); the three per-brand prod jobs in `deploy-api.yml`/`deploy-web.yml` collapse to one `matrix.include` job (arenaquest/spaziord/budo → production/prod-spaziord/prod-budo); `docs/onboarding.md` + `CLAUDE.md` updated; `config/labels/arenaquest.jsonc` + `config/labels/budo.jsonc` created. |

## Verification (all green)

- `node --test scripts/deploy/core.test.mjs` — 24 pass (incl. the enforced
  no-`wrangler`/no-cloud-import assertion on `core.mjs`).
- `node --test scripts/label.test.mjs` — 22 pass (no regression).
- `--dry-run` for `arenaquest`, `spaziord`, `budo` — each resolves from its profile
  and prints the correct `wrangler` commands, exit 0.
- `make lint` — green. `make test-api` — 700 pass / 3 skip. `make test-web` — 223 pass / 6 skip.
- Both workflows parse as valid YAML with exactly one production job each; zero `@v3raphael`.

## Decisions & deviations recorded

1. **Matrix brand set = arenaquest + spaziord + budo** (user decision, 2026-07-27).
   Required creating two profile files — an **approved expansion** of Task 04's
   scope guardrail. `arenaquest.jsonc` is built from values already committed in
   `apps/api/wrangler.jsonc` (no invented data); `budo.jsonc` uses the same
   `<acct>` placeholder convention as `spaziord.jsonc`, pending Budo bring-up.
2. **Stock prod `apiHost` normalized to `api.arenaquest.app`** — the deployed
   worker's own vars (GOOGLE_REDIRECT_URI / WEB_BASE_URL / ALLOWED_ORIGINS) use it;
   the old Makefile `deploy-web-prod` hardcoded `api.raphael-1d2.workers.dev`, which
   was drift. The profile is now the single coherent source.
3. **`GOOGLE_CLIENT_ID` excluded from deploy preflight presence** — it has no
   profile source (it lives in the committed `env.<label>` wrangler block that the
   Worker reads directly); `label-check` still validates it. Narrowly scoped to
   that one key; all other required keys and the wildcard-origin policy still fail
   closed.
4. **`wrangler whoami` session detection hardened** — `whoami` exits 0 even when
   unauthenticated, so session detection also checks the output does not indicate
   "not authenticated", preserving the fail-closed requirement.
5. **CF credential env var** — the CLI accepts `CF_API_TOKEN`/`CF_ACCOUNT_ID` (RFC
   contract) and maps them to wrangler's native `CLOUDFLARE_*` on spawn.

## Known boundary (a Non-Goal, by design)

The CLI emits `wrangler ... --env <label>-staging` / `<label>` per the label
system's per-brand wrangler env convention. A **live** end-to-end deploy therefore
requires each label's scaffolded `env.<label>` block in `apps/api/wrangler.jsonc`
(and real Cloudflare credentials). Creating those blocks is **label bring-up /
`label-scaffold`**, an explicit RFC 0011 Non-Goal ("deploy assumes the tenant
already exists"). This milestone is verified at the forwarding + `--dry-run` level,
which is the correct scope. Follow-up (separate task/RFC): scaffold `env.arenaquest*`
blocks so the stock deploy runs through the CLI end-to-end.

## Definition of Done

- [x] All four tasks Done, every acceptance box checked.
- [x] §3 milestone acceptance criteria pass (dry-run, fail-closed, credential
      contract, single matrixed prod job, `make deploy-api-staging` forwards).
- [x] `make lint`, `make test-api`, `make test-web` green.
- [x] Closeout note written (this file).
- [x] RFC 0011 status → Implemented (header + `docs/product/RFCs/README.md`).
- [x] No diff outside the scope guardrail (as expanded, user-approved).
