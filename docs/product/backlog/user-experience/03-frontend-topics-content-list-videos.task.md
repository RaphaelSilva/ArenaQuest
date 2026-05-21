# Task 03: Topic Root Content Display & Media Gallery

## Metadata
- **Status:** Pending
- **Complexity:** Medium
- **Milestone:** Phase 5 (Participant Experience)
- **Dependencies:** Existing catalog page and topic structure at `/protected/catalog/:id`
- **Category:** User Experience / Content Consumption

---

## Summary

Enhance the topic root (catalog detail view) to display the Markdown content description and associated media files. Currently, the topic view shows structural metadata (subtopic count, time estimate, progress) and a list of subtopics. This task adds a content section that renders the Markdown saved in the `content` field and displays all media files (videos, PDFs, documents) that have been referenced to the root topic node.

---

## Problem Statement

Currently, when a participant views a topic root in the catalog, they see:
1. Topic title and metadata (subtopic count, estimated time, progress)
2. List of child topics (subtopics)

However, they do NOT see:
1. The topic description/content (Markdown) that instructors may have written
2. Associated media files (videos, PDFs, documents) linked to the root topic
3. A visual hierarchy separating content from navigation

**User Impact:**
- Participants cannot read topic descriptions before diving into subtopics
- Media resources attached to the root topic are hidden and inaccessible
- The learning experience lacks context and overview content
- Instructors cannot provide introductory material at the topic root level

---

## Architectural Context

### Cloud-Agnostic Approach
- **Frontend Only:** Content rendering uses existing React components (Markdown renderer, media viewers)
- **Data Layer:** Media references and content already exist in the database via `IMediaRepository` and `ITopicNodeRepository` adapters
- **No New Adapters Required:** Fetch content and media using existing API endpoints
- **Storage Agnostic:** Media is served via presigned URLs (R2, S3, or other S3-compatible storage)

### Current State
- Topic node structure includes `content` field (Markdown text stored in database) ✓
- Media repository tracks media files and their topic associations ✓
- Catalog detail page exists at `apps/web/src/app/(protected)/catalog/[id]/page.tsx` ✓
- Markdown renderer component available (`@tailwindcss/typography` plugin installed) ✓
- Topic metadata (subtopics, progress, time estimate) displays correctly ✓

### Data Model Reference
- **TopicNode** entity has:
  - `id`, `title`, `description` (short teaser)
  - `content` (full Markdown text)
  - `parentId`, `order`, `estimatedMinutes`
  - Child relationship (subtopics via `children` or similar)
- **Media** entity linked via:
  - `topicNodeId` — identifies which topic node owns the media
  - `type` (video, pdf, image, document)
  - `url` (presigned or public URL from storage)
  - `metadata` (dimensions, duration, etc.)

---

## Requirements

### 1. Content Section (Markdown Rendering)
- Display the topic's `content` field (Markdown) in a dedicated section on the topic detail page
- Render Markdown safely (using existing Markdown sanitizer from `@shared/utils/sanitize-markdown.ts`)
- Apply typography styling via Tailwind's `@tailwindcss/typography` plugin for clean readability
- Include a visual separator or heading (e.g., "About This Topic") to distinguish from other sections
- Render ONLY if content exists (no empty content section if field is null or blank)
- Support lists, code blocks, links, emphasis, and other Markdown formatting
- Dark mode support (ensure readability in both light and dark themes)

### 2. Media Gallery (Root Topic Media)
- Display all media files associated with the root topic node (not inherited from subtopics)
- Organize media by type or display in chronological order (order by `createdAt` or explicit order field)
- Provide appropriate viewers/players:
  - **Video (MP4):** HTML5 `<video>` player with controls (play, pause, fullscreen, volume)
  - **PDF:** Embedded or link to download (depending on capability and storage limits)
  - **Images:** Responsive image display with proper aspect ratio handling
  - **Documents:** Download link with file name and size indicator
- Show media metadata: title/filename, type icon, optional description
- Lazy-load media to avoid performance impact on page load
- Mobile-responsive: adapt layout for touch devices (stacked cards on mobile)

### 3. Layout & Visual Hierarchy
- Preserve existing topic structure:
  - **Header:** Topic title, metadata (subtopic count, progress, time estimate) — NO CHANGES
  - **New Content Section:** Markdown rendering (below header, before subtopic list)
  - **New Media Section:** Gallery or list of media files (below content, before subtopic list)
  - **Subtopic List:** Existing list of child topics (at bottom)
- Clear section headings with consistent styling
- Adequate whitespace between sections for readability
- Responsive design: single column on mobile, optional grid layout for media on desktop

### 4. Data Fetching
- Fetch topic `content` field using existing topic detail API endpoint
- Fetch media list for the root topic node using existing media API (filtered by `topicNodeId`)
- Handle empty states gracefully:
  - No content → skip rendering content section
  - No media → skip rendering media section or show "No media available"
- Cache media presigned URLs where applicable to avoid refetching

### 5. Accessibility
- Semantic HTML: use `<section>`, `<article>`, or similar for content and media areas
- Alt text for all images and media thumbnails
- Video player keyboard accessible (play/pause via spacebar, seek via arrow keys)
- Heading hierarchy: maintain proper `<h1>`, `<h2>`, `<h3>` order
- Color contrast: ensure text over backgrounds meets WCAG AA standards

---

## Technical Constraints

