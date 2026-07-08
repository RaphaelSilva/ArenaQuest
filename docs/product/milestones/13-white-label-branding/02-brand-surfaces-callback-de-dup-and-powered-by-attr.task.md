# Task 02 — Frontend: Brand surfaces, callback de-dup and Powered-by attribution (Phase 2)

**Status:** ✅ Done
**Milestone:** [13 — White-label branding](./milestone.md)
**RFC:** [RFC 0006](../../RFCs/0006-white-label-branding-and-build-tooling.md)
**Team:** Frontend Web
**Depends On:** [Task 01](./01-brand-config-module-and-logo-wordmark.task.md)

## Summary

Route the rest of the brand surfaces through the config module added in task 01.
De-duplicate the OAuth callback screen so it renders `<Logo />` instead of its
hand-rolled inline badge/wordmark, leaving exactly one implementation of the mark
(a visual no-op for the default brand). Make the public footer copyright read
`© {year} {brand.fullName}.` with the trailing sentence still an i18n string, and
make the document `<title>` / `description` metadata resolve from
`brand.fullName`. Add a small "Powered by ArenaQuest" footer attribution that
renders when `brand.showPoweredBy` is true: `"Powered by"` becomes a new
dictionary key present with identical keys in both `dict-en.ts` and `dict-pt.ts`,
while `"ArenaQuest"` stays a deliberate platform constant (sourced from
`brand.ts` as an exported constant if the i18n checker flags an inline literal),
since it is the platform's name and not the deployer's brand.

## Dependencies

- Task 01 — consumes the `brand` config module (`brand.fullName`,
  `brand.showPoweredBy`) and the de-duplicated `<Logo>`. This task must not ship
  ahead of it.
- Existing surfaces this extends: `apps/web/src/app/(auth)/auth/callback/page.tsx`,
  `apps/web/src/app/page.tsx` (footer), `apps/web/src/app/layout.tsx` (metadata),
  `apps/web/src/i18n/dict-en.ts` + `dict-pt.ts`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(auth)/auth/callback/page.tsx` — replace the inline mark
    with `<Logo />`; remove the hand-rolled badge/wordmark markup.
  - `apps/web/src/app/page.tsx` — footer copyright from `brand.fullName` and the
    conditional "Powered by" line.
  - `apps/web/src/app/layout.tsx` — `metadata.title` / `description` from
    `brand.fullName`.
  - `apps/web/src/i18n/dict-en.ts`, `apps/web/src/i18n/dict-pt.ts` (and
    `types.ts` if keys are typed) — the single new "Powered by" key.
- **One mark only.** After this task no surface draws the badge/wordmark outside
  `<Logo>`; the callback's surrounding styles already match `Logo`'s output, so
  the change is a visual no-op for the default brand.
- **Platform constant.** `"ArenaQuest"` in the "Powered by" line is intentionally
  not driven by `brand.*`. If `check-i18n-coverage.js` flags it as a hardcoded
  literal, move it into `brand.ts` as an exported `PLATFORM_NAME` constant rather
  than dictionarising it.
- **i18n.** Only `"Powered by"` is translatable; it must exist with identical
  keys in both dictionaries. The year and `brand.fullName` are interpolated, not
  hardcoded copy. `check-i18n-coverage.js` must pass.
- **App Router conventions.** `layout.tsx` metadata is evaluated at build time in
  a Server Component, so `brand.fullName` inlines correctly; do not convert
  Server Components to Client.

## Scope

In:
- OAuth callback renders `<Logo />`, inline badge/wordmark removed.
- Footer copyright interpolates `brand.fullName`; trailing sentence stays i18n.
- Document `<title>` and `description` resolve from `brand.fullName`.
- Conditional "Powered by ArenaQuest" footer line gated on `brand.showPoweredBy`.
- New `"Powered by"` key in both dictionaries (and the typed keys if applicable).
- Component test(s): callback renders `<Logo>` and no inline mark; footer/title
  reflect a custom name; the attribution shows/hides per `showPoweredBy`.

Out:
- The `brand` module, `Logo`, and `next.config.ts` env — owned by task 01.
- The favicon — owned by task 03.
- `.env.example` and CI threading — owned by task 04.

## Acceptance Criteria

- [x] `apps/web/src/app/(auth)/auth/callback/page.tsx` renders `<Logo />` and no
      longer contains an inline badge/wordmark (verifiable by `grep`).
- [x] Footer copyright reads `© {year} {brand.fullName}.` and the document
      `<title>` reflects `brand.fullName` (verified with a custom name).
- [x] "Powered by ArenaQuest" appears when `brand.showPoweredBy` is true and is
      absent when false.
- [x] `"Powered by"` exists with identical keys in `dict-en.ts` and `dict-pt.ts`;
      `node apps/web/scripts/check-i18n-coverage.js` passes. (Note: a second key,
      `landing.footer.rights`, was added alongside it — resolved with the user — so
      interpolating `brand.fullName` keeps the trailing sentence i18n and the
      checker green.)
- [x] Changed files lint clean; `make test-web` green for the affected tests.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-web` (+ `make dev-api` for the live OAuth callback) with no brand
   vars; confirm the callback, footer, and title are visually unchanged.
2. Restart with a custom `NEXT_PUBLIC_BRAND_NAME_PREFIX` / `_NAME_ACCENT`;
   confirm the footer copyright and document title both show the custom name.
3. Confirm "Powered by ArenaQuest" appears on the custom build; set
   `NEXT_PUBLIC_BRAND_POWERED_BY=false` and confirm it disappears.
4. Toggle `NEXT_PUBLIC_LANGUAGE` between `pt` and `en`; confirm "Powered by"
   translates while "ArenaQuest" stays constant.
5. `make test-web` green; run `node apps/web/scripts/check-i18n-coverage.js`;
   `make lint` clean.
6. `git diff --stat` confirms only the guardrail files changed.
