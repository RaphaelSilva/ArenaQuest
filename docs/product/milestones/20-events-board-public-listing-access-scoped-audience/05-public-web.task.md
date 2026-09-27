# Task 05 — Frontend: Public events board, detail page and SEO baseline (Phase 4)

**Status:** ✅ Done
**Milestone:** [20 — Events board — public listing, access-scoped audiences and per-event WhatsApp contact](./milestone.md)
**RFC:** [RFC 0014](../../RFCs/0014-events-board-and-whatsapp-contact.md)
**Team:** Frontend Web
**Depends On:** [Task 03](./03-anonymous-read-api.task.md)

## Summary

Gives ArenaQuest its first page a stranger can read. A new `(public)` route group — purely
additive, since the auth gate is the client-side redirect in `(protected)/layout.tsx` and
not a middleware, so there is no guard to bypass and none to weaken — renders `/events` and
`/events/[slug]` **on the server**, because the entire point of a public board is to be
found and a client-side fetch hands a crawler an empty shell. The board shows cards with the
flyer thumbnail, date, title and summary, an audience chip on anything beyond `public`, and
a **"Próximos" / "Anteriores"** tab pair that switches `?scope`; upcoming is the default and
the history tab is deliberate vitrine, evidence to a first-time visitor that the dojo is
active. A signed-out visitor sees the `public` slice with a "sign in to see more"
affordance; a signed-in visitor sees their full entitled set as **one board** with the
restricted items marked, never two disconnected tables. The detail page carries the flyer,
the formatted date and location, the sanitised markdown body and the WhatsApp button wired
through the existing `whatsappLink` helper to the contact block the API resolved — so a
visitor reaches the instructor who runs *that* event, with a first message naming it.
Date and time render in the **event's own `timezone`**, the only zone an anonymous reader
carries. `generateMetadata` fills `og:title`, `og:description` and `og:image`, the last
pointing at the stable `/flyer` route so a link pasted into a chat still previews a day
later. A minimal SEO baseline ships alongside: `robots.ts`, a `sitemap.ts` over the
published `public` set, and a fix for the hardcoded `<html lang="en">` in the root layout,
which has been wrong since the default build language became `pt`. Task 06 adds the
backoffice that fills this board; Task 07 polishes its empty and past states.

## Dependencies

- [Task 03](./03-anonymous-read-api.task.md) — hard dependency. This task consumes
  `GET /v1/events`, `GET /v1/events/{slug}` and `GET /v1/events/{slug}/flyer` and ships no
  endpoint of its own. It must not land ahead of that contract.
- Extends `apps/web/src/lib/whatsapp.ts` (`whatsappLink`, used unchanged). It does **not**
  read `brand.whatsapp`: the contact number arrives resolved from the API, and this surface
  applies no fallback of its own (RFC 0014 decision of 2026-09-22).
