# Task 04 — Backend: Wire Makefile and CI matrix to the deploy CLI (Phase 3)

**Status:** 📝 Open
**Milestone:** [17 — Branded deploy CLI - label-parametrized CI-independent release script](./milestone.md)
**RFC:** [RFC 0011](../../RFCs/0011-branded-deploy-cli-label-parametrized-ci-independent-release.md)
**Team:** Backend API
**Depends On:** [Task 01](./01-fix-wrangler-action-typo-in-prod-ci-jobs.task.md), [Task 03](./03-cloud-credential-resolution-and-production-confirm.task.md)

## Summary

Make the Makefile and CI thin wrappers over the now-complete deploy CLI, so there
is one real code path for releases. The `deploy-*-staging` / `deploy-*-prod`
targets in `Makefile` are repointed to forward to
`node scripts/cloudflare/deploy.mjs --label arenaquest -e <env> --scope <scope>`
(stock `arenaquest` label as the default), keeping the familiar target names and
their prod confirmation working — with the hardcoded `arenaquest-db` name removed
because the CLI resolves the database from the profile. In CI, the duplicated
per-brand production jobs in `.github/workflows/deploy-api.yml` and `deploy-web.yml`
collapse into a single job driven by `strategy.matrix.label: [arenaquest, spaziord,
budo]`, each leg running the CLI with `-e production --yes` and only the Cloudflare
credential (`CF_API_TOKEN`/`CF_ACCOUNT_ID`) injected from the GitHub environment.
Adding a brand becomes a one-line matrix edit plus a new
`config/labels/<label>.jsonc`. Finally, `docs/onboarding.md` and `CLAUDE.md`'s
command sections are updated to document the CLI. This closes the milestone.

## Dependencies

- [Task 03](./03-cloud-credential-resolution-and-production-confirm.task.md) — hard
  dependency: the Makefile/CI can only forward to a CLI whose credential resolution
  and confirmation gate are complete.
- [Task 01](./01-fix-wrangler-action-typo-in-prod-ci-jobs.task.md) — this task edits
  the same workflows; it must land on top of the `@v3` fix and, in collapsing the
  per-brand jobs, permanently removes the duplicated stanzas the typo lived in.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `Makefile` — repoint the `deploy-*-staging` / `deploy-*-prod` targets (and any
    `deploy-*-shared` scope target) to forward to the CLI; remove hardcoded
    database names from those targets. Deprecated aliases keep working.
  - `.github/workflows/deploy-api.yml` — collapse the per-brand prod jobs into one
    `strategy.matrix.label` job invoking the CLI.
  - `.github/workflows/deploy-web.yml` — the Pages counterpart, likewise matrixed.
  - `docs/onboarding.md` — document the CLI invocation and the manual-release path.
  - `CLAUDE.md` — update the deploy command reference to point at the CLI.
- **One code path.** The Makefile targets become façades that only forward; no
  deploy logic is reimplemented in `make`/`sh`. The CLI is the single source.
- **Naming & safety preserved.** Every environment stays named; production still
  confirms (via the CLI's gate); no implicit prod is introduced.
- **No new config store.** Brands are added via `config/labels/<label>.jsonc` +
  one matrix line — never a `scripts/<brand>/.env` or a separate deploy config.
- **No CLI behaviour change.** This task only wires callers; it must not modify
  `scripts/deploy/core.mjs` or `scripts/cloudflare/deploy.mjs` (that is Task 02/03).

## Scope

In:
- Repoint `deploy-*-staging` / `deploy-*-prod` Makefile targets to the CLI with the
  stock `arenaquest` label default; drop the hardcoded `arenaquest-db` name.
- Collapse `deploy-api.yml` and `deploy-web.yml` per-brand prod jobs into a single
  `matrix.label` job running the CLI with `--yes` and the Cloudflare credential.
- Update `docs/onboarding.md` and `CLAUDE.md` deploy command references.

Out:
- Any change to `scripts/deploy/core.mjs` / `scripts/cloudflare/deploy.mjs` behaviour.
- Provisioning, secret rotation, or a second cloud provider.
- Any change to label profiles or the deployment schema.

## Acceptance Criteria

- [ ] `make deploy-api-staging` still works, now by forwarding to the CLI (stock
      `arenaquest` label); no hardcoded database name remains in the deploy targets.
- [ ] `deploy-api.yml` contains **one** production job matrixed over
      `[arenaquest, spaziord, budo]`; `deploy-web.yml` is likewise a single matrixed
      job; `grep -rn "@v3raphael" .github/workflows/` returns zero matches.
- [ ] Adding a brand is demonstrably a one-line matrix change plus a new
      `config/labels/<label>.jsonc` — no copied job stanza.
- [ ] `docs/onboarding.md` and `CLAUDE.md` document the CLI invocation and the
      manual (CI-independent) release path.
- [ ] A staging deploy of SpazioRD is verified end-to-end through the CLI.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make deploy-api-staging --dry-run`-equivalent (or run the underlying CLI with
   `--dry-run`) — confirm the target forwards to
   `node scripts/cloudflare/deploy.mjs --label arenaquest -e staging --scope api`
   and no `arenaquest-db` literal remains in the target.
2. Validate `deploy-api.yml` / `deploy-web.yml` parse as valid YAML with a single
   `matrix.label` prod job each; `grep -rn "@v3raphael" .github/workflows/` is empty.
3. Run `node scripts/cloudflare/deploy.mjs --label spaziord -e staging` end-to-end
   and confirm SpazioRD's Worker + Pages deploy from profile-resolved values.
4. `make lint`, `make test-api`, `make test-web` — all green.
5. `git diff --stat` confirms only `Makefile`, the two workflow files,
   `docs/onboarding.md`, and `CLAUDE.md` changed.
