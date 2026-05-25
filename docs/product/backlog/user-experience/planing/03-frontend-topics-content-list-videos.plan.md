# Plan — 03-frontend-topics-content-list-videos

**Task:** [03-frontend-topics-content-list-videos.task.md](../03-frontend-topics-content-list-videos.task.md)  
**Source:** Backlog (User Experience)  
**Assigned personas:** frontend-developer  
**Branch:** feature/backlog/03-frontend-topics-content-list-videos.task

## Objective

Enhance the topic detail page (`/protected/catalog/:id`) to display both the Markdown content description and a media gallery for files associated with the root topic. Currently, only metadata and subtopics are shown. This task adds two new sections: a content section rendering Markdown safely, and a media gallery displaying videos, PDFs, images, and documents with appropriate viewers.

## Affected areas

### Web Frontend (apps/web)
- **`src/app/(protected)/catalog/[id]/page.tsx`** — Topic detail page component
  - Add data fetching for topic `content` field
  - Add media list fetching (filtered by root `topicNodeId`)
  - Add content section rendering
  - Add media gallery section rendering
  
- **New component(s) if needed:**
  - `src/components/media/MediaGallery.tsx` — Gallery container for media files
  - `src/components/media/MediaCard.tsx` — Individual media item (thumbnail, metadata)
  - `src/components/media/VideoPlayer.tsx` — HTML5 video player with controls (if not existing)
  
- **Styling:**
  - Tailwind CSS v4 + `@tailwindcss/typography` for Markdown rendering
  - Dark mode support (`dark:` classes)
  - Responsive breakpoints (mobile < 768px, tablet 768–1024px, desktop > 1024px)

### No Backend Changes
- All data already exists via existing API endpoints
- No new adapters or database queries needed
- Media presigned URLs are served from R2/S3-compatible storage

## Step-by-step

### Frontend

1. **Audit existing media components**
   - Check if media viewer components already exist in `src/components/`
   - Determine what needs to be built vs. reused

2. **Extend topic detail page data fetching**
   - Verify existing API call fetches full `content` field from topic node
   - Add API call to fetch media list filtered by `topicNodeId` (call order: topic first, then media)
   - Handle empty/null states gracefully

3. **Implement Content Section**
   - Create conditional render block below topic header
   - Sanitize Markdown using `@shared/utils/sanitize-markdown.ts`
   - Apply typography styling via `@tailwindcss/typography`
   - Include visual heading (e.g., "About This Topic")
   - Render ONLY if `content` is not null/empty
   - Ensure dark mode readability

4. **Implement Media Gallery Component**
   - Create reusable `MediaGallery` component
   - Accept media array and organize/sort by type or `createdAt`
   - Create `MediaCard` sub-component for individual items (title, type icon, metadata)
   - Display conditionally ONLY if media array is not empty

5. **Create Media Viewers**
   - **Video:** Use HTML5 `<video>` with controls (play, pause, fullscreen, volume, timeline scrubbing)
   - **PDF:** Embed or provide download link (determine based on infrastructure capability)
   - **Images:** Responsive `<img>` with proper aspect ratio and lazy-loading
   - **Documents:** Download link with file icon and size indicator

6. **Implement Lazy Loading**
   - Use Intersection Observer API or Next.js `<Image>` component with dynamic imports
   - Defer media rendering until viewport visibility
   - Avoid loading full gallery on initial page load

7. **Responsive Design**
   - Single column on mobile (< 768px)
   - Grid layout on tablet/desktop (e.g., 2 columns at 768–1024px, 3 columns at > 1024px)
   - Ensure no horizontal scrolling or layout shift

8. **Add TypeScript Types**
   - Create/extend types in `packages/shared/types/entities.ts` if needed for media metadata
   - Ensure strict mode compliance (no `any` types)

9. **Testing & Linting**
   - Write unit tests for content rendering (present/absent, sanitization)
   - Write unit tests for media gallery (present/absent, type differentiation)
   - Run `make lint` and `make test-web`
   - Manual browser walkthrough on `make dev-web`

