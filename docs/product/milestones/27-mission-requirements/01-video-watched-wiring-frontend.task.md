# Task 01 — Frontend: Live catalog viewer reports watched videos (Phase 0)

**Status:** 📝 Open
**Milestone:** [27 — Mission requirements](./milestone.md)
**RFC:** [RFC 0022](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md)
**Team:** Frontend Web

## Summary

Makes the `video_watched` requirement producible. Today the only caller of
`client.topics.markVideoWatched(topicId, mediaId)` is `VideoPlayerWithPlaylist`, rendered only by
`MediaTabs`, which no page mounts since the catalog redesign — so `POST
/v1/topics/{id}/videos/{videoId}/watched` is never called from the UI (RFC 0022 Current State §6).
This task makes the **live** catalog video viewer (`MediaList` → `VideoStage`, used by
`(protected)/catalog/[id]`) report a video as watched once, at **90 % of its duration or on
`ended`**, the same rule `VideoPlayerWithPlaylist` already implements, at most once per video per
page view. No API change and no topic change: the endpoint, its topic gate and its XP award exist.
Accepted by the product owner as a **bug fix** (RFC Open Question 5, decided 2026-10-02): it brings
back **50 XP per first watch of a video**, the weekly video quest and the
`videos_watched_in_period` badge rule, none of which fire today — so the **release notes must
announce that watching videos earns XP again**. Task 06 later hooks missions onto the same route.

## Dependencies

None — independent. It touches only the catalog viewer and can merge at any time; first is best,
because the release note for video XP rides with it.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/components/catalog/MediaList/VideoStage.tsx` and
    `apps/web/src/components/catalog/MediaList/MediaList.tsx` — the watched report and the props
    it needs (topic id, media id).
  - `apps/web/src/app/(protected)/catalog/[id]/page.tsx` — only to pass the topic id (and the
    API client callback) down to `MediaList`, if it is not already available there.
  - A component test under `apps/web/src/components/catalog/MediaList/__tests__/` (new).
- **Reuse the existing client call** `client.topics.markVideoWatched` in
  `apps/web/src/lib/topics-api.ts`; no new client method, no change to `topics-api.ts`.
- **Fire once.** A video is reported at most once per mounted viewer, however often the
  `timeupdate` event crosses 90 % or the video is replayed; a failed call is swallowed (logged in
  development) and never interrupts playback.
- **Do not touch** `VideoPlayerWithPlaylist.tsx` or `MediaTabs.tsx` (dead code is out of scope),
  nor the existing `onVisitTopic` behaviour of `MediaList` (visit semantics stay as they are —
  RFC Open Question 6, decided).
- **No new user-facing string**; if one is needed it goes through both dictionaries and
  `check-i18n-coverage.js` stays green.
- **Consumes the API contract as is**: no API source file changes in this task.

## Scope

In:
- `VideoStage` reports watched at 90 % or `ended`, once per video per mount.
- Props plumbing from the topic page through `MediaList` to `VideoStage`.
- Component tests: the call at 90 %, the call on `ended`, no second call on replay, no call below
  90 %, a rejected call does not break playback.
- The release-note line, drafted in the PR description: *"Watching a lesson video to the end now
  earns XP and counts toward weekly video challenges and video badges."* (the closeout, Task 14,
  carries it into the release notes).

Out:
- Any API, XP, quest or badge change — the server side already exists.
- Mission hooks on the watched route — Task 06.
- Firing `visit` on page mount — a backlog item filed by Task 14.

## Acceptance Criteria

- [ ] In a component test with a mocked client, advancing a video's `currentTime` past 90 % of
      its duration calls `markVideoWatched(topicId, mediaId)` exactly once.
- [ ] Firing `ended` on a video that never crossed 90 % calls it exactly once; replaying the same
      video does not call it again.
- [ ] A rejected `markVideoWatched` promise leaves the player playing and renders no error.
- [ ] On a local run, playing a seeded topic video to the end produces one `xp_events` row with
      `source_kind = 'video'` for that user and media id; a second full play produces none.
- [ ] The PR description carries the release-note line announcing that video watching earns XP.
- [ ] `VideoPlayerWithPlaylist.tsx`, `MediaTabs.tsx` and `topics-api.ts` are unchanged.
- [ ] Changed files lint clean; `make test-web` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make dev`; log in as a seeded student with access to a topic that has a video.
2. Open the topic, play the video to the end, and confirm in the network tab one
   `POST /v1/topics/{id}/videos/{videoId}/watched`; replay it and confirm no second request.
3. `wrangler d1 execute` (local) — one `xp_events` row with `source_kind = 'video'` for that
   media id.
4. `make test-web`; `make lint`.
5. `git diff --stat` confirms only guardrail files changed and nothing under `apps/api/`.
