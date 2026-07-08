# Plan — Task 01: Brand config module and Logo wordmark

**Task:** `docs/product/milestones/13-white-label-branding/01-brand-config-module-and-logo-wordmark.task.md`
**Persona:** `frontend-developer` (touches `apps/web` only)
**Branch:** `feature/m13/01-brand-config-module-and-logo-wordmark.task` (chained — cut from subject `feature/m13/white-label-branding`)

## Goal

Create the single source of truth for the brand (`apps/web/src/lib/brand.ts`),
read once from build-time `NEXT_PUBLIC_BRAND_*` env, with defaults that reproduce
today's ArenaQuest mark byte-for-byte. Swap the hardcoded literals in `Logo.tsx`
for `brand.*`. Expose the five vars in `next.config.ts` `env` block. No color,
markup, or prop changes.

## Context (verified)

- `next.config.ts` `env` currently has only `NEXT_PUBLIC_LANGUAGE: process.env.NEXT_PUBLIC_LANGUAGE || 'pt'` — mirror that defaulting pattern.
- `Logo.tsx` (`apps/web/src/components/design-system/Logo.tsx`) hardcodes:
  - badge text `AQ`, badge `background: 'var(--aq-accent)'`, badge `color: '#0B0E17'`.
  - wordmark `Arena<span style={{ color: 'var(--aq-accent)' }}>Quest</span>`.
- Palette (`src/app/globals.css`): `--aq-accent: oklch(0.74 0.19 52)`, badge text `#0B0E17` (= `--aq-bg`). The on-screen badge keeps the `var(--aq-accent)` CSS variable — do NOT swap it to hex (hex is for the favicon in task 03).

## Steps

1. **`apps/web/src/lib/brand.ts` (new).** Plain build-time config module (no `'use client'`). Read each `process.env.NEXT_PUBLIC_BRAND_*` once, falling back to the ArenaQuest default when unset OR empty string. Export a typed `brand` object:
   - `sigla` — default `'AQ'` (from `NEXT_PUBLIC_BRAND_SIGLA`).
   - `namePrefix` — default `'Arena'` (from `NEXT_PUBLIC_BRAND_NAME_PREFIX`).
   - `nameAccent` — default `'Quest'` (from `NEXT_PUBLIC_BRAND_NAME_ACCENT`). **Empty string is a valid value here** (means single-tone wordmark) — only fall back to the default when the var is `undefined`, not when it's `''`. Document this distinction in a comment.
   - `accentHex` — default the sRGB hex equivalent of `oklch(0.74 0.19 52)` (compute it; ≈ `#F2913D`-range warm orange — verify with an oklch→sRGB conversion). From `NEXT_PUBLIC_BRAND_ACCENT`. Favicon-only; not used on screen.
   - `onAccentHex` — `'#0B0E17'` (matches the badge text color today). No env var in the task's five; keep it a derived/constant field.
   - `fullName` — derived: `namePrefix + nameAccent` (e.g. `'ArenaQuest'`). When `nameAccent` is empty, `fullName === namePrefix`.
   - `isCustom` — `true` when any of sigla/namePrefix/nameAccent differs from the ArenaQuest default (i.e. a brand override is in effect).
   - `showPoweredBy` — resolution: if `NEXT_PUBLIC_BRAND_POWERED_BY === 'true'` → `true`; if `=== 'false'` → `false`; otherwise follow `isCustom`.
   - Export `PLATFORM_NAME = 'ArenaQuest'` constant too (task 02 needs it for the "Powered by" line; harmless to define here and keeps the platform name out of the dictionaries). Optional but recommended — leaves the seam ready.
2. **`Logo.tsx`.** Replace literal `AQ` with `{brand.sigla}`. Replace `Arena<span ...>Quest</span>` with `{brand.namePrefix}` followed by, **only when `brand.nameAccent` is non-empty**, `<span style={{ color: 'var(--aq-accent)' }}>{brand.nameAccent}</span>`. Keep all classes, sizes, the `var(--aq-accent)` badge background, `#0B0E17` badge color, fonts, and every prop exactly as-is. Import `brand` from `@/lib/brand` (or the repo's alias — check `tsconfig` paths; `@web/` may be the alias). Do not add `'use client'`.
3. **`next.config.ts`.** Add to the `env` block, each `process.env.X || '<default>'`:
   - `NEXT_PUBLIC_BRAND_SIGLA` → `'AQ'`
   - `NEXT_PUBLIC_BRAND_NAME_PREFIX` → `'Arena'`
   - `NEXT_PUBLIC_BRAND_NAME_ACCENT` → `'Quest'`
   - `NEXT_PUBLIC_BRAND_POWERED_BY` → `''` (empty = auto/follow isCustom; do not force a default)
   - `NEXT_PUBLIC_BRAND_ACCENT` → `''` (empty = brand.ts uses its accentHex default)

   Note: for `_NAME_ACCENT`, the `|| 'Quest'` in next.config means an operator who wants single-tone must set it to a value; that's acceptable for CI threading. `brand.ts` still treats `''` as single-tone at runtime for local `.env.local` usage. Keep the next.config default as `'Quest'` to preserve stock parity.
4. **Tests.** Add component/unit test(s) under the web test setup covering: (a) default render = `AQ` badge + `Arena`/`Quest` two-tone; (b) custom sigla/prefix/accent renders the new mark and still applies the accent color to the trailing span; (c) empty `nameAccent` → no accent `<span>`; (d) `fullName`/`isCustom`/`showPoweredBy` resolution. Env-dependent fields: since `brand.ts` reads env at module load, test the resolution logic in a way that works with the test runner (e.g. a small pure helper for `resolveShowPoweredBy`/`computeIsCustom`, or `vi.stubEnv` + dynamic import). Follow existing web test conventions.

## Constraints / guardrails

- Only these files change: `apps/web/src/lib/brand.ts` (new), `apps/web/src/components/design-system/Logo.tsx`, `apps/web/next.config.ts`, plus the new test file(s).
- Colors frozen: on-screen badge/wordmark keep `var(--aq-accent)`; no `--aq-*` renamed/recolored.
- No new translatable string (the "Powered by" key is task 02). `check-i18n-coverage.js` must still pass.
- Defaults never blank — half-configured deploy still says ArenaQuest.

## Verification (parent runs)

- `make lint`
- `make test-web`
- `node apps/web/scripts/check-i18n-coverage.js`
- `git diff --stat` — only the four files above.
