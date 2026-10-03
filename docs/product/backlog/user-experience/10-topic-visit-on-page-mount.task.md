# Task 10 — Frontend: Record a topic visit when the topic page mounts

**Status:** 📝 Open
**Kind:** Feature
**Team:** Frontend Web
**Priority:** Medium
**Found in:** Milestone 27, RFC 0022 Open Question 6, 2026-10-03

## Summary

A student who opens a catalog topic page (`/catalog/{id}`) records a visit of that topic — once per
page view — whether or not the topic has media and whether or not they open a media item. Today a
visit is recorded only when the student expands or plays a media item, so a text-only topic never
produces one. With this task a `topic_visited` mission step (RFC 0022) on any topic can be completed
by opening the page, and the admin mission editor stops warning that a visit needs media. The
contract is the existing `POST /v1/me/topics/{id}/visit`; no API change.

## Motivation

- RFC 0022 Open Question 6, decided by the product owner on 2026-10-02: keep the media-interaction
  semantics in M27 and fire `visit` on page mount as a separate backlog item (RFC 0022 Roadmap,
  item 1). Visiting is the smallest possible first step of a sequential mission.
- Today `apps/web/src/app/(protected)/catalog/[id]/page.tsx` passes `client.topics.visit(id)` only as
  `MediaList`'s `onVisitTopic`, which fires on expanding or interacting with a media item
  (`components/catalog/MediaList/MediaList.tsx`). A topic without media renders no `MediaList`, so
  the M27 editor shows a *no media* warning on a `topic_visited` step for such a topic
  (`components/missions/RequirementCard.tsx`, `noMediaWarning`) and its hint says a visit needs a
  media item (`visitHint` under the `admin.missions` requirements section of both dictionaries).
- Known consequence, accepted by the decision: `topic_progress` moves to `in_progress` for every
  topic a student merely opens, so the catalog and dashboard progress reflect page opens.

## Scope

In:
- The catalog topic page calls the existing `visit` client once when it has loaded a topic the
  student can read, and again only when the route's topic id changes — not on re-renders. A failed
  call stays silent and never blocks rendering (the client already swallows errors).
- The media-interaction calls stay as they are (a repeat visit inside a mission window is new
  evidence; the API is idempotent on `topic_progress`).
- The mission editor's `topic_visited` hint says the visit is recorded when the student opens the
  topic, and the *no media* warning is no longer shown for a `topic_visited` step (the video-count
  helper stays for `video_watched`).
- Tests: the page calls `visit` exactly once on mount for a topic without media; it does not call it
  when the topic fails to load (404); the editor shows the new hint and no warning.

Out:
- Any API change: `POST /v1/me/topics/{id}/visit`, its gate and its mission hook stay as shipped
  (`apps/api/src/routes/me/progress.ts`).
- A `topic_completed` mission kind (RFC 0022 Alternatives §5) or any change to topic completion.
- Debouncing visits across tabs or sessions — the API already upserts one row per student and topic.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/catalog/[id]/page.tsx`
  - `apps/web/src/app/(protected)/catalog/[id]/__tests__/**` (new)
  - `apps/web/src/components/missions/RequirementCard.tsx`,
    `apps/web/src/components/missions/__tests__/RequirementEditor.test.tsx` and
    `apps/web/src/app/(protected)/admin/missions/__tests__/mission-editor-page.test.tsx` (both
    assert today's `noMediaWarning`)
  - `apps/web/src/i18n/dict-en.ts`, `apps/web/src/i18n/dict-pt.ts`, `apps/web/src/i18n/types.ts`
    (the `visitHint` value; drop `noMediaWarning` only if nothing else reads it — keys stay
    identical in both dictionaries)
- Reuse the existing `client.topics.visit` from `apps/web/src/lib/topics-api.ts`; no new client method.
- Staff opening a topic page record a visit too, as they already do on media interaction; staff are
  never enrolled in `auto` missions, so no mission effect follows.

## Acceptance Criteria

- [ ] Opening `/catalog/{id}` of a published text-only topic as the seeded student sends exactly one
      `POST /v1/me/topics/{id}/visit` (asserted on the mocked client), and a `topic_visited` step on
      that topic completes (manual check against `make dev`).
- [ ] A topic that answers `404` sends no visit.
- [ ] The editor's `topic_visited` card shows the new hint in both languages and no *no media*
      warning; `check-i18n-coverage.js` passes.
- [ ] Changed files lint clean; `make test-web` and `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-web` — the new page spec and the updated editor spec pass.
2. `make dev`; as the seeded student open a text-only topic and confirm one `visit` request in the
   network panel; reload and navigate between topics; open an unknown id and confirm no request.
3. `git diff --stat` confirms only scope-guardrail files changed.
