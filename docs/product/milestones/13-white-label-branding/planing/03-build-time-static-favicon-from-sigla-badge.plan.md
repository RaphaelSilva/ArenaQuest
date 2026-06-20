# Plan — Task 03: Build-time static favicon from sigla badge

**Task:** `docs/product/milestones/13-white-label-branding/03-build-time-static-favicon-from-sigla-badge.task.md`
**Persona:** `frontend-developer` (apps/web only)
**Branch:** `feature/m13/03-...task` (chained — stacked on task 02's HEAD; `brand.ts` with `sigla`/`accentHex`/`onAccentHex` is present)

## Goal

Generate the browser favicon per brand at build time from the sigla badge, as a
**static** asset (no edge function), and delete the static `favicon.ico` so
`icon.tsx` is the single source. Default brand → `AQ` badge on the current accent,
visually equivalent to the removed `.ico`.

## Context (verified)

- `apps/web/src/app/favicon.ico` exists (25,931 bytes) — to be removed.
- `apps/web/package.json`: `pages:build` → `next-on-pages`; `@cloudflare/next-on-pages: ^1`. `next/og` ships with Next 15 (no new dep).
- `brand.ts` (task 01) exports `brand.sigla`, `brand.accentHex` (sRGB hex of the accent, default `#ff8101`), `brand.onAccentHex` (`#0B0E17`). These are the colors to use — the off-DOM Satori renderer in `ImageResponse` does NOT support `oklch()`.

## Steps

1. **New `apps/web/src/app/icon.tsx`** using the App Router `icon` metadata-file convention:
   - `import { ImageResponse } from 'next/og'`.
   - `import { brand } from '@web/lib/brand'`.
   - `export const dynamic = 'force-static'` — so Next pre-renders the PNG into the static output and `next-on-pages` emits a plain asset (no function for `/icon`).
   - `export const size = { width: 32, height: 32 }` and `export const contentType = 'image/png'` (favicon dimensions).
   - Default export `Icon()` returning `new ImageResponse(<div>…</div>, { ...size })`. The JSX renders the sigla badge: a rounded square filled with `brand.accentHex`, centered bold `brand.sigla` text in `brand.onAccentHex`, sized to fill the 32×32 (e.g. font-size ~14–16 for two chars, `borderRadius` ~6 to mirror the on-screen `rounded-md` badge). Use only inline styles with sRGB hex — NO `var(--aq-*)`, NO `oklch()`. Default font is fine (do not load Space Grotesk — keep it dependency-free and statically renderable); the goal is visual equivalence, not pixel-identical typography.
2. **Delete `apps/web/src/app/favicon.ico`** (`git rm`) in the same task so only `icon.tsx` remains — browsers must not prefer a stale `.ico`.
3. **Fallback path.** If `pages:build` cannot statically pre-render the `ImageResponse` (i.e. `/icon` ends up as a function in `.vercel/output`), fall back to a build-time **static SVG** icon (a `icon.svg` file or an SVG-returning route that is genuinely static) rather than introducing a runtime function. Note in the commit/summary which path was used.

## Constraints / guardrails

- Files changed: `apps/web/src/app/icon.tsx` (new), `apps/web/src/app/favicon.ico` (removed). Nothing else.
- Static, not dynamic: `/icon` must be a static asset, no edge function. The build manifest having no function for `/icon` is the acceptance signal.
- sRGB hex only (`brand.accentHex` / `brand.onAccentHex`); the on-screen `oklch()` palette is untouched.
- Single source: do not leave both `icon.tsx` and `favicon.ico` present.
- `NEXT_PUBLIC_BRAND_ACCENT` overrides only the favicon color (it feeds `brand.accentHex`); the on-screen palette must not change.

## Verification (parent runs)

- `make lint`, `make test-web`.
- `pnpm --filter web pages:build` (or `cd apps/web && pnpm pages:build`); inspect `apps/web/.vercel/output` / build manifest to confirm `/icon` is a **static asset, not a function**. Note the result.
- Confirm `apps/web/src/app/favicon.ico` no longer exists.
- `git diff --stat` (vs the task's base) — only `icon.tsx` added and `favicon.ico` removed.
