# RFC 0014: Events board — public listing, access-scoped audiences and per-event WhatsApp contact

**Date:** 2026-09-16
**Status:** Draft
**Revised:** 2026-09-22
**Author:** raphaelsilva
**Affected:**
- `apps/api/migrations/0027_create_events.sql` (new) — `events`, `event_audience_group`, `event_audience_user`. The flyer lives in columns on `events`, not in `media`.
- `packages/shared/types/entities.ts` — new `Entities.Events` namespace and two `Entities.Config` enums (`EventStatus`, `EventAudience`).
- `packages/shared/ports/i-event-repository.ts` (new) + `ports/index.ts` — `IEventRepository`, the only contract the API talks to. No Cloudflare types.
- `packages/shared/domain/contact/whatsapp.ts` (new) — `normalizeWhatsapp` moved out of `apps/web/src/lib/brand.ts:76` so the API can validate the number the web renders.
- `packages/shared/domain/media/limits.ts` (new) — the allowed-type/size table, today duplicated between `apps/api/src/controllers/admin-media.controller.ts:14` and `scripts/content/import-media.mjs`.
- `apps/api/src/middleware/optional-auth.ts` (new) — sets `c.get('user')` when a valid Bearer is present, proceeds anonymously otherwise. The first middleware in the codebase that does not reject.
- `apps/api/src/adapters/db/d1-event-repository.ts` (new) — D1 implementation, including the audience resolver.
- `apps/api/src/controllers/events.controller.ts`, `admin-events.controller.ts` (new) + `routes/events.router.ts`, `routes/admin/events.ts` (new).
- `apps/api/src/container.ts` — new `events` bounded-context group and an `events` KV rate limiter, wired per-request like every other adapter.
- `apps/web/src/app/(public)/` (new route group) — `events/page.tsx`, `events/[slug]/page.tsx`; `(protected)/admin/events/` (new); `src/lib/events-api.ts`, `admin-events-api.ts`; `src/i18n/dict-en.ts` + `dict-pt.ts`.
- `apps/api/src/adapters/db/d1-enrollment-repository.ts`, `apps/api/src/controllers/topics.controller.ts`, every billing file — **unchanged**, deliberately. An event audience is not a content grant and carries no price.

---

## Summary

ArenaQuest has no way to announce anything with a date on it. A seminar, a graduation,
an open class or a visiting instructor's workshop is currently a message in a WhatsApp
group, and the platform — which knows exactly who the students are and which groups they
belong to — plays no part in it. This RFC adds an **events board**: an administrator
registers an event with a date, a description and a flyer, chooses who may see it, and
the platform renders it in two places at once — a page **open to the internet with no
login at all**, and the same board inside the product showing the additional events that
viewer is entitled to. Each event page carries a **WhatsApp button wired to that event's
own responsible number**, pre-filled with a message naming the event, so the person who
runs it receives the lead already identified.

The important consequence is scope: **an event is an announcement, not a product.** It has
no price, no invoice and no enrollment. Nothing here touches
`getEffectiveAccessTopicIds`, no route gains a billing guard, and the `events` table has
no money column. Charging for a seminar is the *next* RFC, and the entity it will point
at is the one defined here.

## Motivation

The `budo` tenant runs paid seminars, belt gradings and open classes. Announcing one
today means posting a flyer into a WhatsApp group and hoping it reaches the right people,
and every interested reply lands in whichever chat the poster happened to use — with no
indication of which event the person is asking about. Meanwhile the platform already
holds the two facts that would make this work: who the students are, and which
`user_groups` they belong to.

| Case | Covered today? |
|---|---|
| "Put the March seminar where anyone can find it, including people who are not students yet." | No. Every data endpoint under `/v1` requires a Bearer token — `catalog.topics.ts:68`, `catalog.tasks.ts:86`, `leaderboard.ts:63`. The only anonymous route in the Worker is `/health`. |
| "Show the black-belt-only training to the black belts, and nobody else." | No. `user_groups` exists and is already used for grants, but only `enrollments_user_group` consumes it, and that grants *topic content*, which is the wrong thing entirely. |
| "Upload the flyer the designer sent." | No. `media.topic_node_id` is `NOT NULL REFERENCES topic_nodes(id)` (`0006_create_media.sql:6`) — every uploaded byte in the product must hang off a topic in the learning tree. |
| "Send interested people to *the instructor who runs that event*." | No. There is exactly one WhatsApp number per deploy, `NEXT_PUBLIC_BRAND_WHATSAPP`, read at **build time** (`next.config.ts:17`, `brand.ts:76`) and baked into the static bundle. A second number requires a second build. |
| "Let me know which event a WhatsApp message is about." | Partly. The landing page already pre-fills a distinct message per CTA (`apps/web/src/lib/whatsapp.ts`), and that pattern is exactly right — but the CTAs are a hardcoded array in `page.tsx:105`, so it covers three fixed intents and no event. |
| "The flyer should show up when someone pastes the event link into WhatsApp." | No. There is no public page to paste, and media URLs are 1-hour presigned GETs, which a link preview cannot use. |

The through-line is that ArenaQuest is currently a **closed** product: everything it knows
is behind a login, and its one public page (`apps/web/src/app/page.tsx`) is a hand-written
brochure whose data is a TypeScript literal with a `TODO` on it (`page.tsx:37`). An event
is the first piece of content with a legitimate reason to be readable by someone who has
no account — that is the whole point of announcing it — and it is also the first piece of
content whose audience is a *group*, not a topic subtree.

