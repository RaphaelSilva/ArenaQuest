# Task 02 — Dictionary keys for catalog redesign and instructor-preview removal (Phase 1)

**Status:** ⏳ Planned
**Milestone:** [11 — Catalog redesign](./milestone.md)
**RFC:** [0004 — Catalog page redesign, Phase 1](../../RFCs/0004-catalog-redesign.md)

## Summary

Author every new user-facing string the catalog redesign needs — in both `dict-en.ts` and `dict-pt.ts` — and remove the instructor-preview toggle from the participant catalog so it no longer renders the "Adicionar subtópico" CTA, persists a localStorage role flag, or branches its render tree on `previewRole`. Authoring tooling continues to live in `/admin/topics`; this task is the prep that lets every Phase 2 PR consume keys without having to add them piecemeal.

## Dependencies

- Task 01 (route topology cleanup landed; no Phase 2 task starts until the foundation is in place).
- Milestone 10 (i18n infrastructure already shipped — `dict`, `useDict`, `check-i18n-coverage.js`).

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/i18n/dict-en.ts` and `apps/web/src/i18n/dict-pt.ts` (additive only; no key removed or renamed in this PR).
  - Optionally the shared `Dictionary` type definition if the chosen namespace structure requires it (kept minimal — adding entries to an existing namespace, or introducing one new `catalog` sub-namespace, is preferred over restructuring).
  - The participant catalog page (`apps/web/src/app/(protected)/catalog/[id]/page.tsx`) and any directly-imported helper / component file required to remove the instructor-preview toggle, the `showInstructorUI` prop on `SubtopicCard`, and the `aq-catalog-role` localStorage usage.
- **No visual restyle.** Components keep their current markup, classes, and behaviour aside from the toggle removal.
- **i18n contract.** Every new key exists in both dictionaries with the same shape; the `Dictionary` type still satisfies both. `check-i18n-coverage.js` must continue to pass.
- **Microcopy authoring.** PT is the reference for tone; EN is a faithful translation. No locale-aware formatting (`Intl.*`) is added here.
- **Cloud-agnostic.** Dictionaries remain plain `as const` objects with no provider coupling.

## Scope

In:
- Add the following key groups (final names at implementer's discretion; the *coverage* below is the contract):
  - **Stat labels** on the topic header: subtopics count label, media count label, total-in-branch label.
  - **Eyebrows / section headers:** "Catálogo · raiz" at root, "Nível N · …" for deeper nodes, and the section labels for "Description", "Subtopics", "Media", "Discussion".
  - **Empty states** (admin-motivating, per RFC 0004 §"UX decisions"): description empty, media empty, subtopics empty, discussion empty.
  - **Error fallback:** the single friendly "deu errado aqui!" line (PT + EN).
  - **Mobile drawer affordances:** open and close labels for the hamburger and dismiss controls.
  - **Discussion microcopy:** input placeholder, publish button label (the auto-revealing "Publicar"), and the "be the first to comment" empty-state nudge.
  - **Meta pill labels** on subtopic cards: video / audio / PDF count noun (singular/plural is acceptable as a single token if the wireframe shows it that way), the "deep" pill label.
- Remove the instructor preview toggle from the participant catalog:
  - The `previewRole` / `showInstructorUI` state (and any context/provider piece scoped to it).
  - The `aq-catalog-role` localStorage read/write.
  - The `showInstructorUI` prop on `SubtopicCard` and any conditional branches keyed off it inside the participant render tree.
  - The "Adicionar subtópico" CTA inside the participant view.
- Keep `SubtopicCard`'s `showInstructorUI` exit cleanly: if the prop only ever served the participant catalog, delete it; if the same component is also imported by an admin surface, narrow the responsibility and ensure no admin code regresses.

Out:
- Migrating any other existing copy under `apps/web/src/{app,components,hooks}/**` — Milestone 10 already handled the global pass.
- Adding any visual restyle that depends on the new keys (the consuming tasks 03 – 11 wire them).
- Authoring tooling under `/admin/topics` (untouched).
- Adding telemetry events tied to the discussion thread (out of scope per §6).

## Acceptance Criteria

- [ ] Every key listed under "Scope" is present in both `dict-en.ts` and `dict-pt.ts` with the same shape; the shared `Dictionary` type still satisfies both.
- [ ] `check-i18n-coverage.js` passes; `make lint` and `make test-web` pass green.
- [ ] The participant catalog (`/catalog/[id]`) no longer renders the "Adicionar subtópico" CTA, does not read or write `aq-catalog-role` in `localStorage`, and contains no `previewRole` / `showInstructorUI` branches.
- [ ] `grep -RE "aq-catalog-role|previewRole|showInstructorUI" apps/web/src/app/(protected)/catalog apps/web/src/components/catalog` returns zero matches.
- [ ] Admin surfaces (`/admin/topics`) continue to render and function unchanged. If `SubtopicCard` was shared, the admin import still type-checks and renders without regression.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. Run `make lint`, `make test-web`, and `make test-api` and confirm green.
2. Run `check-i18n-coverage.js` (the existing script) and confirm zero misses.
3. With `make dev-web` and `NEXT_PUBLIC_LANGUAGE=pt`, load `/catalog/<id>` and confirm there is no "Adicionar subtópico" affordance, no instructor-only toggle, and no localStorage entry under `aq-catalog-role` after navigation. Repeat with `=en`.
4. Walk `/admin/topics` and confirm the admin authoring surface is unchanged.
5. Run `git diff --stat` and confirm only files within the scope guardrail are touched.
