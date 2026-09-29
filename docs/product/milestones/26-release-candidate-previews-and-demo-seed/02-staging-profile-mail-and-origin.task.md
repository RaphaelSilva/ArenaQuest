# Task 02 — Backend: Staging profiles: console mail driver and spaziord webOrigin (Phase 0)

**Status:** 📝 Open
**Milestone:** [26 — Release-candidate previews and demo seed](./milestone.md)
**RFC:** [RFC 0021](../../RFCs/0021-release-candidate-previews-and-demo-seed.md)
**Team:** Backend API

## Summary

Fixes the two profile facts previews depend on. First, **staging sends no real e-mail**:
every label's `environments.staging.mail.driver` becomes `console` (already allowed by
`config/deployment.schema.jsonc:54`), so `apps/api/src/container.ts:267` wires the
`ConsoleMailAdapter` and activation, reset and notification mails are written to the Worker
log; `RESEND_API_KEY` stops being required for staging because its `requiredWhen:
MAIL_DRIVER=resend` gate turns off. Production profiles keep `resend`. Second, **spaziord's
staging `webOrigin`** is set to its staging Pages host (`spaziord-web-staging.pages.dev`,
the value `wrangler.jsonc` already uses) instead of the production domain, so the staging
wildcard `https://*.<webOrigin>` covers its Pages branch previews and staging CORS stops
pointing at production. The generated wrangler blocks are regenerated from the profiles with
the label tooling. Task 12 relies on both facts.

## Dependencies

- None — independent.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `config/labels/arenaquest.jsonc`, `config/labels/budo.jsonc`, `config/labels/spaziord.jsonc`
    — staging `mail.driver`; spaziord staging `webOrigin`.
  - `apps/api/wrangler.jsonc` — only the regenerated `<label>-staging` blocks.
  - `docs/onboarding.md` — "staging mail goes to `wrangler tail`".
- **Generated, not hand-edited.** The wrangler blocks change only through the label tooling
  (`scripts/label.mjs` scaffold / coherence), so profile and wrangler cannot drift.
- **Production untouched.** No `production` block changes, including spaziord's production
  domain mismatch (tracked separately, not bundled here).
- **Secrets.** No secret is written or deleted; an existing staging `RESEND_API_KEY` may stay
  set and is simply unused.

## Scope

In:
- `mail.driver: "console"` in the three staging blocks.
- spaziord staging `webOrigin` → its staging Pages host.
- Regenerated `<label>-staging` wrangler blocks and a passing coherence check.
- Redeploy the three staging Workers through the CLI after merge (runbook step).

Out:
- Any production profile change.
- The `previews` block (Task 11).

## Acceptance Criteria

- [ ] `node scripts/label.mjs` coherence/policy check passes for all labels and both envs.
- [ ] The three `<label>-staging` wrangler blocks carry `MAIL_DRIVER=console`; the
      production blocks still carry `resend`.
- [ ] spaziord staging `ALLOWED_ORIGINS` and bucket CORS derive from
      `spaziord-web-staging.pages.dev` and include `https://*.spaziord-web-staging.pages.dev`.
- [ ] After redeploy, a password reset on budo staging logs the mail (and its link) in
      `wrangler tail` and makes no Resend call.
- [ ] `make test-scripts`, `make lint`, `make test-api` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. Edit the profiles; regenerate the staging blocks with the label tooling.
2. Run the label coherence check for each label/env; diff `wrangler.jsonc` — only staging
   blocks moved.
3. `make test-scripts && make lint && make test-api`.
4. After merge: `make deploy-api-staging` (per label), request a password reset, watch
   `wrangler tail --env budo-staging`.
5. `git diff --stat` confirms only scope-guardrail files changed.
