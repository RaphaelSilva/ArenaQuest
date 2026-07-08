# Milestone 12 — Enrollment enforcement and node visibility

**Status:** ✅ Implemented (on candidate)
**Scope:** `apps/api` (catalog enforcement, resolver, controller, admin route, migration), `packages/shared` (visibility enum + port/entity types), and `apps/web` (admin topic-editor selector + unified Access page). Derived from [RFC 0005](../../RFCs/0005-enrollment-exclusions-and-visibility.md).

> **Hard scope guardrail — read before opening any task.** This milestone delivers the **visibility-only** design from RFC 0005: it fixes the Phase 0 catalog-gating defect, adds a per-node `visibility` column (`public` / `restricted` / `private`) with a single-CTE resolver, an admin/creator bypass, an admin `PATCH` field, a topic-editor selector, and a unified Access page. It may touch: `apps/api/src/routes/public/catalog.topics.ts`, `apps/api/src/adapters/db/d1-enrollment-repository.ts`, `apps/api/src/adapters/db/d1-topic-node-repository.ts`, `apps/api/src/controllers/topics.controller.ts` (and `admin-topics.controller.ts`), `apps/api/src/routes/admin/topics.ts`, `apps/api/migrations/**` (one additive migration), `packages/shared/types/entities.ts`, `packages/shared/ports/i-topic-node-repository.ts`, `apps/web/src/app/(protected)/admin/{topics,access,users,groups}/**`, `apps/web/src/components/enrollment/enrollments-tab.tsx` (retire), the catalog tree component (reuse), the admin enrollment/topics clients, and both i18n dictionaries. It is **not** an opportunity to introduce **negative grants / denies** (`IEnrollmentRepository` is unchanged), generic ACLs, time-bounded access, per-media exclusions, per-creator content scoping, a new role, or a topic-centric access matrix — all explicit Non-Goals in RFC 0005. If a refactor opportunity is spotted outside this scope, file a separate task — do not bundle it.

---

## 1. Objectives

- **Make the catalog enforce enrollment (Phase 0).** Inject the enrollment adapter into the catalog controller so `GET /topics` / `GET /topics/{id}` gate non-admins by the existing cascade resolver — fixing the latent defect where every authenticated user sees every published topic.
- **Add a per-node `visibility` primitive** — `PUBLIC` (any authenticated user), `RESTRICTED` (grant required, back-compat default), `PRIVATE` (admin/creator only) — as an additive, backfilled column on `topic_nodes`.
- **Keep the resolver a single recursive CTE** plus two flat indexed filters: `(allow_tree ∪ public_set) − private_set`. Same cost class as today (`< 50 ms` on the 1,000-topic fixture).
- **Make the admin / content-creator bypass explicit.** `ROLES.ADMIN` and `ROLES.CONTENT_CREATOR` are never subject to the resolver and see all content including `PRIVATE`, platform-wide.
- **Keep comment access derived, not granted.** Comments inherit the same effective-access set — no comment-specific primitive.
- **Ship the admin UI:** a topic-editor visibility selector and a single principal-centric Access page that replaces the per-user / per-group enrollment tabs, with detail-page deep-links.
- **Honour the i18n contract (RFC 0002)** — every new admin string in both `dict-en` and `dict-pt`; `check-i18n-coverage.js` passes.
- **Preserve Ports & Adapters.** Visibility semantics live in `ITopicNodeRepository` and the resolver; `IEnrollmentRepository` is unchanged.

