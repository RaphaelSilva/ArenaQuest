# RFC 0005: Enrollment strategy review — topic exclusions and node visibility

**Date:** 2026-05-28
**Status:** Draft
**Author:** raphaelsilva
**Affected:**
- `packages/shared/ports/i-enrollment-repository.ts`
- `packages/shared/ports/i-topic-node-repository.ts`
- `packages/shared/types/entities.ts` (`Entities.Identity`, `Entities.Content`)
- `apps/api/src/adapters/db/d1-enrollment-repository.ts`
- `apps/api/src/adapters/db/d1-topic-node-repository.ts`
- `apps/api/src/controllers/topics.controller.ts`
- `apps/api/src/core/enrollment/enrollment-service.ts`
- `apps/api/src/routes/admin/enrollments.ts`
- `apps/api/migrations/*` (new migration)
- `apps/web/src/app/(protected)/admin/users/**` and `admin/topics/**` (visibility + deny UI)

---

## Summary

The current enrollment model is **purely additive and cascading**: a grant
on a `TopicNode` (direct user grant or group grant) extends access to every
descendant of that subtree, computed on the fly by a recursive CTE in
`D1EnrollmentRepository.getEffectiveAccessTopicIds`. There is no way to
say *"a user (or group) can see subtree X **except** node Y (and its
descendants)"*, and there is no per-node visibility primitive that
distinguishes "open to all enrolled" from "open only to explicit
grantees". As content becomes more granular — sensitive subtopics inside
otherwise public branches, instructor-only material, NDA-locked modules,
preview content gated by phase — the only available workaround is to
restructure the topic tree, which corrupts the pedagogical ordering and
breaks deep links.

This RFC reviews the enrollment strategy and proposes two additive,
backwards-compatible mechanisms:

1. **Negative grants (denies)** — `enrollments_user_deny` and
   `enrollments_user_group_deny`. A deny cascades to descendants exactly
   like an allow, and **deny wins** in the resolver. This lets an admin
   say *"grant subtree X, then deny node Y"* without touching the tree.
2. **Node-level visibility** — a `visibility` column on `topic_nodes`
   with three values: `PUBLIC` (visible to any authenticated user),
   `RESTRICTED` (visible only via an explicit allow grant — current
   behaviour, becomes the default for back-compat), and `PRIVATE`
   (invisible to anyone but admins and content creators, regardless of
   grants).

The combination covers the gating scenarios product has surfaced
without introducing per-node ACLs or a separate policy engine.

## Motivation

Concrete cases we cannot model today:

1. **"Grant the whole course except the final exam topic."** Today this
   requires either (a) splitting the exam off the course subtree, which
   reorders content and breaks links, or (b) granting every individual
   sibling of the exam one by one and hoping no new siblings are added
   later.
2. **Instructor-only / staff-only sections inside a participant
   subtree.** Same problem in reverse: there is no way to keep a node
   under a participant-facing branch but hide it from participants.
3. **NDA / cohort-gated previews.** A subtopic should be visible only
   to a specific cohort group, even though the rest of its subtree is
   open. Today the only option is restructure-and-cross-link.
4. **Default-private content.** New topics are reachable as soon as an
   ancestor is granted, which makes "draft inside a published branch"
   unsafe. `Entities.Config.TopicNodeStatus.DRAFT` already filters
   drafts out, but there is no equivalent for *published-but-restricted*
   nodes.
5. **Auditability.** Today, revoking access to a single descendant of
   a granted subtree is impossible without also revoking the ancestor,
   so the audit trail conflates "we never granted this" with "we
   intentionally excluded this".

The current cascade is correct for the happy path (enroll a student in
a course → they see the course). The gap is that **exclusions are
structurally impossible** in the current model, and every workaround
involves restructuring content for a permissions concern.

## Goals & Non-Goals

**Goals**
- Allow an admin to **exclude** a specific topic (and its descendants)
  from a user or group, even when an ancestor of that topic is granted.
- Allow an admin to mark a topic as `RESTRICTED` (must be explicitly
  granted) or `PRIVATE` (admin/creator only) at the node level.
- Keep the existing additive cascade behaviour intact — no migration of
  existing grants required, no behaviour change for currently enrolled
  users.
- Keep the resolver O(grants + descendants), single-query, no
  materialised cache.
- Preserve the **Ports & Adapters** boundary: all new semantics live in
  `IEnrollmentRepository` / `ITopicNodeRepository` and the
  `EnrollmentService`; adapters can swap to Postgres / DynamoDB without
  re-deriving the policy.

