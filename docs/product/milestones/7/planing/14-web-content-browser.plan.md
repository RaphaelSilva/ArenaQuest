# Plan — 14-web-content-browser

**Task:** [14-web-content-browser.task.md](../14-web-content-browser.task.md)
**Milestone:** 7
**Assigned personas:** frontend-developer
**Branch:** feature/m7/14-web-content-browser.task (from feature/m7/candidate)

## Objective

Rebuild the `/catalog` section per the `Content.html` wireframe. The left sidebar gets AQ design tokens, a global progress bar, a live search filter, expand/collapse topic tree with per-topic progress mini-bars, and a role pill for instructors/admins. The `catalog/[id]` page changes from showing a single node's markdown to showing a topic header with stat boxes, a progress bar, a badge strip (earned user badges), and a list of subtopic cards. Sidebar tree state (expanded IDs, search query) is persisted in URL search params so a browser refresh restores it.

## Affected areas

### Files to rewrite
- `apps/web/src/app/(protected)/catalog/layout.tsx` — parallel fetch topics + progress, pass to new sidebar; add instructor role detection
- `apps/web/src/components/catalog/CatalogSidebar.tsx` — complete redesign with AQ tokens, search, URL state, role pill
- `apps/web/src/app/(protected)/catalog/[id]/page.tsx` — change from markdown/media view to topic header + subtopic cards

### New files
- `apps/web/src/components/catalog/TopicHeader.tsx`
- `apps/web/src/components/catalog/BadgesStrip.tsx`
- `apps/web/src/components/catalog/SubtopicCard.tsx`
- `apps/web/src/components/catalog/__tests__/catalog-sidebar.test.tsx`

### Unchanged files
- `apps/web/src/app/(protected)/catalog/page.tsx` — empty state, kept as-is
- `apps/web/src/components/catalog/MarkdownViewer.tsx` — used in Task 15
- `apps/web/src/components/catalog/MediaViewer.tsx` — used in Task 15
- `apps/web/src/lib/topics-api.ts` — already has `list`, `getById`, `complete`

### Out of scope
- Per-topic badge endpoint (not in API); badge strip shows all user earned badges from `/me/badges`
- Topic/subtopic create/edit/delete forms (M3 admin tooling)
- Discussion threads (Task 15)
- `catalog/[id]/[subtopicId]` route (Task 15)

## Step-by-step

### 1. Update `catalog/layout.tsx`

Rewrite as `'use client'` component. On mount (when `accessToken` available):
- Call `topicsApi.list(token)` and `topicsApi.listProgress(token)` in parallel via `Promise.all`
- `topicsApi.listProgress` doesn't exist yet — add it to `topics-api.ts`: `GET /me/progress/topics` → `{ data: ProgressEntry[] }` where `ProgressEntry = { topicNodeId: string; status: 'not_started' | 'in_progress' | 'completed' }`
- Compute `globalProgress`: % of topics where status is `completed` over total topics with progress records (0 if no records)
- Detect `isInstructor = user?.roles.some(r => r.name === 'instructor' || r.name === 'admin') ?? false`
- Pass `{ topics, progressMap, globalProgress, isInstructor }` to `CatalogSidebar`
- Wrap `<CatalogSidebar ... />` in `<Suspense fallback={<SidebarSkeleton />}>` because it uses `useSearchParams()`

Sidebar `<aside>` styling:
```
width: 280px, background: var(--aq-bg2), border-right: 1px solid var(--aq-border)
```

Main `<main>` area: `flex-1 overflow-y-auto background: var(--aq-bg)`

### 2. Add `topicsApi.listProgress` to `topics-api.ts`

```ts
async listProgress(token: string): Promise<ProgressEntry[]> {
  const res = await apiFetch('/me/progress/topics', token);
  if (!res.ok) return [];
  const body = await res.json() as { data: ProgressEntry[] };
  return body.data;
}
```

### 3. Rewrite `CatalogSidebar.tsx`

`'use client'` component. Uses `useSearchParams()`, `useRouter()`, `usePathname()`.

Props:
```ts
{
  topics: TopicNode[];
  progressMap: Map<string, 'not_started' | 'in_progress' | 'completed'>;
  globalProgress: number;   // 0-100
  isInstructor: boolean;
}
```

URL state:
- `?q=` — search query (debounced update via `useTransition`)
- `?open=` — comma-separated expanded topic IDs

Sidebar sections (top to bottom):
1. **Header** (`padding: 20px 20px 12px`, `border-bottom: 1px solid var(--aq-border)`):
   - Title: "CATALOGUE" (11px, uppercase, `var(--aq-text3)`)
   - Role pill (only if `isInstructor`): two buttons "Participant" / "Instructor"; active state = `var(--aq-accent)` background; stored in `localStorage` as `aq-catalog-role`; when "Participant" active, hides add/edit/delete affordances
   - Global progress bar: label "Progress" and `${globalProgress}%` in accent color; 6px bar with gradient `var(--aq-accent)` → `var(--aq-accent2)`
