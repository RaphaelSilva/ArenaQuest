# Task 11 — Backend: Generated previews blocks and preview secrets (Phase 3)

**Status:** 📝 Open
**Milestone:** [26 — Release-candidate previews and demo seed](./milestone.md)
**RFC:** [RFC 0021](../../RFCs/0021-release-candidate-previews-and-demo-seed.md)
**Team:** Backend API
**Depends On:** [Task 01](./01-wrangler-bump-and-staging-ci-via-cli.task.md)

## Summary

Teaches the label tooling to generate Workers Previews configuration, so a preview of a
label's staging API runs against that label's staging data. `scaffoldWranglerText` /
`buildEnvBlockObject` in `scripts/label.mjs` emit, inside every `<label>-staging` env block
(never inside a production block), a `previews` block that re-binds the **same** staging D1
(`DB`), KV (`RATE_LIMIT_KV`) and R2 (`R2`) and carries the same derived vars as staging plus
`APP_PREVIEW=1` — Previews do not inherit top-level settings, so omitting any binding would
break the preview. `WEB_BASE_URL` stays the staging web origin (RFC OQ3). No cron trigger,
route or custom domain goes into the block. The coherence check learns to verify that every
staging env has a `previews` block equal to its derivation and that no production env has
one. `apps/api/wrangler.jsonc` is regenerated for the three labels. The provisioner
(`provision-label.mjs`) learns to set the preview base-config secrets
(`wrangler preview base-config secret put --env <label>-staging`) for `JWT_SECRET` (reusing
the staging value handling contract: stdin only, never overwritten once set) and to report
the externally-valued secrets by name, as it does for staging today. The legacy hand-written
`staging` block gets no `previews` block.

## Dependencies

- [Task 01](./01-wrangler-bump-and-staging-ci-via-cli.task.md) — hard: wrangler `>= 4.135`
  understands `previews` and `wrangler preview`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `scripts/label.mjs` and `scripts/label.test.mjs` — generation + coherence.
  - `scripts/cloudflare/provision-label.mjs` and its test — preview base-config secrets.
  - `apps/api/wrangler.jsonc` — regenerated generated blocks only.
  - `scripts/fixtures/**` — profile fixtures for the new cases.
- **Generated only.** No hand edit of a generated block; the diff in `wrangler.jsonc` is what
  the generator produces.
- **Secret contract (RFC 0012).** Values over stdin only; never on argv, disk or logs; an
  existing preview secret is never overwritten.
- **Production stays exact.** `checkPolicy` is unchanged for production; a `previews` block
  in a production env is a coherence error.

## Scope

In:
- `previews` block generation for staging envs; coherence checks both ways.
- Regenerated `wrangler.jsonc`.
- Provisioner support for preview base-config secrets (generate `JWT_SECRET`, detect the
  external ones by name) behind the existing `ONLY=secrets` group.
- Tests over fixtures: block contents, no production block, coherence failure on a drifted
  binding.

Out:
- Running `wrangler preview` — Task 12.
- Removing the legacy `staging` block.

## Acceptance Criteria

- [ ] Each `<label>-staging` env in `wrangler.jsonc` has a `previews` block whose D1, KV and R2
      ids/names equal the env's own bindings, with `APP_PREVIEW=1` and no cron.
- [ ] No production env and not the legacy `staging` block has a `previews` block.
- [ ] Changing a binding in a fixture profile without regenerating makes the coherence check
      fail naming the `previews` field.
- [ ] `make set-new-label LABEL=budo ONLY=secrets DRY_RUN=1` lists the preview base-config
      secrets, generating `JWT_SECRET` over stdin and reporting the external ones by name.
- [ ] `pnpm --filter api exec wrangler preview --env budo-staging --name smoke --dry-run`
      (or the closest non-publishing check) validates the config without missing-binding
      warnings.
- [ ] `make test-scripts`, `make lint` and `make test-api` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `node --test scripts/label.test.mjs scripts/cloudflare/provision-label.test.mjs`.
2. Regenerate `wrangler.jsonc`; review that only generated blocks changed.
3. Run the coherence check for each label/env.
4. Provisioner dry run with `ONLY=secrets` for budo.
5. `git diff --stat` confirms only scope-guardrail files changed.
