# Milestone 20 — Events board — public listing, access-scoped audiences and per-event WhatsApp contact

**Status:** ✅ Done
**Scope:** `apps/api` (events bounded context), `packages/shared` (events types/port + shared media/contact domain), `apps/web` (`(public)` + admin events UI). Derived from [RFC 0014](../../RFCs/0014-events-board-and-whatsapp-contact.md).

> **Hard scope guardrail — read before opening any task.** This milestone may touch **only**: `apps/api/migrations/0027_create_events.sql`; the new events files under `apps/api/src/{adapters/db/d1-event-repository.ts,controllers/events.controller.ts,controllers/admin-events.controller.ts,routes/events.router.ts,routes/admin/events.ts,middleware/optional-auth.ts}` and their wiring in `container.ts` / `routes/index.ts` / `routes/admin/index.ts`; the new shared code `packages/shared/{types/entities.ts (add Entities.Events + two enums),ports/i-event-repository.ts,ports/index.ts,domain/contact/whatsapp.ts,domain/media/limits.ts}`; `apps/web/src/app/(public)/**`, `apps/web/src/app/(protected)/admin/events/**`, `apps/web/src/lib/{events-api.ts,admin-events-api.ts}`, both i18n dictionaries, and the SEO baseline files (`robots.ts`, `sitemap.ts`, the `<html lang>` fix in `layout.tsx`); and, for the closeout only, a new local seed file under `apps/api/migrations/seed/`, the `db-seed-local` target in `Makefile`, `CLAUDE.md`'s media-limits sentence, `docs/product/FEATURES.md`, RFC 0014's `Status:` header and its `docs/product/RFCs/README.md` row. It may **edit** `admin-media.controller.ts` **only** to import the extracted `media/limits.ts`, `scripts/content/import-media.test.mjs` **only** to add the parity test that pins the importer's own table to it (the importer script itself is a zero-dependency stdlib script run without a build step and is **not** modified — see Task 01), and `apps/web/src/lib/brand.ts` **only** to re-export the moved `normalizeWhatsapp`. It is explicitly **not** an opportunity to: add pricing/invoicing/payment for an event or any FK to `subscriptions` (that is RFC 0015); build RSVP/attendance/capacity; grant content access from an audience row or touch `getEffectiveAccessTopicIds`, `d1-enrollment-repository.ts` or any `src/core/billing/` file; add recurring events, iCal, reminders or notifications; make the marketing landing page data-driven; or fix the identical declared-size upload hole in **topic** media (backlog item, not here). If a refactor opportunity is spotted outside this scope, file a separate task — do not bundle it.

---

## 1. Objectives

