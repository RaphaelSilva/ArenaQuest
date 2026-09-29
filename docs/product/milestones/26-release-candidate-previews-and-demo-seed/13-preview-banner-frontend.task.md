# Task 13 — Frontend: Preview banner (Phase 3)

**Status:** 📝 Open
**Milestone:** [26 — Release-candidate previews and demo seed](./milestone.md)
**RFC:** [RFC 0021](../../RFCs/0021-release-candidate-previews-and-demo-seed.md)
**Team:** Frontend Web
**Depends On:** [Task 12](./12-deploy-cli-preview-mode.task.md)

## Summary

Lets a tester always know which candidate they are looking at. When the web is built as a
preview (`NEXT_PUBLIC_PREVIEW_NAME` set by the deploy CLI in Task 12, with the short commit
sha in `NEXT_PUBLIC_PREVIEW_SHA`), every page shows a slim, non-blocking banner reading
"Preview m21 · abc1234" (Portuguese by default, English with `NEXT_PUBLIC_LANGUAGE=en`), with
a hint that the data is shared staging demo data. When the variable is absent — local
development, staging proper, production — nothing renders and no markup is emitted. The
banner is mounted once in the root layout so it covers the `(auth)`, `(protected)` and
`(public)` route groups. It consumes no API; the only contract is the two build variables.

## Dependencies

- [Task 12](./12-deploy-cli-preview-mode.task.md) — sets `NEXT_PUBLIC_PREVIEW_NAME` /
  `NEXT_PUBLIC_PREVIEW_SHA` at build time. The component can be built and tested before it,
  but only ships visible once Task 12 exists.
- Existing root layout `apps/web/src/app/layout.tsx` and the dictionaries in
  `apps/web/src/i18n/`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/components/layout/preview-banner.tsx` (new) and its test.
  - `apps/web/src/app/layout.tsx` — mount the banner once.
  - `apps/web/src/i18n/dict-en.ts`, `apps/web/src/i18n/dict-pt.ts` (and `types.ts` if keys are
    typed) — a `previewBanner` section with identical keys.
- **Server Component.** The values are build-time constants; no `'use client'`, no state, no
  effect.
- **i18n.** No hardcoded user-facing string; `check-i18n-coverage.js` passes.
- **Zero footprint when off.** No element, class or layout shift when the variable is unset.
- **Accessible.** Rendered as a landmark-free status strip (`role="status"` not required —
  static text), readable contrast in both themes, does not cover interactive content on
  mobile.

## Scope

In:
- The banner component, its mount, the dictionary keys.
- A component test: renders name + sha when set, renders nothing when unset, uses the
  dictionary text.

Out:
- Any build-variable plumbing in the deploy CLI (Task 12).
- Any backend change.

## Acceptance Criteria

- [ ] With `NEXT_PUBLIC_PREVIEW_NAME=m21 NEXT_PUBLIC_PREVIEW_SHA=abc1234`, every route group
      shows "Preview m21 · abc1234" in the chosen language.
- [ ] Without the variables, the rendered HTML contains no banner element.
- [ ] No hardcoded user-facing string; the new keys exist in both `dict-en.ts` and
      `dict-pt.ts`; `check-i18n-coverage.js` passes.
- [ ] The banner stays readable and does not cover the navigation at mobile width.
- [ ] Changed files lint clean; `make test-web` green for the new component test.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `NEXT_PUBLIC_PREVIEW_NAME=m21 NEXT_PUBLIC_PREVIEW_SHA=abc1234 make dev-web`; open the
   login page, the catalog and the events board.
2. `make dev-web` without the variables; confirm nothing renders.
3. Toggle `NEXT_PUBLIC_LANGUAGE` between `pt` and `en`.
4. `make test-web`; run `check-i18n-coverage.js`.
5. Resize to mobile.
6. `git diff --stat` confirms only scope-guardrail files changed.