- **No new API endpoints:** Use existing topic and media endpoints
- **No new dependencies:** Use existing Markdown renderer and Tailwind styling
- **Markdown safety:** Always sanitize content before rendering (use shared sanitizer)
- **Performance:** Lazy-load media and avoid rendering large galleries on initial page load
- **Backward compatibility:** No changes to existing topic structure or subtopic list behavior
- **Storage:** Media URLs must be presigned (support S3-compatible APIs per current R2 setup)
- **TypeScript:** No `any` types; maintain strict mode compliance
- **Testing:** Must pass `make lint` and not break existing unit or E2E tests

---

## Scope

### 1. Update Topic Detail Page Component
Modify `apps/web/src/app/(protected)/catalog/[id]/page.tsx`:

**Data fetching:**
- Fetch full topic node data including `content` field
- Fetch media list filtered by root `topicNodeId`

**Rendering:**
- Add content section that renders Markdown (conditionally if content exists)
- Add media gallery section (conditionally if media exists)
- Maintain existing header and subtopic list layout

**No code examples in this task — implementation details left to developer.**

### 2. Media Viewer Components (if needed)
- If media viewer components don't already exist:
  - Create reusable video player component (or use HTML5 `<video>`)
  - Create media card/thumbnail component for displaying media in a grid
  - Ensure components support lazy-loading and responsive layouts

### 3. Styling
- Use Tailwind CSS v4 and `@tailwindcss/typography` plugin
- Ensure dark mode compatibility (`dark:` prefixed classes)
- Responsive breakpoints: mobile (< 768px), tablet (768px–1024px), desktop (> 1024px)

---

## Acceptance Criteria

- [ ] Markdown content from `content` field renders on topic detail page
- [ ] Content section displays ONLY if content is not null/empty
- [ ] Markdown is sanitized (no script injections or XSS vulnerabilities)
- [ ] Media files associated with root topic display in a gallery
- [ ] Media section displays ONLY if media files exist
- [ ] Video player (HTML5 `<video>`) works with play, pause, fullscreen, volume controls
- [ ] All media types (video, PDF, image, document) have appropriate viewers/handlers
- [ ] Media metadata (filename, type) is visible
- [ ] Layout is responsive on mobile, tablet, and desktop
- [ ] Dark mode styling applied and readable
- [ ] No console errors or TypeScript violations
- [ ] Lazy loading implemented (media not loaded until visible)
- [ ] Accessibility: alt text, semantic HTML, keyboard navigation work
- [ ] Existing topic structure preserved (header metadata, subtopic list unchanged)
- [ ] `make lint` passes
- [ ] No regressions in existing topic/catalog flows

---

## Verification Plan

### Automated Tests
1. Add unit tests in `apps/web/__tests__/app/(protected)/catalog/[id].test.tsx`:
   - Test Markdown content renders when present
   - Test content section hidden when no content exists
   - Test media gallery renders when media files exist
   - Test media gallery hidden when no media exists
   - Test media types (video, PDF, image) render with correct components
   - Test lazy-loading behavior

### Manual Testing (Browser Validation)

**Content Rendering:**
1. Load a topic with Markdown content in the catalog
2. Verify content renders correctly (headings, lists, code blocks, links visible)
3. Verify Markdown formatting is applied (bold, italic, inline code)
4. Test with content containing special characters, links, and code blocks
5. Verify dark mode text is readable

**Media Gallery:**
1. Load a topic with associated media files
2. Verify all media files display in a gallery or list
3. Test video player:
   - Click play/pause
   - Scrub timeline
   - Toggle fullscreen
   - Adjust volume
   - Test on mobile (touch controls)
4. Test PDF viewing (if embedded or link works)
5. Test image display (verify aspect ratio, responsiveness)

**Layout & Responsive:**
1. View topic on desktop (1920px+) — verify layout, spacing
2. View topic on tablet (768px–1024px) — verify media grid adjusts
3. View topic on mobile (375px–480px) — verify single-column layout, readable text
4. Scroll page — verify lazy-loading (media loads as needed)
5. Verify no horizontal scrolling or layout shift on any viewport

**Empty States:**
1. Load a topic with NO content — verify content section is hidden/not rendered
2. Load a topic with NO media — verify media section is hidden/not rendered
3. Verify subtopic list and header still display correctly

**Integration Flow:**
1. Login as student
2. Navigate to catalog
3. Click on a topic → topic detail loads with content and media
4. Click subtopic → navigate to subtopic detail
5. Go back → topic detail re-loads content and media correctly
6. Test with multiple topics (some with content, some without; some with media, some without)

**Accessibility:**
1. Use keyboard-only navigation (tab through sections, play videos)
2. Enable screen reader (check semantic HTML, alt text read aloud)
3. Test color contrast with dev tools or accessibility checker
4. Verify heading order is correct (`<h1>` > `<h2>` > `<h3>`)

---

## Notes

- This task enhances the participant learning experience by providing context and resources at the topic root level
- Markdown sanitization is critical — reuse `@shared/utils/sanitize-markdown.ts` to prevent XSS
- Media presigned URLs may have expiration — consider refresh strategy if needed
- Consider future enhancements: media search, filtering by type, or related media recommendations
- Performance: test with topics containing large media galleries (10+ items) to ensure no slowdown
- Instructor feedback: once launched, gather data on which topics use content descriptions and which use media galleries — informs future content management features