- Adds `apps/web/src/lib/events-api.ts` — a new client, because `fetchWithAuth` assumes a
  session and these reads must work with no token at all.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(public)/**` (new route group) — the layout, `events/page.tsx` and
    `events/[slug]/page.tsx`.
  - `apps/web/src/app/robots.ts` and `apps/web/src/app/sitemap.ts` (new).
  - `apps/web/src/app/layout.tsx` — **only** the `<html lang>` fix, so it reflects
    `NEXT_PUBLIC_LANGUAGE`. No other line of this file changes.
  - `apps/web/src/lib/events-api.ts` (new) — the token-optional transport.
  - `apps/web/src/components/**` — the event card, the scope tabs and the contact button,
    if they are extracted as components.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (and `types.ts` if keys are typed) — the
    new `events:` section.
  - `apps/web/src/**/__tests__/**` — component and render tests.
- **Server-rendered, not client-fetched.** The board and the detail page are Server
  Components whose markup carries the events. `'use client'` is added only where interactive
  state genuinely requires it — the tab control and the contact button — never at the page
  level. A page-level `'use client'` defeats the indexing decision this whole task exists
  for.
- **The token-optional transport is the only new client shape.** `events-api.ts` attaches a
  Bearer *when one exists* and omits the refresh and expiry callbacks otherwise; it does not
  route through `fetchWithAuth`, which assumes a session. `ApiClient` may gain an `events`
  namespace for the authenticated case, but the anonymous server render must not depend on
  it.
- **The client never decides what it may see.** The signed-in superset comes from sending
  the token to the same endpoint, never from a different route or a filter parameter. There
  is no client-side audience logic to get wrong.
- **i18n.** No hardcoded user-facing string under `src/{app,components,hooks}/**`; every
  label reads from the dictionary; `dict-en.ts` and `dict-pt.ts` carry **identical** keys and
  `check-i18n-coverage.js` passes. The contact label default is `"Eu quero"` in `dict-pt`
  and `"I'm interested"` in `dict-en` — a Portuguese literal must never reach an
  `NEXT_PUBLIC_LANGUAGE=en` build.
- **The event's own timezone renders it.** Dates are formatted in `events.timezone`, not in
  the reader's local zone and not in the viewer's `users.timezone` — an anonymous reader has
  neither.
- **`og:image` points at the stable `/flyer` route**, never at a presigned URL, which would
  be dead by the time a crawler fetched it.
- **The auth gate is not touched.** `(protected)/layout.tsx` and every existing route group
  are unchanged; the `(public)` group is additive.
- **No backend change.** `apps/api/src/` must be absent from the diff — Task 03 owns the
  endpoints.
- **Cloud-agnostic.** No provider SDK; the client targets `NEXT_PUBLIC_API_URL`.
- **Responsive & accessible.** Tailwind v4 in the existing idiom; the board is usable at
  mobile, tablet and desktop widths; the tab pair is keyboard-navigable with correct tab
  semantics, and the flyer carries meaningful alternative text.

## Scope

In:
- The `(public)` route group and its layout, rendering the full `<Nav/>` when a user
  resolves and a minimal header otherwise, so one page serves both readers.
- `/events` — the server-rendered board, the card, the audience chip, the "Próximos" /
  "Anteriores" tabs over `?scope`, and the "sign in to see more" affordance for signed-out
  visitors.
- `/events/[slug]` — flyer, date and time in the event's timezone, location, sanitised
  markdown body and the WhatsApp button rendered only when the API resolved a contact.
- `generateMetadata` on both pages filling `og:title`, `og:description` and `og:image`.
- `robots.ts`, `sitemap.ts` over the published `public` set, and the `<html lang>` fix.
- `events-api.ts`, the token-optional transport.
- The `events:` dictionary section in both languages.
- Component and render tests: the server-rendered markup contains event titles; the tabs
  switch scope; the contact button composes the expected `wa.me` target; the signed-out
  board shows the public slice and the affordance.

Out:
- Any backend change — Task 03 owns the endpoints.
- The admin backoffice — Task 06.
- Empty states, past-event polish and the final responsive pass — Task 07.
- Making the existing marketing landing page data-driven — explicitly out of milestone
  scope.

## Acceptance Criteria

- [x] `curl` of `/events` returns HTML whose markup already contains the event titles —
      no client fetch is required to see them.
- [x] A signed-out visitor loads `/events`, sees exactly the `public` slice with the "sign
      in to see more" affordance, opens an event and reaches WhatsApp with a message naming
      that event, having never authenticated.
- [x] The number in that `wa.me` URL is exactly the one the API returned for that event;
      no button renders when the API returns `contact: null`, and the page never
      substitutes `brand.whatsapp` for a missing number.
- [x] A signed-in visitor sees their full entitled set as one board, with restricted items
      marked by an audience chip.
- [x] The "Anteriores" tab shows past events ordered most-recent-first and "Próximos" is the
      default; switching tabs changes `?scope` and the rendered set.
- [x] Event date and time render in the event's own `timezone`, verified against an event
      whose timezone differs from the test machine's.
- [x] `generateMetadata` emits `og:title`, `og:description` and an `og:image` pointing at
      `/v1/events/{slug}/flyer`; pasting the URL into a chat renders a preview, and the same
      URL still previews 24 hours later.
- [x] `robots.ts` and `sitemap.ts` resolve, and the sitemap lists exactly the published
      `public` events.
- [x] `<html lang>` matches `NEXT_PUBLIC_LANGUAGE` — `pt` by default, `en` when set.
- [x] No hardcoded user-facing string; the new `events:` keys exist in both dictionaries;
      `check-i18n-coverage.js` passes; both `NEXT_PUBLIC_LANGUAGE=en` and the default `pt`
      render the board with no leaked literal.
- [x] Neither page is a Client Component; `'use client'` appears only on the interactive
      tab and button pieces.
- [x] The board is usable at mobile width and the tab pair is keyboard-navigable.
      **Not verified in a real browser** — no browser driver was available in this
      environment. What *is* verified: the tabs implement the APG manual-activation
      pattern (roving `tabIndex`, arrow-key focus movement, `role="tablist"`/`"tab"`/
      `"tabpanel"`, `aria-selected`) and are real `<Link>`s, so they are natively
      focusable; the grid is `grid-cols-1 sm:2 lg:3`. **Needs a human pass at the mobile
      breakpoint and one keyboard tab-through before the milestone PR.**
- [x] `apps/api/src/` and `(protected)/layout.tsx` are absent from the diff.
- [x] Changed files lint clean; `make test-web` green for the affected component tests.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make dev-api` with a seeded fixture spanning all three audiences and both scopes, then
   `make dev-web`; open `/events` signed out and confirm the public slice and the
   affordance.
2. `curl -s localhost:3000/events | grep` for an event title, confirming the markup carries
   it without JavaScript.
3. Sign in as a student in a granted group and confirm the board grows to the entitled set
   in one list, with the restricted items chipped.
4. Open an event and click the WhatsApp button; confirm the target number is the event's own
   and the pre-filled message names the event.
5. Switch to "Anteriores" and confirm the past set, its ordering, and that `?scope` moved in
   the URL.
6. View source on the detail page and confirm the OpenGraph tags; paste the URL into a chat
   and confirm the preview renders.
7. Fetch `/robots.txt` and `/sitemap.xml` and confirm both resolve and that the sitemap
   lists only published `public` events.
8. Toggle `NEXT_PUBLIC_LANGUAGE` between `pt` and `en`, confirm every label translates, that
   `<html lang>` follows, and run `check-i18n-coverage.js`.
9. `make test-web` — the render and component tests pass.
10. Resize to mobile and tab through the board with the keyboard alone.
11. `make lint`.
12. `git diff --stat` confirms only scope-guardrail files changed, and that `apps/api/src/`
    is absent from the list.
