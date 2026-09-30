# Task 02 — Backend: Tag authoring API (Phase 1)

**Status:** 📝 Open
**Milestone:** [24 — Catalog search by tags](./milestone.md)
**RFC:** [RFC 0017](../../RFCs/0017-catalog-search-by-tags.md)
**Team:** Backend API
**Depends On:** [Task 01](./01-shared-text-normaliser-and-tag-slugify.task.md)

## Summary

Makes tags authorable without a UUID and makes bad tag input a validation error instead of
a crash (RFC 0017 Design §4, Resolved #1 and #5). `POST` and `PATCH /v1/admin/topics`
accept a new `tags` field — a list of **names** (each 1–40 characters after trim, at most
20). The controller slugifies each name with Task 01's `slugify`, rejects any whose slug is
empty (`400`), de-duplicates by slug, upserts them through `ITagRepository.upsertMany`, and
links the resulting IDs to the topic. `upsertMany` changes to **first spelling wins**: an
existing slug is reused with its stored name untouched, so typing `CHUDAN` when `Chūdan`
exists links `Chūdan` and creates nothing. The legacy `tagIds` field stays accepted, but
sending both fields is a `400`, and an ID with no `tags` row now returns
`422 UNKNOWN_TAG` (offending ID in `meta.detail`, nothing written) — mirroring
`UNKNOWN_PREREQ` — instead of failing on the foreign key. On `PATCH`, `tags: []` clears the
topic's tags and an omitted `tags` leaves them unchanged. A new
`GET /v1/admin/tags?q=&limit=` lists tags whose slug starts with `slugify(q)`, ordered by
slug (`limit` default 20, max 100), for `admin` and `content_creator`; other roles get
`403`. Response shapes of existing endpoints do not change. Task 05 builds the admin
combobox on these two surfaces; Task 06 sends `tags` from the importer.

## Dependencies

- [Task 01](./01-shared-text-normaliser-and-tag-slugify.task.md) — hard code dependency:
  `slugify` is the only way a name becomes a slug, on write and on the `q` filter.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `packages/shared/ports/i-tag-repository.ts` — **only** to add an optional `q` (slug
    prefix) to `list(opts)`.
  - `apps/api/src/adapters/db/d1-tag-repository.ts` — `upsertMany` conflict clause becomes
    "do nothing"; `list` honours the slug-prefix filter; a lookup of which IDs exist, if
    the port lacks one (added to the port in the same file set).
  - `apps/api/src/controllers/admin-topics.controller.ts` — `tags` handling, `UNKNOWN_TAG`,
    mutual exclusion with `tagIds`; a small tag-listing method (or a new
    `admin-tags.controller.ts` if that reads cleaner).
  - `apps/api/src/routes/admin/topics.ts` — `tags` on the create/update schemas.
  - `apps/api/src/routes/admin/tags.ts` (new) and its registration in
    `apps/api/src/routes/admin/index.ts`.
  - `apps/api/src/openapi/components/entities.ts` — only new schemas for the tag list
    response, if the existing `TagSchema` is not enough.
  - `apps/api/test/**` — adapter, controller and router specs.
- **No migration.** The `tags` / `topic_node_tags` schema from `0005` is sufficient
  (milestone Decision 7); the prefix filter uses the existing `UNIQUE` index on `slug`.
- **Ports & Adapters.** The controller reasons in slugs and IDs through `ITagRepository`;
  only `D1TagRepository` knows SQL. No D1 type leaks into the port or controller.
- **Validation & results.** Request schemas are `@hono/zod-openapi` `createRoute`
  definitions, like the rest of `routes/admin/topics.ts` (the `@ValidateBody` decorator in
  older docs is not the pattern in use); the controller returns `ControllerResult<T>` with
  explicit `400` / `404` / `422` branches.
- **Authorization.** `routes/admin/tags.ts` mounts under the admin umbrella's existing
  `requireRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR)`; it adds no stricter guard
  (Resolved #5).
- **Atomicity.** Upserting tags and replacing a topic's links must not leave a topic
  half-linked: tag upsert happens before the link replacement, and the link replacement
  stays a single `db.batch`.

## Scope

In:
- `tags: string[]` on create and update, with trimming, length/count limits, empty-slug
  rejection, slug de-duplication, upsert and linking.
- First-spelling-wins `upsertMany`.
- `tags` + `tagIds` → `400`; unknown `tagIds` → `422 UNKNOWN_TAG`, nothing written.
- `PATCH` semantics for `tags: []` vs omitted.
- `GET /v1/admin/tags` with `q` prefix filter and `limit`.
- Regression spec: `GET /v1/topics` for a student still omits a tagged topic outside their
  effective-access set (the search surface stays bounded by enrollment).

Out:
- Any frontend change — Task 05 (combobox) and Tasks 03–04 (catalog).
- Tag rename / merge / delete endpoints — out of the milestone (no tag-admin screen).
- Any change to what `GET /v1/topics` returns.

## Acceptance Criteria

- [ ] With `{ name: 'Chūdan', slug: 'chudan' }` stored, `PATCH` a topic with
      `tags: ['CHUDAN']` → `200`; the topic carries that tag, `tags.name` is still
      `Chūdan`, and the `tags` row count is unchanged.
- [ ] `POST` with `tags: ['Soco', 'soco', ' SOCO ']` creates exactly one `soco` tag and
      one link.
- [ ] `tags: ['!!!']` → `400`; a 41-character name → `400`; 21 names → `400`.
- [ ] `tags` and `tagIds` in the same body → `400`.
- [ ] `tagIds: ['<unknown>']` → `422 UNKNOWN_TAG` with the ID in `meta.detail`, and
      `topic_node_tags` is unchanged.
- [ ] `PATCH` with `tags: []` removes every link; `PATCH` without `tags` keeps them.
- [ ] `GET /v1/admin/tags?q=chu` returns `chudan` for `admin` and `content_creator`;
      `student` gets `403`; `limit=500` is capped (or rejected) per the schema.
- [ ] A student's `GET /v1/topics` does not include a tagged topic outside their
      effective-access set.
- [ ] No D1 import leaks into the port or controller.
- [ ] Changed files lint clean; `make test-api` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api` — adapter, controller and router specs for every branch above pass.
2. `make dev-api` — with a seeded admin token, `PATCH` a topic with `tags`, then
   `GET /v1/admin/tags?q=` and `GET /v1/topics` to see the tag on the topic; repeat with an
   unknown `tagIds` and with both fields to see `422` / `400`.
3. `make lint` — clean.
4. `git diff --stat` confirms only scope-guardrail files changed.
