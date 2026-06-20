# Milestone 13 — White-label branding

**Status:** 📝 Draft
**Scope:** `apps/web` brand surfaces (Logo, OAuth callback, footer, metadata, favicon), build-time env (`next.config.ts`, `.env.example`), the `deploy-web.yml` CI build step, and the two i18n dictionaries. Derived from [RFC 0006](../../RFCs/0006-white-label-branding-and-build-tooling.md).

> **Hard scope guardrail — read before opening any task.** This milestone may
> touch only: `apps/web/src/lib/brand.ts` (**new**), `apps/web/src/components/design-system/Logo.tsx`,
> `apps/web/src/app/(auth)/auth/callback/page.tsx`, `apps/web/src/app/page.tsx`
> (footer), `apps/web/src/app/layout.tsx` (metadata), `apps/web/src/app/icon.tsx`
> (**new**), `apps/web/src/app/favicon.ico` (**removed**), `apps/web/next.config.ts`,
> `apps/web/src/i18n/dict-en.ts` + `dict-pt.ts` (one new "Powered by" key),
> `apps/web/.env.example`, `.github/workflows/deploy-web.yml`, and
> `docs/product/RFCs/README.md` (index/status). It is branding **only** and is
> explicitly **not** an opportunity to: change the `--aq-*` color palette or
> accent split (RFC Non-Goal "Theme/palette customisation"); add a bespoke
> build/deploy script (Non-Goal — deploys stay on the existing GitHub Actions
> pipeline); validate deployment configuration / preflight (Non-Goal — owned by
> RFC 0007); introduce runtime or multi-tenant branding (Non-Goal — build-time,
> one brand per deployment only); support custom logo image / SVG upload
> (Non-Goal — follow-up); add a per-brand OG/social share image (Non-Goal —
> follow-up); or touch `apps/api` in any way (Non-Goal — branding is frontend +
> build only). If a refactor opportunity is spotted outside this scope, file a
> separate task — do not bundle it.

---

## 1. Objectives

- **The brand mark renders as `<Sigla> <LabelName>` from build-time env, defaulting to `AQ` / `ArenaQuest`.** Removes the hardcoded `AQ` badge and `Arena`+`Quest` wordmark so a partner can rebrand without editing components.
- **A single source of truth, `apps/web/src/lib/brand.ts`, is read by every brand surface.** Logo, footer copyright, document metadata, favicon, and the de-duplicated callback screen all consume one typed, defaulted `brand` object — eliminating the "I forgot one place" failure mode.
- **The current colors and accent split are preserved unchanged.** The badge stays `--aq-accent`, the wordmark keeps its two-tone trailing segment, and no palette variable is renamed or recolored.
- **The OAuth callback reuses `<Logo>` instead of its inline badge.** Leaves exactly one implementation of the mark to keep correct; a visual no-op for the default brand.
- **A "Powered by ArenaQuest" footer attribution survives rebranding.** Shown on customised builds (and forceable on/off), keeping the underlying platform's credit; `"Powered by"` is dictionarised, `"ArenaQuest"` is an intentional platform constant.
- **A per-brand favicon is generated at build time from the sigla badge.** A static `app/icon.tsx` (`force-static`) replaces the hand-made `favicon.ico`, staying in sync with the on-screen mark with no manual asset work and no edge function.
- **The brand variables thread into the existing CI build with zero behaviour change for the stock build.** `deploy-web.yml` passes `NEXT_PUBLIC_BRAND_*` alongside `NEXT_PUBLIC_API_URL`; unset vars fall back to ArenaQuest, so the stock pipeline is byte-for-byte unchanged.

Out of scope (explicit, from RFC 0006 Non-Goals):
- **Deployment-configuration validation / preflight** — owned by RFC 0007 (sibling); this milestone only *adds* the brand vars, it does not verify a deploy is fully wired.
- **A bespoke build/deploy script** — deploys stay on the existing GitHub Actions pipeline; a second local deploy path would only drift from CI.
- **Theme/palette customisation per tenant** — colors stay as-is; the `brand.ts` seam leaves room for a later `theme.ts` sibling.
- **Runtime / multi-tenant branding** — build-time, one brand per deployment, matching how `NEXT_PUBLIC_*` already works.
- **Custom logo image / SVG upload** — the mark stays the `sigla badge + wordmark` construction; image upload is a follow-up.
- **OG / social share image per brand** — the favicon is covered (§8 of the RFC); the OG preview needs a composed layout and is a follow-up.
- **Any change to `apps/api`** — branding is entirely a frontend + build concern.

