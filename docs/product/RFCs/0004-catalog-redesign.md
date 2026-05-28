# RFC 0004: Catalog page redesign — wireframe-aligned UX

**Date:** 2026-05-27
**Status:** Draft
**Author:** raphaelsilva
**Affected:** `apps/web/src/app/(protected)/catalog` (Next.js 15 App Router)
**Source design:** `docs/architecture/web/wireframe/project/ArenaQuest Catálogo.html`
**Handoff guidance:** `docs/architecture/web/wireframe/README.md`

---

## Summary

Redesign the participant Catalog (`/catalog` and `/catalog/[id]`) to match the
Claude-Design wireframe at `docs/architecture/web/wireframe/project/ArenaQuest
Catálogo.html`. The wireframe is a single-page, hash-routed React prototype
that treats the catalog as an **explorable tree of topics with rich content**:
left tree sidebar (with search), a header that summarises the current node
(initials icon, eyebrow trail, three stat counters), a Markdown description
card, a two-column subtopic grid with index numbers and media-mix pills, an
inline-expandable media list (video / audio / PDF), and a discussion thread —
all rendered against a tokenised dark / light theme using Space Grotesk + DM
Sans + JetBrains Mono.

The current implementation already has the bones (sidebar, breadcrumb,
TopicHeader, MediaGallery, SubtopicCard, ContentSection) and is already
adapted for mobile; it diverges visually from the wireframe and is missing
several first-class elements: the header stats trio, two-column subtopic
grid with index + media-mix pills, inline media expansion, and the
discussion thread.

## Motivation

1. **Visual coherence with the rest of the redesigned product** — Dashboard,
   Login and Topic Detail wires already follow the same token system; the
   catalog is the last large surface still using the previous treatment.
2. **Information density** — the wireframe presents at a glance the
   subtopic count, media count and total branch depth, which the current
   header doesn't communicate.
3. **Reduced navigation cost** — the inline-expandable media list lets
   participants consume content without leaving the topic page, removing a
   navigation hop that the current `MediaGallery` requires.
4. **Engagement loop** — adding per-topic discussion threads creates a
   lightweight participation surface that supports the Engagement and
   Progress entities defined in `packages/shared/types/entities.ts`.
## Goals & Non-Goals

