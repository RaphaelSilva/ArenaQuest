# Task 02 — Backend: Events schema and D1 repository (Phase 1)

**Status:** ✅ Done
**Milestone:** [20 — Events board — public listing, access-scoped audiences and per-event WhatsApp contact](./milestone.md)
**RFC:** [RFC 0014](../../RFCs/0014-events-board-and-whatsapp-contact.md)
**Team:** Backend API
**Depends On:** [Task 01](./01-shared-foundations.task.md)

## Summary

Gives the events entity a place to live and the only code that knows where that is. One
additive migration, `0027_create_events.sql`, creates `events` — identity and slug, title,
plain-text summary, markdown content, location, a UTC `starts_at` with a nullable `ends_at`
and the event's own `timezone`, a status, an audience, the five flyer columns and the three
contact columns — plus the two grant tables `event_audience_group` and
`event_audience_user`, which reuse `user_groups` and `users` and deliberately are **not**
the `enrollments_*` tables: they say "may see this announcement", never "may open this
content". Two defaults carry the milestone's security posture and must not be softened:
`status` defaults to `draft` and `audience` defaults to `members`, so the failure mode of a
mistake is "fewer people saw it", never a private grading published to the open internet.
`D1EventRepository` implements the Task 01 port and owns the two audience queries from RFC
§2 — the anonymous branch being a literal `published` + `public` filter rather than a
parameter the caller supplies, and the authenticated branch the union of `public`,
`members`, the caller's direct grants and their group grants. It also owns the `?scope`
predicate, where "past" is **computed, never stored** as `COALESCE(ends_at, starts_at + 1
day) < now`, so a row moves between the two lists as the clock passes it with no expiry
sweep and no write; and slug generation, derived once from the title at creation with a
collision suffix. Tasks 03 and 04 call this repository through the port and never write SQL
of their own.

## Dependencies

