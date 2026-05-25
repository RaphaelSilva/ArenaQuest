# Plan — 15-web-topic-detail

**Task:** [15-web-topic-detail.task.md](../15-web-topic-detail.task.md)
**Milestone:** 7
**Assigned personas:** frontend-developer
**Branch:** feature/m7/15-web-topic-detail.task (from feature/m7/candidate)

## Objective

Build the subtopic-detail page at `catalog/[topicId]/[subtopicId]/page.tsx` per `TopicDetail.html`. The page renders: breadcrumb (Catalogue > Topic > Subtopic), header with parent-topic tag + subtopic index + title + meta chips, progress bar with "Marcar como concluído" button, media tabs (Videos/Files/Photos), comments thread with optimistic updates, and a right sidebar with the subtopic navigation list + prev/next buttons. The video player fires `POST /topics/:id/videos/:videoId/watched` once per video at the 90%-played threshold.

## Affected areas

### New files
- `apps/web/src/app/(protected)/catalog/[id]/[subtopicId]/page.tsx` — subtopic detail page (uses `[id]` for topicId and `[subtopicId]` for subtopicId)
- `apps/web/src/components/catalog/SubtopicSidebar.tsx`
- `apps/web/src/components/catalog/MediaTabs.tsx`
- `apps/web/src/components/catalog/VideoPlayerWithPlaylist.tsx` — extends VideoPlayer with playlist + 90%-watched trigger
- `apps/web/src/components/catalog/FilesGrid.tsx`
- `apps/web/src/components/catalog/PhotosGrid.tsx`
- `apps/web/src/components/catalog/Comments.tsx`
- `apps/web/src/components/catalog/__tests__/subtopic-detail.test.tsx` — RTL: tab switching + comment optimistic update

### Unchanged files
- `apps/web/src/components/catalog/MediaViewers/VideoPlayer.tsx` — underlying `<video>` element, reused as-is
- All other catalog components from Task 14

## Step-by-step

### 1. Create `catalog/[id]/[subtopicId]/page.tsx`

`'use client'` + `export const runtime = 'edge'`. 

On mount (when `accessToken` available):
- `topicsApi.getById(token, topicId)` → `{ ...TopicNode, children: TopicNode[] }` (parent topic + all siblings)
- `topicsApi.getById(token, subtopicId)` → `{ ...TopicNode, children: TopicNode[] }` (subtopic + its media)
- `topicsApi.listProgress(token)` → progress map
- `GET /topics/[subtopicId]/comments` → `{ data: CommentWithMeta[] }`
All four in `Promise.all`.

Render layout:
```
<div style="display:flex; height:100%">
  <main style="flex:1; overflow-y:auto; padding:32px 40px">
    breadcrumb, header, progress row, media section, comments section
  </main>
  <SubtopicSidebar ... />
</div>
```

### 2. Breadcrumb

```
Catalogue › [topicTitle] › [subtopicTitle]
```
Using `<Link>` for first two segments.

### 3. Subtopic header

```
[parent-topic tag pill: "📚 {topicTitle}"]  [Subtópico N de Total]
[h1: subtopicTitle]
[meta chips: clock icon + estimatedMinutes min · media count · tag pills]
```

### 4. Progress row

- Full-width progress bar (10px, gradient) — filled to 100% if `status === completed`, else 0%
- `<span>` showing % value
- "Marcar como concluído" button → calls `topicsApi.complete(token, subtopicId)` → on success: set status to completed, progress to 100

The button style:
- Default: `background: var(--aq-accent)`, `color: #0B0E17`
- Done: `background: var(--aq-accent3-glow)`, `color: var(--aq-accent3)`, shows "✓ Concluído", disabled

### 5. Create `MediaTabs.tsx`

Props: `{ videos: Media[]; files: Media[]; photos: Media[]; topicId: string; onVideoWatched: (mediaId: string) => void }`

State: `activeTab: 'videos' | 'files' | 'photos'` (default to first non-empty tab).

Renders tab buttons + active content:
- Videos tab: `<VideoPlayerWithPlaylist>` (only mounted once, hidden when on other tabs via `display:none` to preserve playback state)
- Files tab: `<FilesGrid>`
- Photos tab: `<PhotosGrid>`

Counts shown on each tab button: `{label} {count}`.

