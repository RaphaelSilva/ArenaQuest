# Task 07 — Frontend: Board polish, empty and past-event states (Phase 6)

**Status:** ✅ Done
**Milestone:** [20 — Events board — public listing, access-scoped audiences and per-event WhatsApp contact](./milestone.md)
**RFC:** [RFC 0014](../../RFCs/0014-events-board-and-whatsapp-contact.md)
**Team:** Frontend Web
**Depends On:** [Task 05](./05-public-web.task.md), [Task 06](./06-admin-web.task.md)

## Summary

Closes out the web half of the milestone on the states the happy path never shows. A board
with no upcoming events is the state a brand-new tenant sees first and a crawler may index,
so it must read as an invitation rather than a broken page — and the "Anteriores" tab
matters precisely here, since a dojo between seminars still has a history worth showing. The
empty, loading and error states get the same treatment across the public board, the detail
page and the admin list: a past event's detail page says plainly that it has happened and
keeps its content and flyer readable, since the whole argument for retaining history is that
someone lands on it; an event with no flyer renders a deliberate placeholder rather than a
broken image box; a detail page for an out-of-audience or archived slug shows the same
not-found surface as a slug that never existed, mirroring the API's 404-not-403 rule so the
UI leaks nothing the API withheld. The pass also settles the responsive and accessibility
details across both surfaces at once — the tab pair, the cards, the audience chips and the
contact button — and sweeps the dictionaries so every string introduced by Tasks 05 and 06,
including these new states, exists in both languages. This task adds no endpoint and no new
screen; it finishes the two that exist.

## Dependencies

- [Task 05](./05-public-web.task.md) — hard dependency. This task polishes the public board
  and detail page that task creates.
- [Task 06](./06-admin-web.task.md) — hard dependency. The admin list's empty and error
  states are polished here, so that surface must exist first.