---

## 2. Functional Requirements

- With no `NEXT_PUBLIC_BRAND_*` overrides, the build is visually and behaviourally identical to today: badge reads `AQ`, wordmark is `Arena` + accented `Quest`, footer/title say `ArenaQuest`, and the favicon is the `AQ` badge on the current accent.
- Setting `NEXT_PUBLIC_BRAND_SIGLA` changes the badge text everywhere the mark appears (landing, nav, all auth screens, and the OAuth callback).
- Setting `NEXT_PUBLIC_BRAND_NAME_PREFIX` / `NEXT_PUBLIC_BRAND_NAME_ACCENT` changes the wordmark to `<prefix><accented accent>`, with the **same** accent color treatment as today.
- An empty `NEXT_PUBLIC_BRAND_NAME_ACCENT` yields a clean single-tone wordmark (the accent `<span>` is not rendered).
- The footer copyright reads `© {year} {brand.fullName}.` with the trailing sentence still an i18n string.
- The document `<title>` and `description` reflect the configured brand.
- When `brand.showPoweredBy` is true the footer shows a "Powered by ArenaQuest" line; default is "shown on customised builds, hidden on the stock build". `NEXT_PUBLIC_BRAND_POWERED_BY=true|false` forces it on/off regardless of `isCustom`.
- The browser tab favicon shows the configured sigla, generated at build time as a **static** asset (the `next-on-pages` output has no edge function for `/icon`).
- The optional `NEXT_PUBLIC_BRAND_ACCENT` overrides only the favicon badge color (sRGB hex); the on-screen palette stays the CSS `oklch()` variables.
- `check-i18n-coverage.js` passes: brand values come from `brand.*` (env-backed), and the only new translatable string ("Powered by") exists with identical keys in both dictionaries.
- The OAuth callback screen contains no hand-rolled logo markup — it renders `<Logo />`.

---

## 3. Acceptance Criteria

- [ ] Default build (no brand vars): badge `AQ`, wordmark `Arena`+accented `Quest`, footer `© {year} ArenaQuest.`, `<title>` `ArenaQuest`, favicon = `AQ` badge on current accent — visually identical to `main`.
- [ ] Custom build (`NEXT_PUBLIC_BRAND_SIGLA`/`_NAME_PREFIX`/`_NAME_ACCENT` set): the new mark appears on landing, nav, reset/forgot/activate auth screens, and the OAuth callback, with unchanged accent treatment.
- [ ] `grep` of `apps/web/src/app/(auth)/auth/callback/page.tsx` shows it renders `<Logo />` and no longer contains an inline badge/wordmark.
- [ ] Footer copyright and `<title>` resolve from `brand.fullName` (verified by setting a custom name and observing both).
- [ ] "Powered by ArenaQuest" appears on a customised build; `NEXT_PUBLIC_BRAND_POWERED_BY=false` hides it on a custom build and `=true` shows it on the default build.
- [ ] The `next-on-pages` build output for `/icon` is a static asset, not an edge function (inspect the build manifest / `.vercel/output`); `apps/web/src/app/favicon.ico` is deleted.
- [ ] `apps/web/.env.example` documents every `NEXT_PUBLIC_BRAND_*` variable with its ArenaQuest default.
- [ ] `deploy-web.yml` passes all five brand vars in both the staging and production Pages build steps, sourced from GitHub Environment `vars`.
- [ ] `node apps/web/scripts/check-i18n-coverage.js` passes (`"Powered by"` present and identical in `dict-en.ts` / `dict-pt.ts`).
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] No diff outside the files named in the scope guardrail.

---

## 4. Specific Stack