## Goals & Non-Goals

**Goals**

- An `events` entity with a date, a description, a flyer image, a status and an audience.
- One anonymous read surface: `GET /v1/events` and `GET /v1/events/{slug}` answer without
  a token, and answer *more* when a valid token is present.
- Three audience levels — `public` (the internet), `members` (any authenticated user),
  `restricted` (named groups and users) — resolved server-side, never by the client.
- A flyer upload in the backoffice, going through the same `presign → PUT → finalize`
  lifecycle the topic media uploader uses, with the same type and size limits.
- A per-event WhatsApp number and message, so the button on the event page opens a chat
  with *that event's* responsible person, pre-identified by the event name.
- A stable flyer URL that survives being pasted into a chat (link previews, OpenGraph).
- Full i18n coverage (`dict-en` / `dict-pt`), enforced by `check-i18n-coverage.js`.

**Non-Goals**

- **Pricing, invoicing or payment for an event.** Recorded decision of 2026-09-12: an
  extra (seminar, one-off class) is a charge *for an event* and grants no content access.
  That is its own RFC, drafted on top of the `events.id` defined here. RFC 0013's
  Alternative 10 (per-topic pricing, rejected) stays unreversed.
- **Attendance, RSVP, capacity or a waiting list.** The WhatsApp button is deliberately
  the entire funnel for v1: the conversation is where the dojo already closes, and a
  half-built RSVP would compete with it. Revisit once there is volume to justify it.
- **Granting content access by attending an event.** An audience row is permission to
  *see an announcement*. It is not an enrollment and must never be read as one.
- **Recurring events / series.** A weekly class is the timetable, not an announcement.
- **Calendar export (iCal), reminders, notifications.** Deferred; none of them changes
  the schema proposed here.
- **Making the existing marketing landing page data-driven.** Out of scope, though this
  RFC removes the main reason it is hardcoded.

## Current State (for reference)

**1. There is no anonymous data surface.** `apps/api/src/routes/public/` is named for its
*audience within the product* — non-admin — not for anonymity. All three of its routers
install `authGuard` on every path they own (`catalog.topics.ts:68-69`,
`catalog.tasks.ts:85-86`, `leaderboard.ts:63-64`), and `authGuard`
(`apps/api/src/middleware/auth-guard.ts`) returns `401` on a missing or invalid token with
no pass-through branch. `/health` is the only route mounted outside `/v1`
(`routes/index.ts:64`) and returns no business data.

**2. Audience is currently a property of the learning tree.** Visibility resolution lives
in one recursive CTE, `D1EnrollmentRepository.getEffectiveAccessTopicIds`
(`d1-enrollment-repository.ts:52`), computing `(allow_tree ∪ public_set) − private_set`
over `topic_nodes`. Every column it reads — `enrollments_user.topic_node_id`,
`enrollments_user_group.topic_node_id`, `topic_nodes.visibility` — is bound to a topic.
`user_groups` / `user_group_members` (`0011_create_enrollment_tables.sql`) are general
purpose and reusable; the `enrollments_*` tables are not.

Note also that `Entities.Config.TopicVisibility.PUBLIC` means *"any authenticated user"*
(`entities.ts:26`), not "anonymous". The word is already taken in this codebase with a
weaker meaning, which is why this RFC uses `EventAudience.PUBLIC` for genuine anonymity
and spells the middle level `members`.

**3. All media belongs to a topic.** `media.topic_node_id TEXT NOT NULL REFERENCES
topic_nodes(id) ON DELETE CASCADE` (`0006_create_media.sql:6`), and the storage key is
built as `topics/${topicId}/${mediaId}-${safeName}`
(`admin-media.controller.ts:98`). `IMediaRepository` has exactly one list method,
`listByTopic`. The upload lifecycle itself — `presignUpload` → client `PUT` → `finalizeUpload`
— is sound and worth reusing; its *ownership model* is not.

The allowed types and size ceilings are a literal in
`admin-media.controller.ts:13-20` (`image/jpeg|png|webp` ≤ 5 MB, `application/pdf`
≤ 25 MB, `video/mp4` ≤ 100 MB). `CLAUDE.md` names that file "the source of truth", yet
`scripts/content/import-media.mjs` carries a second copy in `validateMediaFile`. A third
copy for events would settle the matter the wrong way.

**4. One WhatsApp number per build.** `brand.whatsapp` is
`normalizeWhatsapp(process.env.NEXT_PUBLIC_BRAND_WHATSAPP)` (`brand.ts:76`), threaded
through `next.config.ts:17` and therefore fixed for the lifetime of a deployed bundle.
`whatsappLink(number, message)` (`apps/web/src/lib/whatsapp.ts`) is already correct and
already documents the insight this RFC scales up: *"the pre-filled text is the only
attribution we get for free"*. Its callers are the three hardcoded `CONTACT_INTENTS` of
the landing page (`page.tsx:105`), rendered only when a number resolves (`page.tsx:588`).

**5. The web app has no public route group.** `src/app/` contains `(auth)` and
`(protected)` only; there is no `middleware.ts`, so the gate is the client-side redirect
in `(protected)/layout.tsx:16-20`. Adding a `(public)` group is therefore purely
additive — there is no guard to bypass and none to weaken. `ApiClient`
(`src/lib/api-client.ts`) is `'use client'` and routes everything through
`fetchWithAuth`, which assumes a token and a refresh function.

