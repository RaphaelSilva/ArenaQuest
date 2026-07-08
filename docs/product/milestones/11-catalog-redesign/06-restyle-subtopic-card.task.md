# Task 06 — Restyle `SubtopicCard` — two-column grid, index, and arrow chip (Phase 2)

**Status:** ✅ Done
**Milestone:** [11 — Catalog redesign](./milestone.md)
**RFC:** [0004 — Catalog page redesign, Phase 2](../../RFCs/0004-catalog-redesign.md)

## Summary

Restyle `SubtopicCard` and its grid container to the wireframe's two-column layout (collapsing to one column when the main pane's effective width is below ~1100 px). Each card shows a monospaced index (`01`, `02`, …), a title, a 2-line description clamp, a "deep" pill when the branch has further children, and a right-side arrow chip that fills with `--aq-accent` on hover. The MediaMix pills (video / audio / PDF counts) are **not** wired in this task — they depend on the backend `mediaCount` field added in Task 09 and are wired in Task 11.

## Dependencies

- Task 01 (typography loaded — JetBrains Mono for indices).
- Task 02 (dictionary keys for the "deep" pill label and any helper string).

## Technical Constraints

- **Scope guardrail:** changes restricted to `apps/web/src/components/catalog/SubtopicCard.tsx`, the immediate grid container (currently part of the page or a `SubtopicGrid` sibling under `apps/web/src/components/catalog/**`), and any owned style file. The page (`/catalog/[id]/page.tsx`) is touched only insofar as the props passed to the card change shape (e.g. adding `index` and `hasChildren`).
- **Token reuse.** Indices render in JetBrains Mono tinted with `var(--aq-accent)`. Card surfaces, borders, and arrow chip use existing `--aq-*` variables. No new tokens.
- **MediaMix pills deferred.** During this task the meta-pill row renders only the "deep" pill (when applicable). The video / audio / PDF count pills are added in Task 11 once `mediaCount` is available. The component **may** accept a placeholder prop now, but no UI is rendered for the kind counts in this PR.
- **Responsive contract.** `grid-cols-1 lg:grid-cols-2`, with a container query or `lg` breakpoint switch ensuring the grid collapses to one column when the main pane is narrower than ~700 px (per RFC §"Mobile & responsiveness").
- **Behaviour preserved.** Clicking a card still navigates to `/catalog/<id>`; the status pill (visited / completed) still renders if the current implementation shows one.
- **i18n.** "Deep" pill label and any other text read from the dictionary.

## Scope

In:
- Restyle the card to match the wireframe (index, title, 2-line description clamp, "deep" pill when `hasChildren`, right-side arrow chip with hover fill).
- Adjust the grid container to the two-column layout with the documented collapse behaviour.
- Type the `SubtopicCard` props per RFC 0004 §"Component contracts": `topicId`, `subtopic`, `index`, `status`, `hasChildren`. The `subtopic` will eventually carry `mediaCount` (Task 11); this task does not consume it.
- Compute `index` 1-based at the call site (the page) and render it zero-padded to two digits in the card.

Out:
- MediaMix pills with kind counts (Task 11).
- Backend `mediaCount` projection (Task 09).
- Breadcrumb, header, sidebar, media list, discussion (other tasks).
- Adding any new fetch in the card.

## Acceptance Criteria

- [x] The subtopic grid renders two columns on `lg+` and collapses to one column when the main pane is narrower than ~700 px.
- [x] Each card shows: a monospaced `01..NN` index, title, 2-line description clamp, the "deep" pill when the subtopic has children, and an arrow chip that fills with `--aq-accent` on hover.
- [x] The card links to `/catalog/<subtopic.id>`; the status pill (if applicable) still renders.
- [x] No MediaMix pills appear in this PR; the meta-pill row contains only the "deep" pill when applicable.
- [x] No hardcoded user-facing string under the component; `check-i18n-coverage.js` passes.
- [x] `make lint`, `make test-web`, and `make test-api` pass green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-web`, load `/catalog/<id>` at `lg+` with a topic that has multiple children; confirm two-column grid, indices, the "deep" pill on subtopics that have grandchildren, and the arrow chip hover fill.
2. Resize so the main pane is narrower than ~700 px; confirm the grid collapses to one column.
3. Click a card; confirm navigation to `/catalog/<subtopic.id>`.
4. Inspect one card; confirm no kind-count pill renders yet (those wait for Task 11).
5. `git diff --stat` confirms only the files listed in the scope guardrail are touched.