- No backend dependency beyond what Tasks 03 and 04 already landed.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(public)/**` — empty, loading, error and past-event states on the
    board and the detail page.
  - `apps/web/src/app/(protected)/admin/events/**` — the admin list's empty and error
    states.
  - `apps/web/src/components/**` — the shared card, chip, tab and placeholder pieces these
    states use.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (and `types.ts` if keys are typed) — the
    new state strings and the coverage sweep.
  - `apps/web/src/**/__tests__/**` — state and accessibility tests.
- **No new endpoint, no new client method, no new page.** `apps/api/src/` and
  `apps/web/src/lib/*-api.ts` must be absent from the diff. If a state genuinely needs data
  the API does not return, that is a finding to raise, not a change to make here.
- **The UI must not leak what the API withheld.** An out-of-audience slug, an archived slug
  and a nonexistent slug all render the **same** not-found surface, matching the API's
  404-not-403 rule. A distinguishable empty state would reintroduce the enumeration oracle
  the backend deliberately closed.
- **The empty board is indexable content too.** The public empty state is server-rendered
  like the rest of the board — it must not be a client-only skeleton, since a crawler may
  arrive while a tenant has nothing upcoming.
- **A past event stays readable.** Its detail page keeps its content, flyer and date and is
  marked as past; retaining history is pointless if the page it leads to is a dead end.
  **Decided:** the contact button **stays** on a past event, rendered *below* the past
  marker so the reader knows the date has passed before writing. The stored message is the
  admin's own text and a reader may be asking about the next edition; removing the button
  would silently delete a contact path nobody asked to remove. Reversing it is one line and
  one dictionary key.
- **App Router conventions.** Server Component by default; `'use client'` only where
  interactive state requires it. No page is converted to Client for a loading state.
- **i18n.** No hardcoded user-facing string under `src/{app,components,hooks}/**`. This task
  is also the **coverage sweep** for the whole milestone: every key introduced by Tasks 05
  and 06 is verified present and identical in both `dict-en.ts` and `dict-pt.ts`, and
  `check-i18n-coverage.js` passes.
- **Responsive & accessible.** The final pass across both surfaces — mobile, tablet and
  desktop; the tab pair carries correct tab semantics and keyboard navigation; the flyer and
  its placeholder carry meaningful alternative text; audience chips are distinguishable
  without relying on colour alone.

## Scope

In:
- Empty states: the public board with no upcoming events (and the affordance toward the
  "Anteriores" tab), the board with no past events, and the admin list with no events at
  all.
- Loading and error states across the public board, the detail page and the admin list.
- The past-event detail treatment: a clear "this event has happened" marker with the
  content, flyer and date retained.
- The missing-flyer placeholder on both the card and the detail page.
- The unified not-found surface shared by out-of-audience, archived and nonexistent slugs.
- The responsive and accessibility pass over the cards, chips, tabs and contact button.
- The dictionary sweep across every key added in Tasks 05 and 06 plus the new state strings.
- Tests for each state, the not-found identity, and the keyboard path through the tabs.

Out:
- Any backend change — Tasks 03 and 04 own the API.
- New endpoints, new client methods or new pages.
- The seeded example event and the documentation closeout — Task 08.
- Making the marketing landing page data-driven — out of milestone scope.

## Acceptance Criteria

- [x] A tenant with no upcoming events renders a deliberate, server-rendered empty board
      that points toward the "Anteriores" tab; `curl` of `/events` shows that copy in the
      markup.
- [x] A board with no past events renders its own empty state rather than a blank tab.
- [x] The admin list with no events renders an empty state with a create affordance.
- [x] A past event's detail page is marked as past and still renders its content, flyer and
      date.
- [x] An out-of-audience slug, an archived slug and a nonexistent slug render an **identical**
      not-found surface — asserted by comparing them, not by checking each alone.
- [x] An event with no flyer renders the placeholder on both the card and the detail page;
      no broken image appears.
- [x] Loading and error states exist on the public board, the detail page and the admin
      list, and an API failure produces a readable message rather than an empty page.
- [x] No hardcoded user-facing string remains anywhere in the milestone's web surfaces;
      every `events:` key is present and identical in both dictionaries;
      `check-i18n-coverage.js` passes; both `NEXT_PUBLIC_LANGUAGE=en` and the default `pt`
      render every state with no leaked literal.
- [x] Every surface is usable at mobile width; the tab pair is keyboard-navigable with
      correct semantics; flyer and placeholder carry alternative text; audience chips do not
      rely on colour alone.
      **Partially verified.** Asserted in tests: the labelled `tablist` with exactly one
      selected tab, roving `tabIndex`, arrow-key focus movement with wrap, manual
      activation, a translated word **and** a distinct per-audience glyph on each chip (so
      the levels differ with every colour stripped), alt text on the flyer, an accessible
      name on the placeholder, one link per card named after its event.
      **Not verified, and not claimed:** contrast ratios in either theme, focus-ring
      visibility, real screen-reader output, and reflow at true mobile and tablet
      viewports. No browser driver exists in this environment. `min-h-11` tap targets and
      `focus-visible` rings were added but confirmed only in markup. **Needs a human pass
      before the milestone PR**, together with Task 06's end-to-end walkthrough.
- [x] `apps/api/src/` and `apps/web/src/lib/*-api.ts` are absent from the diff.
- [x] Changed files lint clean; `make test-web` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local` with **no** events seeded, then `make dev-api` and `make dev-web`;
   open `/events` and the admin list and confirm both empty states, then `curl -s
   localhost:3000/events` and confirm the empty copy is in the markup.
2. Seed one past event only, and confirm the upcoming tab is empty while "Anteriores" shows
   it; open its detail page and confirm the past marker and that the content and flyer
   render.
3. Request an out-of-audience slug, an archived slug and a nonsense slug in turn and compare
   the three rendered pages.
4. Create an event with no flyer and confirm the placeholder on both the card and the detail
   page.
5. Stop `make dev-api` and reload each surface to confirm the error states read clearly.
6. Toggle `NEXT_PUBLIC_LANGUAGE` between `pt` and `en` across every state, and run
   `check-i18n-coverage.js`.
7. `make test-web` — the state, not-found-identity and keyboard tests pass.
8. Resize to mobile and tab through the board and the detail page with the keyboard alone.
9. `make lint`.
10. `git diff --stat` confirms only scope-guardrail files changed, and that `apps/api/src/`
    and the `lib/*-api.ts` clients are absent from the list.
