# Plan — 05-fix-subtopic-markdown-rendering

**Task:** [05-fix-subtopic-markdown-rendering.task.md](../05-fix-subtopic-markdown-rendering.task.md)
**Source:** Backlog / User Experience
**Assigned personas:** frontend-developer
**Branch:** feature/backlog/05-fix-subtopic-markdown-rendering.task (from develop)

## Objective

Fix the markdown rendering in the Subtopic Detail page by replacing the raw `<pre>` tag rendering with proper markdown-to-HTML conversion using the existing `renderMarkdown` utility. This improves content readability and matches the visual treatment of markdown in other parts of the application (e.g., `ContentSection`).

## Affected areas

- **File to modify:**
  - `apps/web/src/app/(protected)/catalog/[id]/[subtopicId]/page.tsx` (lines 246–256)

- **Patterns to follow:**
  - `apps/web/src/components/catalog/MarkdownViewer.tsx` (uses `renderMarkdown` with `useMemo`)
  - `apps/web/src/components/catalog/ContentSection.tsx` (uses `renderMarkdown` with CSS variable styling)

- **Utility (read-only):**
  - `packages/shared/utils/sanitize-markdown.ts` → `renderMarkdown` function

## Step-by-step

### Frontend

1. **Import `renderMarkdown`** in `/apps/web/src/app/(protected)/catalog/[id]/[subtopicId]/page.tsx`:
   - Add: `import { renderMarkdown } from '@arenaquest/shared/utils/sanitize-markdown';`
   - Verify it's not already imported (scan the file imports).

2. **Replace the `<pre>` tag rendering** (lines 246–256):
   - **Old code:**
     ```tsx
     {/* Markdown content */}
     {subtopic.content && (
       <div className="mb-8">
         <div className="mb-8 h-[1px]" style={{ background: 'var(--aq-border)' }} />
         <div
           className="prose max-w-none rounded-[14px] p-6"
           style={{ background: 'var(--aq-bg2)', border: '1px solid var(--aq-border)', color: 'var(--aq-text2)' }}
         >
           <pre className="whitespace-pre-wrap text-[13px] leading-relaxed">{subtopic.content}</pre>
         </div>
       </div>
     )}
     ```
   
   - **New code:**
     ```tsx
     {/* Markdown content */}
     {subtopic.content && (
       <div className="mb-8">
         <div className="mb-8 h-[1px]" style={{ background: 'var(--aq-border)' }} />
         <div
           className="prose prose-sm dark:prose-invert max-w-none rounded-[14px] p-6"
           style={{
             background: 'var(--aq-bg2)',
             border: '1px solid var(--aq-border)',
             color: 'var(--aq-text2)',
             '--tw-prose-body': 'var(--aq-text2)',
             '--tw-prose-headings': 'var(--aq-text1)',
             '--tw-prose-links': 'var(--aq-accent)',
             '--tw-prose-code': 'var(--aq-accent)',
             '--tw-prose-hr': 'var(--aq-border)',
           } as React.CSSProperties}
         >
           <div dangerouslySetInnerHTML={{ __html: renderMarkdown(subtopic.content) }} />
         </div>
       </div>
     )}
     ```
   
   - **Key changes:**
     - Add `prose prose-sm dark:prose-invert` Tailwind classes
     - Add CSS variables (`--tw-prose-*`) for color coordination with the design system
     - Replace `<pre>` with a `<div>` that uses `dangerouslySetInnerHTML` to inject rendered HTML
     - Call `renderMarkdown(subtopic.content)` to parse and convert markdown to HTML

3. **Styling details:**
   - Use `prose-sm` for a smaller prose size (consistent with `ContentSection`)
   - Apply `dark:prose-invert` for dark mode support
   - Match CSS variables from `ContentSection` to ensure consistent appearance:
     - `--tw-prose-body`: link to text color (var(--aq-text2))
     - `--tw-prose-headings`: heading color (var(--aq-text1))
     - `--tw-prose-links`: link color (var(--aq-accent))
     - `--tw-prose-code`: code color (var(--aq-accent))
     - `--tw-prose-hr`: horizontal rule color (var(--aq-border))

## Acceptance Criteria mapping

| AC | Plan step(s) | Verification |
|---|---|---|
| Markdown parsed and rendered as HTML (not plain text) | Step 2 | Browser: content displays with formatting, not raw syntax |
| Markdown formatting visually applied (headings, bold, italic, lists, code blocks, etc.) | Step 2 | Browser: verify all markdown elements are styled |
| Inline links are clickable and navigable | Step 2 | Browser: click a link in subtopic markdown, verify navigation |
| Styling is consistent with other markdown sections (ContentSection, MarkdownViewer) | Step 2, 3 | Browser: compare visual appearance side-by-side with topic content |
| Dark mode properly supported (`dark:prose-invert` applied) | Step 3 | Browser: switch light/dark mode, verify text remains readable |
| No console errors or TypeScript type violations | Step 2 | Browser DevTools: no errors; `make lint` passes |
| Sanitization maintained (no XSS vulnerabilities introduced) | Step 2 | `renderMarkdown` already sanitizes; no additional escaping needed |
| `make lint` passes | Step 2 | CLI: `make lint` |
| `make test` passes | Step 2 | CLI: `make test` |
| No regressions (media tabs, comments, navigation all work) | Step 2 | Browser: verify full page functionality after change |

## Risks & open questions

- **No known risks:** The change is localized to a single section, uses an existing battle-tested utility (`renderMarkdown`), and follows an established pattern in the codebase.
- **Edge cases to test:**
  - Subtopic with no content (should render nothing — `{subtopic.content && ...}` guard handles this)
  - Very long markdown (should scroll properly within the container)
  - Markdown with special characters (e.g., `&nbsp;`, `&lt;`) — `renderMarkdown` handles sanitization

## Verification

- **Browser walkthrough:**
  1. Start `make dev-web` or `make dev`
  2. Navigate to a subtopic with markdown content (e.g., heading, bold, lists, code blocks, links)
  3. Verify formatting is applied (not raw text in `<pre>`)
  4. Click links to verify navigation
  5. Switch to dark mode; verify colors adapt and text is readable
  6. Scroll through long content; verify layout

- **Automated tests:**
  - `make lint` — TypeScript and ESLint pass
  - `make test` — all tests pass (or `make test-web` for frontend-only)
  - No new test file needed (rendering logic is unchanged, only the presentation layer)

- **No regressions:**
  - Media tabs, comments section, breadcrumb, progress bar, sibling/child navigation all function as before

## Out of scope

- Changes to API contracts or data fetching
- New components or abstractions
- Changes to the media tabs section, comments section, or page layout
- Changes to any other subtopic rendering (only the markdown content section is modified)
- Backend involvement (client-side rendering only)
