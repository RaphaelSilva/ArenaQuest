# Task 04 — Frontend: Brand env docs and CI build threading (Phase 3)

**Status:** ✅ Done
**Milestone:** [13 — White-label branding](./milestone.md)
**RFC:** [RFC 0006](../../RFCs/0006-white-label-branding-and-build-tooling.md)
**Team:** Frontend Web
**Depends On:** [Task 01](./01-brand-config-module-and-logo-wordmark.task.md)

## Summary

Make a white-label deploy need only environment values, not a code change, by
threading the five `NEXT_PUBLIC_BRAND_*` variables into the existing CI build and
documenting them for local builds. Extend the Pages build step of `deploy-web.yml`
— both the staging and production jobs — to pass the brand variables alongside the
existing `NEXT_PUBLIC_API_URL`, sourced from GitHub Environment `vars` per target.
Unset `vars` resolve to empty strings, which `brand.ts` and `next.config.ts` map
back to the ArenaQuest defaults, so the stock pipeline is byte-for-byte unchanged
until a deployer sets the vars. Document every brand variable with its ArenaQuest
default in `apps/web/.env.example`. No new build or deploy script is introduced;
this is the minimal integration with the pipeline that already exists. Verifying
that a target environment has a complete, coherent config is RFC 0007's job, not
this task's.

## Dependencies

- Task 01 — the variables threaded here are the contract defined by `brand.ts`
  and the `next.config.ts` `env` block; this task only feeds them in CI and docs.
- Existing CI surface: `.github/workflows/deploy-web.yml` Pages build step
  (staging + production), which already passes `NEXT_PUBLIC_API_URL`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/.env.example` — document the five `NEXT_PUBLIC_BRAND_*` variables,
    each with its ArenaQuest default and a one-line purpose.
  - `.github/workflows/deploy-web.yml` — add the five brand vars to the `env:`
    block of the Pages build step in **both** the staging and production jobs.
- **Stock pipeline unchanged.** The vars are sourced from GitHub Environment
  `vars` (`${{ vars.NEXT_PUBLIC_BRAND_* }}`); unset → empty string → ArenaQuest
  default. No default value is hardcoded into the workflow, so an environment with
  no brand vars builds the identical stock bundle.
- **No new script.** Do not add a build/deploy helper; thread only into the
  existing `pnpm --filter web pages:build` step. Deploy-config completeness /
  preflight is explicitly RFC 0007's concern, out of scope here.
- **Both environments.** All five variables must appear in the staging job and the
  production job — a partial set in one environment is a defect.
- **Docs match the contract.** `.env.example` must list exactly the variables
  `brand.ts` reads (`SIGLA`, `NAME_PREFIX`, `NAME_ACCENT`, `POWERED_BY`,
  `ACCENT`) with the defaults that module applies.

## Scope

In:
- `.env.example` entries for all five `NEXT_PUBLIC_BRAND_*` variables with their
  ArenaQuest defaults and purpose.
- `deploy-web.yml` Pages build step (staging + production) passing all five brand
  vars from GitHub Environment `vars`.

Out:
- `brand.ts`, `Logo`, `next.config.ts` env, surfaces, and favicon — owned by
  tasks 01–03.
- Any deployment-config validation / preflight — owned by RFC 0007.
- Updating the RFC index/status to `Implemented` — milestone closeout (§7), not
  this task.

## Acceptance Criteria

- [x] `apps/web/.env.example` documents every `NEXT_PUBLIC_BRAND_*` variable with
      its ArenaQuest default.
- [x] `deploy-web.yml` passes all five brand vars in both the staging and
      production Pages build steps, sourced from GitHub Environment `vars`
      (10 `${{ vars.NEXT_PUBLIC_BRAND_* }}` references = 5 × 2 jobs).
- [x] With no `vars` set, the workflow produces an unchanged ArenaQuest bundle
      (the brand vars resolve to defaults; no hardcoded brand default in the YAML).
- [x] No new build/deploy script is added; the change is confined to the existing
      build step's `env:` block.
- [x] `make lint` passes; `make test-web` stays green.
- [x] No diff outside the scope guardrail. **Deviation:** `apps/web/.gitignore`
      was also edited (one-line `!.env.example` exception) because the app-level
      `.env*` rule was ignoring the documentation file, making the committed
      `.env.example` deliverable impossible. This aligns apps/web with the root
      `.gitignore` policy ("Use .env.example for documentation").

## Verification Plan

1. Inspect `deploy-web.yml`; confirm both the staging and production build steps
   list all five `NEXT_PUBLIC_BRAND_*` vars under `env:`, each via
   `${{ vars.* }}`.
2. Inspect `apps/web/.env.example`; confirm all five variables are documented
   with their ArenaQuest defaults.
3. `pnpm --filter web pages:build` with no brand vars; confirm the output is the
   stock ArenaQuest bundle (default mark, title, favicon).
4. Lint the workflow / repo (`make lint`); confirm YAML is valid.
5. `git diff --stat` confirms only `.env.example` and `deploy-web.yml` changed.