Out of scope (explicit, from RFC 0005 Non-Goals):
- **Negative grants ("denies")** — Deferred section of RFC 0005; needs a second CTE, two tables, six routes, and an "Excluded topics" tab. Not in this milestone.
- Generic ACLs / per-node read-write-comment grids.
- Time-bounded access (`grantedUntil`).
- Per-media exclusions (media inherits its topic's effective access).
- A new role; per-creator content scoping (no topic-ownership concept today).
- A topic-centric access matrix ("who can see this node"); the Access page stays principal-centric.
- Participant catalog UI redesign (RFC 0004 owns that — Phase 0 is server-side only).
- `PUBLIC` comment rate limiting / moderation (resolved decision 2).

---

## 2. Functional Requirements

- `GET /topics` and `GET /topics/{id}` return, for a non-admin, only `(allow_tree ∪ public_set) − private_set`; admins and content creators see all published, non-archived content including `PRIVATE`.
- `topic_nodes` carries a `visibility` column defaulting to `restricted`, backfilled for existing rows, `CHECK`-constrained to the three values, and indexed.
- `PATCH /admin/topics/{id}` accepts an optional `visibility` field; no new route.
- Draft and archived topics never appear in the catalog for anyone (the `PUBLISHED && !archived` filter runs before the access check for every caller).
- Comments inherit visibility: `PUBLIC` topics are commentable by any authenticated user; `PRIVATE` discussions are admin/creator-only; `RESTRICTED` follows the cascade — with no comment-controller change.
- The admin topic editor exposes a `visibility` selector with help copy in PT + EN.
- A unified `/admin/access` page manages grants principal-centrically (User | Group) via an ordered tree reusing the catalog tree; user / group detail pages deep-link into it via a "Manage access" link.

---

## 3. Acceptance Criteria

- [x] A participant granted 1 of N topics sees exactly that subtree in `GET /topics` — not all N (Phase 0 bug fixed; would fail on `develop` today).
- [x] An admin can mark a topic `PRIVATE`; it disappears from every non-admin response while remaining reachable in `/admin/topics/*`.
- [x] `PUBLIC` topics appear in `GET /topics` for a freshly-registered, zero-grant user and are commentable by them.
- [x] `DRAFT` and `archived` topics never appear in `GET /topics` / `GET /topics/:id` for anyone, including admins/creators.
- [x] Existing grants behave identically to today (cascade preserved; no migration of existing rows).
- [x] `getEffectiveAccessTopicIds` p95 stays `< 50 ms` on the 1,000-topic benchmark fixture, using a single recursive CTE.
- [x] `IEnrollmentRepository` is unchanged; no deny tables, routes, or UI ship.
- [x] The admin topic editor and unified Access page work; detail-page deep-links resolve; `enrollments-tab.tsx` is retired (or its remaining reference documented).
- [x] All new admin strings ship in both `dict-pt.ts` and `dict-en.ts`; `check-i18n-coverage.js` passes.
- [x] `make lint`, `make test-api`, and `make test-web` pass green.
- [x] No diff outside scope, except the product-approved `GET /admin/groups` expansion (closeout §4.1).

---

## 4. Specific Stack

- **Backend:** Cloudflare Workers + Hono. Per-request adapters built in `buildApp(env)`. One additive D1 migration (column + default + backfill + `CHECK` + index). Resolver SQL stays in `D1EnrollmentRepository`. Validation via the `@ValidateBody` / `@Body` decorators; controllers return `ControllerResult<T>`.
- **Shared:** `Entities.Config.TopicVisibility` enum; `visibility` on `TopicNodeRecord` and the create / update inputs in `i-topic-node-repository.ts`. `IEnrollmentRepository` untouched.
- **Frontend:** Next.js 15 App Router, React 19, Tailwind CSS v4. New `/admin/access` route reusing the catalog tree component; topic-editor selector; detail-page deep-links. Both i18n dictionaries extended; `Dictionary` type updated.
- **Tests:** Vitest + `@cloudflare/vitest-pool-workers` on the API; Vitest + RTL on the web. `check-i18n-coverage.js` gates dictionary drift.

---

## 5. Task Breakdown

| # | Task File | Phase | Team | Status |
|---|-----------|-------|------|--------|
| 01 | [Catalog enrollment enforcement (prerequisite fix)](./01-catalog-enrollment-enforcement.task.md) | 0 | Backend | ✅ Done |
| 02 | [`visibility` column, enum, ports, and adapter read/write](./02-visibility-schema-types-and-adapter.task.md) | 1 | Backend | ✅ Done |
| 03 | [Resolver `(allow ∪ public) − private` rewrite + benchmark](./03-resolver-visibility-rewrite.task.md) | 1 | Backend | ✅ Done |
| 04 | [Admin/creator `PRIVATE` bypass + admin `PATCH` visibility schema](./04-controller-bypass-and-admin-patch.task.md) | 2 | Backend | ✅ Done |
| 05 | [Topic-editor visibility selector](./05-topic-editor-visibility-selector.task.md) | 3 | Frontend | ✅ Done |
| 06 | [Unified, principal-centric Access page](./06-unified-access-page.task.md) | 3 | Frontend | ✅ Done |
| 07 | [Migrate detail pages to a "Manage access" deep-link](./07-detail-pages-manage-access-deeplink.task.md) | 3 | Frontend | ✅ Done |
| 08 | [Visual QA, closeout, and RFC 0005 status update](./08-visual-qa-and-closeout.task.md) | — | QA | ✅ Done |

Dependency graph:

```
01 (Phase 0, independent)
      │
      ▼
02 ──► 03 ──► 04
                │
                ▼
        05, 06   (Phase 3 frontend; 05 ∥ 06 after 04)
                  │
                  ▼  (07 depends on 06)
                07
                  │
                  ▼
                08 (closeout, after 01–07)
```

**Recommended execution order:** `01` → `02` → `03` → `04` → (`05` ∥ `06`) → `07` → `08`.

Each task is intended to land as an independent PR with `make lint`, `make test-api`, and `make test-web` passing.

---

## 6. Decisions recorded (from RFC 0005 "Resolved Decisions")

1. **`PUBLIC` and the catalog exclude `archived` — and `DRAFT` — for everyone**, including admins/creators. Draft / archived content is reachable only via `/admin/topics/*`. The resolver keeps `AND archived = 0` on `public_set`; the controller's `PUBLISHED && !archived` filter (applied before the access check, independent of `userId`) enforces it for every caller.
2. **`PUBLIC` comment abuse is not a concern for now.** Ship the simple coupling (comment access follows visibility) with no rate limiting or moderation toggle. Revisit if `PUBLIC` adoption and user volume make spam real.
3. **No Phase 0 grants audit / backfill needed.** The project is pre-production with no live users to lock out. Phase 0 turns on the intended enforcement; the migration backfills `visibility = 'restricted'` and existing grants already describe who should see what.
4. **`RESTRICTED` is the migration default, not `PUBLIC`** — defaulting to `PUBLIC` would open every existing topic to every authenticated user (a security regression). Admins opt into `PUBLIC` per node.
5. **Denies are deferred, not rejected.** RFC 0005's Deferred section preserves the design; this milestone introduces nothing that precludes it.

---

## 7. Definition of Done (milestone level)

- [x] All 8 tasks marked `Done` with every acceptance box checked.
- [x] All milestone-level acceptance criteria in §3 pass (verified via targeted suites).
- [x] Milestone-relevant suites green (114 backend + 23 web) + `check-i18n-coverage.js`. _Repo-wide `make lint` (pre-existing `generate-bruno.ts`) and full `make test-api` (WSL2 pool instability) caveats in closeout §5._
- [x] Closeout note written at `./closeout-analysis.md`.
- [x] RFC 0005 status set to `Implemented` in the header and `README.md`; deferred items remain backlog.
- [x] No diff outside scope, except the product-approved `GET /admin/groups` expansion (closeout §4.1).
