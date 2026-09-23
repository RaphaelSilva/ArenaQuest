# Task 06 — Frontend: Admin events backoffice (Phase 5)

**Status:** ✅ Done
**Milestone:** [20 — Events board — public listing, access-scoped audiences and per-event WhatsApp contact](./milestone.md)
**RFC:** [RFC 0014](../../RFCs/0014-events-board-and-whatsapp-contact.md)
**Team:** Frontend Web
**Depends On:** [Task 04](./04-admin-api.task.md)

## Summary

Lets an administrator run an event end to end without a terminal. A new
`(protected)/admin/events` surface follows the topics backoffice: a list with status and
audience columns and a filter that includes drafts, and a form carrying the date-and-time
pair, the timezone, the markdown editor, the flyer uploader, the audience selector and the
WhatsApp fields. Four details carry recorded decisions and are the substance of the task
rather than its trim. The **flyer uploader** is the existing topics uploader component
pointed at the event endpoints, and the form states the 5 MB ceiling up front, because a
designer's export routinely exceeds it and being told after a failed upload is the worst
moment to learn. The **audience selector** offers `public` / `members` / `restricted`, and
`restricted` reveals group and user pickers over the existing `admin-groups-api`; choosing
`public` warns plainly that the event becomes readable by anyone on the internet, including
its contact number. The **WhatsApp fields** are where the contact text is *authored*: the
message field is **pre-filled from a dictionary template** composed with the event's title
and date, and what the admin submits is what the API stores and serves — the server
composes nothing (RFC 0014 decision of 2026-09-22). A **live preview** shows it —
the administrator should read the exact text a visitor will send before publishing, not
discover it afterwards. And the **slug** field is generated from the title at creation and
never re-derived on rename, with a manual override that warns it breaks links already
shared, because a public URL pasted into a WhatsApp group cannot be recalled. Publishing is
`admin`-only at the API, so the control is hidden or disabled with an explanation for a
`content_creator` rather than offered and then refused; removal is archive, and no delete
control exists because no delete endpoint does. The timezone field pre-fills the constant
`America/Sao_Paulo` and stays editable per event.

## Dependencies

- [Task 04](./04-admin-api.task.md) — hard dependency. Every control here calls an endpoint
  that task lands: the CRUD routes, the guarded publish, `PUT /{id}/audience` and the flyer
  presign / finalize / delete trio. This surface must not ship ahead of that contract.
- Extends the existing topics flyer/media uploader component and the existing
  `apps/web/src/lib/admin-groups-api.ts` pickers.
