# Task 07: Markdown Sanitization Helper

## Metadata
- **Status:** Done
- **Complexity:** Low
- **Milestone:** 3 — Content & Media Core
- **Dependencies:** none

---

## Summary

Implement a centralized Markdown sanitization helper in the shared package. This ensures a consistent "Safe Markdown" contract across both the backend (write-side persistence) and the frontend (render-side display), preventing XSS and other injection attacks.

---

## Architectural Context

- **Location:** `@arenaquest/shared` (isomorphic package).
- **Tooling:** Recommend using `DOMPurify` (or `isomorphic-dompurify`) and a standard Markdown parser like `marked`.
- **Dual Surface:**
    - **Write-Side:** Strips dangerous constructs from raw Markdown strings before DB storage.
    - **Render-Side:** Converts Markdown to sanitized HTML for safe display in the browser.

---

## Requirements

### 1. Sanitization Contract

- **Allowed Elements:** Standard typography (H1-H6, P, Strong, Em), lists, blockquotes, code blocks, tables, and links.
- **Disallowed Elements:** Script tags, iframes, event handlers (`on*`), and dangerous URI schemes (`javascript:`, `data:`).
- **Isomorphic Support:** The helper must be compatible with both the Cloudflare Workers runtime and standard browser environments.

### 2. Implementation Strategy

- **Markdown-to-Markdown (Write-Side):** A function to clean raw Markdown source while preserving the Markdown syntax.
- **Markdown-to-HTML (Render-Side):** A function to safely parse and sanitize Markdown into HTML for injection into React components (e.g., via `dangerouslySetInnerHTML`).

---

## Acceptance Criteria

- [x] Sanitization helpers are exported from the shared package and usable in both `apps/api` and `apps/web`.
- [x] Attack vectors (scripts, iframes, dangerous links) are successfully neutralized.
- [x] Legitimate Markdown (headers, tables, code blocks) is preserved correctly.
- [x] Comprehensive unit tests cover a wide range of "safe" and "malicious" inputs.
- [x] Integration into the Admin API (Task 04) ensures sanitized storage of content.

---

## Verification Plan

### Automated Tests
- Run unit tests in the shared package: `pnpm --filter @arenaquest/shared test`.
- Verify that common XSS payloads are dropped or neutralized.

### Manual Verification
- Test via a scratch script or REPL to ensure the sanitization output matches expectations for complex Markdown structures.
