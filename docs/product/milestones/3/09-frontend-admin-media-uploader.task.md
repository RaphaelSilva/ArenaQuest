# Task 09: Frontend — Admin Media Uploader

## Metadata
- **Status:** Pending
- **Complexity:** Medium
- **Milestone:** 3 — Content & Media Core
- **Dependencies:** Task 05, Task 08

---

## Summary

Integrate media upload capabilities into the Admin Topic Tree dashboard. This allows content creators to attach files (PDFs, videos, images) directly to topics using a performant direct-to-R2 upload strategy with real-time feedback.

---

## Architectural Context

- **Placement:** Topic detail pane (Authoring interface).
- **Upload Strategy:** Direct client-to-storage (R2) via presigned URLs.
- **State Tracking:** Manage upload lifecycle (Presign → Upload → Finalize) with local UI state.
- **Concurrency:** Implement efficient queue management for multiple file uploads.

---

## Requirements

### 1. Media Upload Experience

- **Drag-and-Drop:** Intuitive file selection via drop zone or file browser.
- **Real-time Progress:** Visual progress bars for every active upload.
- **Queue Management:** Support for multiple uploads with reasonable concurrency limits to maintain UI responsiveness.
- **Validation:** Enforce file type and size constraints on the client-side before starting the upload process.
- **Cancellation:** Allow users to cancel in-flight uploads, ensuring server-side cleanup of partial records.

### 2. Media List & Management

- **Attached Media View:** Display a list of all media associated with a topic, including metadata (type icon, filename, size).
- **Media Deletion:** Ability to remove media from a topic, triggering both database and storage cleanup.

---

## Acceptance Criteria

- [ ] Users can upload media directly to storage without overloading the API Worker.
- [ ] Upload progress is accurately reflected in the UI.
- [ ] Client-side validation prevents oversized or unsupported file uploads.
- [ ] Uploaded media is immediately listed and accessible within the topic detail pane.
- [ ] Deletion of media is synchronous and cleans up both the UI and backend records.
- [ ] Component tests cover the upload state machine, including success, failure, and cancellation scenarios.
- [ ] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- Component tests for the `MediaUploader` and `MediaList` components: `pnpm --filter web test`.
- Verify that upload requests are directed to the storage provider (mocked).

### Manual Verification
- In the admin dashboard:
    1. Attach a PDF and a video to a topic.
    2. Monitor the progress bar and confirm completion.
    3. Cancel an upload mid-way and verify it doesn't appear in the final list.
    4. Delete a file and verify it is removed from the view.
