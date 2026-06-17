# RFC 0005: Enrollment enforcement and node visibility

**Date:** 2026-05-28
**Revised:** 2026-06-16 (scope cut — catalog gating defect made prerequisite; denies deferred; visibility-only chosen)
**Status:** Draft
**Author:** raphaelsilva
**Affected:**
- `packages/shared/ports/i-topic-node-repository.ts`
- `packages/shared/types/entities.ts` (`Entities.Config`, `Entities.Content`)
- `apps/api/src/adapters/db/d1-enrollment-repository.ts`
- `apps/api/src/adapters/db/d1-topic-node-repository.ts`
- `apps/api/src/controllers/topics.controller.ts`
- `apps/api/src/routes/public/catalog.topics.ts` (**prerequisite fix** — wire enrollment into catalog reads)
- `apps/api/src/routes/admin/topics.ts` (`visibility?` on the topic patch)
- `apps/api/migrations/*` (new migration — `visibility` column)
- `apps/web/src/app/(protected)/admin/access/**` (new unified Access page — grants for users and groups)
- `apps/web/src/app/(protected)/admin/topics/**` (per-node visibility selector)
- `apps/web/src/app/(protected)/admin/users/**` and `admin/groups/**` ("Manage access" deep-link only)

---

## Summary

The enrollment model is **additive and cascading**: a grant on a
`TopicNode` (direct user grant or group grant) extends access to every
descendant of that subtree, computed on the fly by a recursive CTE in
`D1EnrollmentRepository.getEffectiveAccessTopicIds`.

Two gaps motivated this RFC. During review, the first turned out to be a
**latent defect rather than a design gap**, which reframes the whole
effort:

0. **The catalog does not actually enforce enrollment today.** The public
   catalog endpoints build the topics controller with **no enrollment
   adapter**, so `GET /topics` / `GET /topics/{id}` return *every*
   published topic to *every* authenticated user, regardless of grants
   (see Current State). Fixing this is the **prerequisite** for any
   per-node policy to mean anything.
1. **There is no per-node visibility primitive** distinguishing "open to
   all authenticated users", "open only to explicit grantees" (today's
   intended behaviour), and "admin/creator only".

This RFC therefore proposes a **minimal, single-CTE design**:

1. **Fix catalog enforcement** (Phase 0) — inject the enrollment adapter
   so the existing cascade resolver actually gates the catalog.
