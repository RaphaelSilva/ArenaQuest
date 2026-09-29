# Task 03 — Frontend: Catalog search matcher and sidebar (Phase 1)

**Status:** ✅ Done
**Milestone:** [24 — Catalog search by tags](./milestone.md)
**RFC:** [RFC 0017](../../RFCs/0017-catalog-search-by-tags.md)
**Team:** Frontend Web
**Depends On:** [Task 01](./01-shared-text-normaliser-and-tag-slugify.task.md)

## Summary

Replaces the catalog sidebar's title-only filter with a word-by-word matcher over title
**and** tags, and turns a tag into a linkable filter (RFC 0017 Design §2–3, milestone
Objectives 1, 3, 4, 5). A new pure module, `catalog-search`, parses the `q` query into
free tokens (via Task 01's `tokenize`; tokens under 2 characters are ignored unless they
are the whole query) and tag-only terms (`#slug`), and, together with the `?tag=<slug>`
URL parameter, decides for one topic whether it matches and **why**: every free token
must be a substring of the normalised title or of a normalised tag name (AND, any order);
every tag-only term and the `tag` parameter must equal one of the topic's tag slugs. It
returns which tags contributed. `CatalogSidebar` precomputes each node's normalised
haystack once per topic list and swaps its current `title.includes(q)` check for the
matcher in both "does this root or a descendant match" and "which ancestors to
auto-expand", so tag hits surface exactly like title hits. A node matched through a tag
(not only its title) shows up to two tag chips, then `+n`. With `?tag=` set, a
dismissible "Tag: <name>" chip sits under the search input and dismissing it removes only
`tag`. The mobile search bar writes the same `q` and, when cleared, also clears `tag`. The
placeholder becomes "search topics or tags". There is **no tag inheritance** (Resolved #2)
and the catalog home grid is untouched (Resolved #4). Nothing new is fetched — search
still runs over the list the layout already loads from `GET /v1/topics`. Task 04 reuses
the tag-chip component on the topic page.

## Dependencies

- [Task 01](./01-shared-text-normaliser-and-tag-slugify.task.md) — hard code dependency:
  the matcher normalises and tokenises through the shared functions.
- No backend dependency: `GET /v1/topics` already returns `tags` on every node.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/lib/catalog-search.ts` (new) and its test under
    `apps/web/src/lib/__tests__/`.
  - `apps/web/src/components/catalog/CatalogSidebar.tsx` — matcher, `tag` parameter,
    active-tag chip, placeholder key.
  - `apps/web/src/components/catalog/TopicTreeNode.tsx` — an optional slot for the chips
    explaining a match.
  - `apps/web/src/components/catalog/MobileSearchBar.tsx` — clearing also removes `tag`.
  - `apps/web/src/components/catalog/TagChip.tsx` (new) — the chip, shared with Task 04.
  - `apps/web/src/components/catalog/__tests__/**` — sidebar and chip tests.
  - `apps/web/src/i18n/dict-en.ts`, `apps/web/src/i18n/dict-pt.ts` — new keys only.
- **API contract.** No new endpoint and no new call: the matcher consumes the `TopicNode[]`
  the catalog layout already holds. No change under `apps/api/`.
- **Pure matcher.** `catalog-search.ts` has no React import and no side effects, so every
  RFC *Motivation* row is a plain unit test.
- **URL state as today.** `q`, `tag` and `open` stay in `useSearchParams`, written with
  `router.replace(..., { scroll: false })` and the existing 200 ms debounce.
- **i18n.** No hardcoded user-facing strings (placeholder, "Tag:" label, dismiss
  aria-label, `+n` overflow); keys identical in `dict-en` and `dict-pt`.
- **Accessibility.** The dismiss control is a button with an aria-label; chips are not
  interactive inside the tree row (the row stays the single link target).

## Scope

In:
- `catalog-search` parse + match + explain, with unit tests for every row of RFC 0017's
  *Motivation* table plus: `#slug` term, `?tag=` composition with `q`, 1-character token
  ignored, whole-query 1-character token honoured.
- Sidebar integration for filtering and ancestor auto-expansion.
- Tag chips on tag-matched rows (max 2, `+n`).
- Active-tag chip with dismiss; mobile clear also clears `tag`.
- New placeholder and labels in both dictionaries.

Out:
- The topic page tag list — Task 04.
- Any API change — Task 02.
- Filtering `catalog/page.tsx` (Resolved #4) and tag inheritance (Resolved #2).

## Acceptance Criteria

- [x] `matchTopic` unit tests pass for `chudan`, `tsuki chudan`, `kata  basica` against
      the corresponding titles, and for `soco` / `faixa amarela` against topics carrying
      those tags.
- [x] Existing `catalog-sidebar.test.tsx` and `CatalogSidebar.test.tsx` pass without edits
      to their existing cases.
- [x] A topic matched only by a tag renders its chip; a topic matched by title renders no
      chip.
- [x] `?tag=soco` shows the tagged topic and its ancestors, hides an untagged sibling root,
      and renders the tagged topic's untagged children without a chip.
- [x] Dismissing the active-tag chip removes `tag` from the URL and keeps `q`.
- [x] Clearing the mobile search input removes both `q` and `tag`.
- [x] Typing in the search box triggers no additional `topics.list()` call.
- [x] `check-i18n-coverage.js` passes; `dict-en` / `dict-pt` keys identical.
- [x] Components lint clean; `make test-web` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make test-web` — matcher and sidebar tests pass.
2. `make dev` with a local topic tree carrying a few tags — type `chudan`, `tsuki chudan`,
   a tag name, `#slug`; open `/catalog?tag=<slug>` directly; dismiss the chip; repeat on a
   narrow viewport with the mobile bar.
3. `make lint` — clean, including the i18n coverage check.
4. `git diff --stat` confirms only scope-guardrail files changed.