- [Task 01](./01-shared-foundations.task.md) — hard code dependency. This task implements
  `IEventRepository` and persists the `EventStatus` / `EventAudience` values that task
  defines; the entity shape it maps rows onto comes from `Entities.Events`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/migrations/0027_create_events.sql` (new) — one additive, sequential
    migration. It creates three tables and their indexes and alters nothing existing, so
    the rollback is dropping them; no backfill is required because no row exists yet.
  - `apps/api/src/adapters/db/d1-event-repository.ts` (new).
  - `apps/api/test/**` — repository specs against the Workers pool.
- **Ports & Adapters.** The adapter is the only file in the milestone that may contain SQL
  or touch `D1Database`. Provider independence is the point: the controllers of Tasks 03
  and 04 see `IEventRepository` and nothing else, and swapping D1 for another store must
  require no change above this file.
- **Cloud-agnostic above the adapter.** No D1 symbol leaks into a port, a controller or a
  route.
- **Security-sensitive defaults are explicit.** `status` defaults to `draft`; `audience`
  defaults to `members`. Both are stated in the migration rather than left to application
  code, and both carry a `CHECK` constraint over their allowed values so an out-of-range
  write fails at the database rather than silently widening an audience.
- **The anonymous query is a constant, not a parameter.** The anonymous listing branch
  filters on literal `status = 'published' AND audience = 'public'`. It must not be
  expressible as "the authenticated query with a null user", because a null that reaches
  the wrong side of that expression is a data leak rather than an error.
- **"Past" is computed.** No column, no flag, no scheduled job records expiry. The scope
  predicate is evaluated per query against the request instant, and reading a past event
  performs no write.
- **`starts_at` is a UTC instant; `timezone` renders it.** Both columns are required
  together — the instant orders the list correctly, the zone renders it correctly for an
  anonymous reader who carries no `users.timezone`.
- **Slug immutability lives here.** The slug is derived from the title **once at creation**,
  with a collision suffix when the derived value is taken, and is never re-derived on a
  later title change. An explicit slug supplied by a caller is honoured; Task 04 owns the
  route that offers it.
- **One column beyond RFC 0014's schema block, deliberately:** `flyer_replaced_key`.
  Internal bookkeeping, never mapped onto the entity. RFC §3 step 3 requires finalize to
  "delete the previously-ready key if this was a replacement", but presign overwrites
  `flyer_key` with the new key, so within the five columns the RFC lists the displaced key
  is unrecoverable and `setFlyerReady` could only ever return `null` — an R2 orphan on
  every flyer replacement. Deleting at presign time instead destroys a live flyer whenever
  an upload is abandoned. Presign stashes the displaced key under
  `CASE WHEN flyer_status = 'ready'` in the same UPDATE; finalize returns and clears it.
  The column makes the RFC's own stated requirement achievable; the migration and the SQL
  both carry this rationale inline.
- **Events stay out of the learning tree.** No foreign key to `topic_nodes`, no row in
  `media`, no reference to `enrollments_user` or `enrollments_user_group`, and no change to
  any existing table. `d1-enrollment-repository.ts` and everything under `src/core/billing/`
  must be absent from the diff.
- **No money.** No price, amount, currency or `subscriptions` foreign key. That is RFC 0015
  and it will read `events.id` from the outside.

## Scope

In:
- The `0027_create_events.sql` migration: the `events` table with its status and audience
  `CHECK` constraints and defaults, the flyer and contact columns, the two audience grant
  tables with their cascade behaviour, and the listing and grant-lookup indexes.
- `D1EventRepository` implementing every method of `IEventRepository`: the anonymous
  audience-scoped list, the authenticated audience-scoped list, both under `upcoming` and
  `past` scope with their opposite orderings and pagination; slug lookup honouring the same
  audience rule; the admin list including drafts and archived rows; create, update, the
  whole-set audience grant replacement, and the flyer column writes.
- Slug derivation with collision suffixing at creation.
- Repository specs against the Workers pool covering the full audience matrix — anonymous
  against each of the three audiences, an authenticated member against each, a directly
  granted user, a group-granted user, a user with neither grant, a draft and an archived
  row — plus the scope predicate at both sides of the boundary, including the open-ended
  event whose `ends_at` is null.

Out:
- `optionalAuth`, the HTTP surface, the controller and the rate limiter — Task 03.
- The flyer presign/finalize lifecycle and the publish role gate — Task 04.
- Any frontend change — Tasks 05–07.
- The local seed row — Task 08.

## Acceptance Criteria

- [x] `0027_create_events.sql` applies cleanly to a fresh local D1 and creates `events`,
      `event_audience_group` and `event_audience_user` with their indexes; no existing
      table is altered.
- [x] Inserting a row with neither `status` nor `audience` set yields `draft` and
      `members`; a write of any value outside the allowed sets is rejected by the database.
- [x] The anonymous list returns exactly the `published` + `public` set for a fixture
      spanning all three audiences and both non-published statuses.
- [x] The authenticated list returns that set ∪ `members` ∪ the caller's directly granted
      events ∪ their group-granted events, and nothing else — asserted per audience level,
      not once.
- [x] Slug lookup applies the same audience rule as the list: an out-of-audience slug
      resolves to nothing, so the caller above can return 404 rather than 403.
- [x] An event past `COALESCE(ends_at, starts_at + 1 day)` is absent from `upcoming` and
      present in `past`, ordered ascending and descending respectively; an event with a
      null `ends_at` crosses the boundary one day after `starts_at`; no row is written by
      either read.
- [x] Creating two events from the same title yields two distinct slugs; updating a title
      afterwards leaves the slug untouched.
- [x] Replacing an audience grant set removes the grants not present in the new set, and
      deleting a group or a user removes its grant rows without deleting the event.
- [x] No D1-specific import leaks into a port or a controller; `IEventRepository` is the
      only type the layers above this task reference.
- [x] `git grep -n "getEffectiveAccessTopicIds" apps/api/src` returns the same four call
      sites as before; `d1-enrollment-repository.ts` and `src/core/billing/**` are absent
      from the diff.
- [x] Changed files lint clean; `make test-api` green for the affected specs.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. `make db-reset-local`, then `make db-migrate-local` — confirm `0027` applies to a fresh
   replica; inspect the resulting schema for the two defaults, the `CHECK` constraints and
   the three indexes.
2. Apply the migration a second time and confirm it is idempotent.
3. `make test-api` — the repository specs pass, including the full audience matrix and both
   sides of the scope boundary.
4. Seed a past, an upcoming and an open-ended event by hand and read both scopes, then
   re-read them and confirm `updated_at` moved on none of the rows.
5. `make lint`.
6. `git diff --stat` confirms only the guardrail files changed, and that
   `d1-enrollment-repository.ts`, `src/core/billing/` and `apps/web/` are absent.