**Goals**
- Pixel-faithful port of the wireframe layout to the real catalog routes.
- Collapse the route topology to `/catalog` + `/catalog/[id]` so any node
  of the tree, at any depth, is addressable by its id (see "Route
  topology" below). Do **not** adopt the hash-based routing the prototype
  uses (Next.js App Router gives us better SEO, code split, and back /
  forward semantics for free).
- Reuse and extend existing components rather than rewriting them.
- Honour the i18n contract from RFC 0002: every user-facing string must come
  from `dict.catalog.*`; the Portuguese strings in the wireframe are
  reference copy, not source of truth.
- Reuse the design tokens already exposed as CSS variables
  (`--aq-bg`, `--aq-bg2`, `--aq-accent`, `--aq-text*`, etc.); do not
  introduce a parallel `--bg` / `--text` set.
- **Preserve current mobile behaviour.** The wireframe is desktop-first
  (single breakpoint at 1100 px); the live catalog is already adapted for
  mobile (`MobileSearchBar`, sidebar hidden below `lg`, fluid padding).
  The port must keep that behaviour — see "Mobile & responsiveness" below.

**Non-Goals**
- Authoring tooling (creating / editing topics) — covered by the existing
  `/admin/topics` flow and outside this RFC's scope.
- Backend changes for media playback or moderation; the discussion thread
  ships behind a feature flag with the API piece tracked separately.
- Theme switcher UI in the topbar — the platform already builds per-locale
  and per-theme via env vars; we keep that approach.

## Proposed Design

### Route topology (collapsed)

```
/catalog          → root listing (all root topics)
/catalog/[id]     → topic detail at any depth
```

The previous `/catalog/[id]/[subtopicId]` segment is **removed**. It
imposed an artificial 2-level limit on what is actually an arbitrarily
deep tree, and was redundant: `TopicNode.id` is globally unique, so a
single `[id]` segment addresses any node at any depth.

The hierarchical trail (breadcrumb, eyebrow "Nível N · A › B …") is
derived on the client from the flat `/topics` list — already loaded
once by the sidebar layout — by walking `parentId` upward from the
current node. Helper:

```ts
// apps/web/src/lib/topic-tree.ts
export function buildTrail(allNodes: TopicNode[], leafId: string): TopicNode[];
```

Side benefits of this shape:
- Stable URLs: moving a topic to a different parent does not invalidate
  any inbound link.
- Cheaper rendering: no `[...path]` validation, no per-segment lookup.
- The on-screen breadcrumb continues to communicate the hierarchy
  (URL doesn't need to).

**Cleanup task in Phase 1:** delete
`apps/web/src/app/(protected)/catalog/[id]/[subtopicId]/` and migrate
any internal `<Link>` that still uses the two-segment form to point at
`/catalog/<id>` directly.

The sidebar already lifts the tree into a shared `layout.tsx`. The redesign
keeps that and adds the new main-pane treatment below.

### Layout (matches wireframe `.body-layout`)

```
┌──────────────────────────────────────────────────────────────┐
│ topbar (already exists)                                      │
├────────────┬─────────────────────────────────────────────────┤
│  sidebar   │  main                                           │
│  (tree +   │  ┌──────────────────────────────────────────┐   │
│   search)  │  │ breadcrumb                               │   │
│            │  ├──────────────────────────────────────────┤   │
│            │  │ loop-notice (conditional)                │   │
│            │  ├──────────────────────────────────────────┤   │
│            │  │ TopicHeader: icon · title · stats(3)     │   │
│            │  ├──────────────────────────────────────────┤   │
│            │  │ DescriptionCard (Markdown)               │   │
│            │  ├──────────────────────────────────────────┤   │
│            │  │ SubtopicGrid (2 cols → 1 < 1100px)       │   │
│            │  ├──────────────────────────────────────────┤   │
│            │  │ MediaList (inline-expand)                │   │
│            │  ├──────────────────────────────────────────┤   │
│            │  │ Discussion (comments)                    │   │
│            │  └──────────────────────────────────────────┘   │
│            │  (max-width 1040px, centred, 28px 40px padding) │
└────────────┴─────────────────────────────────────────────────┘
```

### Component-by-component changes

| Wireframe element | Existing component | Action |
|---|---|---|
| `topbar` | `apps/web` shared header | No change. |
| `.left` tree + search | `CatalogSidebar`, `MobileSearchBar` | Restyle: eyebrow label, single 9px-radius search input, narrower (300 px) tree rows with `tn-chev / tn-icon / tn-label / tn-count` slots. |
| `.breadcrumb` | `CatalogBreadcrumb` | Collapse middle segments when trail > 4; current segment uses `--aq-text2`, links use `--aq-text3`, hover `--aq-accent`. |
| `.t-header` | `TopicHeader` | Restructure to three columns (icon · text · stats) on `md+`, stacked on mobile; replace emoji-only icon with **2-letter title initials** on a `var(--accent)→var(--accent2)` gradient; show eyebrow line `"Catálogo · raiz"` at root and `"Nível N · A › B"` deeper; stats trio: **Subtópicos / Mídias / Total no ramo** (the last computed by recursive `countDeep`). |
| Progress bar | _kept from current page_ | Keep below the header; the wireframe lacks one but participant progress is a product requirement. |
| `.desc-card` | `ContentSection` | Wrap in 14px-radius `var(--bg2)` card; use existing sanitised-Markdown renderer; map heading sizes (h1 22 / h2 18 / h3 15) and the accent-coloured `<em>` and `<blockquote>`. |
| `.sub-grid` | `SubtopicCard` | Two-column grid; each card shows a monospaced **index** (01, 02…), title, 2-line description clamp, and **meta pills** for video / audio / PDF counts plus a `deep` pill when the branch has further children. Right side: arrow chip that fills with `--accent` on hover. |
| `.media-list` | `MediaGallery` | Switch from gallery to a vertical list of collapsible cards; clicking the row toggles the inline player. Three player kinds: video stage (16∶9 with scrub bar), audio stage (play + waveform + time), PDF stage (two cards: paper preview + actions column with `btn-primary` Download / `btn-ghost` Open). |
| `.comments-list` | _new_ `Discussion` | Top input box with auto-revealing **Publicar** submit, then threaded comments with avatar, name, time, optional badge, body, like / reply actions, and one nested-reply level (`border-left: 2px solid var(--border2)`). Empty state card. Hidden at root. |

### Mobile & responsiveness

The wireframe is desktop-first; the live catalog already ships mobile
adaptations that must be preserved. Target breakpoints (Tailwind defaults,
matching what's already in `layout.tsx` / `page.tsx`):

| Breakpoint | Sidebar | Search | Main padding | Subtopic grid | Header layout | Media stages |
|---|---|---|---|---|---|---|
| `< md` (mobile) | Hidden (drawer optional, out of scope) | `MobileSearchBar` at top | `px-4 py-6` | 1 col | Icon + title stacked; stats wrap below as 3 inline chips | Video keeps 16∶9; PDF stage 1 col |
| `md` (tablet) | Hidden | `MobileSearchBar` | `px-6 py-7` | 1 col | Icon + title side-by-side; stats inline | Same as mobile |
| `lg` (desktop) | Visible, 280–300 px fixed | In-sidebar search | `px-10 py-8` | 2 cols (breaks back to 1 below 1100 px effective width) | Three-column grid (icon · text · stats) | Video full 16∶9; PDF stage 2 cols above 720 px |

Concrete rules for the port:
- Keep `lg:flex` on `<aside>` and `hidden md:block` on `MobileSearchBar` —
  do not remove either.
- Replace the wireframe's fixed 1040 px `main-inner` with the existing
  fluid `mx-auto max-w-[1040px] px-4 md:px-6 lg:px-10` pattern.
- The new `TopicHeader` three-column grid uses `grid-cols-1 md:grid-cols-[auto_1fr_auto]`;
  on mobile the stats render as a horizontal chip row, not the right-aligned
  trio shown in the wireframe.
- The new `MediaList` expanded body must not overflow horizontally on
  narrow screens (audio waveform uses `flex-1`, video keeps `aspect-ratio`,
  PDF actions stack below preview under `md`).
- The two-column subtopic grid uses `grid-cols-1 lg:grid-cols-2` and the
  wireframe's `@media (max-width: 1100px)` rule maps to falling back to
  single column whenever the main pane (sidebar excluded) is narrower than
  ~700 px — handled by Tailwind's container query or by switching at `lg`.

### Component contracts (sketch)

```tsx
// apps/web/src/components/catalog/TopicHeader.tsx (revised)
type Stats = { subtopics: number; media: number; deepTotal: number };
type Props = { topic: TopicWithMedia; trail: { id: string; title: string }[]; stats: Stats };

// apps/web/src/components/catalog/SubtopicCard.tsx (revised)
// reads subtopic.mediaCount (added to TopicNode in Phase 3) directly
type Props = {
  topicId: string;
  subtopic: TopicNode;        // now carries mediaCount
  index: number;              // 1-based, rendered as 01, 02…
  status: TopicProgressStatus;
  hasChildren: boolean;       // for the "deep" pill
};

// apps/web/src/components/catalog/MediaList.tsx (replaces MediaGallery on this surface)
type Props = { media: Media[]; onInteract?: (mediaId: string, kind: 'video' | 'audio' | 'pdf') => void };

// apps/web/src/components/catalog/MainPaneSkeleton.tsx
// apps/web/src/components/catalog/CatalogMobileDrawer.tsx
// apps/web/src/components/catalog/SectionError.tsx       // generic "deu errado aqui!" block
// apps/web/src/components/catalog/SectionEmpty.tsx       // admin-motivating empty state
```

### Helpers

```ts
// apps/web/src/lib/topic-tree.ts
export function countDeep(node: TopicNode): { topics: number; media: number };
export function buildTrail(root: TopicNode, id: string): TopicNode[];
```

These mirror `countDeep` / `resolvePath` in the wireframe's
`catalog/catalog-components.jsx`, but operate on the existing `TopicNode`
shape returned by `client.topics.list()`. **Cycle protection is not
re-implemented at the view layer** — the invariant is already enforced
on write at topic creation/edit, so a runtime guard would be defensive
code for a state that cannot occur.

### Theming and typography

- **Reuse** the existing CSS variables under `--aq-*`; do not duplicate the
  wireframe's `--bg`, `--text`, … tokens.
- Add the two missing typefaces to `apps/web/src/app/layout.tsx`'s
  `next/font/google` imports: **Space Grotesk** (display + section labels)
  and **JetBrains Mono** (counts and indices). **DM Sans** is already
  loaded.
- Section labels follow the eyebrow pattern: 11 px, weight 600, 1.2 px
  letter-spacing, uppercase, `var(--aq-text3)`; counts in `[ ]` rendered
  in JetBrains Mono and tinted `var(--aq-accent)`.

### Discussion (new surface)

- Comments are scoped per topic id.
- `GET /topics/:id/comments` and `POST /topics/:id/comments` **already
  exist** in `apps/api/src/routes/comments.router.ts` (with auth guard
  and enrollment-based access control), so the list + create flow can
  ship wired to the real backend from day one.
- `POST /comments/:id/like` and `POST /comments/:id/replies` do **not**
  exist yet. The Discussion UI ships **without** like / reply actions in
  this RFC; those are tracked as a separate follow-up backlog item.

### Backend impact

The redesign is largely a frontend port — **no new routes are required
for the core experience**. Existing endpoints cover:

| Surface | Endpoint | Notes |
|---|---|---|
| Sidebar tree | `GET /topics` | Flat list with `parentId`; the layout already reconstructs the tree. |
| Topic detail (header, content, direct media, direct children) | `GET /topics/:id` → `TopicWithMedia` | Returns one level of children + own media. |
| Progress bar + per-card status | `GET /me/progress/topics`, `POST /topics/:id/{visit,complete}` | Unchanged. |
| Badges strip | `GET /me/badges` | Unchanged. |
| `Total no ramo` header stat | _derived client-side_ from the flat `/topics` already loaded by the sidebar layout. | No backend work. |
| Discussion list + create | `GET` / `POST /topics/:id/comments` | Already shipped. |

**One real gap — resolved:** the **MediaMix pills** on `SubtopicCard`
(`🎥 N · 🎧 N · 📄 N`). `TopicWithMedia.children` returns plain
`TopicNode[]` with no `media` field, so per-child media counts can't
be derived from the detail payload.

**Decision: extend the `TopicNode` projection** with a `mediaCount`
field, populated by a single aggregate query joined into the existing
list / detail payloads. Backwards-compatible additive field, no new
route. ~0.5 d on the API side.

```ts
// packages/shared/types/entities.ts → Entities.Content.TopicNode
mediaCount: {
  video: number;
  audio: number;
  pdf: number;
  total: number;
};
```

Implementation notes:
- Source query: `SELECT topic_id, kind, COUNT(*) FROM media GROUP BY topic_id, kind` (or the equivalent in `D1MediaRepository`).
- Populate in **both** payloads where `TopicNode` is serialised:
  - `GET /topics` (flat list — feeds the sidebar and the `Total no
    ramo` aggregate).
  - `GET /topics/:id` for the parent **and** each entry of `children`.
- Cache invalidation: the count is derived, so any media create /
  delete on a topic invalidates the parent's `mediaCount`. The
  cheapest path is to compute on read — D1 is fast enough at the
  expected catalog sizes.
- Field is additive and non-breaking; existing consumers ignore it.
- A `mediaCount` of all-zeros is a legitimate value (topic has no
  media), not an error.

**Out of scope for this RFC** (deferred to follow-up tickets):
- `POST /comments/:id/like`
- `POST /comments/:id/replies`

These are needed to ship the full "discussion" wireframe (likes,
threaded replies), but the redesign degrades gracefully without them
— the comment list and the publish action work on existing routes.

## Alternatives Considered

1. **Adopt the prototype's hash-based router verbatim.** Rejected: breaks
   App Router conventions, hurts SEO, and loses per-route code splitting.
2. **Embed the prototype HTML in an iframe under `/catalog/preview`.**
   Rejected: would only validate look-and-feel, would not actually replace
   the production surface, and would double the maintenance surface.
3. **Migrate progressively, page by page, over several sprints.** Rejected
   as the default but kept as a contingency — the Implementation Plan below
   stages the work so partial merges remain shippable.
4. **Replace `MediaGallery` everywhere with the new `MediaList`.** Rejected
   for now: the admin media manager and the existing topic detail still
   benefit from the gallery treatment. Limit the new component to the
   participant catalog surface.

## Implementation Plan

Estimated total: **~5–7 dev days** across three milestones.

### Phase 1 — Tokens, typography, helpers, routes & copy (0.5 d)
- Add Space Grotesk + JetBrains Mono to `apps/web/src/app/layout.tsx`.
- Add `apps/web/src/lib/topic-tree.ts` with `countDeep` and `buildTrail`
  + unit tests in `apps/web/test/` (`buildTrail` covers: root, leaf at
  depth N, missing parent → safe fallback).
- **Delete** `apps/web/src/app/(protected)/catalog/[id]/[subtopicId]/`
  and update any `<Link>` / `router.push` callsite still using
  `/catalog/<id>/<subId>` to use `/catalog/<subId>` directly.
- Extend `dict.catalog.*` (PT + EN) with all new keys: `stats.subtopics`,
  `stats.media`, `stats.deepTotal`, `discussion.*`,
  `emptyStates.{description,media,subtopics,discussion}`,
  `errorFallback`, `mobileDrawer.{open,close}`.
- Remove the instructor preview toggle (`previewRole` /
  `showInstructorUI` / `aq-catalog-role` localStorage / "Adicionar
  subtópico" CTA) from the participant catalog.

### Phase 2 — Visual port + skeleton + drawer (2–3 d)
- Restyle `CatalogSidebar` (tree rows, search input, eyebrow).
- Rewrite `TopicHeader` to three-column grid with initials + stats trio.
- Restyle `CatalogBreadcrumb` with mid-trail collapse.
- Restyle `SubtopicCard` to the two-column grid form with index, meta
  pills and arrow chip. MediaMix pills consume `subtopic.mediaCount`
  (lands in Phase 3); during Phase 2 the pill row can render only the
  "deep" pill until the backend field is available.
- Wrap `ContentSection` in the new `.desc-card` style; render the
  admin-motivating empty state when content is missing.
- Add `MainPaneSkeleton` (header + two cards + one media row) and wire
  it during the load phase.
- Add the **mobile drawer** for the sidebar with hamburger trigger in
  the topbar / `MobileSearchBar` area.
- Add the **generic error fallback** ("Desculpa, mas alguma coisa deu
  errado aqui!" / EN) where any of the non-critical fetches fails.
- Manual check at `< md`, `md`, `lg` to confirm mobile adaptations and
  drawer behaviour.

### Phase 3 — Inline media + discussion (2–3 d)
- **Backend (parallel, ~0.5 d):** add the `mediaCount` aggregate to
  `TopicNode` in `packages/shared/types/entities.ts`, populate it in
  the `D1TopicNodeRepository` reads that feed `GET /topics` and `GET
  /topics/:id` (including each `children` entry), and add a test in
  `apps/api/test/` covering: zero media, mixed-kind media, deleted
  media re-counts correctly.
- New `MediaList` with three player kinds; mount only on the participant
  catalog routes. Each player interaction (expand / play / scrub) fires
  the existing progress endpoint(s); precise per-kind semantics deferred
  to the upcoming gaming phase.
- Admin-motivating empty state when the topic has no media.
- `SubtopicCard` consumes the new `mediaCount` to render the MediaMix
  pills (drop the `mediaMix?` optionality from its contract once the
  field ships).
- New `Discussion` component wired to the existing
  `GET / POST /topics/:id/comments`. **No like / reply** in this phase.
  Empty state nudges first comment.
- Visual QA on staging against the wireframe.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| Two design systems coexisting during the port | Phase 2 lands behind no flag but is layout-only; reuses tokens already in production. Roll back per-component if needed. |
| **Regressing mobile adaptations** when porting a desktop-first wireframe | Mobile behaviour is an explicit goal with a per-breakpoint contract above; PR review checklist requires screenshots at `< md`, `md`, `lg`; existing `MobileSearchBar` and `hidden md:block` / `lg:flex` patterns are kept verbatim. |
| `countDeep` over very large trees | Memoise per node id; tree is already loaded once in the sidebar layout, so cost is shared. |
| Inline media stages enlarge the JS bundle | Code-split each player kind via `next/dynamic`; PDF preview is a static block, no PDF.js dependency. |
| Discussion missing like / reply actions on first ship | List + create are the high-value 80%; degraded mode is acceptable. Like / reply tracked as a discrete follow-up RFC; UI leaves a clean spot to add them without restructure. |
| i18n drift between PT (wireframe copy) and EN | RFC 0002's `check-i18n-coverage.js` already gates this; add new keys to both dicts in the same PR. |

## Success Criteria

- The `/catalog` and `/catalog/[id]` routes render the layout sections in
  the order and proportions shown in the wireframe (sidebar 300 px, main
  `max-width: 1040px`, two-column subtopic grid collapsing at 1100 px,
  media list collapsing PDF to one column at 720 px).
- No hardcoded user-facing strings introduced; `check-i18n-coverage.js`
  passes.
- Mobile (`< md`), tablet (`md`) and desktop (`lg`) renderings match the
  per-breakpoint contract in "Mobile & responsiveness"; sidebar stays
  hidden below `lg`; `MobileSearchBar` still mounts.
- Lighthouse performance score on `/catalog/[id]` stays within 5 points of
  the current baseline.
- Visual review sign-off comparing the live route against
  `ArenaQuest Catálogo.html` rendered locally (desktop) **and** against
  the current production catalog on a 375 px viewport (mobile parity).

## UX decisions (resolved with product)

These resolve the questions a UX reviewer would raise before approving the
milestone. Each is **final for this RFC**; anything marked _(future)_ is
explicitly out of scope.

### 1. Loading, empty and error states

- **Main-pane skeleton** mirrors the sidebar pattern (`SidebarSkeleton`).
  Add `MainPaneSkeleton` covering the header strip, two skeleton
  subtopic cards, and one skeleton media row. Mount during the Promise
  chain in `/catalog/[id]/page.tsx`.
- **Empty states are admin-motivating.** When a section has no content,
  render an inviting copy that nudges an admin to populate it (e.g.,
  description empty → "Este tópico ainda não tem uma descrição.
  Adicione contexto e materiais para os participantes."; media empty →
  "Nenhuma mídia cadastrada. Vídeos, áudios e PDFs ajudam o aprendizado
  a engajar."). Copy in both PT and EN, authored as part of the dict
  update.
- **Errors get a single friendly fallback** — no per-failure mapping in
  this phase. Topic 404, network failure, presigned URL failure, badges
  fetch failure all render the same line: "Desculpa, mas alguma coisa
  deu errado aqui!" (and EN equivalent). Place it where the failed
  section would have rendered, not as a global toast.
- **Slow network: UI proceeds.** No blocking spinner waits on
  non-critical fetches; the topic detail renders as soon as
  `getById` resolves; progress and badges hydrate in place when
  available.
- **Enrollment gating is _(future)_** — assumption: if a topic is
  listed for the user, the user can see it. The `403` paths from
  `/topics/:id/comments` are not modelled in this RFC because that
  filtering will move upstream in a later iteration.

### 2. Accessibility — _(future)_

Accessibility (keyboard navigation, ARIA roles, focus management,
reduced-motion, contrast audits) is explicitly **out of scope** for
this project phase. The redesign will not regress existing semantics
(buttons remain `<button>`, links remain `<a>`, nothing becomes
`<div onClick>`), but no new a11y work is scheduled.

### 3. Instructor / admin variant — **removed**

The participant catalog no longer carries an instructor preview mode.
As part of Phase 2, remove:
- the `previewRole` / `showInstructorUI` localStorage toggle in
  `/catalog/[id]/page.tsx`,
- the `showInstructorUI` prop on `SubtopicCard`,
- the `"Adicionar subtópico"` CTA in the participant view.

Editing affordances live in `/admin/topics` and stay there.

### 4. Progress trigger for inline media

For this RFC, **any interaction with a media item** (clicking to
expand, hitting play, scrubbing) counts as engagement and triggers the
existing progress endpoints. Precise semantics (X% watched threshold,
per-kind rules) will evolve during the upcoming **gaming phase** and
are not pinned here.

### 5. Tags and prerequisites — not surfaced

`TopicNode.tags` and `TopicNode.prerequisiteIds` are loaded but not
rendered in this redesign. **Nice to have, not required:** a future
addition of `mediaCount` to `TopicNode` (see "Backend impact") could
ship alongside tags exposure if the API team finds it convenient, but
do **not** spend implementation budget on tags now.

### 6. Mobile sidebar — drawer

Below `lg`, the sidebar becomes a **slide-in drawer** (left edge),
triggered by a hamburger button rendered next to `MobileSearchBar` in
the topbar. Drawer overlays content with a scrim; tapping the scrim
or pressing the close affordance dismisses it. Implementation can
reuse a lightweight headless primitive (Radix Dialog / Headless UI
Dialog) or a small inline component — no new dependency required if
the inline path is cheap.

### 7. Microcopy — model-authored, PT + EN

All new strings (eyebrows, stat labels, empty-state nudges, error
fallback, drawer affordances, comment placeholder) are drafted by the
implementing model in both PT and EN, added to `dict-pt.ts` and
`dict-en.ts` in the same PR, and validated by `check-i18n-coverage.js`.
No external copy review gate.

### 8. Telemetry — _(future)_

No analytics / event instrumentation in this RFC. The existing XP
side-effects on `POST /topics/:id/comments` (`xpEngine.award`) stay
as-is; nothing else is wired.

## References

- Source design: `docs/architecture/web/wireframe/project/ArenaQuest Catálogo.html`
- Handoff README: `docs/architecture/web/wireframe/README.md`
- Sibling wires for token / typography consistency:
  `ArenaQuest Dashboard.html`, `ArenaQuest Topic Detail.html`,
  `ArenaQuest Content.html`
- Prior i18n contract: RFC 0002 — `docs/product/RFCs/0002-frontend-internationalization-i18n.md`
- Entity model: `packages/shared/types/entities.ts` (`Entities.Content`,
  `Entities.Progress`, `Entities.Engagement`)
