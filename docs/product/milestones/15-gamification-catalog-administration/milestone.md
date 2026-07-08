# Milestone 15 — Gamification Catalog Administration

**Status:** ✅ Implemented
**Scope:** `apps/api` admin endpoints for `quest_definitions` + `level_definitions`, `apps/web` admin catalog screens (badges/quests/missions/levels) and their typed client, plus `packages/shared` gamification types and EN/PT dictionaries. Derived from [RFC 0009](../../RFCs/0009-gamification-catalog-administration.md).

> **Hard scope guardrail — read before opening any task.** This milestone may
> touch only: `packages/shared/types/entities.ts` (`Entities.Gamification`
> record shapes); on the API, the new `apps/api/src/controllers/admin-quests.controller.ts`
> and `admin-levels.controller.ts`, the new `apps/api/src/routes/admin/quests.ts`
> and `levels.ts`, the admin mount in `apps/api/src/routes/admin/index.ts`,
> write-method extensions to `apps/api/src/adapters/db/d1-quest-repository.ts`
> (and an analogous level-definition repository), and their Vitest specs; on the
> web, the new `apps/web/src/app/(protected)/admin/{badges,quests,missions,levels}/page.tsx`,
> the new hub cards in `apps/web/src/app/(protected)/admin/page.tsx`, the new
> `apps/web/src/lib/admin-gamification-api.ts` (and its registration in
> `apps/web/src/lib/api-client.ts`), the navigation entry points to the new
> screens in `apps/web/src/components/layout/admin-sidebar.tsx` and
> `apps/web/src/components/layout/nav.tsx` (desktop sidebar + mobile drawer), and
> `apps/web/src/i18n/dict-en.ts`
> + `dict-pt.ts`. It is **not** an opportunity to: build per-user progression
> management (`user_xp`, `user_badges`, streaks, `quest_progress`,
> `mission_progress`) — that is RFC 0010; change the predicate/rule evaluation
> engine or XP-curve math or introduce new `*_kind` values; build a visual
> rule/predicate builder (`predicate_params`/`rule_params` stay validated
> JSON/scalar text); or add a catalog audit trail. If a refactor opportunity is
> spotted outside this scope, file a separate task — do not bundle it.

---

## 1. Objectives

- **Backend admin CRUD for `quest_definitions`.** New OpenAPIHono router +
  `ControllerResult`-returning controller (`GET`/`POST`/`PATCH`/`DELETE
  /admin/quests`) with D1 write methods, so quests stop requiring seed
  migrations.
- **Backend admin editing for `level_definitions`.** New `GET /admin/levels`
  read and a transactional `PUT /admin/levels` whole-table upsert that enforces
  strict `min_xp` monotonicity, no gaps, and exactly one open-ended final row.
- **Shared gamification record types.** Promote `Badge`, `QuestDefinition`, and
  `Mission` into `Entities.Gamification` (alongside the existing
  `LevelDefinition`) so API and web share one definition.
- **A single typed web client.** `apps/web/src/lib/admin-gamification-api.ts`
  exposes `badges`/`quests`/`missions`/`levels` namespaces over the centralized
  api-client, returning the shared types.
- **Four admin catalog screens.** `/admin/{badges,quests,missions,levels}`
  client pages following the existing admin pattern (role gate, `useDict()`,
  list + create/edit form), each a `flex-1 overflow-y-auto` scroll region.
- **Gamification hub cards.** The `/admin` hub gains a "Gamification" group of
  cards linking to the four pages, gated to `ADMIN || CONTENT_CREATOR`.
- **Full EN+PT i18n coverage.** Identical keys across `dict-en.ts` and
  `dict-pt.ts`, with `check-i18n-coverage.js` green.

Out of scope (explicit, from RFC 0009 Non-Goals):
- **Per-user progression management** (`user_xp`, `user_badges`, streaks,
  `quest_progress`, `mission_progress`) — covered by RFC 0010; this milestone
  edits definitions only, never earned player state.
- **Rule/curve engine changes** — screens edit existing fields
  (`predicate_kind`, `predicate_params`, `rule_kind`, `rule_params`,
  `min_xp`/`max_xp`); no new rule kinds and no curve-math changes.
- **A visual rule builder** — deferred to a future RFC; this iteration edits
  `predicate_params`/`rule_params` as validated JSON / scalar text.
- **A catalog audit trail** — deferred to a future general admin audit-log RFC.

---

## 2. Functional Requirements

- `GET /admin/quests` returns all quest definitions; `POST` creates one; `PATCH
  /admin/quests/{id}` updates one; `DELETE /admin/quests/{id}` removes one.