- **Backend:** none — `apps/api` is untouched by this milestone.
- **Shared:** none — no `packages/shared` types or ports change; brand config lives in `apps/web/src/lib/brand.ts`.
- **Frontend:** Next.js 15 App Router, React 19, Tailwind CSS v4. Build-time env baked via `next.config.ts` `env` block (same mechanism as `NEXT_PUBLIC_LANGUAGE`). Favicon via the App Router `app/icon.tsx` metadata-file convention + `ImageResponse` from `next/og` (Satori — sRGB hex only, no `oklch()`), `export const dynamic = 'force-static'` for static pre-render under `@cloudflare/next-on-pages`. Both i18n dictionaries (`dict-en.ts` / `dict-pt.ts`) plus `check-i18n-coverage.js`.
- **CI:** GitHub Actions `deploy-web.yml`; brand `vars` per GitHub Environment threaded into `pnpm --filter web pages:build`.
- **Tests:** Vitest + RTL (web). No API test surface.

---

## 5. Task Breakdown

The execution plan. This milestone is frontend + build only (§4: `apps/api` and
`packages/shared` are untouched), so every task is **Frontend Web**. Task 01 is
the foundation that defines the brand contract; 02, 03, and 04 each consume it and
can otherwise proceed independently.

| # | Task File | Phase | Team | Status |
|---|-----------|-------|------|--------|
| 01 | [Brand config module and Logo wordmark](./01-brand-config-module-and-logo-wordmark.task.md) | 1 | Frontend | ✅ Done |
| 02 | [Brand surfaces, callback de-dup and Powered-by attribution](./02-brand-surfaces-callback-de-dup-and-powered-by-attr.task.md) | 2 | Frontend | ✅ Done |
| 03 | [Build-time static favicon from sigla badge](./03-build-time-static-favicon-from-sigla-badge.task.md) | 2 | Frontend | ☐ Open |
| 04 | [Brand env docs and CI build threading](./04-brand-env-docs-and-ci-build-threading.task.md) | 3 | Frontend | ☐ Open |

Dependency graph:

```
01 (foundation: brand.ts + Logo + next.config env)
 ├──► 02 (surfaces: callback, footer, metadata, Powered-by + i18n)
 ├──► 03 (favicon: app/icon.tsx, remove favicon.ico)
 └──► 04 (env docs + CI threading)
```

**Recommended execution order:** `01` → `02` → `03` → `04`.

Each task is intended to land as an independent PR with `make lint`,
`make test-api`, and `make test-web` passing.

---

## 6. Decisions recorded (from RFC 0006 "Resolved Decisions")

The RFC carries Open Questions rather than a Resolved Decisions section; they are
resolved here against the RFC's proposed defaults so tasks can start.

1. **Name is split into `namePrefix` + `nameAccent`, not a single `NEXT_PUBLIC_BRAND_NAME`** — reproduces today's two-tone wordmark exactly and lets a partner pick their own split (or leave `nameAccent` empty for a single tone); the colors themselves never change.
2. **`showPoweredBy` defaults to "shown on customised builds, hidden on the stock ArenaQuest build"** (RFC Open Question 1, proposed default), overridable via `NEXT_PUBLIC_BRAND_POWERED_BY=true|false`.
3. **`"ArenaQuest"` in the "Powered by" line is a deliberate platform constant**, not driven by `brand.*`; if the i18n checker flags it, it moves into `brand.ts` as an exported `PLATFORM_NAME` constant.
4. **The favicon is generated at build time as a static asset** (`dynamic = 'force-static'`), and the static `favicon.ico` is removed so `icon.tsx` is the single source. If a build cannot statically pre-render it, fall back to a build-time static SVG icon (no `ImageResponse`).
5. **`NEXT_PUBLIC_BRAND_ACCENT` is exposed now as a favicon-only override** (RFC Open Question 3, proposed): the on-screen palette stays the CSS `oklch()` variables; the hex exists only for the off-DOM Satori renderer.
6. **Partner brand values live in GitHub Environment `vars` per target** (RFC Open Question 4, proposed), so the brand travels with the deploy environment rather than a committed file; per-environment completeness is RFC 0007's job.
7. **No new build/deploy script** — brand vars thread into the existing `deploy-web.yml` Pages build step; OG/social image stays a follow-up.

---

## 7. Definition of Done (milestone level)

- [ ] All tasks marked Done with every acceptance box checked.
- [ ] All milestone-level acceptance criteria in §3 pass.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] Closeout note written at `./closeout-analysis.md`.
- [ ] RFC 0006 status set to `Implemented` in its header and
      `docs/product/RFCs/README.md`; deferred items remain backlog.
- [ ] No diff outside the scope declared in the guardrail.
