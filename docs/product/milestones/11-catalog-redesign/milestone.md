# Milestone 11 — Catalog page redesign (wireframe-aligned UX)

**Status:** 🚧 Planned
**Scope:** `apps/web` (participant catalog surface) with one additive, backwards-compatible projection field added to `apps/api` and `packages/shared`. Derived from [RFC 0004](../../RFCs/0004-catalog-redesign.md).

> **Hard scope guardrail — read before opening any task.** This milestone ports the participant catalog (`/catalog` and `/catalog/[id]`) to the wireframe at `docs/architecture/web/wireframe/project/ArenaQuest Catálogo.html`. It may touch: components under `apps/web/src/components/catalog/**`, pages under `apps/web/src/app/(protected)/catalog/**`, helpers under `apps/web/src/lib/topic-tree.ts`, the root layout font imports in `apps/web/src/app/layout.tsx`, both i18n dictionaries (`apps/web/src/i18n/dict-en.ts`, `dict-pt.ts`), and — only in the dedicated backend task — `packages/shared/types/entities.ts` plus the `D1TopicNodeRepository` reads that serialise `TopicNode`. It is **not** an opportunity to redesign other surfaces (dashboard, admin, tasks, login), introduce new authoring tooling, add a theme switcher, replace the existing design tokens (`--aq-*`), wire likes/replies for comments, or change the deployment pipeline. The admin media manager and admin topic detail keep the existing `MediaGallery`; the new `MediaList` is mounted only on participant catalog routes. Accessibility audits, analytics/telemetry, enrollment gating for comments, and per-kind media progress semantics are explicitly deferred. If a refactor opportunity is spotted outside this scope, file a separate task — do not bundle it.

---

## 1. Objectives

- **Port the participant catalog to the wireframe layout** while keeping the existing fluid mobile adaptations (`MobileSearchBar`, `hidden md:block`, `lg:flex` sidebar). The desktop-first wireframe must not regress the mobile experience.
- **Collapse the route topology** to `/catalog` and `/catalog/[id]` so any node at any depth is addressable by id. Remove the legacy `/catalog/[id]/[subtopicId]` segment and migrate every internal callsite.
- **Add the missing visual primitives** required by the wireframe: stats trio in `TopicHeader`, two-column subtopic grid with index + meta pills + arrow chip, inline-expandable media stages (video / audio / PDF), per-topic discussion list.
- **Extend `TopicNode` with an additive `mediaCount` projection** so the subtopic cards can render the MediaMix pills without an extra fetch. Backwards-compatible, no new route, no breaking change.
- **Honour the i18n contract from RFC 0002** — every new user-facing string lands in both `dict-en` and `dict-pt`; nothing is hardcoded under `apps/web/src/{app,components,hooks}/**`.
- **Preserve cloud-agnostic architecture (Ports & Adapters).** The new `mediaCount` field is sourced through the existing `ITopicNodeRepository` and `IMediaRepository` ports; no controller or route imports a Cloudflare-specific symbol.

Out of scope (explicit):
- Authoring tooling for topics, subtopics, or media (covered by `/admin/topics`).
- Likes and threaded replies for comments — `POST /comments/:id/{like,replies}` are deferred to a separate RFC.
- Theme switcher UI; the platform continues to build per-theme via env vars.
- Accessibility (keyboard nav, ARIA roles, focus management, contrast audits) — explicit non-goal in RFC 0004 §"UX decisions".
- Analytics / event instrumentation beyond the existing XP side-effects on `POST /topics/:id/comments`.
- Enrollment gating UX for the discussion thread.
- Per-kind precise progress semantics for inline media (e.g. "watched ≥80%"). Any interaction counts as engagement for this milestone; finer rules ship with the future gaming phase.
- Replacing `MediaGallery` on admin surfaces.

---

## 2. Functional Requirements