### 6. Create `VideoPlayerWithPlaylist.tsx`

Props: `{ videos: Media[]; topicId: string; onWatched: (mediaId: string) => void }`

State: `activeId: string` (first video's id), `watchedIds: Set<string>` (fired XP events).

Renders:
- `<video>` element with `src={activeVideo.url}` and `onTimeUpdate` handler
- `onTimeUpdate`: if `currentTime / duration >= 0.9` and not already in `watchedIds`, fire `POST /topics/[topicId]/videos/[mediaId]/watched` once (add to `watchedIds` immediately to prevent re-fire), then call `onWatched(mediaId)`
- `onEnded`: same check but always fire if not already watched
- Playlist: list of video titles with active highlight, watched checkmark

### 7. Create `FilesGrid.tsx`

Props: `{ files: Media[] }`

Renders a grid of file cards: file icon (📄 PDF, 📊 spreadsheet, 📁 other) + name + size + download button (`<a href={url} download>`).

### 8. Create `PhotosGrid.tsx`

Props: `{ photos: Media[] }`

Renders a CSS grid of image thumbnails: `<img src={photo.url} alt={photo.originalName}>` in a 2-col or 3-col grid. Click → opens full size in new tab.

### 9. Create `Comments.tsx`

Props: `{ topicId: string; initialComments: CommentWithMeta[]; accessToken: string }`

State: `comments: CommentWithMeta[]` (initialized from `initialComments`), `text: string`, `submitting: boolean`.

On submit:
1. Optimistically prepend a fake comment with `id: 'optimistic-' + Date.now()`, `userId: 'me'`, `body: text.trim()`, `likeCount: 0`, `likedByMe: false`, `createdAt: new Date().toISOString()`
2. Clear textarea
3. Call `POST /topics/[topicId]/comments` with `{ body: text }`
4. On success: replace the optimistic entry with the real response
5. On error: remove the optimistic entry, show inline error message, restore textarea text

Like button: calls `POST /comments/[commentId]/like` and toggles `likedByMe` + increments `likeCount` optimistically.

### 10. Create `SubtopicSidebar.tsx`

Props: `{ topicId: string; topicTitle: string; subtopicId: string; siblings: TopicNode[]; progressMap: Map<string, TopicProgressStatus> }`

Renders:
- Header: "Subtópicos" title + topic name + progress bar (% of siblings completed)
- Scrollable list of sibling subtopics: number badge (✓ if completed, else N), name, mini progress bar
- Current subtopic highlighted with `var(--aq-accent)` border
- Prev/Next nav buttons using `Link href={/catalog/topicId/siblingId}`

### 11. RTL tests

`subtopic-detail.test.tsx`:
1. Tab switching: render page stub with fixture media data, click "Files" tab, verify FilesGrid renders
2. Optimistic comment: submit comment, verify it appears immediately; simulate API failure, verify it's removed

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| Layout matches wireframe ≥1280px | 1–10 | frontend | Visual check |
| Tab switching preserves video playback | 5 (display:none trick) | frontend | RTL: tab switch → video element still in DOM |
| Mark as done updates bar to 100% | 4 | frontend | RTL or manual: click → bar fills |
| Optimistic comment, rollback on fail | 9 | frontend | RTL: optimistic prepend + rollback test |
| 90%-watched fires once per video | 6 | frontend | `watchedIds` Set prevents re-fire |
| `make lint` passes; RTL covers tab + comment | 11 | frontend | `make lint && make test-web` |

## Risks & open questions

- The video `onTimeUpdate` event fires ~4× per second; use `watchedIds` Set to ensure idempotency on the frontend.
- The `topicsApi.getById(token, subtopicId)` — a subtopic has no children; `children` will be `[]`. Media is on the subtopic.
- Comments: `CommentWithMeta` has `userId` not `userName`. Show `userId.slice(0, 8)` as display name until profiles exist.
- `PhotosGrid`: images may be R2 CDN URLs — just use `<img>` with `alt`. No lazy loading required for MVP.

## Verification

- Frontend: `make lint && make test-web`
- Manual: `make dev-web` — navigate to a subtopic, play video to 90%+ (check network tab for `/watched` call), post comment (check optimistic appear), mark as done (check bar + sidebar update)
