# Milestone 24 — Catalog search by tags

**Status:** 📝 Draft
**Scope:** `packages/shared` (text normaliser, tag slugify, `ITagRepository.list` filter), `apps/api` (tag authoring on admin topics, `GET /v1/admin/tags`), `apps/web` (catalog sidebar matcher, `?tag=` filter, tag chips, admin tag combobox), `scripts/content` (README `tags` key). Derived from [RFC 0017](../../RFCs/0017-catalog-search-by-tags.md).

> **Hard scope guardrail — read before opening any task.** This milestone may touch **only**: the new files `packages/shared/domain/search/{normalize.ts,index.ts}` and `packages/shared/domain/tags/{slugify.ts,index.ts}` (plus their tests, `slugify.fixtures.json` and re-exports); `packages/shared/ports/i-tag-repository.ts` **only** to add an optional `q` to `list(opts)`; `apps/api/src/adapters/db/d1-tag-repository.ts` (`upsertMany` → `ON CONFLICT(slug) DO NOTHING`, `list` slug-prefix filter); `apps/api/src/controllers/admin-topics.controller.ts` and `apps/api/src/routes/admin/topics.ts` (`tags` names on create/update, `UNKNOWN_TAG`); the new `apps/api/src/routes/admin/tags.ts` (plus an optional `apps/api/src/controllers/admin-tags.controller.ts`) and its wiring in `apps/api/src/routes/admin/index.ts` / the container; `apps/api/src/openapi/components/entities.ts` only for the new request/response schemas; the new `apps/web/src/lib/catalog-search.ts` and `apps/web/src/lib/admin-tags-api.ts`; `apps/web/src/lib/admin-topics-api.ts` (`tags` field); `apps/web/src/components/catalog/{CatalogSidebar,TopicTreeNode,MobileSearchBar}.tsx` and a new tag-chip component under `apps/web/src/components/catalog/`; `apps/web/src/app/(protected)/catalog/[id]/page.tsx` (or the component it renders the topic header with) **only** to list the topic's tags; `apps/web/src/app/(protected)/admin/topics/page.tsx` and a new combobox component under `apps/web/src/components/admin/`; both i18n dictionaries; `scripts/content/import-media.mjs` and `import-media.test.mjs` (README fence `tags`); and, for the closeout only, a new local seed `apps/api/migrations/seed/0004_catalog_tags_local.sql` and its line in the `Makefile` `db-seed-local` target, `docs/product/FEATURES.md`, the `CLAUDE.md` importer paragraph, RFC 0017's `Status:` header and its README row. It is explicitly **not** an opportunity to: search topic `content` (RFC Resolved #3); add a server-side search endpoint, `LIKE` query or FTS5 table; add fuzzy/typo-tolerant matching or a fuzzy-search dependency; make tags inherit from parent to child (Resolved #2); filter the catalog home grid `catalog/page.tsx` (Resolved #4); build a tag administration screen (rename, merge, delete); add a migration or change the `tags` / `topic_node_tags` schema; search tasks, events or media; or change what `GET /v1/topics` returns or who may read it. If a refactor opportunity is spotted outside this scope, file a separate task — do not bundle it.

---

## 1. Objectives

- **A query finds a topic by title or by tag, word by word.** Every query token must appear in the normalised title or a normalised tag name — any order, case- and accent-insensitive, whitespace-tolerant (RFC Goals, Design §2).
- **One normaliser for search and slugs.** `normalizeText` / `tokenize` / `slugify` live in `packages/shared`, so the tag `Chūdan` and the query `chudan` can never disagree (RFC Design §1).
- **A tag hit explains itself.** A sidebar row matched only through a tag shows that tag as a chip (RFC Design §3).
- **A tag is a linkable filter.** `/catalog?tag=<slug>` (and `#slug` inside `q`) filters the sidebar exactly; the topic page lists its tags as links to it (RFC Design §2–3).
- **No regression.** Every title-substring query that matches today still matches (RFC Goals).
- **Admins and content creators tag a topic by name.** `tags: string[]` on create/update, missing tags created by slug, existing ones reused with their first spelling kept; no UUIDs in the UI (RFC Design §4–5, Resolved #1, #5).
- **Bad tag IDs fail as validation, not as a crash.** Unknown `tagIds` return `422 UNKNOWN_TAG` (RFC Design §4).
- **An existing tree can be tagged in bulk.** The importer reads `"tags"` from the README `arenaquest` fence (RFC Design §6).

Out of scope (explicit, from RFC 0017 Non-Goals and Resolved Decisions):
- **Search in topic content** — a future RFC with a D1 FTS5 index and an enrollment-aware endpoint (Resolved #3).
- **Server-side search / FTS5** — not needed at current catalog size; the matcher's semantics are portable later.
- **Fuzzy / typo-tolerant matching** — deferred until usage shows the need.
- **Tag administration screen** (rename, merge, delete) — backlog item; renaming is deliberately not a side effect of tagging (Resolved #1).
- **Tag inheritance** — a parent's tag does not make its children results (Resolved #2).
- **Catalog home grid filtering** — search stays a sidebar/drawer concern (Resolved #4).
- **Searching tasks, events or media.**

---

## 2. Functional Requirements

**Shared normalisation**
- `normalizeText` folds diacritics, maps Unicode dashes to `-`, lowercases, squeezes whitespace and trims.
- `tokenize` splits the normalised text on whitespace and `- _ / . , ; :` and drops empty tokens.
- `slugify(name)` equals `tokenize(name).join('-')`; `slugify('Chūdan Tsuki') === 'chudan-tsuki'`.

**Catalog search (web)**
- Free tokens of `q` must each be a substring of the node's normalised title or of one of its normalised tag names; all must hold (AND), in any order.
- Tokens shorter than 2 characters are ignored unless they are the whole query.
- A `#slug` token in `q` and the `?tag=<slug>` parameter each require an exact match on one of the node's tag slugs; `q` and `tag` compose.
- A root is shown when it or any descendant matches; ancestors of every match are auto-expanded — for tag hits exactly as for title hits.
- A node that matched through a tag (and not only through its title) shows up to 2 matching tag chips, then `+n`.
- With `?tag=` set, a dismissible "Tag: <name>" chip appears under the search input; dismissing removes only `tag`.
- The mobile search bar writes the same `q`; clearing the mobile input also clears `tag`.
- The search placeholder reads "search topics or tags" (PT and EN).
- The topic page lists the topic's tags as chips linking to `/catalog?tag=<slug>`; a topic with no tags shows nothing.
- Search only ever filters the list already returned by `GET /v1/topics`; no new request is made per keystroke.

**Tag authoring (API)**
- `POST` / `PATCH /v1/admin/topics` accept `tags: string[]` (each 1–40 characters after trim, at most 20); names are slugified, de-duplicated by slug, upserted, and linked.
- An existing slug keeps its stored name (`ON CONFLICT(slug) DO NOTHING`).
- A name whose slug is empty (e.g. only punctuation) is rejected with `400`.
- Sending both `tags` and `tagIds` returns `400`.
- `tagIds` remains accepted; an ID with no `tags` row returns `422 UNKNOWN_TAG` with the offending ID in `meta.detail`, and nothing is written.
- `PATCH` with `tags: []` removes every tag from the topic; omitting `tags` leaves them unchanged.
- `GET /v1/admin/tags?q=&limit=` (roles `admin`, `content_creator`) returns tags whose slug starts with `slugify(q)`, ordered by slug, `limit` default 20, max 100; other roles get `403`.

**Tag authoring (admin web)**
- The topic editor replaces the "tag IDs, comma separated" field with a combobox: typing queries `GET /v1/admin/tags`, picking adds a chip, Enter on an unmatched name adds it as new, chips are removable.
- Saving sends `tags: string[]`; the editor never displays a tag ID.

**Importer**
- The README `arenaquest` fence accepts `"tags": string[]`; it is sent as `tags` on create and compared (by slug set) in the drift check, so an unchanged re-run performs no write.
- A non-array or non-string `tags` value is a warning and is ignored, like other malformed fence keys.

---

## 3. Acceptance Criteria

- [ ] Unit tests for `normalizeText`, `tokenize` and `slugify` cover `Chūdan`/`Jō`, en-dash, double spaces, NFC vs NFD input and an all-punctuation name.
- [ ] `matchTopic` unit tests pass for every row of RFC 0017's *Motivation* table (`chudan`, `tsuki chudan`, `kata  basica`, `soco` via tag, `faixa amarela` via tag).
- [ ] The existing `catalog-sidebar.test.tsx` and `CatalogSidebar.test.tsx` suites pass unchanged (no regression on title search).
- [ ] Sidebar test: a topic matched only by tag renders its tag chip; a topic matched by title renders none.
- [ ] Sidebar test: `?tag=soco` shows the tagged topic and its ancestors, not an untagged sibling; its children render under it but a child without the tag shows no chip (no inheritance).
- [ ] Sidebar test: typing does not trigger any additional `topics.list()` call.
- [ ] API test: `PATCH` with `tags: ["CHUDAN"]` when `{name:'Chūdan', slug:'chudan'}` exists links that tag and `tags.name` is still `Chūdan`; `SELECT COUNT(*) FROM tags` is unchanged.
- [ ] API test: `tagIds: ["<unknown>"]` returns `422 UNKNOWN_TAG` and `topic_node_tags` is unchanged.
- [ ] API test: `tags` + `tagIds` together returns `400`; `tags: ["!!!"]` returns `400`.
- [ ] API test: `GET /v1/admin/tags?q=chu` returns `chudan` for `admin` and `content_creator`, `403` for `student`.
- [ ] API test: a student listing `GET /v1/topics` does not receive a tagged topic outside their effective-access set (search surface bounded by enrollment).
- [ ] Web test: the admin combobox adds an existing tag, creates a new one on Enter, removes a chip, and submits `tags: string[]` with no IDs.
- [ ] Importer: a dry run over a README with `"tags": ["soco"]` plans the tag; a second real run on an unchanged tree performs zero writes.
- [ ] `check-i18n-coverage.js` passes; `dict-en.ts` / `dict-pt.ts` keys are identical.
- [ ] No new file under `apps/api/migrations/` other than the local seed `seed/0004_catalog_tags_local.sql`.
- [ ] `make lint`, `make test-api` and `make test-web` pass green.
- [ ] No diff outside the files listed in the guardrail.

---

## 4. Specific Stack

- **Backend:** Cloudflare Workers + Hono; per-request adapters in `buildApp(env)` (`D1TagRepository` is already built there and injected into `AdminTopicsController`); routes are `@hono/zod-openapi` `createRoute` definitions — the new `admin/tags.ts` follows `admin/topics.ts` and sits under the same `requireRole(ADMIN, CONTENT_CREATOR)` guard; controllers return `ControllerResult<T>`. Tag upsert and link writes use `db.batch([...])`.
- **Shared:** new pure modules `domain/search/normalize.ts` (`normalizeText`, `tokenize`) and `domain/tags/slugify.ts`; `ITagRepository.list(opts)` gains an optional `q`. No change to `Entities.Content.Tag` or `TopicNode`.
- **Frontend:** Next.js 15 App Router, React 19, Tailwind CSS v4; `catalog-search.ts` is a pure module (no React) consumed through `useMemo` in `CatalogSidebar`; URL state stays in `useSearchParams` / `router.replace` as today; `useDict()` in client components; both i18n dictionaries; `check-i18n-coverage.js`.
- **Tooling:** `scripts/content/import-media.mjs` (Node, stdlib) cannot import TypeScript from `packages/shared`, so it carries a copy of `slugify`, guarded by a parity test that reads the shared `packages/shared/domain/tags/slugify.fixtures.json`; run with `make test-scripts`.
- **Tests:** Vitest for `packages/shared`; Vitest + `@cloudflare/vitest-pool-workers` (API); Vitest + RTL (web); the importer's existing `node --test` suite.

---

## 5. Task Breakdown

| # | Task File | Phase | Team | Status |
|---|-----------|-------|------|--------|
| 01 | [Shared text normaliser and tag slugify](./01-shared-text-normaliser-and-tag-slugify.task.md) | 0 | Backend | ✅ Done |
| 02 | [Tag authoring API](./02-tag-authoring-api.task.md) | 1 | Backend | ✅ Done |
| 03 | [Catalog search matcher and sidebar](./03-catalog-search-matcher-and-sidebar.task.md) | 1 | Frontend | ✅ Done |
| 04 | [Topic page tag chips](./04-topic-page-tag-chips.task.md) | 2 | Frontend | ✅ Done |
| 05 | [Admin tag combobox](./05-admin-tag-combobox.task.md) | 2 | Frontend | ☐ Open |
| 06 | [Importer README tags](./06-importer-readme-tags.task.md) | 2 | Backend | ☐ Open |
| 07 | [Local seed, docs and closeout](./07-local-seed-docs-and-closeout.task.md) | 3 | Backend | ☐ Open |

Dependency graph:

```
01 ──┬──► 02 ──┬──► 05 ──┐
     │         └──► 06 ──┤
     │                   ├──► 07
     └──► 03 ──► 04 ─────┘
```

(`05` and `06` also read `01` directly: `slugify` for de-duplication and the shared fixture.)

**Recommended execution order:** `01` → `03` → `04` → `02` → `05` → `06` → `07`.

`03` + `04` deliver the student-facing search on their own (tags that already exist
become searchable), so they can reach `main` before the authoring half. `02` changes
`upsertMany` semantics and adds request fields but no response change, so it is safe
to deploy ahead of `05`.

Each task is intended to land as an independent PR into the `feature/m24/candidate`
branch with `make lint`, `make test-api`, and `make test-web` passing.

---

## 6. Decisions recorded (from RFC 0017 "Resolved Decisions")

1. **First spelling wins** — `upsertMany` uses `ON CONFLICT(slug) DO NOTHING`; tagging a topic never renames an existing tag, renaming waits for a tag-admin screen. *(owner, 2026-09-29)*
2. **No tag inheritance** — `?tag=` matches only topics carrying the tag; children of a matched parent render under it but are not results. *(owner, 2026-09-29)*
3. **No content search for now** — title + tag names only, in the browser; content search is a future FTS5 RFC. *(owner, 2026-09-29)*
4. **Search stays in the sidebar** — `q` / `tag` filter the sidebar and mobile drawer; `catalog/page.tsx` is untouched. *(owner, 2026-09-29)*
5. **`admin` and `content_creator` both create tags** — no role split on the vocabulary. *(owner, 2026-09-29)*
6. **Client-side search over the existing payload** — `GET /v1/topics` already carries tags (bulk-loaded, no N+1); no new read endpoint for students. *(RFC Design §2, Alternatives)*
7. **No migration** — the `tags` / `topic_node_tags` schema from `0005` is sufficient; this milestone stays out of the `0028` contention between RFC 0015 and RFC 0016. *(recorded at scaffolding, 2026-09-29)*
8. **Milestone numbered 24** — M23 is already claimed by in-flight planning branches (RFC 0018 admin storage browser, RFC 0020 student submissions). *(recorded at scaffolding, 2026-09-29)*

---

## 7. Definition of Done (milestone level)

- [ ] All tasks marked Done with every acceptance box checked.
- [ ] All milestone-level acceptance criteria in §3 pass.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] Closeout note written at `./closeout-analysis.md`.
- [ ] RFC 0017 status set to `Implemented` in its header and
      `docs/product/RFCs/README.md`; deferred items remain backlog.
- [ ] No diff outside the scope declared in the guardrail.
