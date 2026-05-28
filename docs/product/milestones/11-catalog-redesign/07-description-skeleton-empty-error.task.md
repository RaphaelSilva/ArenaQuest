# Task 07 — Description card wrap, skeleton, and section empty/error fallbacks (Phase 2)

**Status:** ⏳ Planned
**Milestone:** [11 — Catalog redesign](./milestone.md)
**RFC:** [0004 — Catalog page redesign, Phase 2](../../RFCs/0004-catalog-redesign.md)

## Summary

Wire the supporting visual scaffolding that ties the redesign together: wrap `ContentSection` in a 14 px-radius `var(--aq-bg2)` description card, introduce `MainPaneSkeleton` (header strip + two subtopic skeletons + one media row) used during the page's loading state, and introduce two generic blocks — `SectionEmpty` (admin-motivating copy) and `SectionError` ("desculpa, mas alguma coisa deu errado aqui!") — that any section in the main pane can drop in when content is missing or its fetch failed.

## Dependencies

- Task 01 (typography loaded).
- Task 02 (dictionary keys for the description / media / subtopics / discussion empty states and the generic error fallback).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/components/catalog/ContentSection.tsx` (description card wrap only — the Markdown renderer is reused as-is).
  - New components: `apps/web/src/components/catalog/MainPaneSkeleton.tsx`, `apps/web/src/components/catalog/SectionEmpty.tsx`, `apps/web/src/components/catalog/SectionError.tsx`.
  - The catalog detail page (`/catalog/[id]/page.tsx`) only to mount `MainPaneSkeleton` during the loading phase and to drop `SectionEmpty` / `SectionError` where appropriate (description section is enough to demonstrate the wiring; the media and discussion empty/error states arrive in Tasks 10 – 11).
- **Token reuse.** 14 px radius, `var(--aq-bg2)` for the card surface, `--aq-text*` for typography. No new tokens.
- **No global toast.** Per RFC §"UX decisions", the error fallback renders in place of the failed section, not as a global notification.
- **No new dependency.** Skeleton shimmer is implemented in CSS using existing token primitives or a minimal local utility — no `react-loading-skeleton` etc.
- **i18n.** Every line in `SectionEmpty` and `SectionError` reads from the dictionary; the consumer passes a key or a slot, the component does not hardcode copy.
- **Cloud-agnostic.** All three components are presentational; no provider import.

## Scope

In:
- Wrap `ContentSection` in the description-card surface (14 px radius, `--aq-bg2`, padding tuned to wireframe). Heading sizes map to h1 22 / h2 18 / h3 15 inside the Markdown content; the accent-coloured `<em>` and `<blockquote>` styling matches the wireframe.
- Implement `MainPaneSkeleton` covering: a header strip placeholder, two subtopic card placeholders, and one media row placeholder.
- Implement `SectionEmpty` with a slot for an admin-motivating title and body, plus optional iconography. Consumers pass dictionary-derived strings.
- Implement `SectionError` as a single friendly block with a dictionary-derived line ("deu errado aqui!" / EN equivalent). Optional retry slot can be added later — not required in this milestone.
- Mount `MainPaneSkeleton` while the topic detail Promise chain resolves; drop `SectionEmpty` in the description slot when the topic has no description content.

Out:
- Wiring `SectionEmpty` / `SectionError` for media (Task 10) and discussion (Task 11).
- Restyling sidebar / header / breadcrumb / subtopic card / media list (other tasks).
- Backend changes (Task 09).
- Adding any new fetch.

## Acceptance Criteria

- [ ] `ContentSection` renders inside the new 14 px-radius `var(--aq-bg2)` card on the catalog detail page.
- [ ] `MainPaneSkeleton` mounts during the topic detail load and includes a header strip, two subtopic card placeholders, and one media row placeholder.
- [ ] `SectionEmpty` and `SectionError` are reusable presentational components that take dictionary-derived strings as props/slots. The description section uses `SectionEmpty` when there is no Markdown content.
- [ ] No hardcoded user-facing string in the new components or in the page changes; `check-i18n-coverage.js` passes.
- [ ] `make lint`, `make test-web`, and `make test-api` pass green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-web`, load `/catalog/<id>` and throttle the network in DevTools; confirm `MainPaneSkeleton` renders during the load and is replaced by the real content when the fetch resolves.
2. Pick a topic that has no description content; confirm `SectionEmpty` renders with the admin-motivating copy from the dictionary.
3. Force a description fetch failure (e.g. temporary code change or DevTools network block on a specific request); confirm `SectionError` renders in place of the description without surfacing a global toast. Revert the forced failure before commit.
4. Switch `NEXT_PUBLIC_LANGUAGE` between `pt` and `en`; confirm empty and error copy translate.
5. `git diff --stat` confirms only the files listed in the scope guardrail are touched.