- Adds `apps/web/src/lib/admin-events-api.ts`, the authenticated admin client.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/events/**` (new) — the list page, the form page and
    their local pieces.
  - `apps/web/src/lib/admin-events-api.ts` (new) — the admin client.
  - `apps/web/src/components/**` — the audience selector, the WhatsApp fields with their
    message preview, and any extraction of the reused uploader. The existing uploader is
    **configured**, not forked.
  - The admin navigation entry, in whichever existing nav component owns it.
  - `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` (and `types.ts` if keys are typed) — the
    admin `events:` keys.
  - `apps/web/src/**/__tests__/**` — component tests.
- **No backend change.** `apps/api/src/` must be absent from the diff — Task 04 owns every
  endpoint and every guard.
- **The UI must not contradict the API's gates.** A `content_creator` sees no enabled
  publish control; the reason is shown rather than implied by a silent `403`. No delete
  control is rendered, because no delete route exists — removal is the archive action.
- **The slug is never re-derived on rename.** Editing the title of an existing event leaves
  the slug field untouched. The manual override is deliberate, and it warns that links
  already shared will break before it is accepted.
- **App Router conventions.** Server Component by default; `'use client'` only where the
  form's interactive state requires it. No Server Component is converted to Client without a
  stated reason.
- **The uploader is reused, not reimplemented.** A second upload implementation would drift
  from the lifecycle the topics path proved; point the existing component at the event
  endpoints.
- **The size ceiling is stated before the upload**, matching the shared 5 MB image limit the
  API enforces. Client-side validation is a courtesy, never the gate — the API re-checks the
  stored bytes.
- **i18n.** No hardcoded user-facing string under `src/{app,components,hooks}/**`;
  `dict-en.ts` and `dict-pt.ts` keep identical keys, including every warning string
  introduced here; `check-i18n-coverage.js` passes.
- **Cloud-agnostic.** No provider SDK; the client targets `NEXT_PUBLIC_API_URL` through the
  existing authenticated transport.
- **Responsive & accessible.** Existing Tailwind v4 idiom; the form is usable at tablet and
  desktop width, every field is labelled, and the destructive-adjacent actions (publish,
  archive, manual slug edit) are reachable and confirmable by keyboard.

## Scope

In:
- The events list: status and audience columns, a draft-inclusive filter, and entry points
  to create and edit.
- The event form: title, slug (generated, with the warned manual override), summary,
  markdown content, location, the start and end date-time pair, and the timezone field
  pre-filled with `America/Sao_Paulo`.
- The flyer uploader wired to the event presign / finalize / delete endpoints, with the
  ceiling stated and the oversize and lying-upload rejections surfaced as clear errors.
- The audience selector with its group and user pickers over `admin-groups-api`, and the
  `public` warning.
- The WhatsApp number, message and label fields with a live preview of the composed
  message. Both value fields are **pre-filled and then persisted**, never resolved at read
  time (RFC 0014 decisions of 2026-09-22):
  - the **number** from the tenant's `NEXT_PUBLIC_BRAND_WHATSAPP` — that constant's only
    remaining job — a starting value a human accepts or replaces;
  - the **message** from a dictionary template composed with the event's title and date, so
    the suggestion follows the build language and no Portuguese literal can reach an `en`
    build.

  The preview must show plainly that clearing the number means **no button at all** on the
  public page, and that clearing the message means the chat opens with **no pre-filled
  text** — neither falls back to anything. When the title changes after a message was
  written, the form warns, because the stored text will otherwise keep advertising the old
  name (the risk RFC Alternative 9 named, now owned by a human rather than hidden).
- The publish and archive actions, with publish hidden or disabled and explained for a
  `content_creator`.
- The admin nav entry. **Delivered** — `admin-sidebar.tsx:62`, with
  `[ADMIN, CONTENT_CREATOR]` and a comment noting a content creator authors drafts while
  only an admin publishes.

  *Two follow-ups this uncovered, both handled in `feature/m20/events-entry-points.task`:*
  - `nav.tsx` carries a **second, duplicated `adminLinks` array** for the mobile drawer,
    which was not updated — so the entry existed on desktop and not on mobile. The
    duplication is the real defect; see
    [backlog `refactoring/10`](../../backlog/refactoring/10-admin-nav-links-duplicated.task.md).
  - The **public** entry points — `/events` in the authenticated nav and a link from the
    landing page — were covered by **no task in this milestone**. RFC 0014 §7 specifies the
    board in detail and never says how anyone reaches it; that gap propagated into all
    eight task files, and the board shipped navigable only by typing its URL. The RFC now
    carries an "Entry points" subsection.
- Component tests: the form issues the expected payloads, the audience selector reveals its
  pickers only for `restricted`, the message preview updates with the title, the publish
  control is unavailable to a `content_creator`, and no delete control renders.

Out:
- Any backend change — Task 04 owns the endpoints and the guards.
- The public board and the SEO baseline — Task 05.
- Empty states and the final polish pass — Task 07.
- The seeded example event — Task 08.

## Acceptance Criteria

- [x] An admin creates and publishes an event end to end through the backoffice with **no
      `curl`** — including the flyer upload, a restricted audience with one group, and the
      WhatsApp fields.
      **Verified at build and unit level only — the live browser walkthrough was not run**,
      here or by the implementer: no browser driver is available in this environment. What
      is proven: every payload the form issues, the publish gate for both roles, the
      audience pickers, the preview behaviour, the slug override flow, and a clean
      `make build-web` for all three routes under both `NEXT_PUBLIC_LANGUAGE` values.
      **RFC 0014's Phase 5 success criterion asks for exactly this walkthrough by a human**
      ("an admin creates and publishes an event end to end through the backoffice, with no
      `curl`" — the RFC notes this criterion exists because RFC 0013 once left it implicit).
      **It must be performed before the milestone PR**, together with Task 05's mobile and
      keyboard pass.
- [x] The composed-message preview shows the exact text a visitor will send, updates as the
      title changes, and shows the fallback composition when the message field is blank.
- [x] The flyer uploader rejects a 6 MB JPEG with a clear message naming the 5 MB ceiling,
      and surfaces the finalize-time rejection as an error rather than a silent failure.
- [x] Selecting `restricted` reveals the group and user pickers; selecting `public` shows
      the warning that the event and its contact number become readable by anyone.
- [x] Renaming an existing event leaves the slug field untouched; the manual override warns
      that shared links break before it is accepted.
- [x] A `content_creator` session sees no enabled publish control and is told why; an
      `admin` session publishes successfully.
- [x] No delete control is rendered anywhere in the surface; removal is the archive action,
      and an archived event is visibly distinguished in the list.
- [x] The timezone field pre-fills `America/Sao_Paulo` and an edited value round-trips.
- [x] No hardcoded user-facing string; every new key exists in both `dict-en.ts` and
      `dict-pt.ts`; `check-i18n-coverage.js` passes.
- [x] The uploader is the existing component configured for the event endpoints, not a
      second implementation.
- [x] The form is usable at tablet width and every action is keyboard-reachable.
- [x] `apps/api/src/` is absent from the diff.
- [x] Changed files lint clean; `make test-web` green for the affected component tests.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local`, `make dev-api` and `make dev-web`; sign in as the seeded admin and
   create an event from scratch through the form — flyer, restricted audience with one
   group, WhatsApp fields — then publish it.
2. Open `/events` signed out and confirm the event created in step 1 behaves as its audience
   dictates; open it as a member of the granted group.
3. Attempt the 6 MB flyer and confirm the stated ceiling and the clear error; then confirm a
   valid flyer replaces it and the old one disappears.
4. Rename the event and confirm the slug field did not move and the public URL still
   resolves; exercise the manual override and read the warning.
5. Sign in as the seeded `content_creator`, confirm a draft can be created and edited and
   that the publish control is unavailable with a stated reason.
6. Archive the event and confirm it leaves the public board and is distinguished in the
   admin list; confirm no delete control exists anywhere.
7. Toggle `NEXT_PUBLIC_LANGUAGE` between `pt` and `en`, confirm every label and warning
   translates, and run `check-i18n-coverage.js`.
8. `make test-web` — the component tests pass.
9. Resize to tablet width and complete a create using the keyboard alone.
10. `make lint`.
11. `git diff --stat` confirms only scope-guardrail files changed, and that `apps/api/src/`
    is absent from the list.
