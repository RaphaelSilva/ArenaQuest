# Task 05 — Frontend: Admin tag combobox (Phase 2)

**Status:** 📝 Open
**Milestone:** [24 — Catalog search by tags](./milestone.md)
**RFC:** [RFC 0017](../../RFCs/0017-catalog-search-by-tags.md)
**Team:** Frontend Web
**Depends On:** [Task 02](./02-tag-authoring-api.task.md)

## Summary

Replaces the admin topic editor's "tag IDs, comma separated" text field with a tag
combobox, so admins and content creators tag a topic by name and never see a UUID (RFC 0017
Design §5, milestone Objective 6). Typing queries Task 02's `GET /v1/admin/tags?q=`
(debounced) and lists matching tags; picking one adds it as a removable chip; pressing
Enter on a name with no match adds it as a new chip, marked as new. Duplicates are
prevented by comparing slugs (Task 01's `slugify`), so `CHUDAN` next to an existing
`Chūdan` chip is not added twice. Saving sends `tags: string[]` — the chips' names — on
create and update, and no longer sends `tagIds`. Opening an existing topic pre-fills the
chips from its `tags`. Both roles that edit topics may create tags (Resolved #5), so the
component has no role-dependent branch.

## Dependencies

- [Task 02](./02-tag-authoring-api.task.md) — hard code dependency: the `tags` request field
  and `GET /v1/admin/tags` must exist; frontend never ships ahead of the contract it calls.
- [Task 01](./01-shared-text-normaliser-and-tag-slugify.task.md) — `slugify` for client-side
  de-duplication.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/lib/admin-tags-api.ts` (new) — `list({ q, limit })` over
    `GET /v1/admin/tags`, registered on the centralised API client like the other admin
    clients.
  - `apps/web/src/lib/admin-topics-api.ts` — `tags?: string[]` on the create/update
    payloads.
  - `apps/web/src/components/admin/TagCombobox.tsx` (new) and its test under
    `apps/web/src/components/admin/__tests__/`.
  - `apps/web/src/app/(protected)/admin/topics/page.tsx` — swap the tag-ID field for the
    combobox and send `tags`.
  - `apps/web/src/lib/__tests__/admin-topics-api.test.ts` and a new
    `admin-tags-api.test.ts`.
  - `apps/web/src/i18n/dict-en.ts`, `apps/web/src/i18n/dict-pt.ts` — new keys; the
    now-unused `tagIdsLabel` / `tagIdsHint` / `tagIdsPlaceholder` keys are removed from both.
- **API contract.** Consumes exactly Task 02's surface; no change under `apps/api/`.
- **Keyboard and a11y.** The combobox follows the ARIA combobox pattern: arrow keys move
  through suggestions, Enter picks or creates, Backspace on an empty input removes the last
  chip, Escape closes the list; each chip's remove button has an aria-label.
- **Request volume.** Suggestions are debounced (≈200 ms, as the catalog search) and a
  stale response never overwrites a newer one.
- **i18n.** No hardcoded strings (label, placeholder, "new" marker, empty-suggestions text,
  remove aria-label); keys identical in both dictionaries.

## Scope

In:
- Admin tags API client and `tags` on the topics client.
- `TagCombobox` with pick, create, remove, keyboard handling and slug de-duplication.
- Topic editor integration, including pre-fill from an existing topic's `tags`.
- Removal of the tag-ID field and its dictionary keys.

Out:
- The prerequisites field, which still takes IDs — not part of this milestone.
- Tag rename / merge / delete UI — out of the milestone.

## Acceptance Criteria

- [ ] Typing `chu` shows `Chūdan` from a mocked `GET /v1/admin/tags?q=chu`; selecting it
      adds a chip.
- [ ] Enter on `Kihon novo` (no suggestion) adds a chip marked as new.
- [ ] Adding `CHUDAN` while a `Chūdan` chip is present adds nothing.
- [ ] Removing a chip and saving sends a `tags` array without it; the request body never
      contains `tagIds` or any tag ID.
- [ ] Opening an existing topic shows its current tags as chips.
- [ ] `check-i18n-coverage.js` passes; `dict-en` / `dict-pt` keys identical, with the
      `tagIds*` keys gone from both.
- [ ] Components lint clean; `make test-web` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-web` — combobox, client and page tests pass.
2. `make dev` — as the seeded admin, tag a topic with an existing and a new tag, save,
   reload, confirm the chips; open the catalog and search by the new tag.
3. `make lint` — clean.
4. `git diff --stat` confirms only scope-guardrail files changed.
