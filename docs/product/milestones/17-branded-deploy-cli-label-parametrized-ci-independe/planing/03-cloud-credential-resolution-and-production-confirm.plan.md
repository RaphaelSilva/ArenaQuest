# Plan — Task 03: Cloud credential resolution + production confirmation (Phase 2)

**Task:** [03-...task.md](../03-cloud-credential-resolution-and-production-confirm.task.md)
**Persona:** Backend/infra. Depends on Task 02 (in candidate).
**Branch:** `feature/m17/03-cloud-credential-resolution-and-production-confirm.task`

## Architectural boundary (must preserve Task 02's invariant)

`scripts/deploy/core.mjs` must remain **cloud-agnostic** — the Task 02
`core.test.mjs` no-cloud-import assertion still has to pass. Therefore:

- **core.mjs (cloud-agnostic, stdlib incl. `node:readline`):**
  - `confirmProduction({ env, label, yes, stream/promptFn })` — when
    `env === 'production'` and NOT (`yes` || `CONFIRM=1`), require the operator to
    type the label name; a mismatch aborts (non-zero). `--yes`/`CONFIRM=1` bypass.
    **TTY-gated:** if not a TTY and not bypassed → fail closed (abort, never hang).
    Pure `node:readline`/stdin — no cloud symbol. Unit-testable with an injected
    prompt function.
- **cloudflare/deploy.mjs (adapter, may use wrangler/child_process):**
  - `resolveCredential()` — resolve the Cloudflare credential by context:
    1. `CF_API_TOKEN` (RFC-canonical; with `CF_ACCOUNT_ID`) present in env → use it,
       and export it to the wrangler spawn as `CLOUDFLARE_API_TOKEN` /
       `CLOUDFLARE_ACCOUNT_ID` (also honour a pre-set `CLOUDFLARE_API_TOKEN`).
    2. else an existing `wrangler login` session (`wrangler whoami` exits 0) → use it.
    3. else ABORT with a clear message: "run `wrangler login`, or set CF_API_TOKEN".
    **Never prompt for the token.** Only engage for a real (non-dry-run) execute.
  - Wire `guard-no-dev-seed` as a preflight step **before** a staging/production
    deploy: spawn `pnpm --filter api exec tsx scripts/check-no-dev-seed.ts --db
    <resolved.d1.name> [--env <wranglerEnv-for-staging>]` (omit `--env` for
    production, matching the Makefile). A non-zero exit aborts the deploy.
  - Call `core.confirmProduction(...)` after preflight/guard, before executing.

This reconciles the Task 02 stub (which checked `CLOUDFLARE_API_TOKEN` only):
replace that bare check with `resolveCredential()`, accepting `CF_API_TOKEN` as the
RFC contract while still satisfying wrangler's native `CLOUDFLARE_*` vars.

## Reference (confirmed)

- `apps/api/scripts/check-no-dev-seed.ts` usage:
  `--db <name> [--env staging] [--local]`; omit `--env` for production
  (Makefile `guard-no-dev-seed-prod` runs `--db arenaquest-db` with no `--env`).
- Never read app runtime secrets (JWT_SECRET, R2_*, GOOGLE_CLIENT_SECRET,
  RESEND_API_KEY) — they persist on the Worker.

## Ordered pipeline after this task

resolve → preflight (presence/coherence/policy) → guard-no-dev-seed →
resolveCredential → confirmProduction → execute (or print on --dry-run).
`--dry-run` still resolves + preflights + prints, and must NOT require a
credential or a confirmation.

## Scope guardrail (only these)

- `scripts/deploy/core.mjs` — add `confirmProduction` (+ `CONFIRM=1`/TTY logic);
  keep it cloud-free.
- `scripts/cloudflare/deploy.mjs` — `resolveCredential`, guard wiring, call the
  confirm gate; replace the Task 02 bare-env credential check.
- `scripts/deploy/core.test.mjs` — extend with confirmation-gate tests (typed
  label ok / wrong entry aborts / `--yes` & `CONFIRM=1` bypass / non-TTY fail
  closed) via injected prompt+stream; keep the no-cloud-import assertion passing.

Out: Makefile/CI wiring (Task 04); any change to `check-no-dev-seed.ts`,
`label.mjs`, profiles, or schema.

## Verification (parent)

1. `node --test scripts/deploy/core.test.mjs` + `node --test scripts/label.test.mjs` — green;
   the no-cloud-import assertion still passes (core stays clean).
2. No `CF_API_TOKEN`/`CLOUDFLARE_API_TOKEN` and no `wrangler login` session →
   `node scripts/cloudflare/deploy.mjs --label arenaquest -e staging` (execute path)
   aborts non-zero with the login/token message; no hang, no prompt.
3. `--dry-run` still works with no credential (resolve+preflight+print, exit 0).
4. Production without `--yes`: the type-the-label gate blocks; with `--yes`/`CONFIRM=1`
   it proceeds past the gate (verify via dry-run + injected-prompt unit tests).
5. `make lint` green; `git diff --stat` only the three scope files.