**6. There is no SEO baseline.** `apps/web` has no `robots.ts` and no `sitemap.ts`, and
exactly two `metadata` exports in the whole app — the root `layout.tsx:30` and
`(protected)/dashboard/page.tsx:4` — neither of which sets an OpenGraph tag. `layout.tsx:41`
hardcodes `<html lang="en">` although the default build language is `pt`
(`next.config.ts:11`). None of this has mattered while every page was behind a login. The
first page meant to be read by strangers is also the first page for which it matters, which
is why the indexing decision (Resolved Decisions #3, 2026-09-22) is a build task, not only a
product call — it makes §7 server-rendered.

## Proposed Design

### 1. Schema (`0027_create_events.sql`)

```sql
CREATE TABLE IF NOT EXISTS events (
  id               TEXT NOT NULL PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  summary          TEXT NOT NULL DEFAULT '',          -- plain text, the list card blurb
  content          TEXT NOT NULL DEFAULT '',          -- markdown, sanitizeMarkdown on write
  location         TEXT NOT NULL DEFAULT '',
  starts_at        TEXT NOT NULL,                     -- ISO-8601 UTC instant
  ends_at          TEXT,                              -- nullable: an event may be open-ended
  timezone         TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','published','archived')),
  audience         TEXT NOT NULL DEFAULT 'members'
                     CHECK (audience IN ('public','members','restricted')),

  -- Flyer: exactly one image per event, owned by the row (see §3).
  flyer_status     TEXT NOT NULL DEFAULT 'none'
                     CHECK (flyer_status IN ('none','pending','ready')),
  flyer_key        TEXT,
  flyer_type       TEXT,
  flyer_size_bytes INTEGER,
  flyer_name       TEXT,

  -- Contact: the responsible person for THIS event (see §5).
  whatsapp_number  TEXT NOT NULL DEFAULT '',          -- normalised digits, or '' to fall back
  whatsapp_message TEXT,                              -- NULL → composed from the title at read time
  contact_label    TEXT NOT NULL DEFAULT '',          -- '' → the dictionary default

  created_by       TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_listing ON events (status, audience, starts_at);

-- Audience grants. Deliberately NOT the enrollments_* tables: these say
-- "may see this announcement", never "may open this content".
CREATE TABLE IF NOT EXISTS event_audience_group (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, group_id)
);

CREATE TABLE IF NOT EXISTS event_audience_user (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_audience_group_group ON event_audience_group (group_id);
CREATE INDEX IF NOT EXISTS idx_event_audience_user_user   ON event_audience_user (user_id);
```

`audience` defaults to `members`, not `public`: the failure mode of a wrong default must
be "fewer people saw it", never "we published a private grading to the internet".

`starts_at` is a UTC instant and `timezone` is stored alongside it so the board renders
"19:30" for the dojo regardless of the reader's device — and it is the *only* zone an
anonymous reader can be shown in, since a logged-out visitor carries no `users.timezone`.
Both columns are needed: the instant orders the list correctly, the zone renders it
correctly. The admin form pre-fills the zone with a constant (`America/Sao_Paulo`) for v1;
that default is portable to `config/labels/<label>.jsonc` or a config row later without
changing this column's meaning (§7, decision of 2026-09-22).

### 2. Audience resolution

One resolver, server-side, mirroring the shape of `getEffectiveAccessTopicIds` but over a
different graph. For an anonymous caller it is a constant:

```sql
-- anonymous: userId IS NULL; :now is the request instant
SELECT * FROM events
 WHERE status = 'published' AND audience = 'public'
   AND COALESCE(ends_at, datetime(starts_at, '+1 day')) >= :now   -- scope='upcoming'
 ORDER BY starts_at ASC;
```

and for an authenticated caller, the union of the three levels:

```sql
SELECT e.* FROM events e
 WHERE e.status = 'published'
   AND COALESCE(e.ends_at, datetime(e.starts_at, '+1 day')) >= :now   -- scope='upcoming'
   AND ( e.audience IN ('public','members')
      OR EXISTS (SELECT 1 FROM event_audience_user  au
                  WHERE au.event_id = e.id AND au.user_id = ?1)
      OR EXISTS (SELECT 1 FROM event_audience_group ag
                  JOIN user_group_members ugm ON ugm.group_id = ag.group_id
                 WHERE ag.event_id = e.id AND ugm.user_id = ?1) )
 ORDER BY e.starts_at ASC;
```

**"Past" is a computed predicate, not a column** (decision of 2026-09-22). An event is
past when `COALESCE(ends_at, starts_at + 1 day) < now`: an explicit end wins, and an
event left open-ended — `ends_at` is nullable by design, since a seminar rarely commits
to a closing time — expires the day after it starts rather than lingering forever.
`?scope=past` inverts the comparison (`< :now`) and orders `starts_at DESC`; `upcoming`
is the default. Nothing is written on expiry — the same row simply moves between the two
lists as the clock passes it, so there is no sweep to run and no state to keep in sync.

An admin or `content_creator` reading the **admin** surface bypasses this entirely and
sees drafts, exactly as `topics.controller.ts:36` documents for topics.

Detail reads return **404, not 403**, for an event the caller may not see — matching
`topics.controller.ts:61` and denying an enumeration oracle on a surface that is open to
the internet.

### 3. The flyer

A flyer is one image owned by one event, so it lives in columns on `events` rather than
in the `media` table. Three reasons: `media.topic_node_id` is `NOT NULL` and SQLite cannot
relax a `NOT NULL` without rebuilding the table (see Alternative 1); an event never needs
a gallery, so the one-to-many machinery would be dead weight; and keeping events out of
`media` guarantees no events row can ever be reached by a topic/enrollment query by
accident.

The **lifecycle is reused unchanged**, because it is the part that is hard to get right:

1. `POST /v1/admin/events/{id}/flyer/presign` → validates type and size against the
   shared limits, writes `flyer_status = 'pending'` plus the key
   `events/{eventId}/{nonce}-{safeName}`, returns a presigned `PUT` URL. `sanitizeFileName`
   (`admin-media.controller.ts:32`) is reused as-is.
2. The browser `PUT`s the bytes straight to R2.
3. `POST /v1/admin/events/{id}/flyer/finalize` → `HEAD`s the object, **compares its real
   size against the ceiling**, flips `flyer_status = 'ready'`, and deletes the
   previously-ready key if this was a replacement.

Step 3 is stricter than the topic path it borrows from, deliberately. `finalizeUpload`
today calls `objectExists` (`admin-media.controller.ts:129`), which answers only whether a
key is there, and the presign is signed with the **client-declared** `sizeBytes` rather
than the ceiling (`:103`) — so the 5 MB limit is enforced against a number the client sent,
not against the bytes it stored. The event path instead calls
`IStorageAdapter.headObject(key)`, which already returns a top-level `size`
(`r2-storage-adapter.ts:161-170`); a flyer whose stored object exceeds the ceiling is
deleted and rejected with the same `422 FileTooLarge` shape, leaving `flyer_status` at
`'pending'`. No new port method is needed. The identical gap on topic media belongs in its own
backlog item — fixing it means touching an upload path used by the bulk importer, which is
not this RFC's risk to take, though the shared limits module of §3 makes it a one-line fix
once someone does.

Type and size come from a new `packages/shared/domain/media/limits.ts`, which becomes the
single source of truth that `CLAUDE.md` already claims exists; `admin-media.controller.ts`
imports it instead of its literal, and `import-media.mjs`'s `validateMediaFile` is
rewritten against the same table. Flyers accept **images only** — `image/jpeg`,
`image/png`, `image/webp`, ≤ 5 MB — reusing the existing image ceiling rather than
inventing a second one — 5 MB was confirmed for flyers on 2026-09-20 (Resolved Decisions).

### 4. Serving the flyer: a stable URL

Topic media is served as a 1-hour presigned GET (`topics.controller.ts:79`), which is
correct for a logged-in reader and useless for a public page: a link pasted into WhatsApp
renders its preview hours or days later, and a signed URL in an OpenGraph tag is dead on
arrival. `R2_PUBLIC_BASE` is not a way out — it is set to the S3 endpoint and is empty in
most environments (`wrangler.jsonc:42`), and making the bucket world-readable would expose
every topic video too.

So the flyer gets a **stable route that redirects**:

```
GET /v1/events/{slug}/flyer  →  302  →  freshly minted presigned GET (TTL 1h)
```

The URL in the page and in the `og:image` tag never changes, the bucket stays private,
the audience check runs on every hit, and the redirect target is short-lived. `Cache-Control`
is set on the 302 — a minute for a `public` event, `no-store` otherwise — so a burst on a
shared link does not become a burst of signatures.

### 5. The WhatsApp CTA

The event detail response carries a resolved contact block, or `null`:

```ts
contact: {
  number: string;   // normalised digits, ready for wa.me
  message: string;  // pre-filled first message
  label: string;    // button text
} | null
```

Resolution, server-side, so the rule lives in one place:

- **number** — `events.whatsapp_number` when set, else the tenant's build-time
  `NEXT_PUBLIC_BRAND_WHATSAPP`, else `null` and no button is rendered (the same
  degradation `page.tsx:588` already implements).
- **message** — `events.whatsapp_message` when the admin wrote one, else composed from the
  event: `Olá! Tenho interesse no evento "{title}" ({date}).` Storing `NULL` rather than
  the rendered default means renaming the event does not strand a stale message.
- **label** — `events.contact_label` when set, else the dictionary default, resolved by
  the web layer so it follows the build language. The default is **"Eu quero"** (decided
  2026-09-20); `dict-en` carries its own sibling string, since identical keys across both
  dictionaries are enforced by `check-i18n-coverage.js` and a Portuguese literal must not
  reach an English build.

The web side calls the existing `whatsappLink(number, message)` unchanged. Validation of
the number moves into `packages/shared/domain/contact/whatsapp.ts`, lifted verbatim from
`brand.ts:76` including its "10–15 digits or treat as unset" rule, so the API rejects at
write time exactly what the web would have refused to render — `brand.ts` re-exports it and
its behaviour is unchanged.

This is the part the administrator actually asked for: because the number is per event,
a seminar run by a visiting instructor sends its leads to that instructor, and because the
message names the event, whoever receives it knows which flyer produced it without asking.

### 6. HTTP surface

Anonymous, mounted at `/v1/events` **outside** `routes/public/` — that directory means
"non-admin, authenticated" today and re-using it would blur a security boundary:

| Method | Path | Auth | Returns |
|---|---|---|---|
| `GET` | `/v1/events` | optional | Audience-scoped list; `?scope=upcoming` (default, `starts_at` ascending) or `?scope=past` (the "Anteriores" tab, `starts_at` descending) per §2; paginated |
| `GET` | `/v1/events/{slug}` | optional | One event + sanitised `content` + resolved `contact`; 404 when out of audience |
| `GET` | `/v1/events/{slug}/flyer` | optional | 302 to a presigned GET; 404 when out of audience or no flyer |

Admin, under the `/v1/admin` umbrella (`authGuard` + `requireRole(ADMIN, CONTENT_CREATOR)`,
`routes/admin/index.ts:22`), **plus a publish gate** (decision of 2026-09-22): a
content creator may create and edit drafts, but the transition to `published` — the act
that puts a page on the open internet with a person's phone number — is `admin` only. The
router carries its own `requireRole(ADMIN)` on the publish path, exactly as
`admin/billing` does (`routes/admin/index.ts:34`):

| Method | Path | Role | Returns |
|---|---|---|---|
| `GET` | `/v1/admin/events` | admin · content_creator | All events, drafts included |
| `POST` | `/v1/admin/events` | admin · content_creator | Create a `draft` |
| `PATCH` | `/v1/admin/events/{id}` | admin · content_creator (draft fields) · **admin only** (`status → published`) | Edit; publish or archive |
| `PUT` | `/v1/admin/events/{id}/audience` | admin · content_creator | Replaces the grant set: `{ audience, groupIds[], userIds[] }` |
| `POST` | `/v1/admin/events/{id}/flyer/presign` · `/finalize` · `DELETE .../flyer` | admin · content_creator | §3 |

**There is no `DELETE /v1/admin/events/{id}`** (decision of 2026-09-22). Removal is
`PATCH {status: 'archived'}`: an archived event leaves the board and the "Anteriores" tab,
is reversible, keeps its audit trail, and — decisively — cannot orphan its flyer object in
R2, because the row and the object stay together. Truly purging a test event and its
object is deferred to a later administrative sweep; it is not a v1 endpoint. The one
`DELETE` that remains is `.../flyer`, which already cleans its own object (§3).

**One endpoint, two lists.** `GET /v1/events` deliberately does not split into a public
and a private variant. The client never decides what it is allowed to see; it sends
whatever token it has and the server returns the union. The "other list for logged-in
users" the product asks for is the *difference between the two responses*, not a second
route.

Two supporting pieces:

- **`optionalAuth`** (`apps/api/src/middleware/optional-auth.ts`) — verifies a Bearer when
  present and sets `c.get('user')`, and calls `next()` regardless. An **invalid** token is
  treated as anonymous rather than rejected, so an expired session degrades a public page
  to its public content instead of erroring; the browser still refreshes on its own
  schedule.
- **Rate limiting** — the first endpoints reachable without an account get a `KvRateLimiter`
  keyed on `CF-Connecting-IP` (60 requests/minute), registered in `container.ts` beside the
  four existing limiters (`container.ts:238-251`). CORS needs no change: the same
  `OriginPolicy` applies, and an anonymous GET from an allowed origin already passes.

### 7. Web surface

**Public** — a new `(public)` route group, which is purely additive since the auth gate is
`(protected)/layout.tsx`, not a middleware. The board and detail pages are **server-rendered**
(decision of 2026-09-22, Current State §6): the whole point of a public board is to be found,
and the client-side fetch of the earlier draft rendered an empty shell to a crawler. So:

- `/events` — the board, rendered on the server so its markup carries the events. Cards:
  flyer thumbnail, date, title, summary, and an audience chip for anything beyond `public`.
  A **"Próximos" / "Anteriores"** tab pair switches `?scope` (decision #2): upcoming is the
  default; the history tab is deliberate vitrine — a first-time visitor sees the dojo is
  active. Signed-out visitors see the `public` slice with a "sign in to see more"
  affordance; signed-in visitors see their full set as one board with the restricted items
  marked, not as two disconnected tables.
- `/events/[slug]` — flyer, formatted date/time/location, sanitised markdown body, and the
  WhatsApp button. `generateMetadata` fills `og:title` / `og:description` / `og:image`, the
  last pointing at the stable `/flyer` route from §4. The date/time is rendered in the
  **event's own `timezone`**, the only source available to an anonymous reader (§1 schema).
- A minimal **SEO baseline** ships with this group: `robots.ts`, a `sitemap.ts` enumerating
  the `public` published events, and a fix for the hardcoded `<html lang="en">`
  (`layout.tsx:45`) so it reflects `NEXT_PUBLIC_LANGUAGE` (`pt` by default).
- The `(public)` layout renders the full `<Nav/>` when a user is resolved and a minimal
  header otherwise, so one page serves both readers.

**Data access** — the server component fetches with no token for the initial, indexable
render (the `public` slice); on the client, `src/lib/events-api.ts` re-fetches the
audience-scoped superset when a session exists, attaching the Bearer *when one exists* and
omitting the refresh/expiry callbacks otherwise. `ApiClient` gains an `events` namespace
for the authenticated case. This is the only new shape in the web client and it exists
precisely because `fetchWithAuth` assumes a session.

**Admin** — `(protected)/admin/events`, following the topics backoffice: a list with status
and audience columns, and a form with the date/time pair, markdown editor, the flyer
uploader (the existing uploader component, pointed at the event endpoints), an audience
selector (`public` / `members` / `restricted` + group and user pickers over
`admin-groups-api`), and the WhatsApp fields with a live preview of the composed message —
the admin should see the exact text a visitor will send before publishing. Two more
fields carry decisions of 2026-09-22: a **slug** field that is generated from the title at
creation and **never re-derived on rename** (an explicit manual edit is allowed, for a
typo, with a warning that it breaks links already shared — the URL is public and pasted
into WhatsApp, so an automatic re-slug would silently 404 every circulating link); and a
**timezone** field pre-filled with the constant `America/Sao_Paulo`, editable per event.
That default is intentionally a constant for v1 and is documented as portable — it can
later be sourced from the tenant profile in `config/labels/<label>.jsonc` or from a
configuration row in the database, with **no change to how an event renders**, since the
stored `events.timezone` remains the source of truth on read.

**i18n** — a new `events:` section in `dict-en.ts` and `dict-pt.ts` with identical keys, no
hardcoded strings in `src/{app,components,hooks}/**`, enforced by `check-i18n-coverage.js`.

## Alternatives Considered

1. **Hang the flyer off `media` by relaxing `topic_node_id`.** Rejected for now. SQLite
   cannot drop a `NOT NULL` in place; it needs a full table rebuild of the most
   heavily-referenced table in the product, plus a polymorphic `owner_type`/`owner_id`
   pair that every existing media query would have to learn about. The cost lands entirely
   on the topic tree to serve one image. Revisit if a second non-topic media owner appears
   — at two owners the polymorphic column is right and this RFC's columns become its first
   migration.

2. **A dedicated `event_media` table with its own repository.** Deferred, not rejected. It
   is the correct shape the moment an event needs more than one image (a gallery, a PDF
   programme). Today it is a table, a port, an adapter and a controller to hold exactly one
   nullable image. The columns in §1 promote to a table without changing any route.

3. **Create a hidden `topic_node` per event and reuse media wholesale.** Rejected. It puts
   non-content rows inside the learning tree, where `getEffectiveAccessTopicIds`,
   the catalog, progress and enrollment queries would all have to learn to ignore them —
   a permanent tax on five subsystems, paid to avoid one migration.

4. **Reuse `enrollments_user_group` for the audience.** Rejected on meaning, not on
   mechanics. Its column is `topic_node_id`; making it polymorphic would mean "may see this
   announcement" and "may open this content" become one row, and the first person to write
   a join against it will get that wrong. Separate tables make the distinction
   unfalsifiable. `user_groups` itself *is* reused — that is the part worth sharing.

5. **Two endpoints: `/v1/public/events` and `/v1/events`.** Rejected. It puts the client in
   charge of asking the right question, and the wrong question is a silent data leak rather
   than an error. One endpoint plus `optionalAuth` has one code path and one test matrix.

6. **A single tenant-wide WhatsApp number, as today.** Rejected — it is the core of the
   request. An event run by a visiting instructor must not route its leads to the dojo's
   main line. The tenant number survives as the *fallback* when an event names none.

7. **An in-product RSVP / attendance list instead of the WhatsApp button.** Deferred. The
   dojo closes in conversation, and an RSVP that nobody presses is worse than no RSVP —
   it makes the board look empty. When there is enough traffic to justify it, it becomes an
   additive table; the button stays either way.

8. **Make the bucket public and serve flyers from `R2_PUBLIC_BASE`.** Rejected. One bucket
   holds flyers *and* every topic video and PDF; making it world-readable to fix a link
   preview would expose the content the enrollment system exists to protect. The §4 redirect
   gets a stable URL with the bucket still private.

9. **Store the composed WhatsApp message at creation time.** Rejected. Renaming an event
   would leave a message advertising the old name, and the divergence is invisible until a
   student quotes it back. `NULL` means "compose from the current title".

10. **Model the event as a `TopicNode` with a date.** Rejected. A topic is a node in a
    learning hierarchy with progress, prerequisites, comments and XP hanging off it. An
    event has a date and a phone number. The overlap is that both have a title and markdown.

## Implementation Plan

Total **~7 dev days**, six phases. Phases 0–3 are shippable behind an unreferenced route;
the board only becomes visible in Phase 4.

### Phase 0 — Shared foundations (~0.5 d)
`Entities.Events` namespace and the `EventStatus` / `EventAudience` enums;
`IEventRepository` port; `normalizeWhatsapp` moved to
`packages/shared/domain/contact/whatsapp.ts` with `brand.ts` re-exporting it; media limits
extracted to `packages/shared/domain/media/limits.ts` and
`admin-media.controller.ts` switched to import them. Pure, unit-testable, no Worker.

### Phase 1 — Schema and repository (~1 d)
Migration `0027`, `D1EventRepository` including the two audience queries from §2 and slug
generation with collision suffixes. Repository tests against the Workers pool.

### Phase 2 — Anonymous read API (~1 d)
`optionalAuth`; `events.controller.ts`; `GET /v1/events`, `/{slug}`, `/{slug}/flyer`; the
IP rate limiter. Test matrix: anonymous × each audience, member × each audience,
granted-user, granted-group, non-granted, draft, expired token, and the 404-not-403
assertion.

### Phase 3 — Admin API (~1 d)
`admin-events.controller.ts`, CRUD, `PUT .../audience`, the flyer presign/finalize/delete
trio, `sanitizeMarkdown` on `content` write, container wiring.

### Phase 4 — Public web (~1.5 d)
`(public)` route group, board and detail pages, the unauthenticated transport, the WhatsApp
button, OpenGraph metadata, `events:` dictionary entries in both languages.

### Phase 5 — Admin web (~1.5 d)
`(protected)/admin/events` list and form, flyer uploader, audience selector over
`admin-groups-api`, WhatsApp fields with the composed-message preview, nav entry.

### Phase 6 — Polish and documentation (~0.5 d)
Empty and past-event states, `docs/product/FEATURES.md`, `CLAUDE.md` note that media limits
now live in `packages/shared`, and a seeded example event for `make db-seed-local`.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| **A restricted event leaks to the internet.** The first anonymous endpoint in the product is also the one carrying an audience rule. | `audience` defaults to `members`, never `public`. The resolver is server-side and the anonymous branch is a literal `audience = 'public'` filter, not a client parameter. Detail and flyer reads return 404 rather than 403. The audience matrix is a required test in Phase 2. |
| **The anonymous endpoints are an abuse surface** — no account, no cost to the caller. | IP-keyed `KvRateLimiter` at 60 rpm, reusing the adapter already guarding login. Responses are small and indexed (`idx_events_listing`); the flyer route 302s rather than proxying bytes. |
| **Flyer columns on `events` become the wrong shape** if events later need several images. | Alternative 2 is the pre-agreed exit: the columns promote to `event_media` with no route change. The decision is recorded rather than defaulted into. |
| **Duplicating the media limits a third time** would entrench the drift `CLAUDE.md` already mis-describes. | Phase 0 extracts them first and migrates both existing copies; the event code never gets its own literal. |
| **A per-event phone number is personal data** entered by an admin and served to the internet. | Only the digits needed for `wa.me` are stored and returned, on `published` events the caller can already see; it is never joined to a user row. An admin publishing an instructor's number is doing so deliberately — the form says so. |
| **The 302 flyer route mints a signature per request** under a viral link. | `Cache-Control: public, max-age=60` on the redirect for `public` events; `no-store` otherwise. Presigning is CPU-only, no R2 round trip. |
| **A stale OpenGraph preview** persists after a flyer is replaced, since the URL is stable by design. | Accepted. WhatsApp and the social crawlers cache previews for hours either way; a changing URL would break the link instead, which is worse. |
| **A declared-size ceiling is not a ceiling.** The 5 MB limit is decided, but the existing upload path checks the number the client sends, not the bytes it stores. | §3 re-checks the real object size with `headObject` at finalize and rejects with `422 FileTooLarge`; the matching Success Criterion asserts a lying client is refused, so the decision is testable rather than nominal. |
| **Scope creep toward selling tickets** during implementation. | The Non-Goals are enforceable: `events` has no money column and no FK to `subscriptions`. Anything charged goes through the extras RFC, which reads `events.id`. |

## Success Criteria

- **Phase 2** — `curl -s $API/v1/events` with **no `Authorization` header** returns
  `200` and exactly the `published` + `audience='public'` set. The same call with a
  student's token returns that set plus `members` events plus the events granted to that
  student's groups, and nothing else. A `GET /v1/events/{slug}` for an event outside the
  caller's audience returns `404`, and the response body is byte-identical to the one for a
  slug that does not exist.
- **Phase 2** — the 61st request in a minute from one IP returns `429`.
- **Phase 3** — an admin creates an event, uploads a flyer through
  `presign → PUT → finalize`, sets `audience='restricted'` with one group, and publishes,
  using only the API; a member of that group sees it and a non-member gets `404`.
- **Phase 3** — a `content_creator` token can `POST` a draft and `PATCH` its fields, but a
  `PATCH {status:'published'}` from that token returns `403`; the same call from an `admin`
  token publishes. There is no `DELETE /v1/admin/events/{id}` route; `PATCH
  {status:'archived'}` removes an event from both `?scope` lists while its flyer object
  remains in R2.
- **Phase 2** — a published event whose `ends_at` (or, when null, `starts_at + 1 day`) is in
  the past is absent from the default `?scope=upcoming` list and present in `?scope=past`,
  with no write having occurred on expiry.
- **Phase 4** — renaming a published event via `PATCH` leaves its `slug`, and therefore its
  public URL, unchanged; a previously shared link still resolves.
- **Phase 3** — a flyer upload of a 6 MB JPEG is rejected with the same `422 FileTooLarge`
  shape the topic uploader returns, from the same shared limits module.
- **Phase 3** — a client that presigns declaring `sizeBytes: 1024`, `PUT`s a 50 MB object
  and then calls finalize is rejected with `422 FileTooLarge`, the object is removed and
  `flyer_status` stays `'pending'`. This is the assertion that makes the 5 MB decision real;
  without it the ceiling is a client-side suggestion.
- **Phase 4** — a signed-out visitor loads `/events`, opens an event and lands on
  WhatsApp with a message naming that event, having never authenticated. The number in the
  URL is the event's own, not `NEXT_PUBLIC_BRAND_WHATSAPP`.
- **Phase 4** — pasting an event URL into WhatsApp renders a preview with the flyer, and
  the same URL still previews 24 hours later.
- **Phase 4** — `check-i18n-coverage.js` passes; `NEXT_PUBLIC_LANGUAGE=en` and the default
  `pt` build both render the board with no hardcoded string.
- **Phase 5** — an admin creates and publishes an event end to end through the backoffice,
  with no `curl`. (RFC 0013's revision note exists because this criterion was once left
  implicit.)
- **Throughout** — `git diff` touches neither `d1-enrollment-repository.ts` nor any file
  under `src/core/billing/`, and `grep -rn "getEffectiveAccessTopicIds" apps/api/src` returns
  the same four call sites it does today.

## Resolved Decisions

- **2026-09-12 (product owner)** — an extra (seminar, one-off class) is a charge *for an
  event* and grants no content access. This RFC supplies the event; the charge is the
  following RFC. RFC 0013's Alternative 10 is not reversed.
- **2026-09-16 (this RFC)** — the extras/one-off revenue proposal, previously penciled in as
  RFC 0014, moves to **RFC 0015**: it depends on the entity defined here, so it is drafted
  after it rather than before.
- **2026-09-20 (product owner)** — the contact button reads **"Eu quero"**, not "Entrar em
  contato": it states an intent and commits the reader, which is the behaviour the button
  exists to produce. It ships as the `contact_label` default in the dictionary, so an
  individual event can still override it (§5). Consequence for Phase 4: `dict-en` and
  `dict-pt` must hold **identical keys** (`check-i18n-coverage.js`), so the English build
  needs a real sibling string — "Eu quero" cannot leak into an `NEXT_PUBLIC_LANGUAGE=en`
  build. Proposed: `"I'm interested"`.
- **2026-09-20 (product owner)** — the flyer ceiling stays at **5 MB**, reusing the existing
  image limit rather than raising it. A designer's export above 5 MB is resized before
  upload, and the admin form says so. This keeps `packages/shared/domain/media/limits.ts`
  (§3) a single table with one image ceiling for both topics and events.
  **But the decision is not yet true in the code, and this RFC now has to make it true.**
  The ceiling today is checked only against the size the *client declares*:
  `admin-media.controller.ts:87` compares `body.sizeBytes` to `SIZE_LIMIT_BYTES`, the
  presign is then signed with `maxSizeBytes: sizeBytes` — the declared size, not the
  ceiling (`:103`) — and `finalizeUpload` calls `objectExists`, which asserts existence and
  never looks at the object's real size (`:129`). A client that declares 1 KB and `PUT`s
  50 MB is refused only if R2 rejects the signed `ContentLength`, which nothing in this
  repository verifies. §3 therefore adds a size re-check at finalize, and the same hole in
  topic media needs its own backlog item rather than a fix here.

The seven questions the 2026-09-16 draft left open were resolved in dialogue on
**2026-09-22**:

- **#1 — when an event is "past".** Computed, not stored: `COALESCE(ends_at, starts_at + 1
  day) < now`. An explicit end wins; an open-ended event expires the day after it starts.
  `?scope` moves a row between the two lists as the clock passes; nothing is written on
  expiry. See §2. *(architect)*
- **#2 — past events stay on the board.** Yes, behind an **"Anteriores"** tab; the default
  board shows only upcoming. History is vitrine — evidence to a first-time visitor that the
  dojo is active. See §7. *(product owner)*
- **#3 — the public board is indexed.** Yes. The board and detail pages become
  **server-rendered**, and a minimal SEO baseline ships with them (`robots.ts`,
  `sitemap.ts` over the `public` published set, and the `<html lang>` fix). Accepted
  tradeoff: the tenant's event cadence becomes publicly visible — for a dojo recruiting
  students, discovery outweighs it. Phase 4 grows accordingly. See §7. *(product owner + lead)*
- **#4 — the render timezone.** The **event's own `timezone`** renders it everywhere — the
  only source available to an anonymous reader. The admin form pre-fills a **constant**
  (`America/Sao_Paulo`) for v1; explicitly documented as portable to `config/labels` or a
  DB config row later, with no change to how an event renders. See §1, §7. *(architect)*
- **#5 — who may publish.** Creating and editing a draft: `admin` or `content_creator`.
  **Publishing** (the transition to `published`, which exposes a page and a phone number to
  the open internet): **`admin` only**, via a dedicated `requireRole(ADMIN)` on the publish
  path, mirroring `admin/billing`. See §6. *(product owner)*
- **#6 — slug stability.** The slug is generated once at creation and is **immutable on
  rename**; a public URL never breaks on its own. An **explicit manual override** is offered
  for a typo, with a warning that it breaks links already shared. See §7. *(product owner)*
- **#7 — flyer on delete.** There is **no hard delete**. Removal is `status='archived'`:
  reversible, audit-preserving, and incapable of orphaning the flyer object in R2. A true
  purge is a deferred administrative sweep, not a v1 endpoint. See §6. *(architect)*

## References

- Anonymity gap: `apps/api/src/routes/public/catalog.topics.ts:68`,
  `catalog.tasks.ts:85`, `leaderboard.ts:63`, `apps/api/src/middleware/auth-guard.ts:5`
- Audience precedent: `apps/api/src/adapters/db/d1-enrollment-repository.ts:52`,
  `apps/api/migrations/0011_create_enrollment_tables.sql:6`
- Media ownership and limits: `apps/api/migrations/0006_create_media.sql:6`,
  `apps/api/src/controllers/admin-media.controller.ts:13`, `:98`
- WhatsApp today: `apps/web/src/lib/whatsapp.ts`, `apps/web/src/lib/brand.ts:76`,
  `apps/web/src/app/page.tsx:105`, `:588`, `apps/web/next.config.ts:17`
- Web auth gate: `apps/web/src/app/(protected)/layout.tsx:16`, `apps/web/src/lib/api-client.ts:1`
- Rate limiting precedent: `apps/api/src/container.ts:238`
- Related RFCs: RFC 0005 (enrollment grants and node visibility — the model this one
  deliberately does not reuse), RFC 0006 (white-label branding — owns
  `NEXT_PUBLIC_BRAND_WHATSAPP`), RFC 0013 (billing — owns money; this RFC owns none)
