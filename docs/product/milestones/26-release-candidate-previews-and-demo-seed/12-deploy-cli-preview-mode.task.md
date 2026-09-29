# Task 12 — Backend: Deploy CLI preview mode, Make targets and workflow (Phase 3)

**Status:** 📝 Open
**Milestone:** [26 — Release-candidate previews and demo seed](./milestone.md)
**RFC:** [RFC 0021](../../RFCs/0021-release-candidate-previews-and-demo-seed.md)
**Team:** Backend API
**Depends On:** [Task 02](./02-staging-profile-mail-and-origin.task.md), [Task 10](./10-migration-lint.task.md), [Task 11](./11-wrangler-previews-block.task.md)

## Summary

Delivers the candidate preview itself on the single release path. `node
scripts/cloudflare/deploy.mjs --label <l> -e staging --preview <name> [--scope api|web|all]
[--dry-run]` builds this plan: guard (staging mode) → `check-migrations` (Task 10) → record
the D1 Time Travel bookmark → migrate the staging D1 → `wrangler preview --env <l>-staging
--name <name>` and capture the Preview URL from its output → build the web with
`NEXT_PUBLIC_API_URL` = that URL, `NEXT_PUBLIC_SITE_URL=https://<name>.<webOrigin>` and
`NEXT_PUBLIC_PREVIEW_NAME=<name>` plus the short commit sha → `pages deploy --project-name
<staging pages project> --branch <name>` → print the web URL, the API URL and the bookmark
with its restore command. `--preview` is rejected with `-e production`; `<name>` must match
`[a-z0-9-]{1,20}` and defaults to `m<N>` when the current branch is `feature/m<N>/candidate`.
The live staging Worker and the Pages production branch are never touched. Cleanup is
`--preview <name> --delete` (`wrangler preview delete --env <l>-staging --name <name>` and
deletion of that branch's Pages deployments). Make wrappers: `make deploy-preview-staging
LABEL= CANDIDATE=` and `make preview-delete-staging LABEL= CANDIDATE=`. A
`.github/workflows/preview-candidate.yml` runs the same CLI on `workflow_dispatch` only, with
inputs `label` (one label or `all` → matrix `[arenaquest, spaziord, budo]`) and `candidate`,
and writes both URLs to the job summary.

## Dependencies

- [Task 11](./11-wrangler-previews-block.task.md) — hard: the `previews` block and secrets.
- [Task 10](./10-migration-lint.task.md) — hard: the lint is a plan step.
- [Task 02](./02-staging-profile-mail-and-origin.task.md) — hard: spaziord's origin and the
  console mail driver the preview inherits.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `scripts/deploy/core.mjs`, `scripts/deploy/core.test.mjs` — preview plan builder
    (provider-neutral step kinds: `lint-migrations`, `bookmark`, `deploy-worker-preview`,
    `deploy-pages-branch`, `report`).
  - `scripts/cloudflare/deploy.mjs` — flag parsing, wrangler command mapping, URL capture,
    `--delete`.
  - `scripts/label.mjs` — a `derivePreview(profile, name)` next to `deriveExpected`.
  - `Makefile` — `deploy-preview-staging`, `preview-delete-staging`.
  - `.github/workflows/preview-candidate.yml` (new).
  - `docs/onboarding.md`, `CLAUDE.md` — "Previewing a candidate" runbook.
- **One code path.** The workflow and the Make targets only forward to the CLI; no wrangler
  command string outside `deploy.mjs`.
- **Neutral core.** `core.mjs` holds no provider command strings (as today); the mapping to
  `wrangler preview` / `pages deploy --branch` lives in the Cloudflare adapter.
- **URL capture is isolated** in one helper with a test over recorded `wrangler preview`
  output, so a wrangler output change fails one test instead of a silent wrong build.
- **Manual only** (RFC OQ1): the workflow has no `push` / `pull_request` trigger.
- **CORS by derivation.** The web preview origin must be covered by the staging
  `ALLOWED_ORIGINS` wildcard; the CLI verifies it with the existing origin-policy helper and
  refuses otherwise (catches a label whose staging `webOrigin` is not the Pages host).

## Scope

In:
- `--preview`, `--delete`, name validation and default, production refusal.
- Bookmark + restore command in the report.
- Preview URL capture and the web build variables.
- Make targets, the dispatch workflow, runbook text.
- Plan-builder and URL-capture tests; `--dry-run` output for each label.

Out:
- The web banner component (Task 13) — this task only sets its build variables.
- Automatic previews on push; Google OAuth on previews.

## Acceptance Criteria

- [ ] `make deploy-preview-staging LABEL=budo CANDIDATE=m21` prints a web URL on
      `m21.<budo staging pages host>` and a Workers Preview URL; `demo.admin` logs in on the
      web preview (CORS and refresh cookie work) and topic media play.
- [ ] During and after the preview, the live staging API and web keep serving the previous
      version (unchanged `wrangler deployments list` for the staging Worker).
- [ ] The run's report includes the bookmark and a working restore command.
- [ ] `--preview x -e production` and a name like `Feature/M21` exit non-zero before any
      step runs.
- [ ] A candidate with a destructive migration (no `@contract`) stops at the lint step,
      before the bookmark and migrate steps.
- [ ] `make preview-delete-staging LABEL=budo CANDIDATE=m21` removes the Worker preview and
      the Pages branch deployments.
- [ ] `preview-candidate.yml` has only a `workflow_dispatch` trigger; a run with `label: all`
      produces three previews and lists their URLs in the job summary.
- [ ] `make test-scripts`, `make lint`, `make test-api`, `make test-web` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `deploy.mjs --label budo -e staging --preview m21 --dry-run` for each label — read the plan.
2. Real run for budo; open both URLs; log in as demo admin and student-1; play media.
3. Check the staging Worker's deployments and the Pages production branch are unchanged.
4. Scratch branch with a destructive migration → the run stops at the lint.
5. `make preview-delete-staging LABEL=budo CANDIDATE=m21`; confirm both previews are gone.
6. Dispatch the workflow with `all`.
7. `git diff --stat` confirms only scope-guardrail files changed.
