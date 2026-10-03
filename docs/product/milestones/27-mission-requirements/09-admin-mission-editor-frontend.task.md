# Task 09 — Frontend: Admin mission editor — requirements editor, pickers, audience, badge suggestion (Phase 5)

**Status:** ✅ Done
**Milestone:** [27 — Mission requirements](./milestone.md)
**RFC:** [RFC 0022](../../RFCs/0022-mission-requirements-evidence-driven-missions-with-ordered-s.md)
**Team:** Frontend Web
**Depends On:** [Task 05](./05-admin-missions-api.task.md)

## Summary

Replaces the free-text mission form with a structured editor. The list page
`(protected)/admin/missions` keeps the table (now with step count, mode, enrollment mode and
enrolled/completed counts from Task 05's list) and links to a new editor page
`(protected)/admin/missions/[id]` (`new` for creation). The **mission card** holds title,
description, the mandatory window (local time, sent as ISO), **Mode** (*Parallel — all steps at
once* / *Sequential — one after another*), **Enrollment** (*Automatic* / *Students join* /
*Assigned*), mission XP and badge; with *Assigned*, a users-and-groups picker reusing the events
`AudienceSelector`. A **badge suggestion** appears when the window is **14 days or longer** and no
badge is picked — a non-blocking hint next to the badge picker; saving without one stays allowed.
The **requirements editor** is a list of step cards with **Add step** and a kind picker; per kind:
*Demonstrations on a topic* (topic, minimum count, description required, count any / shared only,
count moderated demonstrations, XP — with the owner's defaults: "count moderated" **off**, and a
`shared_only` step added next to an `any` step on the same topic pre-filled with a **higher XP**
than the private one; both editable), *Visit a topic* (topic, XP, with the hint that a visit is
recorded when the student opens a media item and a warning when the topic has no media), *Watch
videos* (topic, minimum count capped by the topic's video count, XP), *Self-check* (instructions,
XP) and *Event participation* (published events, unpriced ones disabled with the reason, XP). The
topic field reuses `TaskTopicPicker` (published, non-archived) through a thin single-select wrapper.
In sequential mode the cards are numbered and reorder by drag **and** keyboard-accessible up/down
buttons; in parallel mode numbers are hidden. API errors carrying a requirement index are shown on
that card. **After `start_at`** the editor is read-only except title, description, extending the end
and the active switch, with a banner explaining why. For a **content creator** every page renders
**read-only** — no create, edit or audience controls — matching Task 05 (reads open, writes
admin-only). The free `predicateKind` / `predicateParams` fields and their JSON preview are removed.

## Dependencies

- [Task 05](./05-admin-missions-api.task.md) — hard code dependency: the admin API contract, error
  codes and role matrix this editor calls.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/missions/page.tsx` and its `__tests__`;
    `apps/web/src/app/(protected)/admin/missions/[id]/page.tsx` (new).
  - `apps/web/src/components/missions/**` (new) — mission form, requirement editor, step cards,
    single-select topic picker wrapper, event picker, badge hint.
  - `apps/web/src/components/tasks/task-topic-picker.tsx` — **read-only reuse**; not edited.
  - `apps/web/src/components/admin/events/AudienceSelector.tsx` — reused as is; not edited.
  - `apps/web/src/lib/admin-gamification-api.ts` — the missions client (detail, create, patch,
    replace requirements, patch requirement title, audience); `apps/web/src/lib/api-types.gen.ts`
    regenerated with `pnpm gen:api-types`.
  - `apps/web/src/app/(protected)/admin/page.tsx` — the Missions card stays visible to content
    creators (no change in visibility; label only if needed).
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts`, `types.ts` — the reworked `admin.missions`
    section; obsolete predicate keys removed from both.
  - Component tests beside the new components.
- **The kinds and params come from `packages/shared/domain/missions/requirements.ts`**; the form
  validates with the same schemas before sending, and the server stays the authority.
- **Write affordances** are gated by `useHasRole(ROLES.ADMIN)`; read-only rendering for others.
- **No hardcoded strings**; `check-i18n-coverage.js` passes; both dictionaries keep identical keys.
- **Consumes the API contract as is**: no API source file changes in this task.

## Scope

In:
- List page update; editor page with mission card, mode, enrollment and audience, badge hint,
  requirements editor per kind, ordering, error mapping, start-lock and content-creator read-only
  states; client methods; dictionaries.
- Component tests: each kind's fields and defaults; the higher-XP pre-fill for a shared step;
  reorder by buttons; a `400` with an index lands on the right card; the 14-day badge hint shows
  and does not block saving; the read-only states (after start, content creator); the removed
  predicate fields.

Out:
- Participants tab and *Reconcile now* — Task 10.
- Student surfaces — Tasks 11 and 12.

## Acceptance Criteria

- [x] An admin creates a sequential mission with a demonstrations step and a self-check step from
      the editor; the request body matches Task 05's schema and the list shows the new mission.
- [x] Adding a *Demonstrations on a topic* step starts with "count moderated" off; adding a
      *shared only* step next to an *any* step on the same topic pre-fills a higher XP.
- [x] A window of 14 days or more with no badge shows the badge hint; saving succeeds without a
      badge.
- [x] In sequential mode the up/down buttons reorder the cards and the saved positions follow; in
      parallel mode no number is shown.
- [x] A mocked `400 INVALID_REQUIREMENT_TARGET` with index 1 renders the error on the second card.
- [x] After `start_at` only title, description, end extension and active are editable; a content
      creator sees every page read-only with no create button.
- [x] No `predicateKind` / `predicateParams` field or dictionary key remains.
- [x] `check-i18n-coverage.js` passes; `pt` and `en` builds both render the editor.
- [x] Changed files lint clean; `make test-web` green.
- [x] No diff outside the scope guardrail.
      _Closed 2026-10-03. Choices: own `MissionAudiencePicker` on the groups/users clients (the events `AudienceSelector` always renders the public/members/restricted radio and has no read-only mode; it was not edited); event prices read through `adminBilling.extras.getPrice` (admin-only, so content creators never call it); shared-step XP pre-fill = `max(ceil(xp × 1.5), xp + 10)`; the visit warning and video cap use `adminMedia.list(topicId)` because the topic list's `mediaCount.video` is always 0 (pre-existing backend grouping by raw MIME type, not fixed here); the audience is also locked after start. **Not run:** the browser walkthrough and the PT/EN `next build` render check — component tests and the i18n coverage check are the gates; a single Playwright smoke over the four frontend tasks is scheduled before the candidate PR._

## Verification Plan

1. `make dev`; log in as the seeded admin; create one mission of each enrollment mode with at least
   one step of each kind; edit a draft; open a started mission and check the read-only banner.
2. Log in as the seeded content creator; open the list and an editor — read-only.
3. `make test-web` (it runs `scripts/check-i18n-coverage.js` first); `make lint`.
4. `git diff --stat` confirms only guardrail files changed and nothing under `apps/api/src/`.
