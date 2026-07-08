# Plan — Task 04: Brand env docs and CI build threading

**Task:** `docs/product/milestones/13-white-label-branding/04-brand-env-docs-and-ci-build-threading.task.md`
**Persona:** Frontend Web (config/CI threading — handled inline by the conductor; pure config, no app code)
**Branch:** `feature/m13/04-...task` (chained — stacked on task 03's HEAD; tasks 01–03 present)

## Goal

Make a white-label deploy need only env values: thread the five
`NEXT_PUBLIC_BRAND_*` vars into the existing `deploy-web.yml` Pages build step
(staging + production) from GitHub Environment `vars`, and document them in
`apps/web/.env.example`. Stock pipeline byte-for-byte unchanged (unset vars →
empty → ArenaQuest defaults in `brand.ts` / `next.config.ts`).

## Context (verified)

- `.github/workflows/deploy-web.yml`: both `deploy-staging` (job has `environment: name: staging`) and `deploy-production` (`environment: name: production`) run `pnpm --filter web pages:build` with an `env:` block holding only `NEXT_PUBLIC_API_URL` (hardcoded literal — leave it as-is, out of scope). Staging build step ~lines 79–82; production ~lines 121–124.
- Because each job declares `environment:`, `${{ vars.* }}` resolves to that environment's GitHub Environment variables.
- `apps/web/.env.example` currently documents only `NEXT_PUBLIC_API_URL`.
- The five vars and their `brand.ts` defaults: `SIGLA=AQ`, `NAME_PREFIX=Arena`, `NAME_ACCENT=Quest`, `POWERED_BY` (empty = auto: shown on customised builds), `ACCENT` (empty = favicon uses brand.ts default `#ff8101`).

## Steps

1. **`deploy-web.yml`** — to BOTH build steps' `env:` blocks (staging and production), append, after the existing `NEXT_PUBLIC_API_URL` line:
   ```yaml
   NEXT_PUBLIC_BRAND_SIGLA: ${{ vars.NEXT_PUBLIC_BRAND_SIGLA }}
   NEXT_PUBLIC_BRAND_NAME_PREFIX: ${{ vars.NEXT_PUBLIC_BRAND_NAME_PREFIX }}
   NEXT_PUBLIC_BRAND_NAME_ACCENT: ${{ vars.NEXT_PUBLIC_BRAND_NAME_ACCENT }}
   NEXT_PUBLIC_BRAND_POWERED_BY: ${{ vars.NEXT_PUBLIC_BRAND_POWERED_BY }}
   NEXT_PUBLIC_BRAND_ACCENT: ${{ vars.NEXT_PUBLIC_BRAND_ACCENT }}
   ```
   No hardcoded default in the workflow — unset `vars` resolve to empty string, which `brand.ts`/`next.config.ts` map to the ArenaQuest defaults. Both environments get the identical five-var set.
2. **`apps/web/.env.example`** — append a documented block for the five vars, each with its ArenaQuest default and a one-line purpose, e.g.:
   ```
   # ── White-label branding (build-time; unset → ArenaQuest defaults) ──
   # Badge text shown in the logo mark and favicon.
   NEXT_PUBLIC_BRAND_SIGLA=AQ
   # Wordmark leading segment (un-accented).
   NEXT_PUBLIC_BRAND_NAME_PREFIX=Arena
   # Wordmark trailing segment (accent-coloured); empty → single-tone wordmark.
   NEXT_PUBLIC_BRAND_NAME_ACCENT=Quest
   # Force the "Powered by ArenaQuest" footer on/off; empty → auto (shown only on customised builds).
   NEXT_PUBLIC_BRAND_POWERED_BY=
   # Favicon badge colour as sRGB hex (favicon only; on-screen palette stays the oklch() vars). Empty → #ff8101.
   NEXT_PUBLIC_BRAND_ACCENT=
   ```

## Constraints / guardrails

- Files changed: `apps/web/.env.example`, `.github/workflows/deploy-web.yml`. Nothing else.
- Stock pipeline unchanged: vars only from `${{ vars.* }}`, no hardcoded brand default in the workflow. Don't touch the existing `NEXT_PUBLIC_API_URL` lines.
- No new build/deploy script; thread only into the existing `pages:build` step.
- All five vars in BOTH the staging and production jobs (a partial set is a defect).
- `.env.example` lists exactly the five vars `brand.ts` reads, with matching defaults.

## Verification (parent runs)

- Inspect `deploy-web.yml`: both build steps list all five `${{ vars.NEXT_PUBLIC_BRAND_* }}` under `env:`.
- Inspect `.env.example`: all five documented with ArenaQuest defaults.
- `make lint`; `make test-web` stays green.
- `git diff --stat` — only `.env.example` and `deploy-web.yml`.
