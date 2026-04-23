# Task 09: Frontend — Stage Check-in UI & Topic Mark-as-read

## Metadata
- **Status:** Pending
- **Complexity:** Medium
- **Milestone:** 5 — Engagement & Student Progress
- **Dependencies:** Task 03, Task 04, Milestone 4 Task 09 (student task view)

---

## Summary

Wire the student-facing engagement controls into the existing UI. This adds "Check in" buttons to the task view for completing stages sequentially, and a "Mark as read" button with a silent visit tracker to the topic catalogue viewer.

---

## Architectural Context

- **Task View:** Extends `apps/web/src/components/tasks/stage-list.tsx` from M4.
- **Topic View:** Extends `apps/web/src/components/viewers/` from M3.
- **API clients:** Extends `tasks-api.ts` and `topics-api.ts` with the new write operations.

---

## Requirements

### 1. Stage Check-in Interaction (`/tasks/:id`)

- **Visual Stage States:** Each stage in the task view must display one of three states:
    - **Checked:** Stage is complete; shows completion date.
    - **Current:** The next expected stage; shows an active "Check in" button.
    - **Locked:** Future stages; muted appearance with a tooltip ("Complete previous stages first").
- **Ordering Errors:** If the API returns `409 OUT_OF_ORDER`, display a clear toast message naming the stage to complete first and revert any optimistic UI changes.
- **Double-click Guard:** The check-in button must be disabled while a request is in flight to prevent duplicate submissions.
- **Accessibility:** The stage list uses semantic ordered list markup, and the current active stage is marked with `aria-current="step"`.

### 2. Topic Progress Interaction (`/catalog/:id`)

- **Silent Visit Beacon:** When a student first views a topic, silently send a "visit" signal to the API. This must be non-blocking and must not fire more than once per page mount.
- **Mark as Read Button:** Display a "Mark as read" button when the topic is not yet completed. On click, call the complete endpoint and update the UI optimistically.

---

## Acceptance Criteria

- [ ] Students can advance through a task's stages in the correct order.
- [ ] Out-of-order check-in attempts surface a clear, actionable error message.
- [ ] Topic visit beacon fires once on mount without blocking the page render.
- [ ] "Mark as read" correctly updates the topic's status in the UI.
- [ ] Component tests cover: stage state rendering, check-in flow, out-of-order error, double-click guard, and the mark-as-read flow.
- [ ] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- `pnpm --filter web test` — component tests for the stage list and topic viewer interactions.

### Manual Verification
- As an enrolled student: complete all stages of a task in order and verify the dashboard updates.
- Open a topic page and verify the visit is recorded; then click "Mark as read" and confirm the button disappears.
