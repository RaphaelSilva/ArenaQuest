# Task 10: Frontend — Student Catalogue + Content Viewers

## Metadata
- **Status:** Pending
- **Complexity:** High
- **Milestone:** 3 — Content & Media Core
- **Dependencies:** Task 06, Task 07

---

## Summary

Build the public catalogue where students can browse the educational hierarchy and consume content. This task involves creating the read-only catalogue interface and specialized viewers for different media types (Markdown, PDF, Video, Images).

---

## Architectural Context

- **Path:** `/catalog`
- **Security:** Accessible to any authenticated user.
- **Content Integrity:** Employs client-side sanitization for Markdown rendering to ensure a secure viewing experience.
- **Media Strategy:** Uses short-lived presigned URLs for all media assets.

---

## Requirements

### 1. Catalogue Browser

- **Navigation:** A hierarchical sidebar for browsing the published topic tree.
- **Content Selection:** Selecting a topic updates the main view with its full content and media list.

### 2. Specialized Viewers

- **Markdown Viewer:** Renders rich text content with consistent typography and strict sanitization.
- **PDF Viewer:** Enables inline viewing of PDF documents with fallback options for unsupported browsers.
- **Video Player:** Native HTML5 video playback for educational content.
- **Image Gallery:** Optimized display of attached images.

### 3. Accessibility & UX

- **Semantic Structure:** Ensure the tree and content panes use appropriate ARIA roles for accessibility.
- **Loading States:** Provide smooth transitions and skeleton loaders while fetching topic details or media.

---

## Acceptance Criteria

- [ ] The `/catalog` page is functional and restricted to authenticated users.
- [ ] Students can only see `published` content and `ready` media.
- [ ] Markdown content is rendered accurately and securely (no XSS).
- [ ] PDF and Video content is accessible inline via presigned URLs.
- [ ] The catalogue is fully navigable using keyboard/screen readers (Basic ARIA compliance).
- [ ] Component tests cover the navigation logic and the safety of the Markdown viewer.
- [ ] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- Component tests for the catalogue view and media players: `pnpm --filter web test`.
- Verify the "Safe Markdown" contract in the browser environment.

### Manual Verification
- Log in as a student and perform the following:
    1. Browse the topic tree and select various topics.
    2. Verify that Markdown, PDF, and Video content renders correctly.
    3. Confirm that no internal/draft content is visible.
    4. Verify that media URLs expire as expected (by waiting or checking headers).
