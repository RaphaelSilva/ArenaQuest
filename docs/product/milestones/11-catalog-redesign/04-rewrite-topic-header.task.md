# Task 04 — Rewrite `TopicHeader` — initials, eyebrow trail, and stats trio (Phase 2)

**Status:** ⏳ Planned
**Milestone:** [11 — Catalog redesign](./milestone.md)
**RFC:** [0004 — Catalog page redesign, Phase 2](../../RFCs/0004-catalog-redesign.md)

## Summary

Restructure `TopicHeader` to the wireframe's three-column layout (icon · text · stats) on `md+`, with the stats trio (Subtopics / Media / Total in branch) computed from the helpers landed in Task 01. The emoji-only icon is replaced by a two-letter title-initials block on the accent gradient. The eyebrow line reads `"Catálogo · raiz"` at the root and `"Nível N · A › B …"` at deeper nodes (derived from `buildTrail`). On mobile, icon + title stack and the stats render as a horizontal chip row, not the right-aligned trio.

## Dependencies

- Task 01 (typography + `countDeep` / `buildTrail` helpers).
- Task 02 (dictionary keys for the stat labels, eyebrow noun, and root label).

## Technical Constraints

- **Scope guardrail:** changes restricted to `apps/web/src/components/catalog/TopicHeader.tsx`, the page that mounts it (`apps/web/src/app/(protected)/catalog/[id]/page.tsx`) only insofar as the props it passes need extending, and any owned style/sub-component file of `TopicHeader`. The progress bar already rendered below the header is **kept** as-is.
- **Stats computation.** `Total no ramo` is computed client-side via `countDeep` (Task 01) walking the flat tree already loaded by the sidebar layout. Memoise per node id to avoid re-walking the tree on every render. No backend round-trip is added; the `mediaCount` field from Task 09 is **not** consumed in this task (the stats trio uses the count of own media on the current node and the deep aggregate — both derivable from already-loaded data).
- **Token reuse.** Initials block uses `linear-gradient(var(--aq-accent), var(--aq-accent2))`; text colors use `--aq-text*`. No new tokens.
- **Responsive contract.** `grid-cols-1 md:grid-cols-[auto_1fr_auto]`. On mobile/tablet, icon + title stack and stats become an inline chip row (per RFC §"Mobile & responsiveness").
- **i18n.** Stat labels, the root eyebrow text, and the trail separator come from the dictionary; no hardcoded copy.
- **Cloud-agnostic.** No new dependency.

## Scope

In:
- Replace the existing header markup with the three-column grid on `md+` and the stacked layout below.
- Render the two-letter initials block on the accent gradient (derived from the topic title; falls back gracefully when the title is shorter than two visible characters).
- Render the eyebrow line above the title: `"Catálogo · {dict.catalog.root}"` at depth 0, and `"Nível {N} · A › B …"` at depth N, using the trail returned by `buildTrail`.
- Render the three stat tiles: Subtopics (direct children count), Media (own-media count, already available from `TopicWithMedia`), Total in branch (`countDeep` for the current node).
- Type the props as outlined in RFC 0004 §"Component contracts" — `topic: TopicWithMedia`, `trail`, `stats`. The implementer chooses whether `stats` is computed inside the component or passed in by the page; whichever is chosen, the helper memoisation requirement still holds.

Out:
- MediaMix pills on subtopic cards (Task 11).
- The progress bar (kept).
- Breadcrumb (Task 05) — `TopicHeader` does not render the breadcrumb.
- Backend changes (Task 09).
- Inline media stages (Task 10).

## Acceptance Criteria

- [ ] On `md+`, `TopicHeader` renders as three columns (initials · text · stats). On `< md`, icon + title stack and stats render as a horizontal chip row.
- [ ] The initials block uses the accent gradient and shows the first two visible characters of the topic title; an empty/short title degrades gracefully (a single letter or a neutral placeholder, no thrown error).
- [ ] The eyebrow shows `"Catálogo · raiz"` at the root and `"Nível N · A › B …"` at deeper nodes; the trail is derived from `buildTrail`.
- [ ] The three stat tiles show: Subtopics (direct children), Media (own media), Total in branch (`countDeep`). Labels come from the dictionary.
- [ ] `countDeep` is memoised per node id so the header does not re-walk the tree on every render.
- [ ] No hardcoded user-facing string in `TopicHeader.tsx`; `check-i18n-coverage.js` passes.
- [ ] `make lint`, `make test-web`, and `make test-api` pass green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-web`, load `/catalog/<root-id>` at `lg`; confirm the three-column header, the initials block, and the eyebrow showing the root label.
2. Navigate to a nested node and confirm the eyebrow shows `"Nível N · A › B"` and the stats reflect the new node.
3. Resize to `< md`; confirm icon + title stack and stats render as inline chips.
4. Pick a topic with no media and no children and confirm the stats render `0 / 0 / 1` (or the equivalent for "self only") without errors.
5. Switch `NEXT_PUBLIC_LANGUAGE` between `pt` and `en`; confirm stat labels translate.
6. `git diff --stat` confirms only the files listed in the scope guardrail are touched.
