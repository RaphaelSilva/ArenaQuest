# Task 05: Fix Markdown Rendering in Subtopic Detail Page

## Metadata
- **Status:** ✅ Done
- **Complexity:** Low
- **Milestone:** Future Enhancement
- **Dependencies:** None
- **Category:** User Experience / Content Display

---

## Summary

The markdown content displayed on the Subtopic Detail page is currently rendered as plain text wrapped in a `<pre>` tag instead of being properly parsed and rendered as HTML. This prevents users from seeing formatted markdown content (headings, lists, emphasis, links, code blocks, etc.) in their natural rendered form.

---

## Problem Statement

When a user navigates to a subtopic detail page (`/catalog/[id]/[subtopicId]`), the subtopic's markdown content is displayed literally as raw text rather than being converted to formatted HTML. This occurs because the content is wrapped in a `<pre>` tag without markdown parsing.

**Current behavior:**
- Raw markdown syntax is visible (e.g., `# Heading`, `**bold**`, `- list item`)
- No formatting, emphasis, or structure is applied
- Links are not clickable
- Code blocks are not syntax-highlighted
- Overall readability is severely degraded

**Expected behavior:**
- Markdown content is parsed and rendered as formatted HTML
- Headings, lists, emphasis, links, and code blocks are properly styled
- Content matches the visual treatment of markdown in other parts of the application (e.g., topic content sections)

---

## Architectural Context

### Cloud-Agnostic Approach
- No new adapters, APIs, or backend logic required
- Uses existing `renderMarkdown` utility from `packages/shared/utils/sanitize-markdown.ts`
- Follows the same pattern already established in `MarkdownViewer` and `ContentSection` components
- Client-side rendering; no backend changes needed

### Current Implementation
- File: `apps/web/src/app/(protected)/catalog/[id]/[subtopicId]/page.tsx` (lines 246–256)
- Content rendered in `<pre>` tag without markdown parsing
- Prose styling classes present but ineffective (no HTML content to style)
- `renderMarkdown` utility already imported elsewhere in the codebase

---

## Requirements

### 1. Markdown Parsing
- Replace the `<pre>` tag rendering with proper markdown-to-HTML conversion
- Use the existing `renderMarkdown` function from `packages/shared/utils/sanitize-markdown.ts`
- Render the resulting HTML safely via `dangerouslySetInnerHTML`

### 2. Styling
- Apply Tailwind prose classes consistent with other markdown sections in the application
- Use CSS variables (e.g., `--aq-text2`, `--aq-accent`) to match the design system
- Maintain the existing container styling (background, border, padding, border-radius)

### 3. Consistency
- Ensure the rendered output matches the visual treatment in `ContentSection` and `MarkdownViewer` components
- Apply appropriate `dark:prose-invert` modifier for dark mode support

---

## Technical Constraints

- **No new dependencies:** Use only the existing `renderMarkdown` utility
- **Backward compatible:** No changes to data structures or API contracts
- **Sanitization:** The `renderMarkdown` function already handles security sanitization; no additional HTML escaping needed
- **Client-side only:** All rendering occurs in the browser; no backend involvement

---

## Scope

### File to modify:
`apps/web/src/app/(protected)/catalog/[id]/[subtopicId]/page.tsx`

### Changes required:
1. Import `renderMarkdown` from `@arenaquest/shared/utils/sanitize-markdown` (if not already present)
2. In the markdown content section (lines 246–256):
   - Parse the subtopic content using `renderMarkdown(subtopic.content)`
   - Replace `<pre>` tag with a styled `<div>` that uses `dangerouslySetInnerHTML` to inject the rendered HTML
   - Apply appropriate Tailwind prose classes and CSS variables for consistent styling

### What does NOT change:
- Component props or data fetching
- Media tabs section
- Comments section
- Children/sibling navigation
- Overall page layout

---

## Acceptance Criteria

- [x] Markdown in subtopic content is parsed and rendered as HTML (not plain text)
- [x] Markdown formatting is visually applied (headings, bold, italic, lists, code blocks, etc.)
- [x] Inline links are clickable and navigable
- [x] Styling is consistent with other markdown sections in the application
- [x] Dark mode is properly supported (`dark:prose-invert` applied)
- [x] No console errors or TypeScript type violations
- [x] Sanitization is maintained (no XSS vulnerabilities introduced)
- [x] `make lint` passes
- [x] `make test` passes
- [x] No regressions in existing subtopic rendering (media tabs, comments, navigation all function correctly)

---

## Verification Plan

### Automated Tests
1. Update or add tests in `apps/web/__tests__/app/(protected)/catalog/[id]/[subtopicId].test.tsx` (if exists):
   - Test that markdown content with headings is rendered as HTML (not `<pre>`)
   - Test that lists, emphasis, and code blocks are properly converted
   - Test that links have correct `href` attributes
   - Test that dangerous content (scripts, iframes) is still sanitized

### Manual Testing (Browser)
1. **Subtopic with various markdown:**
   - Navigate to a subtopic with markdown content containing:
     - Headings (`# H1`, `## H2`)
     - Bold/italic text (`**bold**`, `*italic*`)
     - Lists (unordered and ordered)
     - Code blocks (backtick or indented)
     - Links (`[text](url)`)
   - Verify each element is rendered and styled correctly
   - Compare visual output with topic content section rendering for consistency

2. **Dark/Light Mode:**
   - Switch between light and dark themes
   - Verify prose colors adapt correctly in both modes
   - Check that text remains readable

3. **Edge Cases:**
   - Subtopic with no content (should render nothing or a placeholder)
   - Very long markdown content (should scroll properly)
   - Markdown with HTML entities (`&nbsp;`, `&lt;`, etc.)

4. **No Regressions:**
   - Verify media tabs still display correctly
   - Verify comments section loads and functions
   - Verify breadcrumb, header, progress bar work as before
   - Test sibling/child navigation

---

## Notes

- The fix is straightforward and follows an established pattern in the codebase (`MarkdownViewer` and `ContentSection` components)
- No new utilities, components, or types are required
- The existing sanitization in `renderMarkdown` prevents any security regressions
- This is a high-impact, low-risk fix that improves content readability significantly