- Quest create/update validates `kind` ∈ {`daily`, `weekly`}, `title`,
  `description`, `predicateKind`, `predicateParams` (a JSON string that must
  parse), `xpReward` (integer ≥ 0), and `active` (boolean, default `true`).
- `GET /admin/levels` returns the level definitions ordered by `level`.
- `PUT /admin/levels` upserts the whole curve in one transaction and rejects
  with `400 BadRequest` when `min_xp` is not strictly increasing, when there are
  gaps, or when there is not exactly one row with `max_xp = NULL` (the final
  open-ended row).
- All new admin endpoints sit under the existing `authGuard` +
  `requireRole(ADMIN, CONTENT_CREATOR)` umbrella and appear in the OpenAPI
  document.
- Economy-affecting edits (the level curve and any `xpReward` field) are
  restricted to `ADMIN`; `CONTENT_CREATOR` may edit non-economy catalog fields
  but not reward values. `/admin/levels` is `ADMIN`-gated end to end.
- `/admin/badges` lists badges (icon, name, slug, rule, xpReward, active toggle)
  and offers a create/edit form for `name`, `slug`, `iconEmoji`, `description`,
  `ruleKind`, `ruleParams`, `xpReward`, `active`.
- `/admin/quests` lists quest definitions grouped by `kind` and offers a
  create/edit form matching the API contract above.
- `/admin/missions` lists missions with their `startAt`/`endAt` window and
  optional `badgeId` (selected from existing badges) and supports
  create/edit/delete over the existing API.
- `/admin/levels` presents an editable grid of the full curve (level, rankTitle,
  minXp, maxXp) with client-side monotonicity validation, saved via the `PUT`
  endpoint.
- The `/admin` hub shows a "Gamification" card group linking to all four pages,
  visible only to `ADMIN || CONTENT_CREATOR`.
- Each screen surfaces an "edits affect the current period" warning and previews
  the parsed `predicate_params`/`rule_params` value before save.
- All user-facing strings come from the dictionaries; EN and PT keys are
  identical and `check-i18n-coverage.js` passes.

---

## 3. Acceptance Criteria

Testable assertions, each a `- [ ]` checkbox. These are stricter than the
Functional Requirements: each one names the concrete signal that proves it
(a specific endpoint response, a migrated row, a passing script, a deleted
directory). Include the gate commands the milestone must keep green
(`make lint`, `make test-api`, `make test-web`) and a "no diff outside scope"
line tied to the guardrail.

- [x] `Entities.Gamification` exports `Badge`, `QuestDefinition`, and `Mission`;
      the existing badge/mission controllers consume them and the former
      `BadgeRecord`/`Mission` shapes alias the canonical types (single source of
      truth). The routers' inline OpenAPI Zod schemas were kept by design (they
      define the wire shape, not the TS record type).
- [x] `GET/POST/PATCH/DELETE /admin/quests` round-trip a quest definition under
      Vitest (Workers pool, 11 tests) and the four operations appear in the OpenAPI doc.
- [x] `GET /admin/levels` returns rows ordered by `level`; `PUT /admin/levels`
      persists a valid curve and returns `400` for a non-monotonic curve, a
      gapped curve, and a curve without exactly one `max_xp = NULL` row (each
      asserted by a Vitest case; 10 tests).
- [x] A non-`ADMIN` `CONTENT_CREATOR` is rejected from `/admin/levels` (403) and
      from `xpReward`-bearing quest edits (403), each asserted by a guard test.
- [x] `/admin/{badges,quests,missions,levels}` render for `ADMIN`/`CONTENT_CREATOR`,
      list existing records, and complete a create/edit (and delete where
      applicable) round-trip against the client; covered by RTL component tests.
- [x] The `/admin` hub renders the Gamification card group only for
      `ADMIN || CONTENT_CREATOR` (Levels card `ADMIN`-only).
- [x] `check-i18n-coverage.js` is green and `dict-en.ts`/`dict-pt.ts` have
      identical keys.
- [x] `make lint`, `make test-api` (690 passing), and `make test-web`
      (218 passing) pass green.
- [x] No diff outside the scope declared in the guardrail (amended above to
      include the navigation entry points and the api-client registration).

---

## 4. Specific Stack

- **Backend:** Cloudflare Workers + Hono; per-request adapters in `buildApp(env)`;
  OpenAPIHono admin routers mounted in `routes/admin/index.ts` under `authGuard`
  + `requireRole`; controllers return `ControllerResult<T>`; validation via
  `@ValidateBody` / `@Body` (Zod); D1 repositories for catalog reads/writes, with
  the level `PUT` running its upsert + validation in a single transaction.