2. **Node-level visibility** — a `visibility` column on `topic_nodes`
   with three values: `PUBLIC` (visible to any authenticated user),
   `RESTRICTED` (visible only via an explicit grant on the node or an
   ancestor — today's intended behaviour, the back-compat default), and
   `PRIVATE` (invisible to anyone but admins and content creators,
   regardless of grants).

**Negative grants ("denies") are explicitly deferred** — see
[Deferred: negative grants](#deferred-negative-grants-denies). They add a
second recursive CTE and a large CRUD/UI surface to solve per-principal,
mid-subtree exclusions (instructor-only sections, cohort-only previews)
that the product does not currently need. Default-restricted content plus
`PRIVATE` covers the cases we have, on a resolver no more expensive than
today's.

## Motivation

Concrete cases, and how the chosen (visibility-only) design handles each:

| # | Case | Covered by this RFC? |
|---|---|---|
| 0 | A participant sees topics they were never granted (catalog ignores enrollment) | ✅ **Phase 0** — the core defect this RFC fixes first |
| 1 | "Grant the whole course **except** the final exam" — exam hidden from **everyone** | ✅ mark the exam `PRIVATE` |
| 4 | Default-private content (published-but-restricted nodes / drafts inside a published branch) | ✅ `PRIVATE` (plus existing `DRAFT` status) |
| 2 | Instructor-only / staff-only section **inside** a participant subtree (visible to some, hidden from others) | ⛔ **Deferred** — needs denies (see Deferred section) |
| 3 | Cohort-only preview — one node open to a cohort while its parent subtree is open to all | ⛔ **Deferred** — needs denies |
| 5 | Auditability of *intentional* per-node exclusion vs "never granted" | ⛔ **Deferred** — a deny-specific concern |

Cases 2, 3 and 5 are the only ones that require per-principal exclusion of
a node *within* an otherwise-granted subtree. They are real but not
currently on the roadmap; the Deferred section preserves their design so
it can be picked up without re-derivation.

## Goals & Non-Goals

**Goals**
- **Make the catalog enforce enrollment** (Phase 0). A non-admin sees a
  published topic only if they (or one of their groups) have a grant on
  it or an ancestor — the cascade that already exists in the resolver but
  is not wired into the catalog reads.
- Allow an admin to mark a topic `PUBLIC` (any authenticated user),
  `RESTRICTED` (grant required — default), or `PRIVATE` (admin/creator
  only) at the node level.
- Keep the existing additive **cascade** behaviour intact — granting a
  parent still grants its descendants. No migration of existing grants,
  no behaviour change for currently enrolled users.
- Keep the resolver **a single recursive CTE** plus cheap indexed
  filters — no second CTE, no materialised cache, same cost class as
  today (`< 50 ms` on the 1,000-topic fixture).
- Preserve the **Ports & Adapters** boundary: visibility semantics live
  in `ITopicNodeRepository` and the resolver; adapters can swap to
  Postgres / DynamoDB without re-deriving the policy.
- **Make the authorization model explicit and uniform.** `ROLES.ADMIN`
  and `ROLES.CONTENT_CREATOR` fully bypass visibility and grants and see
  **all** content (including `PRIVATE`), platform-wide. Every other
  principal is subject to the resolver (§3).
- **Keep comment access derived, not granted.** Reading and writing
  comments is gated by the *same* effective-access set as topic
  visibility — already true today (§7). `PRIVATE` therefore propagates to
  the discussion automatically, with no separate comment primitive.
- **Make the admin grant picker tree-shaped.** The grant picker renders
  topics as an ordered tree consistent with the participant catalog, so
  admins navigate the same hierarchy they gate (§6).
- **Consolidate access management into one page** (§6) — replace the
  per-user and per-group entry points with a single principal-centric
  Access page.

**Non-Goals**
- **Negative grants (denies).** Deferred to a follow-up; see the Deferred
  section. The visibility column does not preclude them.
- Generic ACLs (per-node read/write/comment grids). The model stays
  binary: *can see* vs *cannot see*.
- Time-bounded access (`grantedUntil`). Separate backlog item.
- Per-media exclusions (hide a single video inside an otherwise granted
  topic). Media inherits its parent topic's effective access.
- A new role beyond `ROLES.ADMIN` / `ROLES.CONTENT_CREATOR`. No new role
  is introduced; the full bypass for those roles is enforced in the
  controller.
- **Per-creator content scoping.** The bypass is platform-wide: a content
  creator sees every topic, including other creators' `PRIVATE` drafts.
  Scoping a creator to content they own requires a topic-ownership
  concept that does not exist today — separate backlog item.
- A topic-centric access matrix ("who can see this node", managed from
  the topic screen). The unified Access page (§6) stays principal-centric
  (pick a user or group), so no reverse-lookup port methods are added.
- Frontend redesign of the catalog. RFC 0004 owns the participant catalog
  UX; the admin UI changes here consolidate existing surfaces.

## Current State (for reference)

`IEnrollmentRepository` exposes:

```ts
getEffectiveAccessTopicIds(userId: string): Promise<string[]>;
listUserGrants / grantUser / revokeUser({ cascade });
listGroupGrants / grantGroup / revokeGroup({ cascade });
```

`D1EnrollmentRepository.getEffectiveAccessTopicIds` already **cascades**
and already includes **group** grants (single recursive CTE):

```sql
WITH RECURSIVE
  direct_grants(topic_node_id) AS (
    SELECT topic_node_id FROM enrollments_user WHERE user_id = ?1
    UNION
    SELECT eg.topic_node_id
      FROM enrollments_user_group eg
      JOIN user_group_members ugm ON ugm.group_id = eg.group_id
     WHERE ugm.user_id = ?1
  ),
  tree(id) AS (
    SELECT topic_node_id AS id FROM direct_grants
    UNION ALL
    SELECT tn.id FROM topic_nodes tn JOIN tree ON tn.parent_id = tree.id
  )
SELECT DISTINCT id FROM tree
```

`TopicsController.listPublished` / `getPublishedById` *can* gate by this
set, but **only when both a `userId` and an enrollment adapter are
supplied** (`topics.controller.ts:41`, `:55`):

```ts
if (userId && this.enrollment) { /* filter by effective access */ }
return published; // otherwise: ALL published topics
```

> **⚠️ Known defect (found during RFC review, 2026-06-16).** The live
> catalog endpoints do **not** gate by enrollment for anyone. The public
> catalog router builds the controller with **no enrollment adapter**:
> ```ts
> // apps/api/src/routes/public/catalog.topics.ts
> // "enrollment is not needed for public catalog reads"
> const controller = new TopicsController(topics, media, storage, undefined);
> ```
> Because `this.enrollment` is `undefined`, the guard above is skipped and
> `GET /topics` / `GET /topics/{id}` return **every** published topic to
> **every** authenticated user, regardless of grants. (Verified manually:
> a user with 1 of 3 topics granted sees all 3 in the catalog.) The
> cascading resolver *is* correctly wired into other paths — comments
> (`comments.router.ts:97`) and the video-watched check
> (`topics.router.ts:26`) — but **not** the catalog read path.

This defect is why the RFC's original premise ("the catalog is gated by
enrollment, we just can't express exceptions") was wrong: the catalog is
gated by nothing. Phase 0 fixes it.

## Proposed Design

### 1. Node visibility (additive column)

Add a `visibility` column to `topic_nodes`:

```ts
// packages/shared/types/entities.ts → Entities.Config
export enum TopicVisibility {
  /** Visible to any authenticated user, regardless of grants. */
  PUBLIC = 'public',
  /** Visible only when the user (or one of their groups) has a grant on
   *  this node or an ancestor. Today's intended semantics. */
  RESTRICTED = 'restricted',
  /** Invisible to everyone except admins and content creators,
   *  regardless of grants. */
  PRIVATE = 'private',
}
```

```ts
// packages/shared/ports/i-topic-node-repository.ts → TopicNodeRecord
visibility: Entities.Config.TopicVisibility;
```

Migration: add the column with default `'restricted'` and **backfill all
existing rows to `'restricted'`**. Combined with the Phase 0 fix, that
makes the catalog behave the way the product always intended — a topic is
reachable only via a grant on itself or an ancestor.

> **Rationale for `RESTRICTED` as default rather than `PUBLIC`:** the
> platform treats published topics as gated by enrollment, not as
> world-readable. Defaulting to `PUBLIC` would open every existing topic
> to every authenticated user — a security regression. Admins opt into
> `PUBLIC` per node once the column ships.

### 2. Resolver semantics — single CTE + two filters

`getEffectiveAccessTopicIds` returns
`(allow_tree ∪ public_set) − private_set`:

- `allow_tree` = today's recursive cascade of grants (descendants of any
  granted node) — **unchanged**.
- `public_set` = all topics with `visibility = 'public'` (and not
  archived), visible without any grant.
- `private_set` = all topics with `visibility = 'private'`, always removed
  for non-admin users.

```sql
WITH RECURSIVE
  allow_seed(id) AS (
    SELECT topic_node_id FROM enrollments_user WHERE user_id = ?1
    UNION
    SELECT eg.topic_node_id
      FROM enrollments_user_group eg
      JOIN user_group_members ugm ON ugm.group_id = eg.group_id
     WHERE ugm.user_id = ?1
  ),
  allow_tree(id) AS (
    SELECT id FROM allow_seed
    UNION ALL
    SELECT tn.id FROM topic_nodes tn JOIN allow_tree ON tn.parent_id = allow_tree.id
  ),
  public_set(id) AS (
    SELECT id FROM topic_nodes WHERE visibility = 'public' AND archived = 0
  )
SELECT DISTINCT id FROM (
  SELECT id FROM allow_tree
  UNION
  SELECT id FROM public_set
)
WHERE id NOT IN (SELECT id FROM topic_nodes WHERE visibility = 'private');
```

This is the **same single recursive CTE as today**, plus a `UNION` with a
flat indexed lookup (`public_set`) and a `NOT IN` against another flat
indexed lookup (`private_set`). No second recursion; the cost class is
unchanged. (An index on `topic_nodes(visibility)` keeps both filters
cheap.)

### 3. Admin / content-creator bypass

Callers pass `userId: undefined` when the requester is an admin or content
creator (see `topics.router.ts:26`), which makes the controller skip the
resolver. This RFC keeps that bypass **and extends it to the `PRIVATE`
filter**. The rule, stated in full:

> **`ROLES.ADMIN` and `ROLES.CONTENT_CREATOR` are never subject to the
> resolver.** They see *all* content — every grant, every `PRIVATE`
> topic — across the whole platform. Every other principal is filtered by
> `(allow ∪ public) − private`.

No new role; the gate is enforced in `TopicsController` exactly where the
`userId` decision is made today. Making it explicit (rather than an
implicit consequence of `userId === undefined`) is the point of this
section — reviewers were unsure whether creators retained full access.

**Scope note:** the bypass is platform-wide and trust-based — a content
creator can see other creators' `PRIVATE` drafts. Restricting a creator to
content they own is out of scope (no topic-ownership concept today); see
Non-Goals.

### 4. Port additions

Only `ITopicNodeRepository` changes; **`IEnrollmentRepository` is
unchanged** in this RFC (the deny methods belong to the Deferred section).

```ts
// packages/shared/ports/i-topic-node-repository.ts
// TopicNodeRecord
visibility: Entities.Config.TopicVisibility;
// CreateTopicNodeInput / UpdateTopicNodeInput
visibility?: Entities.Config.TopicVisibility;
```

The repository's update path already handles partial patches; reading and
writing the new column is the only adapter change.

### 5. HTTP surface (admin)

No new routes. `PATCH /admin/topics/{id}` already accepts a partial
update; extend its schema to accept `visibility?: TopicVisibility`. Grant
and revoke routes are unchanged.

### 6. Frontend impact (admin only)

- **Topic editor** (`apps/web/src/app/(protected)/admin/topics/**`) — add
  a `visibility` select with three options
  (`public` / `restricted` / `private`), wired to the patched topic
  update endpoint. Inline copy explains the semantics; copy goes through
  the i18n dict per RFC 0002.
- **New unified Access page**
  (`apps/web/src/app/(protected)/admin/access/**`) — a single
  principal-centric surface that replaces the two separate entry points
  (per-user tab + per-group tab) currently provided by the shared
  `enrollment/enrollments-tab.tsx` component. Layout:
  1. **Principal selector** — toggle `User | Group`, then search/pick the
     principal. Verb-first flow ("manage access → pick whom").
  2. **Granted topics** — the grant picker (existing allow behaviour).
     *(An "Excluded topics" tab is added only if denies ship — Deferred.)*
  3. **Tree picker** — renders the topic hierarchy as an **ordered tree**
     reusing the catalog's tree component, so the admin gates the same
     structure participants browse.
- **User / Group detail pages** keep only a lightweight **"Manage
  access"** link that deep-links into the unified Access page,
  pre-filtered to that principal. Single source of truth; the detail
  pages no longer embed the full enrollment component.

The participant catalog (RFC 0004) needs **no UI change**: once Phase 0
lands, it already calls `GET /topics` / `GET /topics/:id` with the user's
JWT, and those endpoints return the enrollment-aware, visibility-aware
set. The 404 the controller already returns for non-accessible topics
covers `PRIVATE` identically.

### 7. Comments inherit effective access (no separate primitive)

Comment read/write is **already** gated by the same effective-access set
as topic visibility: `comments.router.ts` resolves
`getEffectiveAccessTopicIds(userId)` and `CommentsController.listComments`
/ `createComment` reject with `403` when the topic is not in that set.
This RFC adds **no comment-specific permission**.

Consequences, free of any new code in the comment path:

- A **`PRIVATE`** topic exposes its discussion only to admins / content
  creators, identical to its content.
- A **`PUBLIC`** topic, being in every authenticated user's effective set,
  is **commentable by any authenticated user** — the intended behaviour
  (comment access follows visibility). The abuse/spam surface is flagged
  in Open Questions, not solved here.
- Once Phase 0 lands, comment access on `RESTRICTED` topics is gated by
  the same cascade as the catalog — already true in code, but only
  meaningful once the catalog is gated too.

## Alternatives Considered

1. **Negative grants ("denies") in this RFC.** The original proposal.
   *Deferred, not rejected:* denies uniquely solve per-principal
   mid-subtree exclusion (Motivation 2, 3, 5), but those cases are not on
   the roadmap, and denies add a second recursive CTE plus a large
   CRUD/UI surface. Full design preserved in the Deferred section.
2. **"Most-specific wins" precedence** (a deny/allow closer to the node
   overrides an ancestor). *Rejected:* only relevant once denies exist,
   and harder to reason about than "deny wins"; revisit with the Deferred
   work.
3. **Per-node ACL table** (`(topic_id, principal_id, kind, action)`).
   *Rejected:* over-engineered for a binary model; complicates the CTE;
   makes audits harder.
4. **Tag-based gating** — denylist topics by tag. *Rejected:* couples
   permissions to authoring metadata; renaming a tag silently changes who
   sees what.
5. **Structural restructure** (move the restricted node out of its
   subtree). *Rejected on principle:* permissions should not dictate
   pedagogical ordering.
6. **Visibility column only, no denies (chosen).** Covers
   default-restricted enforcement, `PUBLIC` opt-in, and admin-only
   `PRIVATE` on a single-CTE resolver. Does not cover "grant subtree X
   except node Y" for a *subset* of principals — accepted, since that is
   the Deferred case.

## Implementation Plan

Estimated total: **~3–3.5 dev days**, all shippable independently.

### Phase 0 — Prerequisite: make the catalog enforce enrollment (~0.5 d)
**The design assumes the catalog is gated by enrollment. It is not
today** (see Current State defect). Before any new primitive ships:
- Inject the enrollment adapter into the catalog controller in
  `apps/api/src/routes/public/catalog.topics.ts` (currently `undefined`).
- Confirm `GET /topics` / `GET /topics/{id}` filter by
  `getEffectiveAccessTopicIds(user.sub)` for non-admins and keep the
  admin / content-creator bypass.
- Regression test: a participant with a grant on 1 of N topics sees
  exactly that subtree (cascade), not all N. **This test would fail on
  `main` today** — it pins the fix.
- Ship-able and verifiable on its own, independent of visibility.

### Phase 1 — Schema + resolver + ports (~1 d)
- Migration: add `visibility` to `topic_nodes` (default `'restricted'`,
  backfill, `CHECK` constraint); add index on `topic_nodes(visibility)`.
- Extend `Entities.Config.TopicVisibility` enum.
- Extend `TopicNodeRecord` / create / update inputs with `visibility`.
- Update `D1TopicNodeRepository` to read/write the new column.
- Update `D1EnrollmentRepository.getEffectiveAccessTopicIds` to the
  `(allow_tree ∪ public) − private` query above.
- Vitest coverage (`@cloudflare/vitest-pool-workers`):
  - grant-only (cascade) unchanged from today; `PUBLIC` topic visible with
    no grant; `PRIVATE` topic hidden even with a grant.
  - Benchmark: resolver p95 stays `< 50 ms` on the 1,000-topic fixture.

### Phase 2 — Controller + admin route (~0.5–1 d)
- Extend the admin `PATCH /topics/{id}` schema with `visibility?`.
- Make the admin / content-creator bypass include `PRIVATE` explicitly in
  the `userId === undefined` branch of `TopicsController`.
- Integration tests against an in-memory D1: admin sees `PRIVATE`,
  participant does not; `PUBLIC` visible without a grant; `RESTRICTED`
  gated by cascade.
- Regression test confirming **comments** inherit the resolver: an
  authenticated user can comment on a `PUBLIC` topic with no grant; a
  participant cannot comment on a `RESTRICTED` topic they lack (no
  comment-controller edit expected).

### Phase 3 — Admin UI (~1.5 d)
- Topic editor: visibility selector with help copy (PT + EN dict keys);
  calls the patched update endpoint.
- **New unified Access page** (`admin/access/**`): principal selector
  (`User | Group`), "Granted topics" tab using the catalog's ordered-tree
  picker, wired to the existing grant endpoints.
- Migrate `enrollment/enrollments-tab.tsx` usages off the user/group
  detail pages; replace with a "Manage access" deep-link.
- All new strings in `dict-pt.ts` + `dict-en.ts`; `check-i18n-coverage.js`
  passes.
- Visual QA on staging.

No frontend change ships in the participant catalog beyond the Phase 0
enforcement (which is server-side).

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| **Phase 0 changes catalog behaviour for existing users** — anyone who relied on seeing ungranted topics loses them | This is the intended fix (the current behaviour is a security defect). **The project is pre-production with no live users (resolved decision 3), so no grants audit / backfill is required** — Phase 0 simply enables the intended enforcement. Still ships first and is independently verifiable on staging. |
| **Mental model adds a visibility axis** | The default after migration (`RESTRICTED` + Phase 0) is the behaviour the product always intended; teams learn `PUBLIC`/`PRIVATE` only when they reach for them. Admin UI copy explains each level on the selector. |
| Backfill picks the "wrong" default | Default is `RESTRICTED`, preserving intended behaviour. Flipping to `PUBLIC` is an explicit per-node action; nothing is auto-opened. |
| Resolver cost | One recursive CTE (as today) + two indexed flat filters. Benchmark in Phase 1; the index on `visibility` keeps `public_set` / `private_set` cheap. |
| Migration failure in production | Additive: one nullable-with-default column + a `CHECK` + an index. No data rewrite. Rollback is `ALTER TABLE DROP COLUMN` (D1 supports it). |

## Success Criteria

- **Phase 0:** a participant granted 1 of N topics sees exactly that
  subtree in `GET /topics` — not all N. (The bug reproduced during review
  no longer reproduces.)
- An admin can mark a topic `PRIVATE` and confirm it disappears from every
  non-admin response while remaining reachable in `/admin/topics/*`.
- `PUBLIC` topics appear in `GET /topics` for a freshly-registered user
  with zero grants.
- **`DRAFT` and `archived` topics never appear in `GET /topics` /
  `GET /topics/:id` for anyone — including admins and content creators**
  (resolved decision 1); they are reachable only via `/admin/topics/*`.
- Existing grants behave identically to today (cascade preserved; no
  migration of existing rows).
- `getEffectiveAccessTopicIds` p95 stays `< 50 ms` on the 1,000-topic
  benchmark fixture.
- All new admin-facing strings ship in both `dict-pt.ts` and `dict-en.ts`;
  `check-i18n-coverage.js` passes.

## Resolved Decisions

_Resolved by product, 2026-06-16._

1. **`PUBLIC` (and the catalog) must continue to exclude `archived` —
   and `DRAFT`.** Neither archived nor draft nodes are listed or shown in
   the catalog **to anyone, including admins/creators**. The
   participant-facing catalog is published-and-not-archived only; draft /
   archived content is reachable solely through the `/admin/topics/*`
   authoring surfaces. The resolver keeps `AND archived = 0` on
   `public_set`, and the controller's existing
   `status === PUBLISHED && !archived` filter (applied **before** the
   access check, independent of `userId`) enforces this for every caller.
   → reflected in Success Criteria.
2. **`PUBLIC` comment abuse is not a concern for now.** The user base is
   small in this phase; we ship the simple coupling (comment access
   follows visibility, §7) with no rate limiting or moderation toggle.
   Revisit only if `PUBLIC` adoption and user volume make spam real.
3. **No Phase 0 grants audit / backfill needed.** The project is
   pre-production with no live users to lock out, so the rollout risk does
   not exist. Phase 0 simply turns on the intended enforcement; the
   migration backfills `visibility = 'restricted'` and existing grants
   already describe who should see what.

---

## Deferred: negative grants ("denies")

> **Status: deferred — not part of this RFC's implementation.** Captured
> so the design survives if the per-principal exclusion cases (Motivation
> 2, 3, 5) reach the roadmap. Picking this up re-opens
> `IEnrollmentRepository`, adds two tables, a second recursive CTE, six
> admin routes, and an "Excluded topics" tab on the Access page.

**When this becomes necessary:** when a node must be visible to *some*
principals but hidden from *others* while its parent subtree stays granted
— e.g. an instructor-only section inside a participant course, or a
cohort-only preview. `PRIVATE` cannot express this (it hides from
non-admins entirely); only a per-principal deny can.

**Design (preserved from the original RFC draft):**

- **Two tables**, mirroring the allow tables, keyed `(user_id|group_id,
  topic_node_id)` with `UNIQUE` for idempotent `INSERT OR IGNORE`:
  `enrollments_user_deny`, `enrollments_user_group_deny`. A deny cascades
  to descendants exactly like an allow.
- **Resolver — "deny wins":** `(allow_tree ∪ public) − deny_tree −
  private`. The deny set is a *second* recursive CTE. "Deny wins" (not
  "most-specific wins") for predictability, least privilege, and a
  set-subtraction resolver with no per-edge precedence. Group deny beats
  user allow.
- **Ports:** `IEnrollmentRepository` gains
  `listUserDenies` / `denyUser` / `undenyUser` and the group equivalents,
  returning `EnrollmentUserDenyRecord` / `EnrollmentGroupDenyRecord`.
  `EnrollmentService` mirrors the audit-logged grant operations
  (`event: 'enrollment.deny_user' | 'enrollment.undeny_user' | …`).
- **HTTP:** six additive routes under `routes/admin/enrollments.ts`
  (`GET`/`POST`/`DELETE` of `/users/{id}/denies` and
  `/groups/{id}/denies`), OpenAPI per RFC 0003.
- **UI:** an "Excluded topics" tab on the unified Access page (same
  ordered-tree picker, opposite intent) + a warning chip when a granted
  topic is shadowed by a deny on the same principal/group.
- **FK hygiene:** `ON DELETE CASCADE` on `topic_node_id` for both deny
  tables to avoid orphans on hard-delete.
- **Tests:** allow ∩ deny, allow ⊃ deny (descendant denied), deny ⊃ allow
  (confirm deny wins), `PUBLIC` topic with deny, idempotent double-deny.

**Deferred open questions** (resolve when this is picked up):
- Surface denies in the participant UI ("this topic is restricted") or
  keep them silently absent (information-disclosure risk)?
- Group precedence on cohort overlaps — confirm "deny wins" matches
  product expectation.
- Time-bounded grants/denies (`grantedUntil`) — fold in or keep separate.

## References

- Enrollment port: `packages/shared/ports/i-enrollment-repository.ts`
- Resolver (cascade): `apps/api/src/adapters/db/d1-enrollment-repository.ts:51`
- **Catalog gating defect:** `apps/api/src/routes/public/catalog.topics.ts`
  (controller built with `enrollment = undefined`)
- Access enforcement guard: `apps/api/src/controllers/topics.controller.ts:41`, `:55`
- Comment access coupling (§7): `apps/api/src/routes/comments.router.ts`,
  `apps/api/src/controllers/comments.controller.ts`
- Existing shared enrollment UI being consolidated (§6):
  `apps/web/src/components/enrollment/enrollments-tab.tsx`
- Entity model: `packages/shared/types/entities.ts`
  (`Entities.Content.TopicNode`, `Entities.Identity.EnrollmentUser`,
  `Entities.Identity.EnrollmentUserGroup`)
- Related: RFC 0003 (route organisation / OpenAPI), RFC 0004 (catalog UX),
  RFC 0002 (i18n contract for new admin strings).