- `/catalog` and `/catalog/[id]` render the wireframe layout: sidebar (with eyebrow + search + tree rows), breadcrumb with mid-trail collapse, topic header with initials icon + eyebrow trail + stats trio (Subtopics / Media / Total in branch), description card, two-column subtopic grid, inline-expandable media list, and per-topic discussion thread.
- A node at any depth is reachable via `/catalog/<id>`. Visiting a legacy `/catalog/<id>/<subId>` URL is no longer supported; every internal `<Link>` and `router.push` callsite has been migrated.
- The wireframe behaviour holds at `lg` (desktop). Below `lg`, the sidebar collapses into a slide-in drawer triggered by a hamburger control near `MobileSearchBar`. The `TopicHeader` stats render as a horizontal chip row on mobile, the subtopic grid drops to one column, and the PDF media stage stacks below the preview.
- `TopicNode` payloads served by `GET /topics` and `GET /topics/:id` (both the parent and every entry of `children`) include a `mediaCount` object with `video`, `audio`, `pdf`, and `total` counts. The field is additive; existing clients continue to work unchanged.
- The discussion thread loads existing comments via `GET /topics/:id/comments` and posts new comments via `POST /topics/:id/comments`. Likes and threaded replies are not exposed in the UI.
- Loading the topic page renders the `MainPaneSkeleton` while data is in flight. Sections with no content render an admin-motivating empty state in both PT and EN. Any non-critical fetch failure renders a single friendly `SectionError` fallback in place of the failed section — never as a global toast.
- The participant catalog no longer exposes the instructor preview toggle (`previewRole`, `showInstructorUI`, `aq-catalog-role` localStorage, "Adicionar subtópico" CTA). Editing affordances live in `/admin/topics`.

---

## 3. Acceptance Criteria

- [ ] The `/catalog` and `/catalog/[id]` routes render the layout sections in the order and proportions shown in the wireframe (sidebar ~300 px on `lg`, main pane `max-width: 1040px`, two-column subtopic grid that collapses to one column below ~1100 px effective main-pane width).
- [ ] The `apps/web/src/app/(protected)/catalog/[id]/[subtopicId]/` directory is deleted; `grep -RE "catalog/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+" apps/web/src` returns no matches in source code.
- [ ] `TopicNode.mediaCount` is defined in `packages/shared/types/entities.ts`, populated by `D1TopicNodeRepository` on both the flat list and the detail payload (including every `children` entry), and covered by a Vitest case in `apps/api/test/` (zero media, mixed kinds, deletion re-counts correctly).
- [ ] `MediaList` is mounted only on participant catalog routes. The admin media manager and admin topic detail still render `MediaGallery`.
- [ ] The discussion thread reads and writes against `GET / POST /topics/:id/comments`. No UI affordance exists for likes or threaded replies.
- [ ] No hardcoded user-facing string is introduced under `apps/web/src/{app,components,hooks}/**`; `check-i18n-coverage.js` passes. Every new key exists in both `dict-en.ts` and `dict-pt.ts`.
- [ ] Mobile (`< md`), tablet (`md`), and desktop (`lg`) renderings respect the per-breakpoint contract in RFC 0004 §"Mobile & responsiveness". The sidebar stays hidden below `lg` and becomes a drawer triggered from the topbar. `MobileSearchBar` still mounts.
- [ ] Lighthouse performance score on `/catalog/[id]` stays within 5 points of the current baseline (measured locally on the same machine, pre and post merge).
- [ ] No new runtime dependency is introduced beyond what is required for the optional mobile drawer (Radix Dialog or Headless UI Dialog), if the chosen path is not inline.
- [ ] `make lint`, `make test-web`, and `make test-api` pass green.
- [ ] No diff outside the scope declared in §"Hard scope guardrail".

---

## 4. Specific Stack

- **Frontend:** Next.js 15 App Router, React 19, Tailwind CSS v4, existing CSS variables under `--aq-*`. Two additional Google Fonts (Space Grotesk + JetBrains Mono) loaded via `next/font/google` in the root layout.
- **Backend:** Cloudflare Workers + Hono. New `mediaCount` field flows through the `ITopicNodeRepository` and `IMediaRepository` ports; the Cloudflare-specific adapters (`D1TopicNodeRepository`, `D1MediaRepository`) absorb the SQL change. No new route.
- **Shared:** `packages/shared/types/entities.ts` adds the optional-during-rollout-then-required `mediaCount` field to `Entities.Content.TopicNode`. The `Dictionary` type in `apps/web/src/i18n/**` is extended with the new catalog namespace keys.
- **Tests:** Vitest with `@cloudflare/vitest-pool-workers` on the API side; Vitest + React Testing Library on the web side. Existing `check-i18n-coverage.js` gates dictionary drift.
- **No new external auth/media SDK.** The discussion list and create flow reuse `commentsApi` already wired in the web app.

---

## 5. Task Breakdown

