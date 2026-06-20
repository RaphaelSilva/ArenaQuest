# Task 01 — Frontend: Brand config module and Logo wordmark (Phase 1)

**Status:** 📝 Open
**Milestone:** [13 — White-label branding](./milestone.md)
**RFC:** [RFC 0006](../../RFCs/0006-white-label-branding-and-build-tooling.md)
**Team:** Frontend Web

## Summary

Establish the single source of truth for the brand. Add a new `brand` config
module that reads the build-time `NEXT_PUBLIC_BRAND_*` environment once and
exposes a typed, defaulted object whose defaults reproduce today's ArenaQuest
identity (sigla `AQ`, wordmark `Arena` + accented `Quest`, sRGB accent hex
mirroring `--aq-accent`, a derived `fullName`, an `isCustom` flag, and a
`showPoweredBy` resolution). Replace the hardcoded strings in the canonical
`Logo` component with these config values — keeping the component's existing
props, markup, and the two-tone accent treatment untouched — and expose the new
variables in `next.config.ts` so they are baked into the static export exactly
like `NEXT_PUBLIC_LANGUAGE`. With no overrides, the rendered mark is byte-for-byte
the same as today; every existing `<Logo>` call site inherits the brand for free.

## Dependencies

- None — this is the foundation task; tasks 02, 03, and 04 depend on it.
- Existing component this extends: `apps/web/src/components/design-system/Logo.tsx`.
- Existing build-time env precedent: `apps/web/next.config.ts` `env` block
  (`NEXT_PUBLIC_LANGUAGE`).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/lib/brand.ts` (**new**) — the brand config module.
  - `apps/web/src/components/design-system/Logo.tsx` — literals swapped for
    `brand.*` values; no color/markup/prop change.
  - `apps/web/next.config.ts` — add the five `NEXT_PUBLIC_BRAND_*` keys to the
    existing `env` block, each defaulting to its ArenaQuest value.
- **Colors are frozen.** The badge keeps `--aq-accent`; the wordmark keeps the
  accent on its trailing segment. No palette variable is renamed or recolored,
  and no `--aq-*` value is touched.
- **Empty accent renders single-tone.** An empty `nameAccent` must not render the
  accent `<span>` at all (clean single-tone wordmark), not an empty span.
- **App Router conventions.** `brand.ts` is plain build-time config read from
  `process.env.NEXT_PUBLIC_*`; do not add `'use client'` to `Logo` or convert it.
- **i18n.** Brand values are config (env-backed), not translatable copy — they
  are read from `brand.*`, never written as literals in the component, so
  `check-i18n-coverage.js` keeps passing. This task introduces no new dictionary
  key (the "Powered by" string belongs to task 02).
- **Defaults never blank.** Unset/empty env must fall back to the ArenaQuest
  default in both `brand.ts` and `next.config.ts`, so a half-configured deploy
  still says ArenaQuest rather than rendering blanks.

## Scope

In:
- New `brand.ts` exporting a typed brand object: `sigla`, `namePrefix`,
  `nameAccent`, `accentHex`, `onAccentHex`, `fullName`, `isCustom`,
  `showPoweredBy`, with ArenaQuest defaults and the documented `showPoweredBy`
  resolution (`true`/`false` force; otherwise follow `isCustom`).
- `Logo` rendering `brand.sigla` for the badge and `brand.namePrefix` +
  optional accented `brand.nameAccent` for the wordmark.
- `next.config.ts` `env` block extended with the five brand variables.
- Component test(s) covering: default render equals today's mark; a custom
  sigla/prefix/accent renders the new mark; empty accent omits the accent span.

Out:
- Footer, document metadata, OAuth callback de-dup, and the "Powered by" line —
  owned by task 02.
- The favicon (`icon.tsx`) — owned by task 03.
- `.env.example` and CI threading — owned by task 04.

## Acceptance Criteria

- [ ] With no `NEXT_PUBLIC_BRAND_*` set, `<Logo>` renders the `AQ` badge and
      `Arena` + accented `Quest` wordmark — visually identical to `main`.
- [ ] Setting `NEXT_PUBLIC_BRAND_SIGLA` / `_NAME_PREFIX` / `_NAME_ACCENT` changes
      the badge and wordmark, with the accent treatment unchanged.
- [ ] An empty `NEXT_PUBLIC_BRAND_NAME_ACCENT` yields a single-tone wordmark with
      no accent `<span>` rendered.
- [ ] `brand.fullName`, `brand.isCustom`, and `brand.showPoweredBy` resolve per
      the rules above (covered by a unit/component test).
- [ ] No new hardcoded user-facing string is introduced; `node
      apps/web/scripts/check-i18n-coverage.js` passes.
- [ ] Changed files lint clean; `make test-web` green for the affected tests.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-web` with no brand vars; confirm the landing nav and auth screens
   show the unchanged `AQ` / `Arena`+`Quest` mark.
2. Restart with `NEXT_PUBLIC_BRAND_SIGLA`, `_NAME_PREFIX`, `_NAME_ACCENT` set;
   confirm every `<Logo>` site shows the new mark with the same accent color.
3. Restart with an empty `_NAME_ACCENT`; confirm the wordmark is single-tone.
4. `make test-web` — component tests green; run
   `node apps/web/scripts/check-i18n-coverage.js`.
5. `make lint` clean.
6. `git diff --stat` confirms only `brand.ts`, `Logo.tsx`, and `next.config.ts`
   changed.