**Non-Goals**
- Generic ACLs (per-node read/write/comment grids). The model stays
  binary: *can see* vs *cannot see*.
- Time-bounded access (`grantedUntil`). Tracked as a separate backlog
  item; the schema additions here do not preclude it.
- Per-media exclusions (hide a single video inside an otherwise
  granted topic). Media inherits its parent topic's effective access.
- A new role beyond the existing `ROLES.ADMIN` /
  `ROLES.CONTENT_CREATOR`. Visibility bypass for those roles is
  enforced in the controller, not as a new role.
- Frontend redesign of the catalog. This RFC is about the policy
  layer; RFC 0004 owns the participant catalog UX. The admin UI
  changes here are minimal additions to existing surfaces.

## Current State (for reference)

`IEnrollmentRepository` exposes:

```ts
getEffectiveAccessTopicIds(userId: string): Promise<string[]>;
listUserGrants / grantUser / revokeUser({ cascade });
listGroupGrants / grantGroup / revokeGroup({ cascade });
```

`D1EnrollmentRepository.getEffectiveAccessTopicIds`:

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

`TopicsController.listPublished` / `getPublishedById` already gate by
the result set when a `userId` is supplied. Routes pass `undefined`
for admins / content creators, which is how the bypass works today.

## Proposed Design

### 1. Node visibility (additive column)

Add a `visibility` column to `topic_nodes`:

```ts
// packages/shared/types/entities.ts → Entities.Config
export enum TopicVisibility {
  /** Visible to any authenticated user, regardless of grants. */
  PUBLIC = 'public',
  /** Visible only when the user (or one of their groups) has an
   *  allow-grant on this node or an ancestor. Current default semantics. */
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

Migration: add the column with default `'restricted'` and **backfill
all existing rows to `'restricted'`**. That preserves today's
behaviour exactly — a topic is reachable only via an allow grant on
itself or an ancestor.

> **Rationale for `RESTRICTED` as default rather than `PUBLIC`:**
> the platform today treats published topics as gated by enrollment,
> not as world-readable. Flipping the default to `PUBLIC` would silently
> open every existing topic to every authenticated user — a security
> regression. Admins can opt into `PUBLIC` per node once the column
> ships.

### 2. Negative grants (denies)

Two new tables, mirroring the existing allow tables:

```sql
CREATE TABLE enrollments_user_deny (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  topic_node_id TEXT NOT NULL,
  granted_by    TEXT NOT NULL,
  granted_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, topic_node_id)
);

CREATE TABLE enrollments_user_group_deny (
  id            TEXT PRIMARY KEY,
  group_id      TEXT NOT NULL,
  topic_node_id TEXT NOT NULL,
  granted_by    TEXT NOT NULL,
  granted_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (group_id, topic_node_id)
);
```

A row in either table means *"this user (or group) is denied access to
this topic and to all its descendants"*. Like allow grants, denies
cascade down the tree.

### 3. Resolver semantics — deny wins

Updated `getEffectiveAccessTopicIds` returns
`allow_set − deny_set − private_set`, where:

- `allow_set` = today's recursive expansion of allow grants
  (descendants of any allow-granted node).
- `deny_set` = recursive expansion of deny grants (descendants of any
  deny-granted node) for the same user / their groups.
- `private_set` = all topics with `visibility = 'private'` (always
  removed for non-admin users).

`PUBLIC` topics are unioned in **after** the deny filter, on the
assumption that an explicit deny on a public topic still means
"hidden for this user". A `PUBLIC` topic with no explicit deny is
visible even with no allow grant.

Concrete D1 query (single round-trip):

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
  deny_seed(id) AS (
    SELECT topic_node_id FROM enrollments_user_deny WHERE user_id = ?1
    UNION
    SELECT egd.topic_node_id
      FROM enrollments_user_group_deny egd
      JOIN user_group_members ugm ON ugm.group_id = egd.group_id
     WHERE ugm.user_id = ?1
  ),
  allow_tree(id) AS (
    SELECT id FROM allow_seed
    UNION ALL
    SELECT tn.id FROM topic_nodes tn JOIN allow_tree ON tn.parent_id = allow_tree.id
  ),
  deny_tree(id) AS (
    SELECT id FROM deny_seed
    UNION ALL
    SELECT tn.id FROM topic_nodes tn JOIN deny_tree ON tn.parent_id = deny_tree.id
  ),
  public_set(id) AS (
    SELECT id FROM topic_nodes WHERE visibility = 'public' AND archived = 0
  )
SELECT DISTINCT id FROM (
  SELECT id FROM allow_tree
  UNION
  SELECT id FROM public_set
)
WHERE id NOT IN (SELECT id FROM deny_tree)
  AND id NOT IN (SELECT id FROM topic_nodes WHERE visibility = 'private');
```

