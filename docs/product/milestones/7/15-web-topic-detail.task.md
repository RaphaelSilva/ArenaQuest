# Task 15 — Web: Topic Detail Page

**Status:** ⏳ Pending
**Milestone:** [7](./milestone.md)

## Summary

Build the subtopic-detail surface per `docs/product/web/wire/TopicDetail.html`: breadcrumb, header with meta chips, progress bar with a "Marcar como concluído" button, media tabs (Videos / Files / Photos), an embedded video player + playlist, file cards, photo gallery, comments thread, and a right-sidebar with subtopic navigation (current, list, prev/next).

## Dependencies

Tasks 06 (XP hook on video watch), 10 (subtopic progress reads), 11 (comments API).

## Technical Constraints

- Route: `apps/web/src/app/(protected)/catalog/[topicId]/[subtopicId]/page.tsx`.
- Video player uses the existing media viewer from M3 — extend it with the visual treatment from the wireframe; do not introduce a new third-party video library.
- "Mark as done" calls `POST /topics/:id/complete` (M5). The button visually transitions to "✓ Concluído" on success.
- Watching a video to completion calls the new `POST /topics/:id/videos/:videoId/watched` from Task 06; the trigger is `ended` event or ≥ 90 % of duration, whichever fires first.
- Comments box uses the API from Task 11. One-level nesting only; the textarea grows up to 6 rows then scrolls.
- Right sidebar mirrors the wireframe: subtopic list with progress per item; prev / next buttons navigate to siblings in the same topic.

## Scope

In:
- The page and its components (`MediaTabs`, `VideoPlayer`, `Playlist`, `FilesGrid`, `PhotosGrid`, `Comments`, `SubtopicSidebar`).
- Light + dark themes.
- Loading skeleton.

Out:
- New media upload flows (existing M3 admin uploader is reused).
- Cross-topic navigation.

## Acceptance Criteria

- [ ] Layout matches the wireframe at ≥ 1280 px within ±8 px.
- [ ] Switching the media tabs preserves video playback state when returning to the Videos tab in the same session.
- [ ] Marking as done updates the progress bar to 100 % and the right-sidebar entry without a full reload.
- [ ] Posting a comment optimistically appends it and rolls back if the API call fails.
- [ ] The 90 %-watched trigger fires exactly once per video per user (server-side enforced by the XP idempotency key).
- [ ] `make lint` passes; RTL covers tab switching and comment optimistic update.

## Verification Plan

1. Manual walkthrough in `make dev-web` with both seeded participant and instructor accounts.
2. RTL specs.
3. `make lint`.