2. **Search** (`margin: 12px 16px 0`): search icon + input, `var(--aq-bg3)` background, `var(--aq-border2)` border
3. **Tree** (scrollable `flex-1`): for each root topic:
   - Row: chevron (rotates when open) + 📚 icon in `var(--aq-accent-glow)` bg + topic title + mini progress bar (3px) + pct
   - Active row: `var(--aq-accent-glow)` bg + left 3px `var(--aq-accent)` border
   - Expanded subtopics: `padding-left: 54px`, dot `var(--aq-accent3)` if done else `var(--aq-bg4)`, name, status emoji
   - Search filters: show only topics/subtopics whose names contain the query (case-insensitive); if a subtopic matches, show its parent expanded

### 4. Rewrite `catalog/[id]/page.tsx`

`'use client'` with `export const runtime = 'edge'`.

On mount:
- `topicsApi.getById(token, id)` → `{ ...TopicNode, children: TopicNode[] }`
- `topicsApi.listProgress(token)` (already added)
- `fetch('/me/badges', token)` — reuse the badges endpoint for the badge strip

Render sections:
1. **Breadcrumb**: "Catalogue / {topic.title}"
2. **TopicHeader** component: icon box (📚, `var(--aq-accent-glow)` bg), title (28px Space Grotesk bold), description (use `topic.content` first sentence or tags as description), stat boxes: subtopic count, estimated total minutes, progress %
3. **Topic progress bar**: full-width 10px gradient bar showing `completedSubtopics / total * 100`
4. **BadgesStrip** component: shows user's earned badges as chips; skip if empty
5. **Subtopics list header**: "SUBTOPICS" label + "Add subtopic" button (only if instructor mode)
6. **SubtopicCard list**: for each child subtopic, show `SubtopicCard`

### 5. Create `TopicHeader.tsx`

Props: `{ topic: TopicNode & { children: TopicNode[] }; pct: number }`

Displays: 56×56 icon box, title, description (trimmed content if any, else tag list), three stat boxes (subtopics, est. minutes, progress%).

### 6. Create `BadgesStrip.tsx`

Props: `{ badges: Array<{ id: string; emoji: string; name: string; earned: boolean }> }`

Renders badge chips. Each chip: `border: 1px solid var(--aq-border2)`, earned chips get `var(--aq-accent-glow)` bg + `var(--aq-accent)` border/text. Returns null if empty array.

### 7. Create `SubtopicCard.tsx`

Props: `{ subtopic: TopicNode; index: number; status: 'not_started' | 'in_progress' | 'completed'; isInstructor: boolean }`

Renders: left accent stripe (green if done, accent if in-progress), number badge, title, description, tag chips, right side: progress % (from status) + status pill + edit/delete buttons (instructor only).

### 8. Write RTL tests

`src/components/catalog/__tests__/catalog-sidebar.test.tsx`:
- Test expand/collapse: clicking chevron shows/hides subtopics
- Test search: typing "postura" filters to matching subtopic and shows its parent

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| Sidebar tree expand/collapse persists in URL state | 3 | frontend | `useSearchParams` `?open=` param updates on click; RTL test |
| Search narrows visible items in real time | 3, 8 | frontend | RTL: search input filters tree |
| Selecting topic deep-links to `/catalog/[topicId]` | 3 | frontend | `Link` href; Next.js router push |
| Role pill renders only for instructor/admin | 1, 3 | frontend | `isInstructor` prop false for participants |
| Layout matches wireframe | 1–7 | frontend | Visual check at ≥1280px light + dark |
| `make lint` passes; RTL covers expand/collapse + search | 8 | frontend | `make lint && make test-web` |

## Risks & open questions

- `useSearchParams()` requires `<Suspense>` in Next.js 15 App Router when used in a layout — wrap the `CatalogSidebar` render in `<Suspense fallback={...}>` from the layout.
- Per-topic badge data doesn't exist — show all user earned badges on topic page; this is an approximation but won't crash.
- The existing `[id]/page.tsx` currently shows markdown content. After this task, that content moves to Task 15's `[id]/[subtopicId]/page.tsx`. Until Task 15 lands, clicking a subtopic card goes to a route that doesn't exist. That's acceptable — Task 15 creates that route.
- `TopicNode.content` is the full markdown — use `content.slice(0, 150)` as a description fallback.

## Verification

- Frontend: `make lint && make test-web`
- Manual: `make dev-web` walkthrough as participant (role pill hidden) and admin (role pill visible, edit/delete shown)
