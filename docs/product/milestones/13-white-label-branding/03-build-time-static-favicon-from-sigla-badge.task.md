# Task 03 — Frontend: Build-time static favicon from sigla badge (Phase 2)

**Status:** ✅ Done
**Milestone:** [13 — White-label branding](./milestone.md)
**RFC:** [RFC 0006](../../RFCs/0006-white-label-branding-and-build-tooling.md)
**Team:** Frontend Web
**Depends On:** [Task 01](./01-brand-config-module-and-logo-wordmark.task.md)

## Summary

Generate the browser favicon per brand at build time from the same sigla badge,
so a rebranded deployment gets a matching tab icon with no hand-made asset. Add a
new App Router `icon` metadata-file route that renders the sigla badge — using the
brand's sRGB hex colors rather than the on-screen `oklch()` variables — and
pre-renders it once at build time as a static asset (no per-request edge
function), which is what makes it safe under `@cloudflare/next-on-pages`. Remove
the static `favicon.ico` so the generated icon is the single source and browsers
cannot prefer a stale `.ico`. With no overrides the generated icon is the `AQ`
badge on the current accent — a one-time, intentional asset swap that is visually
equivalent to today's favicon. The optional `NEXT_PUBLIC_BRAND_ACCENT` overrides
only the favicon badge color; the on-screen palette is untouched.

## Dependencies

- Task 01 — consumes the `brand` config module (`brand.sigla`, `brand.accentHex`,
  `brand.onAccentHex`) and the `NEXT_PUBLIC_BRAND_ACCENT` env already exposed in
  `next.config.ts`. This task must not ship ahead of it.
- App Router metadata-file convention (`app/icon`) + the static-export pipeline
  (`@cloudflare/next-on-pages`).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/icon.tsx` (**new**) — the build-time generated favicon.
  - `apps/web/src/app/favicon.ico` (**removed**) — the static icon it replaces.
- **Static, not dynamic.** The icon route must be force-static so Next pre-renders
  the image into the static output and `next-on-pages` emits it as a plain asset
  with **no edge function** for `/icon`. Verifying the build manifest has no
  function for `/icon` is an acceptance signal.
- **sRGB hex only.** The off-DOM image renderer (Satori) does not support
  `oklch()`; the badge must use `brand.accentHex` / `brand.onAccentHex`, never the
  CSS `--aq-*` variables. The on-screen palette stays the `oklch()` variables and
  must not change.
- **Single source.** `favicon.ico` is deleted in the same task so only `icon.tsx`
  remains; do not leave both present.
- **Fallback path.** If the build cannot statically pre-render the
  `ImageResponse`, fall back to a build-time static SVG icon (no `ImageResponse`)
  rather than introducing a runtime function — note which path was used in the PR.
- **Default parity.** With no overrides the icon is the `AQ` badge on the current
  accent, visually equivalent to the removed `favicon.ico`.

## Scope

In:
- New `app/icon.tsx` rendering the sigla badge from `brand.*` hex colors, sized
  for a favicon and pre-rendered as a static asset.
- Removal of `apps/web/src/app/favicon.ico`.
- Confirmation that `NEXT_PUBLIC_BRAND_ACCENT` changes only the favicon color.

Out:
- The `brand` module and the `NEXT_PUBLIC_BRAND_ACCENT` env exposure — owned by
  task 01.
- On-screen surfaces (Logo, footer, metadata, callback) — owned by tasks 01/02.
- `.env.example` and CI threading — owned by task 04.
- Any OG / social share image — explicit milestone Non-Goal (follow-up).

## Acceptance Criteria

- [x] `apps/web/src/app/icon.tsx` exists and `apps/web/src/app/favicon.ico` is
      deleted.
- [x] The default-brand favicon is the `AQ` badge on the current accent —
      visually equivalent to the removed `.ico` (rendered via `ImageResponse`
      using `brand.accentHex` / `brand.onAccentHex`).
- [x] Setting `NEXT_PUBLIC_BRAND_SIGLA` changes the tab icon's text; setting
      `NEXT_PUBLIC_BRAND_ACCENT` changes only the favicon badge color, with the
      on-screen palette unchanged.
- [x] The `next-on-pages` build output for `/icon` is a static asset, not an edge
      function — Next reports `○ /icon (Static)` and next-on-pages' Edge Function
      Routes (7) list excludes `/icon` (it is a Prerendered Route); the static PNG
      is materialized at `.vercel/output/static/icon`.
- [x] `make lint` and `make test-web` pass green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `pnpm --filter web pages:build` with no brand vars; inspect the build output /
   manifest and confirm `/icon` is a static asset (no function).
2. Load the app and confirm the tab icon is the `AQ` badge on the current accent.
3. Rebuild with `NEXT_PUBLIC_BRAND_SIGLA` and `NEXT_PUBLIC_BRAND_ACCENT` set;
   confirm the favicon shows the new sigla and color while the on-screen palette
   is unchanged.
4. Confirm `apps/web/src/app/favicon.ico` no longer exists.
5. `make lint` and `make test-web` green.
6. `git diff --stat` confirms only `icon.tsx` (added) and `favicon.ico` (removed)
   changed.