10. **Accessibility**
    - Add alt text to all images and media thumbnails
    - Use semantic HTML (`<section>`, `<article>`, proper heading hierarchy)
    - Ensure video player is keyboard-accessible (spacebar play/pause, arrow keys seek)
    - Verify color contrast meets WCAG AA standards
    - Test with screen reader

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| Markdown content from `content` field renders | Step 3 | frontend | Manual: load topic with content; verify rendering |
| Content section displays ONLY if content exists | Step 3 | frontend | Manual: load topic without content; verify section hidden |
| Markdown is sanitized (no XSS) | Step 3 | frontend | Code review: verify `sanitize-markdown.ts` used |
| Media files display in gallery | Steps 4–5 | frontend | Manual: load topic with media; verify all files display |
| Media section displays ONLY if media exists | Step 4 | frontend | Manual: load topic without media; verify section hidden |
| Video player works (play, pause, fullscreen, volume, scrub) | Step 5 | frontend | Manual: test video player controls |
| All media types (video, PDF, image, document) have appropriate viewers | Step 5 | frontend | Manual: load each media type; verify viewer renders |
| Media metadata (filename, type) visible | Step 5 | frontend | Manual: verify metadata displays in gallery |
| Responsive on mobile, tablet, desktop | Step 7 | frontend | Manual: test at 375px, 768px, 1920px viewports |
| Dark mode styling applied & readable | Step 3, 7 | frontend | Manual: toggle dark mode; verify readability |
| No console errors or TypeScript violations | Step 8, 9 | frontend | `make lint` passes; `make test-web` passes |
| Lazy loading implemented | Step 6 | frontend | Code review: verify Intersection Observer or Next.js dynamic import |
| Accessibility: alt text, semantic HTML, keyboard nav | Step 10 | frontend | Manual: keyboard-only nav, screen reader test |
| Existing topic structure preserved | Steps 2–4 | frontend | Manual: verify header, metadata, subtopic list unchanged |
| `make lint` passes | Step 9 | frontend | `make lint` output clean |
| No regressions in existing flows | Step 9 | frontend | `make test-web` passes; manual regression test |

## Risks & open questions

- **Media presigned URL expiration:** R2/S3 presigned URLs may expire. Clarify with backend if refresh strategy is needed or if URLs are long-lived.
- **PDF embedding support:** Determine whether to embed PDFs (requires viewer library) or provide download links only. Current task allows either; implementation depends on storage/infrastructure capability.
- **Performance with large galleries:** No guidance on expected max gallery size; assume < 10 items for initial implementation. If larger, may need pagination or load-more pattern.
- **Existing media components:** If media viewers already exist in the codebase, reuse instead of building new. Audit early (Step 1).
- **TypeScript entity types:** Confirm `Entities.Content.Media` structure in `packages/shared/types/entities.ts` matches API response shape; no new types required if schema is already defined.

## Verification

**Frontend:**
- `make lint` — no linting errors
- `make test-web` — all tests pass (including new tests for content/media sections)
- `make dev-web` — manual browser walkthrough:
  - Load topic with content → verify Markdown renders, section visible
  - Load topic without content → verify section hidden
  - Load topic with media → verify gallery renders, lazy-loading works
  - Load topic without media → verify gallery hidden
  - Test video player (play, pause, fullscreen, volume, scrub)
  - Test PDF/image/document viewers
  - Resize to mobile/tablet/desktop → verify responsive layout
  - Toggle dark mode → verify readability
  - Keyboard-only navigation → verify accessibility
  - Screen reader test → verify alt text and semantic HTML

**Integration:**
- Navigate catalog → click topic → content and media display
- Click subtopic from within content/media section → navigate without errors
- Go back → content/media re-load correctly
- Test with multiple topics (varying content/media presence)

## Out of scope

- Backend API changes or new endpoints (use existing topic and media APIs)
- New database migrations or data model changes
- Creating a media management UI (instructor upload/management is separate)
- Implementing search, filtering, or sorting by media type (can be added later)
- Creating standalone media viewers outside the topic context (e.g., media library page)
- Implementing media recommendations or related content suggestions
- Adding comments or annotations to media

---

**Next step:** Invoke frontend-developer skill to implement these steps.
