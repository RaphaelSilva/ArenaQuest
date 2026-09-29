# RFC 0017: Catalog search by tags

**Date:** 2026-09-29
**Status:** Draft
**Revised:** 2026-09-29
**Author:** raphaelsilva
**Affected:**
- `packages/shared/domain/search/normalize.ts` (new — the one text normaliser: case, diacritics, dashes, whitespace; used by search *and* tag slugs)
- `packages/shared/domain/tags/slugify.ts` (new — tag name → slug, built on the normaliser)
- `apps/web/src/lib/catalog-search.ts` (new — pure matcher: query → tokens → per-node match result, with the tags that matched)
- `apps/web/src/components/catalog/CatalogSidebar.tsx` (replace the inline `title.includes(q)` filter with the matcher; honour `?tag=`; render matched-tag chips)
- `apps/web/src/components/catalog/TopicTreeNode.tsx` (optional chip slot for the tags that explain a match)
- `apps/web/src/components/catalog/MobileSearchBar.tsx` (same `q` semantics; clears `tag` together with `q`)
- `apps/web/src/app/(protected)/catalog/[id]/page.tsx` (show the topic's tags as links to `/catalog?tag=<slug>`)
- `apps/api/src/controllers/admin-topics.controller.ts` (accept tag **names**, resolve through `ITagRepository.upsertMany`; reject unknown `tagIds` with `422`)
- `apps/api/src/routes/admin/topics.ts` (`tags?: string[]` on create/update schemas)
- `apps/api/src/routes/admin/tags.ts` (new — `GET /v1/admin/tags?q=` for the authoring combobox)
- `apps/api/src/routes/admin/index.ts`, `apps/api/src/container.ts` (wiring)
- `apps/web/src/lib/admin-topics-api.ts`, `apps/web/src/lib/admin-tags-api.ts` (new client)
- `apps/web/src/app/(protected)/admin/topics/page.tsx` (replace the raw "tag IDs, comma separated" input with a tag combobox)
- `scripts/content/import-media.mjs` (optional `"tags"` key in the README `arenaquest` fence)
- `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (new keys, identical in both)

---

## Summary

Make the topic catalog findable by **what a topic is about**, not only by how its
title happens to be spelled. The sidebar search keeps running in the browser over the
tree it already downloads — `GET /v1/topics` returns every visible topic *with its
tags* today — but matches each query word against the title **and the topic's tag
names**, in any order, ignoring case and accents. A tag becomes a first-class filter
(`/catalog?tag=<slug>`) reachable from chips on the topic page. The prerequisite that
makes this worth doing is on the authoring side: tags exist in the schema but cannot
realistically be created today, so the RFC also gives admins a way to tag a topic by
typing a name.

## Motivation

The sidebar search (`CatalogSidebar.tsx`) keeps a node when
`node.title.toLowerCase().includes(q)`. In practice this behaves like an exact-name
search:

| What the student types | Topic title | Found today? | Why |
|---|---|---|---|
| `chudan` | `Chūdan Tsuki` | ✗ | accent-sensitive |
| `tsuki chudan` | `Chūdan Tsuki` | ✗ | the whole query must be one contiguous substring |
| `kata  basica` | `Kata básica` | ✗ | double space, missing accent |
| `soco` | `Chūdan Tsuki` (a punch) | ✗ | the concept is not in the title — only a tag could carry it |
| `faixa amarela` | `9th Kyu` | ✗ | same — the grading is the topic's *subject*, not its name |

The last two rows are the real ask: titles are chosen by the content author (often
in Japanese, or following a numbering scheme like `9th Kyu`), while students search by
concept. Tags are the existing place to put concepts — `tags` / `topic_node_tags`
exist since migration `0005`, and every `TopicNode` already ships `tags: Tag[]` to the
web — but nothing reads them.

And nothing writes them either. The admin topic editor asks for **tag IDs, comma
separated** (`dict.admin.topics.detail.tagIdsLabel`), yet no endpoint lists or creates
tags: `D1TagRepository.list/upsertMany` are implemented and injected into
`AdminTopicsController` as `_tags`, but never called. An admin would have to insert a
row into D1 by hand and paste its UUID. Tag search without tag authoring would search
an empty field.

## Goals & Non-Goals

**Goals**
- A query matches a topic when **every word** of the query appears in the topic's
  title **or** in one of its tag names — order-free, case-insensitive,
  accent-insensitive, whitespace-tolerant.
- A topic that matched only through a tag says so: the matching tag is shown as a chip
  on the sidebar row, so a result never looks random.
- An exact tag filter, `?tag=<slug>`, reachable by clicking a tag chip on the topic
  page, shareable as a URL.
- Admins and content creators tag a topic by typing tag **names**; the API creates
  missing tags by slug and reuses existing ones. No UUIDs in the UI.
- One normaliser, shared by search matching and slug generation, so `Chūdan` the tag
  and `chudan` the query always agree.
- No regression of current behaviour: a title substring that matches today still
  matches.

**Non-Goals**
- **Full-text search over topic `content`** (Markdown bodies). Different cost profile
  (payload size, ranking) — see *Alternatives* and Resolved Decision 3.
- **Server-side search endpoint / FTS5.** Not needed at the current catalog size; the
  matcher is written so it could move behind an endpoint later without changing its
  semantics.
- **Typo tolerance / fuzzy matching** (`tsuky` → `tsuki`). Deferred until there is
  evidence it is needed.
- **Tag administration screen** (rename, merge, delete tags). The combobox covers
  creation and reuse; curating the vocabulary is a later backlog item.
- **Tag inheritance** (a tag on a parent implicitly tagging its children). The tree
  already surfaces a matching parent; see Resolved Decision 2.
- Searching tasks, events or media.

## Current State (for reference)

**Web — the search** (`apps/web/src/components/catalog/CatalogSidebar.tsx`):

- The catalog layout loads `client.topics.list()` once — every published, non-archived
  topic the user can access, each with `tags: {id,name,slug}[]` — and hands the flat
  list to the sidebar, which builds the tree.
- `q` lives in the URL (`?q=`), written with a 200 ms debounce by both the desktop
  sidebar and `MobileSearchBar.tsx`.
- Filtering: `nodeOrDescendantMatches` keeps a **root** when its title, or any
  descendant's title, contains `q.toLowerCase()`. `collectMatchAncestors` auto-expands
  the ancestors of every match. Children of a kept root are rendered unfiltered.
- Tags are rendered nowhere in the catalog.

**API — tags**:

- Schema: `tags(id, name, slug UNIQUE)` and `topic_node_tags(topic_node_id, tag_id)`
  (migration `0005`).
- `D1TopicNodeRepository.listAll` already fetches all tag associations in one bulk
  query (no N+1), so tags cost nothing extra on `GET /v1/topics`.
- `CreateTopicSchema` / `UpdateTopicSchema` accept `tagIds: string[]`; the controller
  passes them straight to the repository without checking they exist (an unknown ID
  fails on the foreign key instead of returning a validation error).
- `ITagRepository` (`list`, `findBySlug`, `upsertMany`) is implemented but has no
  route.

**Admin web**: `admin/topics/page.tsx` edits tags as a free-text list of IDs.

**Importer**: `scripts/content/import-media.mjs` reads a README `arenaquest` fence with
`order`, `status`, `estimatedMinutes`, `title` — no tags.

## Proposed Design

### 1. One normaliser (`packages/shared/domain/search/normalize.ts`)

```ts
export function normalizeText(s: string): string {
  return s
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')   // Chūdan → Chudan
    .replace(/[‐-―−]/g, '-')              // Unicode dashes → '-'
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
export function tokenize(s: string): string[] {
  return normalizeText(s).split(/[\s\-_/.,;:]+/).filter(Boolean);
}
```

This is the same folding the media converter already had to learn for Drive vs.
macOS filenames (`convert-skipped.mjs` relaxed tier); it becomes a shared, tested
function instead of a second copy. `slugify(name)` in
`packages/shared/domain/tags/slugify.ts` is `tokenize(name).join('-')`, so a tag's slug
is by construction the normalised form of its name.

### 2. The matcher (`apps/web/src/lib/catalog-search.ts`)

A pure function, unit-tested without React:

```ts
type MatchResult = { matched: boolean; via: 'title' | 'tag' | 'both' | null; tags: Tag[] };
function matchTopic(node: TopicNode, query: ParsedQuery): MatchResult;
```

- **Parse**: `q` is tokenised with `tokenize`. A token written `#slug` is a **tag-only
  term**: it must equal one of the node's tag slugs. The `?tag=<slug>` URL parameter is
  the same thing, as a separate parameter the chips can set without editing `q`.
- **Match**: the node's *haystack* is its normalised title plus its normalised tag
  names. Every free token must be a **substring** of the haystack (AND semantics,
  any order); every tag-only term must hit a slug exactly. Substring — not prefix —
  keeps today's behaviour a strict subset of the new one.
- **Explain**: the result records which tags contributed, so the row can show them.
- The haystack for each node is precomputed once per `topics` change (`useMemo`), so a
  keystroke is `O(nodes × tokens)` string checks over already-normalised strings.

`CatalogSidebar` keeps its tree logic and simply swaps `title.toLowerCase().includes(q)`
for `matchTopic(...).matched` in both `nodeOrDescendantMatches` and
`collectMatchAncestors`. Ancestor auto-expansion therefore works for tag hits exactly
as for title hits.

### 3. UI

- **Sidebar row**: when a node matched *via a tag*, `TopicTreeNode` renders the
  matching tag names as small chips after the title (max 2, `+n` beyond). Title hits
  render as today.
- **Active tag filter**: when `?tag=` is set, a dismissible chip appears under the
  search input ("Tag: Soco ✕"); dismissing it removes the parameter. `q` and `tag`
  compose (both must hold).
- **Topic page** (`catalog/[id]`): the topic's tags are listed as chips linking to
  `/catalog?tag=<slug>`. This is the discovery path — a student learns the vocabulary
  by seeing it.
- **Placeholder** text changes from "search topics" to "search topics or tags"
  (new i18n keys, PT and EN).
- Empty state keeps `dict.catalog.sidebar.noResults`.

### 4. Tag authoring (API)

- `CreateTopicSchema` / `UpdateTopicSchema` gain `tags?: string[]` — **names**, 1–40
  chars each, at most 20 per topic. The controller slugifies them, drops duplicates by
  slug, calls `ITagRepository.upsertMany`, and passes the resulting IDs to the
  repository. `upsertMany` already does `ON CONFLICT(slug) DO UPDATE SET name`, so
  typing `Chūdan` for an existing `chudan` tag reuses it. `upsertMany` changes from
  `ON CONFLICT(slug) DO UPDATE SET name` to `DO NOTHING`: the **first spelling wins**
  and an existing tag's display name never changes as a side effect of tagging a topic
  (Resolved Decision 1). Renaming belongs to the deferred tag-administration screen.
- `tagIds` stays accepted for compatibility; `tags` and `tagIds` together is a `400`.
  Unknown `tagIds` now return `422 UNKNOWN_TAG` (mirroring `UNKNOWN_PREREQ`) instead of
  a foreign-key failure.
- Both `admin` and `content_creator` may create tags through this field (Resolved
  Decision 5).
- New `GET /v1/admin/tags?q=&limit=` (roles `admin`, `content_creator`), backed by
  `ITagRepository.list` plus a slug-prefix filter, feeds the combobox. The port gains
  an optional `q` in `list(opts)`.

### 5. Tag authoring (admin web)

The "tag IDs" text field becomes a combobox: type a name, pick an existing tag from
`GET /v1/admin/tags?q=` or press Enter to create a new one; tags render as removable
chips. On save the page sends `tags: string[]`.

### 6. Importer

The README fence accepts `"tags": ["soco", "kihon"]`, sent as `tags` on create and
included in the drift check on re-run. This is how the existing Budo tree gets its
initial vocabulary without clicking through every topic.

### Access and security

No new read surface: tags are already inside the topics a user is allowed to see, and
the filter runs over that already-filtered list, so search cannot reveal a topic the
enrollment resolver hides. The new endpoint and the new write field are admin /
content-creator only.

## Alternatives Considered

| Alternative | Why not (now) |
|---|---|
| **Server-side search endpoint** (`GET /v1/topics/search?q=`) with `LIKE` over title and tag names | A round-trip per keystroke for data the browser already holds; `LIKE` in SQLite is ASCII-case-insensitive only and not accent-aware, so it would need a normalised shadow column anyway. Worth revisiting if the catalog grows past a few thousand nodes. |
| **D1 FTS5 virtual table** over title + tags + content | Real ranking and content search, but a migration, triggers to keep it in sync, a diacritics tokenizer config, and a new endpoint — heavy for a catalog of hundreds of topics. It is the natural next step if content search is ever wanted. |
| **Fuzzy client library** (Fuse.js et al.) | Adds a dependency and ranking behaviour that is hard to explain ("why is this first?"). Deterministic token matching covers every case in *Motivation*. |
| **Search tags only via `#`** (keep titles exact) | Makes students learn a syntax to get the main benefit. `#` stays as an opt-in precision tool; plain words search both. |
| **Tags as free text on the topic** (a `keywords` column) | Simpler to write, but loses the shared vocabulary that makes `?tag=` a meaningful, linkable filter. The tables already exist. |

## Implementation Plan

Three small, independently shippable steps:

1. **Matcher + UI (web only).** Shared `normalizeText`/`tokenize`; `catalog-search.ts`
   with unit tests covering every row of the *Motivation* table; sidebar and mobile bar
   switched over; `?tag=`; chips on rows and on the topic page; i18n keys. Ships value
   immediately for accent/word-order problems, and for any tags that exist.
2. **Tag authoring (API + admin web).** `slugify`; `tags` on create/update;
   `UNKNOWN_TAG`; `GET /v1/admin/tags`; combobox in the topic editor. Backend and
   frontend as separate tasks.
3. **Importer.** `"tags"` in the README fence; drift detection; a dry run against the
   Budo tree.

No migration is required. (Migration `0028` is currently claimed by both RFC 0015 and
RFC 0016; this RFC deliberately does not add to that contention.)

## Tradeoffs & Risks

- **Client-side scaling.** Every visible topic is already downloaded; the matcher adds
  a precomputed string per node. Comfortable at hundreds–low thousands of nodes; past
  that, move the same semantics behind an endpoint (see *Alternatives*).
- **Broader matches.** AND-of-substrings over title + tags returns more than today.
  Short tokens (`a`, `de`) could match almost everything; mitigated by ignoring tokens
  shorter than 2 characters unless they are the whole query.
- **Tag sprawl.** Free creation from a combobox invites `soco`, `socos`, `soco-direto`.
  Slugification catches case/accent variants; genuine synonyms need the (deferred)
  merge screen. Showing existing tags first in the combobox is the main defence.
- **Name drift.** With the current `DO UPDATE SET name`, any admin re-typing a tag
  silently renames it for everyone. Hence the switch to `DO NOTHING`.
- **Tags are only as good as the authoring.** The benefit arrives when the content is
  tagged — step 3 (importer) is what makes that cheap for an existing tree.

## Success Criteria

- Every row of the *Motivation* table is a passing unit test of `matchTopic`, given the
  relevant tags.
- Every query that matched before (title substring, any case) still matches — covered
  by keeping the existing `CatalogSidebar` tests green.
- A topic hit only through a tag shows that tag on its sidebar row.
- `/catalog?tag=<slug>` shows exactly the topics carrying that tag (plus their
  ancestors for context), and the URL is shareable.
- An admin can tag a topic with a new tag and an existing tag without seeing a UUID;
  typing `Chūdan` when `chudan` exists does not create a second tag.
- Posting an unknown `tagId` returns `422 UNKNOWN_TAG`, not a 500.
- A student cannot find, by tag, a topic they cannot open (enrollment test).
- `check-i18n-coverage.js` passes; `dict-en.ts` and `dict-pt.ts` keys stay identical.

## Resolved Decisions

Resolved with the product owner on 2026-09-29.

1. **Tag display name on conflict → first spelling wins.** `upsertMany` uses
   `ON CONFLICT(slug) DO NOTHING`. If `Chūdan` (`chudan`) exists and an admin types
   `CHUDAN`, the topic is linked to the existing tag and its name stays `Chūdan`.
   Renaming is a job for the future tag-administration screen, not a side effect.
2. **No tag inheritance.** `?tag=soco` matches only topics carrying `soco` themselves.
   A matched parent still renders its children underneath (expandable), exactly as a
   title match does today, but they are not results in their own right and carry no
   inherited chip. A child that should be found on its own gets its own tag.
3. **No content search for now.** Search covers title + tag names, in the browser.
   Searching topic bodies is left to a future RFC, which would bring a D1 FTS5 index
   and a server-side, enrollment-aware endpoint.
4. **Search stays a sidebar concern.** `q` and `tag` filter the sidebar tree (and the
   mobile drawer that hosts it); the catalog home grid (`catalog/page.tsx`) keeps
   showing every root topic. `catalog/page.tsx` is not touched.
5. **Both `admin` and `content_creator` create tags.** The two roles that already edit
   topics may reuse or create tags from the combobox; there is no role split on the
   tag vocabulary.

## References

- [RFC 0004 — Catalog redesign](./0004-catalog-redesign.md) — introduced the sidebar
  tree and the URL-held `q` / `open` state this RFC extends.
- [RFC 0005 — Enrollment exclusions and visibility](./0005-enrollment-exclusions-and-visibility.md)
  — the effective-access set that bounds what search can see.
- `apps/api/migrations/0005_create_topics_tags.sql` — tag schema.
- `apps/api/src/adapters/db/d1-tag-repository.ts` — `upsertMany` semantics.
- `apps/web/src/components/catalog/CatalogSidebar.tsx` — current matcher.
- `scripts/media/convert-skipped.mjs` — prior art for diacritic/dash folding.