- **A first-class `events` entity, separate from the learning tree.** Date, description, flyer, status, audience and per-event contact — modelled so no event row can ever be reached by a topic/enrollment query (RFC §1, §3).
- **One anonymous read surface that answers *more* with a token.** `GET /v1/events`, `/{slug}`, `/{slug}/flyer` resolve audience server-side via `optionalAuth`; the logged-in "other list" is the difference between the two responses, not a second route (RFC §2, §6).
- **Three server-resolved audience levels — `public` / `members` / `restricted`.** Reusing `user_groups` (never `enrollments_*`), defaulting to `members` so a wrong default hides rather than leaks (RFC §1, §2).
- **A per-event flyer through the existing presign→PUT→finalize lifecycle, with a real size ceiling.** Flyer lives in columns on `events`; finalize re-checks the stored object's true size against the 5 MB image limit via `headObject` (RFC §3).
- **A stable, private flyer URL.** `GET /v1/events/{slug}/flyer` 302s to a fresh presigned GET, so a pasted link and its `og:image` keep previewing while the bucket stays private (RFC §4).
- **A per-event WhatsApp CTA, pre-identified.** Number and message resolved server-side from the event row (no runtime tenant fallback — the admin form pre-fills the tenant number and it is persisted); the message names the event so a lead arrives identified (RFC §5).
- **A shared single source of truth for media limits and WhatsApp normalisation.** `packages/shared/domain/media/limits.ts` and `.../contact/whatsapp.ts`, replacing the duplicated literals (RFC §3, §5).
- **A server-rendered, indexable public board with a minimal SEO baseline.** `(public)` route group, `robots.ts`, `sitemap.ts` over the `public` set, and the `<html lang>` fix; a "Próximos"/"Anteriores" tab pair over `?scope` (RFC §7, decisions #2/#3).
- **An admin backoffice to author, gate and publish events.** List + form with flyer uploader, audience selector, WhatsApp fields with live message preview, immutable-slug + timezone fields; publish is `admin`-only (RFC §6, §7, decisions #5/#6).
- **Full i18n coverage** across `dict-en`/`dict-pt`, enforced by `check-i18n-coverage.js` (RFC §7).

Out of scope (explicit, from RFC 0014 Non-Goals):
- **Pricing / invoicing / payment for an event** — RFC 0015 (extras), built on this `events.id`; `events` gets no money column and no `subscriptions` FK. Excluded so the "billing never touches access" invariant and RFC 0013 Alternative 10 stay intact.
- **RSVP / attendance / capacity / waiting list** — deferred to a future additive table; the WhatsApp button is the whole v1 funnel, and a half-built RSVP would compete with it.
- **Granting content access via an audience row** — audience is permission to *see an announcement*, never an enrollment; lives with the enrollment system if ever wanted.
- **Recurring events / series, iCal, reminders, notifications** — none changes this schema; deferred.
- **Making the marketing landing page data-driven** — separate effort; this milestone only removes the reason it is hardcoded.
- **Fixing the declared-size upload hole in topic media** — its own backlog item; touching the importer's upload path is out of scope here.

---

## 2. Functional Requirements

**Public read surface**
- `GET /v1/events` returns, with **no** `Authorization` header, exactly the `published` + `audience='public'` events; with a valid token, the union of `public` + `members` + events granted to the caller's groups/user, and nothing else.
- The list honours `?scope`: `upcoming` (default, `starts_at` ascending) and `past` (`starts_at` descending), where "past" is `COALESCE(ends_at, starts_at + 1 day) < now`. No write occurs when an event crosses into "past".
- `GET /v1/events/{slug}` returns one event with sanitised `content` and a resolved `contact` block; an event outside the caller's audience returns **404**, byte-identical to a non-existent slug.
- `GET /v1/events/{slug}/flyer` 302-redirects to a freshly presigned GET (TTL 1h) with `Cache-Control` `max-age=60` for `public` events and `no-store` otherwise; 404 when out of audience or no flyer.
- An **invalid/expired** token on any public route degrades to anonymous (public slice), never 401.
- The anonymous endpoints are IP-rate-limited (`CF-Connecting-IP`, 60 req/min); the 61st in a window is `429`.

**Contact resolution**
- `contact.number` = `events.whatsapp_number`, else `null` (no button). **No runtime tenant fallback** — the number is whatever the row stores; the tenant's number is a pre-filled value in the admin form, persisted onto the event like any other field (RFC 0014 decision of 2026-09-22: `NEXT_PUBLIC_BRAND_WHATSAPP` is a build-time variable of the *web* bundle that the Worker cannot read, and persisting keeps a published contact auditable). `contact.message` = `events.whatsapp_message` **as stored — the API composes nothing** (RFC 0014 decision of 2026-09-22, reversing Alternative 9: the Worker has no language context, so a server-composed default hardcoded one language and leaked Portuguese into an `en` build). An empty column means no pre-filled text. The admin form pre-fills the field from a dictionary template and persists what is submitted. `contact.label` = `events.contact_label` when set, else the dictionary default (`"Eu quero"` / `"I'm interested"`) — resolved in the web layer, since it is a translated UI string.
- A number that fails the shared 10–15-digit normalisation is rejected at write time.

**Admin surface**
- `admin`/`content_creator` may `GET`/`POST`/`PATCH` events and `PUT` audience and manage the flyer. Creating and editing a **draft** is open to both roles.
- The transition to `status='published'` is **`admin` only**; a `content_creator` attempting it gets `403`.
- Removal is `PATCH {status:'archived'}` only — there is **no** `DELETE /v1/admin/events/{id}`; the flyer object is retained.
- The `slug` is generated once at creation and never re-derived on rename; an explicit manual slug edit is possible and warns that it breaks shared links.
- `PUT /v1/admin/events/{id}/audience` replaces the whole grant set `{ audience, groupIds[], userIds[] }`.
- Flyer upload validates type/size against the shared limits **before** presign and re-checks the real object size at finalize; an oversize or lying upload is rejected `422 FileTooLarge` and leaves `flyer_status='pending'`.

**Web**
- `/events` and `/events/[slug]` are server-rendered; their markup carries the events for a crawler. Signed-out visitors see the `public` slice with a "sign in to see more" affordance; signed-in visitors see their full set as one board with restricted items marked.
- Event date/time renders in the event's own `timezone`. `generateMetadata` fills `og:title`/`og:description`/`og:image` (the stable `/flyer` route).
- `robots.ts` and `sitemap.ts` (over `public` published events) exist; `<html lang>` reflects `NEXT_PUBLIC_LANGUAGE`.
- No hardcoded user-facing strings; `dict-en`/`dict-pt` carry identical `events:` keys.

---

## 3. Acceptance Criteria

- [ ] `GET /v1/events` with no auth returns `200` and exactly the `published`+`public` set; with a student token, that set ∪ `members` ∪ the student's granted events, and nothing else.
- [ ] `GET /v1/events/{slug}` for an out-of-audience event returns `404` with a body byte-identical to a non-existent slug.
- [ ] A published event past `COALESCE(ends_at, starts_at + 1 day)` is absent from `?scope=upcoming` and present in `?scope=past`, with no row having been written on expiry.
- [ ] The 61st anonymous request from one IP inside the window returns `429`.
- [ ] A `content_creator` token can `POST` a draft and `PATCH` draft fields, but `PATCH {status:'published'}` returns `403`; the same from an `admin` token publishes.
- [ ] No `DELETE /v1/admin/events/{id}` route exists; `PATCH {status:'archived'}` removes the event from both `?scope` lists while its flyer object stays in R2.
- [ ] Renaming a published event via `PATCH` leaves its `slug` and public URL unchanged; a previously shared link still resolves.
- [ ] A 6 MB JPEG flyer is rejected `422 FileTooLarge` from the shared limits module; and a stored object exceeding the ceiling is rejected **at finalize** by re-reading its real size with `headObject`, the object removed and `flyer_status` left `'pending'`. (The original wording — "a client declaring `sizeBytes: 1024` then `PUT`-ing 50 MB" — described an attack the presigned URL never permitted: the SDK signs `ContentLength` as a *signed header*, so a PUT must match the declared size byte for byte. The reachable path to an oversize stored object is an out-of-band write, which is how the test exercises it. The finalize check is what makes the ceiling real either way.)
- [ ] `GET /v1/events/{slug}/flyer` returns a 302 to a presigned GET with the specified `Cache-Control`; the bucket is not world-readable.
- [ ] A signed-out visitor loads `/events`, opens an event and reaches WhatsApp with a message naming that event; the number is the one stored on that event's row. An event whose `whatsapp_number` is empty renders **no** button — it does not silently fall back to the tenant number.
- [ ] `curl` of `/events` (server-rendered HTML) contains event titles in the markup; `robots.ts`/`sitemap.ts` resolve; `<html lang>` matches `NEXT_PUBLIC_LANGUAGE`.
- [ ] `check-i18n-coverage.js` passes; `NEXT_PUBLIC_LANGUAGE=en` and default `pt` both render the board with no hardcoded string.
- [ ] `git grep -n "getEffectiveAccessTopicIds" apps/api/src` returns its pre-milestone baseline — 13 lines across 5 files (the definition in `d1-enrollment-repository.ts` plus 12 callers); no diff under `src/core/billing/` or in `d1-enrollment-repository.ts`.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] No diff outside the scope declared in the guardrail.

---

## 4. Specific Stack

- **Backend:** Cloudflare Workers + Hono; per-request adapters built in `buildApp(env)` (no module-scope state); controllers return `ControllerResult<T>` from `src/core/result.ts`. **Validation is `@hono/zod-openapi` `createRoute` + Zod schemas at the route layer — not `@ValidateBody`/`@Body` decorators, which do not exist in this codebase** (see `docs/product/backlog/refactoring/07-validatebody-documentation-drift.task.md`). New middleware `optionalAuth`; `KvRateLimiter` keyed on `CF-Connecting-IP`; `R2StorageAdapter.headObject` for the finalize size re-check; `sanitizeMarkdown` on `content` write.
- **Shared:** `packages/shared/types/entities.ts` gains `Entities.Events` + `Entities.Config.EventStatus`/`EventAudience`; new port `ports/i-event-repository.ts` (+ `ports/index.ts`); new pure domain `domain/contact/whatsapp.ts` (`normalizeWhatsapp`) and `domain/media/limits.ts` (allowed types + ceilings). No Cloudflare types in shared.
- **Database:** D1 migration `0027_create_events.sql` — `events` (+ flyer/contact columns), `event_audience_group`, `event_audience_user`, indexes. `D1EventRepository` implements the port, including the two audience queries and slug generation with collision suffixes.
- **Frontend:** Next.js 15 App Router (React 19, Tailwind v4) via `@cloudflare/next-on-pages`; a new `(public)` route group **server-rendered** for indexing; `generateMetadata` for OpenGraph; `robots.ts`/`sitemap.ts`; a bare (token-optional) transport in `src/lib/events-api.ts` since `fetchWithAuth` assumes a session; admin UI reuses the topics uploader and `admin-groups-api` pickers; both i18n dictionaries + `check-i18n-coverage.js`.
- **Tests:** Vitest + `@cloudflare/vitest-pool-workers` (API — the audience matrix, role gate, scope predicate, flyer size re-check, 404-not-403); Vitest + RTL (web — server-render markup, tabs, contact button).

---

## 5. Task Breakdown

Each task is one independent PR with one owner and one review surface. Backend and frontend never share a file, so RFC Phase 6 — planned above as a single "polish and docs" slice — lands as **two** tasks: the web polish (`07`, Frontend) and the seed plus documentation closeout (`08`, Backend).

| # | Task File | Phase | Team | Status |
|---|-----------|-------|------|--------|
| 01 | [Shared foundations — media limits, WhatsApp normalisation and event contracts](./01-shared-foundations.task.md) | 0 | Backend | ✅ Done |
| 02 | [Events schema and D1 repository](./02-schema-and-repository.task.md) | 1 | Backend | ✅ Done |
| 03 | [Anonymous events read API](./03-anonymous-read-api.task.md) | 2 | Backend | ✅ Done |
| 04 | [Admin events API and flyer lifecycle](./04-admin-api.task.md) | 3 | Backend | ✅ Done |
| 05 | [Public events board, detail page and SEO baseline](./05-public-web.task.md) | 4 | Frontend | ✅ Done |
| 06 | [Admin events backoffice](./06-admin-web.task.md) | 5 | Frontend | ✅ Done |
| 07 | [Board polish, empty and past-event states](./07-web-polish.task.md) | 6 | Frontend | ✅ Done |
| 08 | [Seeded example event and documentation closeout](./08-seed-and-docs.task.md) | 6 | Backend | ✅ Done |

Dependency graph:

```
01 ──► 02 ──► 03 ──► 04
               │      │
               ▼      ▼
              05     06 ──► 08
               │      │
               └──►07◄─┘
```

**Recommended execution order:** `01` → `02` → `03` → `04` → `05` → `06` → `07` → `08`. Backend (01–04) is shippable behind an unreferenced route before the board becomes visible in `05`; `05` depends on the read API (`03`), `06` on the admin API (`04`), and `07` closes out both web tasks. `08` depends on `04` for code (the seed must match the final schema and grant shape) but is **written last**, since its closeout note and the RFC status change assert the milestone is complete.

Each task is intended to land as an independent PR with `make lint`, `make test-api`, and `make test-web` passing.

---

## 6. Decisions recorded (from RFC 0014 "Resolved Decisions")

1. **An event is an announcement, not a product** — no price, no invoice, no enrollment; charging is RFC 0015, built on this `events.id`. Rules out any money column or `subscriptions` FK here.
2. **Extras revenue is RFC 0015, drafted after this** — it depends on the entity defined here, so the numbering follows the dependency.
3. **Contact button default reads "Eu quero"** (`"I'm interested"` in `dict-en`) — states intent and commits the reader; per-event `contact_label` can override. Both dictionaries must carry identical keys.
4. **Flyer ceiling stays at 5 MB**, reusing the single shared image limit — and the ceiling must be enforced against the **stored** object size at finalize (`headObject`), not the client-declared size, or it is nominal.
5. **"Past" is computed, not stored** — `COALESCE(ends_at, starts_at + 1 day) < now`; `?scope` moves a row between lists as the clock passes; no expiry sweep.
6. **Past events stay on the board behind an "Anteriores" tab** — history is vitrine; upcoming is the default view.
7. **The public board is indexed** — board + detail are server-rendered, with a minimal SEO baseline (`robots.ts`, `sitemap.ts`, `<html lang>` fix). Accepted tradeoff: event cadence becomes publicly visible.
8. **The event's own `timezone` renders it everywhere** (the only source an anonymous reader has); the admin form pre-fills the constant `America/Sao_Paulo`, documented as portable to `config/labels` or a DB config row with no change to rendering.
9. **Publishing is `admin`-only** — draft create/edit is open to `content_creator`; the `status → published` transition (which exposes a page + phone number to the internet) carries its own `requireRole(ADMIN)`, mirroring `admin/billing`.
10. **The slug is immutable on rename**, with an explicit manual override that warns it breaks shared links — an automatic re-slug would silently 404 circulating links.
11. **Removal is archive-only** — `status='archived'`, reversible and audit-preserving; no hard `DELETE` endpoint, so the flyer object can never be orphaned. A true purge is a deferred administrative sweep.

---

## 7. Definition of Done (milestone level)

- [ ] All tasks marked Done with every acceptance box checked.
- [ ] All milestone-level acceptance criteria in §3 pass.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] Closeout note written at `./closeout-analysis.md`.
- [ ] RFC 0014 status set to `Implemented` in its header and
      `docs/product/RFCs/README.md`; deferred items remain backlog.
- [ ] No diff outside the scope declared in the guardrail.
