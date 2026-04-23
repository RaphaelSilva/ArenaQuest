# Task 08: Frontend — Student Dashboard

## Metadata
- **Status:** Pending
- **Complexity:** Medium-High
- **Milestone:** 5 — Engagement & Student Progress
- **Dependencies:** Task 06

---

## Summary

Replace the `/dashboard` placeholder with a functional student home page. The dashboard gives students a motivating, at-a-glance view of their learning journey: overall progress, content to continue, and a topic-by-topic breakdown.

---

## Architectural Context

- **Path:** `/dashboard` (replaces existing placeholder).
- **Data Fetching:** Client-side using the progress API, authenticated via the session token.
- **Visualizations:** Plain SVG-based progress rings and percentage bars — no heavy charting libraries in M5.
- **Accessibility:** Every visual progress indicator must have an adjacent numerical text equivalent. No color-only encoding.

---

## Requirements

### 1. Dashboard Layout

The dashboard is organized into three sections:

- **Summary Row:** High-level progress cards showing overall topic completion %, task completion %, and last activity timestamp.
- **"Continue" Section:** A short list of in-progress tasks the student can resume, each deep-linking to the task detail page.
- **Topics Breakdown:** Per-root-topic progress bars showing completion percentage rolled up across all descendant topics.

### 2. Topic Progress Roll-up

For the topics breakdown, compute per-root-topic completion by aggregating progress across all descendants:
- A pure utility function should handle this calculation independently of rendering, making it independently testable.

### 3. User Experience

- **Stale-While-Revalidate:** Show cached data immediately on mount, then refresh in the background. The dashboard should never show an empty state unless the data is truly empty.
- **Empty State:** When no topics are assigned, show a friendly message; do not suggest creating content (students cannot).

---

## Acceptance Criteria

- [ ] The dashboard renders summary cards, continue-list, and topic breakdown with live API data.
- [ ] The progress roll-up utility is independently unit tested.
- [ ] Empty states are handled gracefully for both topics and tasks.
- [ ] All progress visualizations have accessible text equivalents.
- [ ] Component tests cover summary rendering, continue-list, topic roll-up, and empty states.
- [ ] Codebase remains lint-clean and all tests pass.

---

## Verification Plan

### Automated Tests
- `pnpm --filter web test` — component tests for the dashboard.

### Manual Verification
- Log in as a seeded, enrolled student; complete a check-in in another tab, refresh the dashboard, and verify the progress percentages update.
