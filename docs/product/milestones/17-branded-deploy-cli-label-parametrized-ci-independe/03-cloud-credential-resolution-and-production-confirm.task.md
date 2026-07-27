# Task 03 — Backend: Cloud credential resolution and production confirmation (Phase 2)

**Status:** 📝 Open
**Milestone:** [17 — Branded deploy CLI - label-parametrized CI-independent release script](./milestone.md)
**RFC:** [RFC 0011](../../RFCs/0011-branded-deploy-cli-label-parametrized-ci-independent-release.md)
**Team:** Backend API
**Depends On:** [Task 02](./02-cloud-agnostic-core-and-cloudflare-adapter-with-pr.task.md)

## Summary

Add the safety and credential layer on top of the core built in Task 02. The CLI
resolves the **only** sensitive input a routine deploy needs — the Cloudflare API
credential — purely by context: use `CF_API_TOKEN` (with `CF_ACCOUNT_ID`) from the
environment if present (CI), else use an existing `wrangler login` OAuth session
in `~/.wrangler` (local), else abort with a clear message telling the operator to
run `wrangler login` or set `CF_API_TOKEN`. It is never prompted for, never
written to a file by the CLI, and never logged. App runtime secrets are explicitly
not read — they persist on the Worker across deploys. On top of that, this task
adds the production safety gate: when `-e production` and neither `--yes` nor
`CONFIRM=1` is set, the CLI requires the operator to type the label name to
confirm before any mutation (matching the `confirm-prod` convention); `--yes` /
`CONFIRM=1` bypass it, and the interactive prompt only engages on a TTY, failing
closed (non-interactive) in CI. It also wires the existing
`apps/api/scripts/check-no-dev-seed.ts` guard as a preflight step before a
staging/production deploy. Task 04 then points the Makefile and CI at this
complete CLI.

## Dependencies

- [Task 02](./02-cloud-agnostic-core-and-cloudflare-adapter-with-pr.task.md) — hard
  code dependency: the credential resolution and confirmation gate slot into the
  core's resolve → preflight → execute pipeline built there.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `scripts/deploy/core.mjs` — credential-context resolution, TTY detection, the
    production confirm-by-typing-the-label gate, `--yes`/`CONFIRM=1` bypass, and
    the `guard-no-dev-seed` preflight step (invoking the existing check).
  - `scripts/cloudflare/deploy.mjs` — pass the resolved credential context through
    to the `wrangler` invocations; abort cleanly when no credential is available.
  - `scripts/**` test files — `node:test` unit tests for the credential-resolution
    branches and the confirmation gate (using injected env / TTY fakes).
- **Never prompt for a secret.** The Cloudflare credential is resolved by context
  only (env token → `wrangler login` session → abort). No `readline` prompt for a
  token; the only interactive input is typing the label name to confirm prod.
- **App secrets are out of bounds.** The CLI must not read `JWT_SECRET`, `R2_*`,
  `GOOGLE_CLIENT_SECRET`, or `RESEND_API_KEY` — they live on the Worker and are a
  Non-Goal (bring-up / rotation).
- **Fail closed in CI.** No TTY ⇒ no confirmation prompt engages; production
  without `--yes`/`CONFIRM=1` in a non-interactive context aborts rather than
  hangs.
- **Reuse the existing guard.** `apps/api/scripts/check-no-dev-seed.ts` is invoked
  as-is; its logic is not modified.

## Scope

In:
- Cloudflare credential resolution by context (`CF_API_TOKEN`/`CF_ACCOUNT_ID` →
  `wrangler login` session → abort with an actionable message).
- Production confirm-by-typing-the-label gate with `--yes` / `CONFIRM=1` bypass and
  TTY-only interactivity.
- Wiring `guard-no-dev-seed` as a preflight step before a staging/production deploy.
- `node:test` unit coverage for each credential branch and the confirmation gate.

Out:
- Setting or rotating app runtime secrets (Non-Goal; stays with `make secret-*`).
- Any prompt for a Cloudflare token or an app secret.
- Makefile / CI wiring (Task 04).
- Any change to `check-no-dev-seed.ts`, `label.mjs`, or the label profiles.

## Acceptance Criteria

- [ ] With no `CF_API_TOKEN` in the environment and no `wrangler login` session,
      the CLI exits non-zero telling the operator to log in or set the token — it
      never prompts and never hangs.
- [ ] With `CF_API_TOKEN` set, the CLI uses it; with only a `wrangler login`
      session, it uses that — each branch covered by a unit test.
- [ ] `-e production` without `--yes`/`CONFIRM=1` requires typing the label name
      before any mutation; a wrong entry aborts; `--yes` or `CONFIRM=1` bypasses.
- [ ] A deploy never reads `JWT_SECRET` or the other app runtime secrets —
      asserted by a test / inspection of the resolved inputs.
- [ ] `guard-no-dev-seed` runs as a preflight step before a staging/production
      deploy and blocks on a dev-seed-tainted target.
- [ ] `make lint` and the `node:test` suite pass green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `node --test scripts/deploy/` — credential-branch and confirmation-gate tests
   pass (env token present / session present / neither → abort; prod confirm /
   bypass).
2. In a shell with no `CF_API_TOKEN` and no `wrangler login`, run
   `node scripts/cloudflare/deploy.mjs --label arenaquest -e staging` and confirm
   the clear abort message and non-zero exit — no hang, no prompt.
3. Run `-e production` without `--yes` and confirm the type-the-label prompt gates
   the deploy; re-run with `--yes` and confirm it proceeds past the gate.
4. `make lint` — green.
5. `git diff --stat` confirms only scope-guardrail files under `scripts/` changed.
