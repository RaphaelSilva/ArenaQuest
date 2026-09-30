# Task 04 — Frontend: Topic page tag chips (Phase 2)

**Status:** 📝 Open
**Milestone:** [24 — Catalog search by tags](./milestone.md)
**RFC:** [RFC 0017](../../RFCs/0017-catalog-search-by-tags.md)
**Team:** Frontend Web
**Depends On:** [Task 03](./03-catalog-search-matcher-and-sidebar.task.md)

## Summary

Lets a student discover the tag vocabulary where they read content: the topic page lists
the topic's tags as chips, each linking to `/catalog?tag=<slug>` (RFC 0017 Design §3,
milestone Objective 4). The data is already in hand — the topic returned by
`GET /v1/topics/{id}` carries `tags` — so this is a presentation-only change that reuses
Task 03's tag-chip component in its link form. A topic with no tags renders nothing (no
empty heading, no placeholder). Following a chip lands on the catalog with the sidebar
filtered by Task 03's `tag` parameter.

## Dependencies

- [Task 03](./03-catalog-search-matcher-and-sidebar.task.md) — hard code dependency: the
  `TagChip` component and the `?tag=` behaviour the links point at.
- No backend dependency: the topic payload already includes `tags`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/components/catalog/TopicHeader.tsx` — render the tag chips (preferred
    location, next to the existing header metadata).
  - `apps/web/src/app/(protected)/catalog/[id]/page.tsx` — **only** if the tags must be
    passed down to `TopicHeader` explicitly.
  - `apps/web/src/components/catalog/TagChip.tsx` — only to add the link variant if Task 03
    did not ship it.
  - `apps/web/src/components/catalog/__tests__/**` — header test.
  - `apps/web/src/i18n/dict-en.ts`, `apps/web/src/i18n/dict-pt.ts` — new keys only (e.g. the
    list's accessible label).
- **API contract.** Reads the existing `TopicWithMedia.tags`; no new call, no change under
  `apps/api/`.
- **Navigation.** Chips are real links (Next.js `Link`) to `/catalog?tag=<slug>`, so they
  work with middle-click and are crawl-safe; the slug is URL-encoded.
- **i18n.** No hardcoded user-facing strings; keys identical in both dictionaries.

## Scope

In:
- Tag chips on the topic page, as links to the tag filter.
- Nothing rendered for a topic with no tags.
- A component test for both states.

Out:
- Any sidebar behaviour — Task 03.
- Editing tags — Task 05.

## Acceptance Criteria

- [ ] A topic with tags `Soco` and `Kihon` renders two links with hrefs
      `/catalog?tag=soco` and `/catalog?tag=kihon`.
- [ ] A topic with no tags renders no tag list element.
- [ ] Clicking a chip in `make dev` lands on the catalog with the sidebar filtered and the
      active-tag chip visible.
- [ ] `check-i18n-coverage.js` passes; `dict-en` / `dict-pt` keys identical.
- [ ] Components lint clean; `make test-web` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-web` — the header test passes.
2. `make dev` — open a tagged topic, click a chip, confirm the filtered sidebar; open an
   untagged topic and confirm nothing is shown.
3. `make lint` — clean.
4. `git diff --stat` confirms only scope-guardrail files changed.