| # | Task File | Phase | Status |
|---|-----------|-------|--------|
| 01 | [Foundation: typography, tree helpers, and route topology cleanup](./01-foundation-typography-helpers-routes.task.md) | 1 | ✅ Done |
| 02 | [Dictionary keys for catalog redesign and instructor-preview removal](./02-dictionary-keys-and-instructor-preview-removal.task.md) | 1 | ✅ Done |
| 03 | [Restyle `CatalogSidebar` — eyebrow, search, and tree rows](./03-restyle-catalog-sidebar.task.md) | 2 | ✅ Done |
| 04 | [Rewrite `TopicHeader` — initials, eyebrow trail, and stats trio](./04-rewrite-topic-header.task.md) | 2 | ⏳ Planned |
| 05 | [Restyle `CatalogBreadcrumb` — mid-trail collapse and token reuse](./05-restyle-catalog-breadcrumb.task.md) | 2 | ⏳ Planned |
| 06 | [Restyle `SubtopicCard` — two-column grid, index, and arrow chip](./06-restyle-subtopic-card.task.md) | 2 | ⏳ Planned |
| 07 | [Description card wrap, skeleton, and section empty/error fallbacks](./07-description-skeleton-empty-error.task.md) | 2 | ⏳ Planned |
| 08 | [Mobile sidebar drawer with hamburger trigger](./08-mobile-sidebar-drawer.task.md) | 2 | ⏳ Planned |
| 09 | [Backend — additive `mediaCount` projection on `TopicNode`](./09-backend-mediacount-projection.task.md) | 3 | ⏳ Planned |
| 10 | [`MediaList` — inline-expandable video, audio, and PDF stages](./10-medialist-inline-players.task.md) | 3 | ⏳ Planned |
| 11 | [MediaMix pills on `SubtopicCard` and `Discussion` thread component](./11-mediamix-pills-and-discussion.task.md) | 3 | ⏳ Planned |
| 12 | [Visual QA, closeout, and RFC 0004 status update](./12-visual-qa-and-closeout.task.md) | 3 | ⏳ Planned |

Dependency graph:

```
01 ──► 02 ──► 03, 04, 05, 06, 07, 08   (Phase 2, parallel after 02)
                       │
                       ▼
                09 (backend, parallel to Phase 2)
                       │
                       ▼
                10 ──► 11 ──► 12
```

**Recommended execution order:** `01` → `02` → `09` in parallel with `03, 04, 05, 06, 07, 08` → `10` → `11` → `12`.

Each task is intended to land as an independent PR with `make lint`, `make test-web`, and `make test-api` passing.

---

## 6. Decisions recorded

The following questions from RFC 0004 §"UX decisions" are pinned for this milestone:

1. **Loading state:** a `MainPaneSkeleton` mirrors the existing `SidebarSkeleton` pattern.
2. **Empty states:** admin-motivating copy in both PT and EN, authored in the dictionary update task.
3. **Error fallback:** a single friendly `SectionError` block rendered in place of the failed section; no global toast, no per-failure mapping.
4. **Accessibility:** explicitly out of scope. The redesign must not regress existing semantics, but no new a11y work is scheduled.
5. **Instructor variant:** removed from the participant catalog. Editing lives in `/admin/topics`.
6. **Progress trigger:** any interaction (expand, play, scrub) on a media item counts as engagement and fires the existing progress endpoint. Finer rules ship later.
7. **Tags and prerequisites:** loaded but not rendered.
8. **Mobile sidebar:** slide-in drawer triggered by a hamburger control near `MobileSearchBar`.
9. **Microcopy:** model-authored in both PT and EN, validated by `check-i18n-coverage.js`. No external copy review gate.
10. **Telemetry:** none introduced in this milestone.

---

## 7. Definition of Done (milestone level)

- [ ] All 12 tasks marked `✅ Done` with every acceptance box checked.
- [ ] All milestone-level acceptance criteria in §3 pass.
- [ ] `make lint`, `make test-api`, and `make test-web` all green in CI.
- [ ] Closeout note at `docs/product/milestones/11-catalog-redesign/closeout-analysis.md` records: number of new dictionary keys per namespace, the decisions recorded in §6, screenshots of `/catalog/[id]` at `< md`, `md`, and `lg` viewports in both PT and EN, and a Lighthouse comparison vs. baseline.
- [ ] RFC 0004 status updated to `Implemented` in `docs/product/RFCs/README.md` and in the RFC header. Deferred items (likes/replies, telemetry, accessibility, enrollment gating, per-kind progress) remain explicitly listed as backlog.
- [ ] No diff outside the scope declared in §"Hard scope guardrail".