**Why "deny wins" and not "most-specific wins":**

- *Predictability:* an admin who applies a deny expects it to take
  effect; a sibling allow further down should not silently re-open the
  branch.
- *Least privilege:* matches how most access systems (IAM, file ACLs)
  resolve conflicts.
- *Cheap to reason about:* the resolver is "subtract one set from
  another", no per-edge precedence calculation.

The alternative — "the closest grant to the node wins" — is documented
under [Alternatives](#alternatives-considered) and rejected.

### 4. Admin bypass

Today, callers pass `undefined` for `userId` when the requester is an
admin or content creator (see `topics.router.ts:26`). This RFC keeps
that bypass for the allow / deny layer **and extends it to the
`PRIVATE` filter**: admins and content creators see `PRIVATE` topics;
nobody else does. No new role; the gate is enforced in
`TopicsController` exactly where the `userId` decision is made today.

### 5. Port additions

```ts
// packages/shared/ports/i-enrollment-repository.ts
export interface EnrollmentUserDenyRecord {
  id: string;
  userId: string;
  topicNodeId: string;
  grantedBy: string;
  grantedAt: string;
}
export interface EnrollmentGroupDenyRecord {
  id: string;
  groupId: string;
  topicNodeId: string;
  grantedBy: string;
  grantedAt: string;
}

export interface IEnrollmentRepository {
  // unchanged
  getEffectiveAccessTopicIds(userId: string): Promise<string[]>;
  listUserGrants(userId: string): Promise<EnrollmentUserRecord[]>;
  grantUser(...): Promise<EnrollmentUserRecord>;
  revokeUser(...): Promise<void>;
  listGroupGrants(...): Promise<EnrollmentGroupRecord[]>;
  grantGroup(...): Promise<EnrollmentGroupRecord>;
  revokeGroup(...): Promise<void>;

  // new
  listUserDenies(userId: string): Promise<EnrollmentUserDenyRecord[]>;
  denyUser(userId: string, topicNodeId: string, grantedBy: string): Promise<EnrollmentUserDenyRecord>;
  undenyUser(userId: string, topicNodeId: string): Promise<void>;

  listGroupDenies(groupId: string): Promise<EnrollmentGroupDenyRecord[]>;
  denyGroup(groupId: string, topicNodeId: string, grantedBy: string): Promise<EnrollmentGroupDenyRecord>;
  undenyGroup(groupId: string, topicNodeId: string): Promise<void>;
}
```

`EnrollmentService` grows the mirror operations (`denyUser`,
`undenyUser`, `denyGroup`, `undenyGroup`), each emitting the same
structured `console.info` audit line as the existing grant methods,
with `event: 'enrollment.deny_user' | 'enrollment.undeny_user' | …`.

`ITopicNodeRepository` exposes `visibility` on
`TopicNodeRecord`, `CreateTopicNodeInput.visibility?`, and
`UpdateTopicNodeInput.visibility?`. The repository's update path
already handles partial patches; no resolver changes needed there.

### 6. HTTP surface (admin)

Additive routes under `apps/api/src/routes/admin/enrollments.ts`:

| Method | Path | Body | Notes |
|---|---|---|---|
| `GET`    | `/users/{userId}/denies`               | —                     | List per-user denies. |
| `POST`   | `/users/{userId}/denies`               | `{ topicNodeId }`     | Add (idempotent). `201` created / `200` already-denied. |
| `DELETE` | `/users/{userId}/denies/{topicId}`     | —                     | Remove. `204`. |
| `GET`    | `/groups/{groupId}/denies`             | —                     | List per-group denies. |
| `POST`   | `/groups/{groupId}/denies`             | `{ topicNodeId }`     | Add (idempotent). |
| `DELETE` | `/groups/{groupId}/denies/{topicId}`   | —                     | Remove. `204`. |

`PATCH /admin/topics/{id}` already accepts a partial update; extend its
schema to accept `visibility?: TopicVisibility`. No new route needed
for visibility.

All routes follow RFC 0003's OpenAPI / `createRoute` pattern and
return the same envelope shapes as the existing allow routes.

### 7. Data model summary

```
topic_nodes
  + visibility TEXT NOT NULL DEFAULT 'restricted'
    CHECK (visibility IN ('public','restricted','private'))

enrollments_user_deny       (id, user_id, topic_node_id, granted_by, granted_at)
enrollments_user_group_deny (id, group_id, topic_node_id, granted_by, granted_at)
```

Unique constraints on `(user_id, topic_node_id)` and
`(group_id, topic_node_id)` so `INSERT OR IGNORE` is idempotent, matching
the existing allow-table behaviour.

### 8. Frontend impact (admin only)

- **Topic editor** (`apps/web/src/app/(protected)/admin/topics/**`) —
  add a `visibility` select with three options
  (`public` / `restricted` / `private`), wired to the patched topic
  update endpoint. Inline copy explains the semantics; copy goes through
  the i18n dict per RFC 0002.
- **User enrollment manager** — add an "Excluded topics" tab alongside
  the existing "Granted topics" view. Same picker, opposite intent.
- **Group enrollment manager** — same addition for groups.

The participant catalog (RFC 0004) needs **no changes**: it already
calls `GET /topics` / `GET /topics/:id` with the user's JWT, and those
endpoints now return the deny-aware, visibility-aware set. The 404
that the controller already returns for non-accessible topics covers
the deny path identically.

## Alternatives Considered

1. **"Most-specific wins" instead of "deny wins".** A more-specific
   allow below a deny ancestor (or vice-versa) would override the
   ancestor. *Rejected:* harder to reason about, easier to
   misconfigure into a security hole, requires per-node distance
   computation in the resolver.
2. **Per-node ACL table** (`(topic_id, principal_id, principal_kind,
   action)`). *Rejected:* over-engineered for the binary
   visibility model; complicates the recursive CTE; makes audits
   harder.
3. **Tag-based gating** — denylist topics by tag rather than by id.
   *Rejected:* couples permissions to authoring metadata; renaming a
   tag silently changes who sees what.
4. **Structural restructure** (the current workaround — move the
   restricted node out of the public subtree). *Rejected on
   principle:* permissions concerns should not dictate pedagogical
   ordering.
5. **Visibility column only, no denies.** Covers default-private but
   not "grant subtree X except Y" without lifting Y out of X.
   *Rejected as insufficient* — case 1 in Motivation stays unsolved.
6. **Denies only, no visibility column.** Covers exclusions but
   leaves no way to mark a topic admin-only without remembering to
   deny every existing user / group. *Rejected as insufficient* —
   case 4 in Motivation stays unsolved.

The two mechanisms are complementary and together close the gap.

## Implementation Plan

Estimated total: **~4–5 dev days** across three milestones, all
shippable independently.

### Phase 1 — Schema + ports (~1 d)
- Migration: add `visibility` to `topic_nodes` (default `'restricted'`,
  backfill); create `enrollments_user_deny` and
  `enrollments_user_group_deny` with unique constraints.
- Extend `Entities.Config.TopicVisibility` enum.
- Extend `TopicNodeRecord` / inputs and `IEnrollmentRepository` with
  the new methods and records.
- Update `D1TopicNodeRepository` to read/write the new column.
- Update `D1EnrollmentRepository`: implement deny CRUD + the
  expanded `getEffectiveAccessTopicIds` query above.
- Vitest coverage (`@cloudflare/vitest-pool-workers`):
  - `getEffectiveAccessTopicIds` with allow only, deny only,
    allow ∩ deny, allow ⊃ deny (descendant denied), deny ⊃ allow
    (deny ancestor + redundant allow descendant — confirm deny wins),
    `PUBLIC` topic with deny, `PRIVATE` topic with allow.
  - Idempotency: double `denyUser` returns the same row.

### Phase 2 — Controller + admin routes (~1.5 d)
- Extend `EnrollmentService` with `denyUser` / `undenyUser` /
  `denyGroup` / `undenyGroup`, mirroring the existing audit logs.
- Add the six new admin routes in
  `apps/api/src/routes/admin/enrollments.ts` (OpenAPI via
  `createRoute` per RFC 0003).
- Extend the existing admin `PATCH /topics/{id}` schema with
  `visibility?`.
- Update `TopicsController.getPublishedById` / `listPublished` so
  the admin / content-creator bypass also includes `PRIVATE` topics
  (today the bypass is implicit via the `userId === undefined`
  branch — make the `PRIVATE` rule explicit in that branch).
- Integration tests against an in-memory D1 covering: participant
  cannot see denied topic, admin can see private topic, public
  topic visible without grant.

### Phase 3 — Admin UI (~1.5 d)
- Topic editor: visibility selector with help copy (PT + EN dict
  keys); calls the patched update endpoint.
- User / group enrollment managers: "Excluded topics" tab with the
  same topic picker UI as the existing "Granted topics" tab; calls
  the new deny endpoints.
- Visual QA on staging.

No frontend change ships in the participant catalog.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| **Mental model becomes harder** (allow + deny + visibility) | The default after migration is *identical* to today's behaviour; teams only learn the new primitives when they reach for them. Admin UI copy explains precedence on the visibility selector and the deny tab. |
| Resolver query grows from one recursive CTE to two | Both CTEs are bounded by `grants + descendants`; in practice the deny set is small (≤ 10 per user expected). Benchmark in Phase 1 against the same 1,000-topic fixture as today; abort and reconsider if > 100 ms on D1. |
| **Silent re-grants when an admin re-enables a denied node** by mistake (e.g. uses the allow UI instead of removing the deny) | Admin "Granted topics" UI surfaces a warning chip when a granted topic is shadowed by a deny on the same user / one of their groups; resolver still does the right thing — UI just clarifies intent. |
| Backfill picks the "wrong" default | The default is `RESTRICTED`, which preserves *current* behaviour exactly. Flipping topics to `PUBLIC` is an explicit per-node action; nothing is auto-opened. |
| Deny rows orphaned when a topic is hard-deleted | Add `ON DELETE CASCADE` on `topic_node_id` foreign keys for both deny tables (mirror what the existing allow tables do, or add it consistently to all four if missing). |
| Group denies vs user allows: who wins? | Deny always wins. A user with an explicit allow on a topic whose group is denied still cannot see the topic. Documented in the admin UI; tested in Phase 1. |
| Audit gap: revoking a deny is silent today | `undenyUser` / `undenyGroup` emit the same structured `console.info` audit log as the existing revoke methods (`event: 'enrollment.undeny_user'` etc.). |
| Migration failure in production | Migration is additive (one nullable-with-default column, two new tables). No data rewrite. Safe to roll forward; rollback is `DROP TABLE` + `ALTER TABLE DROP COLUMN` (D1 supports it as of 2024). |

## Success Criteria

- An admin can grant a subtree on a user, then deny one descendant, and
  the user (a) sees the rest of the subtree and (b) does not see the
  denied node or any of *its* descendants — verified end-to-end via
  `GET /topics` and `GET /topics/:id`.
- An admin can mark a topic `PRIVATE` and confirm it disappears from
  every non-admin response while remaining reachable in the
  `/admin/topics/*` surfaces.
- `PUBLIC` topics appear in `GET /topics` for a freshly-registered
  user with zero grants.
- Existing grants behave identically to today (regression suite from
  Phase 1 of `D1EnrollmentRepository` tests stays green; no migration
  of existing rows).
- `getEffectiveAccessTopicIds` p95 stays under ~50 ms on the existing
  1,000-topic benchmark fixture extended with 10 deny rows.
- All new admin-facing strings ship in both `dict-pt.ts` and
  `dict-en.ts`; `check-i18n-coverage.js` passes.

## Open Questions

These are flagged for product input before moving to **Proposed**:

1. **Should `PUBLIC` ignore `archived = true`?** Current draft excludes
   archived nodes from `public_set`. Confirm this matches the
   editorial workflow.
2. **Should we expose denies in the participant-facing UI** ("This
   topic is restricted")? Default in this RFC is *no* — denied topics
   are simply absent from the catalog payload, identical to
   not-granted topics. Surfacing "you don't have access to X" risks
   information disclosure.
3. **Group precedence**: when a user belongs to multiple groups,
   one granting and one denying the same topic, deny wins. Is that
   what product expects for cohort overlaps?
4. **Time-bounded grants / denies** (`grantedUntil`): out of scope
   here; confirm we want to track separately rather than fold into
   this RFC.

## References

- Current enrollment port:
  `packages/shared/ports/i-enrollment-repository.ts`
- Current resolver:
  `apps/api/src/adapters/db/d1-enrollment-repository.ts:51`
- Current access enforcement:
  `apps/api/src/controllers/topics.controller.ts:35`,
  `apps/api/src/controllers/topics.controller.ts:50`
- Admin enrollment routes (extension point):
  `apps/api/src/routes/admin/enrollments.ts`
- Entity model:
  `packages/shared/types/entities.ts` (`Entities.Identity.EnrollmentUser`,
  `Entities.Identity.EnrollmentUserGroup`, `Entities.Content.TopicNode`)
- Related: RFC 0003 (route organisation / OpenAPI), RFC 0004
  (catalog UX — consumer of the resolver output), RFC 0002 (i18n
  contract for new admin strings).