- **Shared:** `packages/shared/types/entities.ts` — add `Badge`,
  `QuestDefinition`, `Mission` to the `Entities.Gamification` namespace
  (`LevelDefinition` already present).
- **Frontend:** Next.js 15 App Router, React 19, Tailwind CSS v4; client pages
  with `useHasRole` gates and `useDict()` strings; root `<main>` as
  `flex-1 overflow-y-auto` per RFC 0008's layout contract; typed
  `admin-gamification-api.ts` over the centralized api-client; both i18n
  dictionaries; `check-i18n-coverage.js`.
- **Tests:** Vitest + `@cloudflare/vitest-pool-workers` (API); Vitest + RTL (web).

---

## 5. Task Breakdown

The execution plan. Each row is a `.task.md` file, backend and frontend split
into distinct tasks (each frontend task depends on the backend contract it
consumes).

| # | Task File | Phase | Team | Status |
|---|-----------|-------|------|--------|
| 01 | [Shared gamification catalog types](./01-shared-gamification-catalog-types.task.md) | 0 | Backend | ✅ Done |
| 02 | [Admin quest-definition CRUD endpoints](./02-admin-quest-definition-crud-endpoints.task.md) | 1 | Backend | ✅ Done |
| 03 | [Admin level-definition editor endpoints](./03-admin-level-definition-editor-endpoints.task.md) | 1 | Backend | ✅ Done |
| 04 | [Gamification web client and badges and missions screens](./04-gamification-web-client-and-badges-and-missions-sc.task.md) | 2 | Frontend | ✅ Done |
| 05 | [Quests and levels screens and gamification hub cards](./05-quests-and-levels-screens-and-gamification-hub-car.task.md) | 3 | Frontend | ✅ Done |

Dependency graph:

```
01 (independent)
 │
 ├──► 02 ──┐
 ├──► 03 ──┤
 └─────────┴──► 04 ──► 05
```

`02` and `03` both depend on `01` and are independent of each other. `04`
depends on `01`, `02`, and `03` (it types the full client against all three
contracts). `05` depends on `04`.

**Recommended execution order:** `01` → `02` → `03` → `04` → `05`.

Each task is intended to land as an independent PR with `make lint`,
`make test-api`, and `make test-web` passing.

---

## 6. Decisions recorded (from RFC 0009 "Resolved Decisions")

Pin the decisions the RFC already settled so implementers don't reopen them.
Number each; one line of decision + one line of rationale. If the RFC has a
"Resolved Decisions" section, copy its entries here; if it has open questions
that must be answered before tasks start, resolve them with the author and
record the answer (with who decided) rather than leaving them dangling.

1. **Deactivating a definition (`active = 0`) does not cascade-hide in-flight
   progress** (2026-06-23, product) — `active = 0` only stops the definition
   being handed out in future periods; the participant read path still shows it
   when `active = 1` **OR** the user already has a `quest_progress` row for the
   current `period_key` (resp. a `mission_progress` row inside the mission's
   window). Already-`completed` rows keep their reward. No mid-period rug-pull;
   read path stays simple.
2. **Economy-affecting edits are `ADMIN`-only** (2026-06-23, raphaelsilva) — the
   level curve and `xpReward` fields are restricted to `ADMIN`;
   `CONTENT_CREATOR` may manage non-economy catalog fields but not reward
   values. `/admin/levels` is `ADMIN`-gated end to end.
3. **No catalog audit trail in this iteration** (2026-06-23, raphaelsilva) —
   deferred to a future general admin audit-log RFC covering
   topics/tasks/users/gamification under one mechanism, rather than a
   gamification-only audit table. Per-user XP changes remain auditable via the
   `xp_events` ledger (RFC 0010).
4. **Level curve edited whole-table, not per-row** (from RFC 0009 Alternatives) —
   the curve must stay contiguous and monotonic, so a single transactional `PUT`
   keeps the invariant atomic; per-row PATCH is a deferred fallback if partial
   saves are ever needed.

---

## 7. Definition of Done (milestone level)

- [x] All tasks marked Done with every acceptance box checked.
- [x] All milestone-level acceptance criteria in §3 pass.
- [x] `make lint`, `make test-api`, and `make test-web` pass green.
- [x] Closeout note written at `./closeout-analysis.md`.
- [x] RFC 0009 status set to `Implemented` in its header and
      `docs/product/RFCs/README.md`; deferred items remain backlog.
- [x] No diff outside the scope declared in the guardrail.
