# RFC 0008: User Dashboard with Topic Recommendations and Badge Achievements

**Date:** 2026-06-20
**Status:** Draft
**Revised:** 2026-09-30
**Author:** raphaelsilva
**Affected:**
- `packages/shared/types/dashboard.ts` — current learner-dashboard contract; a successor may extend it with recommendations.
- `apps/api/src/controllers/me-dashboard.controller.ts` and `apps/api/src/routes/me/gamification.ts` — current aggregate and authenticated `GET /v1/me/dashboard` route.
- `apps/api/src/adapters/db/d1-enrollment-repository.ts` — existing effective-access authority that recommendations must not bypass.
- `apps/web/src/lib/dashboard-api.ts` and `apps/web/src/app/(protected)/dashboard/` — current dashboard composition and learner surface.
- A future recommendation port, D1 adapter/migration and versioned admin routes — names remain subject to architecture review and Gate 1.

> This RFC has been reconciled with the product currently present in `main`.
> Dashboard, progress and badge capabilities were delivered after the original
> draft in Milestones 5, 7, 15 and 16. They are facts of the current product, not
> work still proposed here. The only material product gap retained by this draft
> is group-curated topic recommendations. No milestone or implementation should
> be opened until architectural review and the human Gate 1 decide the disposition
> recorded in [Recommendation](#recommendation).

---

## Summary

The original RFC combined three outcomes:

1. a learner dashboard;
2. group-curated topic recommendations; and
3. badge definitions, eligibility, approval and learner display.

The first and most of the third already exist, but in a materially different
shape from the original proposal. `/v1/me/dashboard` and `/dashboard` expose the
learner's gamification state; badge rules award achievements automatically;
catalog administration and per-player award/revoke flows are separate admin
surfaces. Reintroducing the old schema or manual pending-approval queue would
duplicate and conflict with shipped behavior.

This reconciliation therefore narrows the unresolved opportunity to:

> Let an authorized operator curate topic recommendations for user groups and
> show the recommendations that are visible to a learner in the existing
> dashboard, without replacing progress, roadmap, quests, missions or badges.

The candidate contract below is intentionally reviewable but remains non-binding
while the RFC is `Draft`.

## Motivation

The current dashboard helps learners understand progress and rewards, but it does
not let an operator explicitly guide a group toward selected topics. Enrollment
answers "may this learner access the topic?"; progress answers "what has this
learner done?"; a recommendation would answer "what does the instructor suggest
next?" These concepts must remain independent.

## Current State (for reference)

### Facts verified in the repository

- Milestone 5 implemented `/dashboard`, learner progress and roadmap data.
- Milestone 7 implemented `/v1/me/dashboard`, XP, streaks, quests, missions,
  automatic rule-based badge awards and learner badge display.
- RFC 0009 / Milestone 15 implemented the gamification definition catalog,
  including badge CRUD.
- RFC 0010 / Milestone 16 implemented per-player progression administration,
  including direct badge award and revoke.
- A user may belong to more than one group through `user_group_members`.
- Topic visibility and effective access already have dedicated policy and query
  paths. A recommendation must not grant access or bypass those paths.
- The web dashboard currently composes `/v1/me/dashboard`, leaderboard, topics
  and topic-progress reads in parallel. Its API shape has no recommendations
  field.
- No `topic_recommendations` table, recommendation repository, admin API or admin
  UI exists in the inspected product.

### Original proposal disposition

| Original capability | Current disposition |
|---|---|
| Create a learner dashboard | Superseded by Milestones 5 and 7 |
| Show current / last-watched topic | Superseded by the shipped roadmap and progress model; no reliable media-resume position exists |
| Show group-curated recommendations | Not implemented; candidate remaining scope |
| Define badge catalog | Superseded by RFC 0009 / Milestone 15 |
| Detect badge eligibility | Superseded by the Milestone 7 rule engine |
| Require manual approval for every badge | Conflicts with automatic awards; do not restore as a global rule |
| Display earned badges | Implemented on the learner dashboard |
| Manually award or revoke a badge | Implemented by RFC 0010 / Milestone 16 |

## Goals & Non-Goals

### Goals for the remaining candidate

- Allow an authorized backoffice user to list, create, edit, order, activate and
  deactivate topic recommendations scoped to one user group.
- Return to a learner only recommendations from groups they currently belong to
  and topics they are currently entitled to read.
- Add recommendations to the existing learner dashboard without creating a
  second dashboard or replacing its progress and gamification sections.
- Keep recommendation curation independent from enrollment, topic progress and
  gamification state.
- Define deterministic behavior for duplicate topics and stale references before
  implementation begins.
- Preserve the existing API versioning, OpenAPI, Ports & Adapters, RBAC and web
  i18n conventions.

### Non-goals

- Rebuilding the learner dashboard, progress aggregation, roadmap, badge catalog,
  badge engine or per-player progression administration.
- Restoring `pending` / `approved` / `rejected` badge awards.
- Algorithmic, behavioral or per-user recommendations.
- Recommendations that enroll a user, alter topic visibility or create progress.
- Persisted video/media playback position or a "last watched" contract.
- Notifications, email, push, leaderboards or recommendation analytics.
- Creating a milestone or beginning implementation as part of this RFC
  reconciliation.

## Users and Outcomes

| User | Intended outcome |
|---|---|
| Learner | Sees a short, understandable set of instructor-curated topics that they can open now |
| Admin / content operator | Curates guidance for a group without changing enrollment or reward rules |
| Product / architecture reviewer | Can decide whether the remaining value justifies a successor RFC and milestone |

## Proposed Design

The following is a candidate design for review, not an approved implementation
contract. Gate 1 must resolve the decisions listed in [Open Questions](#open-questions)
before a successor RFC or milestone treats it as binding.

### Product flows

#### Curate recommendations

1. The operator opens a group's recommendation administration surface.
2. The system lists the group's existing recommendations and their active state.
3. The operator selects a topic, supplies the learner-facing reason and chooses
   its order.
4. The system rejects an invalid group, invalid topic or duplicate
   `(group, topic)` pair.
5. The operator may edit the reason/order or deactivate the recommendation.

#### Read recommendations

1. An authenticated learner opens the existing dashboard.
2. The API resolves all current group memberships.
3. It takes active recommendations for those groups, removes topics the learner
   cannot currently read and deduplicates repeated topic ids.
4. The dashboard renders the resulting topics as links to `/catalog/{topicId}`.
5. No applicable recommendation is a normal empty state; the rest of the
   dashboard remains usable.

#### Membership or access changes

- Removing a learner from a group removes that group's recommendations from the
  learner's next dashboard read.
- Revoking topic access hides the recommendation from that learner without
  deleting the curator's group-level record.
- Regaining membership/access makes an active recommendation eligible again.

### Candidate contracts

These contracts describe the smallest coherent successor scope. Names and final
authorization policy require Gate 1 approval.

#### Data

`topic_recommendations`:

| Field | Contract |
|---|---|
| `id` | UUID primary key |
| `group_id` | Required reference to `user_groups`; delete behavior must be chosen in architecture review |
| `topic_node_id` | Required reference to `topic_nodes`; stale/deleted behavior must be chosen in architecture review |
| `reason` | Required trimmed learner-facing text; localized content policy is an open decision |
| `sort_order` | Integer ordering within a group |
| `active` | Boolean; deactivation is preferred to destructive history loss |
| `created_at`, `updated_at` | UTC timestamps |

Required invariant: `UNIQUE(group_id, topic_node_id)`.

#### Participant read model

Add an always-present, empty-safe collection to the existing dashboard response:

```typescript
interface DashboardRecommendation {
  topicId: string;
  title: string;
  reason: string;
}

interface DashboardShape {
  // Existing fields remain unchanged.
  recommendations: DashboardRecommendation[];
}
```

- Route: extend `GET /v1/me/dashboard`; do not add a second learner dashboard.
- Empty state: `recommendations: []`, not `404` and not a failure of the other
  dashboard sections.
- Authorization: authenticated learner only; each item must pass the existing
  effective-access / visibility policy before it is returned.
- Deduplication: one topic appears at most once even when recommended by multiple
  groups. Which reason wins and how source groups are audited are open decisions;
  internal group ids are not exposed to the learner without a demonstrated UI need.
- Ordering across multiple groups is an open product decision and must be settled
  before this contract can be accepted.

#### Administration

Candidate REST surface under the existing versioned admin router:

| Method | Path | Outcome |
|---|---|---|
| `GET` | `/v1/admin/groups/{groupId}/recommendations` | Ordered list for one group |
| `POST` | `/v1/admin/groups/{groupId}/recommendations` | Create one recommendation |
| `PATCH` | `/v1/admin/groups/{groupId}/recommendations/{id}` | Edit reason, order or active state |
| `DELETE` | `/v1/admin/groups/{groupId}/recommendations/{id}` | Optional hard delete; decision pending |

All request/response schemas must be represented in OpenAPI and shared/generated
types. Controllers own business rules; a repository port owns persistence; D1 is
an adapter detail.

### Edge cases

- Learner belongs to no groups: return an empty list.
- Same topic is recommended by multiple groups: return it once; unresolved
  ordering/attribution policy applies.
- Topic is unpublished, private, excluded or otherwise inaccessible: omit it
  rather than revealing its title or existence.
- Recommendation points to an archived/deleted topic: behavior depends on the
  reference lifecycle decision; never return a broken dashboard link.
- Recommendation is deactivated while cached: current dashboard uses private
  short-lived caching; acceptable staleness must be agreed before implementation.
- One recommendation query fails: current dashboard controller degrades failed
  subsections to empty/null. Architecture review must decide whether the new
  section follows that policy or fails the aggregate request.
- A reason is blank, whitespace-only or exceeds the agreed length: reject with
  `400 BadRequest`; the maximum length remains to be decided.
- Concurrent reorder operations: final contract must prevent duplicate or
  unstable ordering within a group.

## Dependencies

- Existing group membership model (`user_groups`, `user_group_members`).
- Existing topic effective-access and visibility policy.
- Existing `/v1/me/dashboard` controller and `DashboardShape`.
- Existing dashboard client/component and EN/PT dictionary system.
- Existing admin router, role guards, OpenAPI generation and D1 migration flow.
- Architecture review and human Gate 1 before milestone creation.

## Alternatives Considered

1. **Accept and implement RFC 0008 as originally written.** Rejected. The shipped
   dashboard, automatic badge engine, catalog administration and award/revoke
   flows make most of that scope duplicate or contradictory.
2. **Rewrite RFC 0008 in place as if it had always proposed recommendations
   only.** Rejected. That would erase why the dashboard and badge portions were
   superseded and make later architectural decisions difficult to audit.
3. **Supersede RFC 0008 and, if Gate 1 confirms value, create a
   recommendation-only successor.** Recommended. It preserves history and gives
   the remaining capability a clean decision record.
4. **Close the recommendation delta without a successor.** Viable if product
   ownership decides curated guidance does not justify another admin workflow and
   dashboard query. In that case RFC 0008 should become `Superseded`, with no new
   milestone.
5. **Reuse enrollment records as recommendations.** Rejected. Enrollment answers
   whether content may be accessed; recommendation answers what an instructor
   suggests. Coupling them would turn guidance changes into authorization changes.
6. **Use per-user or algorithmic recommendations.** Deferred, not rejected.
   Neither has an evidenced requirement in the original RFC or current product,
   and both require different inputs, governance and success measures.

## Implementation Plan

There is no approved implementation estimate while this RFC remains `Draft`.
The only authorized work in the current phase is documentation and review:

### Phase 0 — Reconciliation and Gate 1 (this change)

1. Reconcile the original claims against `main` and validate this document.
2. Obtain product-owner and architecture review of the recommendation delta.
3. Resolve the decisions in [Open Questions](#open-questions).
4. Choose one disposition: create a successor RFC or close the delta.

### Phase 1A — If the recommendation delta is approved

1. Create a recommendation-only successor RFC with the Gate 1 decisions embedded
   in its data, API, authorization, ordering, lifecycle and failure contracts.
2. Run a security and performance review against effective-access resolution and
   the existing dashboard aggregate.
3. Only then create a milestone and independently shippable API/web tasks.
4. Estimate delivery from that accepted contract; do not carry forward the old
   RFC's `8–10 dev days` estimate because most of its scope no longer applies.

### Phase 1B — If the recommendation delta is declined

1. Change RFC 0008 and its README row to `Superseded`.
2. Record Milestones 5, 7, 15 and 16 as the delivered disposition and explicitly
   record group-curated recommendations as rejected.
3. Create no milestone and perform no implementation work.

## Tradeoffs & Risks

| Risk | Mitigation / required decision |
|---|---|
| Recommendation leaks a restricted topic | Apply server-side effective-access filtering before projection |
| Multiple group memberships produce noisy or unstable results | Decide cap and deterministic cross-group ordering at Gate 1 |
| Recommendation is mistaken for enrollment | Keep records and APIs separate; recommendation never mutates access |
| Stale topic creates a broken link | Define archive/delete lifecycle and cover it with integration tests |
| Dashboard aggregate grows slower or more fragile | One bounded indexed query; measure against the existing dashboard budget |
| Free-text reasons conflict with build-time i18n | Decide whether reasons are tenant-authored content or localized UI copy |
| Original RFC is mistaken for unimplemented badge work | Keep the reconciliation table and supersession recommendation explicit |

## Success Criteria

The following are testable candidate criteria, not authorization to implement:

- An authorized operator creates a recommendation for group G and topic T; a
  current member of G with access to T receives exactly one T in
  `GET /v1/me/dashboard`.
- A non-member does not receive G's recommendation.
- A member without effective access to T does not receive T and the response does
  not disclose T's title.
- If two of the learner's groups recommend T, the dashboard returns T once and
  applies the Gate 1-approved reason, attribution and ordering rule.
- Deactivating a recommendation removes it from the next uncached dashboard read
  without deleting enrollment or progress rows.
- Removing a learner from G removes G-only recommendations on the next uncached
  read; adding the learner back restores active, accessible recommendations.
- Invalid group/topic ids and duplicate `(group, topic)` creation are rejected
  with observable `4xx` responses and no partial write.
- A learner with no applicable recommendations receives
  `recommendations: []`; XP, streak, quests, missions, badges, leaderboard and
  roadmap continue to render.
- Admin APIs are role-gated, included in OpenAPI and covered by route-level tests.
- EN/PT dictionaries keep identical keys; no hardcoded user-facing string is
  introduced in the web surface.
- Focused API and web tests, `make lint` and `make build` pass for the future
  implementation.

## Assumptions

- Group-level curation remains the desired model from the original RFC; there is
  no evidence of a requirement for per-user or algorithmic recommendation.
- The existing dashboard is the only learner surface to extend.
- Recommendation reasons are authored by an operator and displayed verbatim
  after normal validation/escaping; whether that makes them tenant content or
  localizable copy is unresolved.
- Existing effective-access resolution is the authority for whether a learner may
  see a recommended topic.

## Open Questions

1. **Disposition:** approve creation of a recommendation-only successor RFC, or
   reject the remaining opportunity as insufficiently valuable.
2. **Operator role:** `ADMIN` only, or `ADMIN || CONTENT_CREATOR`. The latter is
   consistent with topic curation but expands who can target groups.
3. **Multi-group ordering and cap:** define precedence, stable tie-breaker and the
   maximum number rendered on the dashboard; also decide which reason wins when
   the same topic is recommended by more than one group.
4. **Reason localization:** one tenant-authored string, per-language values, or no
   free-text reason.
5. **Topic/group lifecycle:** cascade delete, prevent deletion, or retain an
   inactive tombstone when a referenced record disappears.
6. **Delete semantics:** hard delete versus deactivate-only.
7. **Aggregate failure policy and cache staleness:** empty-section degradation
   versus failing the request, and the acceptable freshness window.
8. **Dashboard performance budget:** preserve the original `< 200 ms` M7 target
   or approve a new measured threshold and fixture.

Decision loop: product ownership answers product-value, operator-role, display and
localization questions in the RFC review; architecture answers lifecycle, failure,
cache and performance questions. Each answer moves to a dated `Resolved Decisions`
section before this RFC's disposition or a successor RFC is accepted.

## Recommendation

**Recommend superseding RFC 0008 rather than implementing or accepting it as
written.** Its dashboard and badge proposals were overtaken by Milestones 5, 7,
15 and 16, and its mandatory manual badge-approval model conflicts with the
shipped automatic rule engine.

If Gate 1 confirms that instructor-curated group guidance remains a priority,
create a new recommendation-only RFC using the candidate scope and unresolved
decisions above. If Gate 1 declines that value, mark RFC 0008 `Superseded` by the
existing milestones and close the recommendation delta as rejected. Until then,
keep this RFC `Draft`, create no milestone and start no implementation.

## References

- [Milestone 5 — Engagement & Student Progress](../milestones/5-engagement-and-student-progress/milestone.md)
- [Milestone 7 — Gamification Engine & Learner UX](../milestones/7-gamification-engine-and-learner-ux/milestone.md)
- [RFC 0009 — Gamification Catalog Administration](./0009-gamification-catalog-administration.md)
- [Milestone 15 — Gamification Catalog Administration](../milestones/15-gamification-catalog-administration/milestone.md)
- [RFC 0010 — Player Progression Administration](./0010-player-progression-administration.md)
- [Milestone 16 — Player Progression Administration](../milestones/16-player-progression-administration/milestone.md)
- Current dashboard contract: `packages/shared/types/dashboard.ts`
- Current dashboard aggregate: `apps/api/src/controllers/me-dashboard.controller.ts`
- Current dashboard composition: `apps/web/src/lib/dashboard-api.ts`
- Group membership schema: `apps/api/migrations/0011_create_enrollment_tables.sql`
- Badge schema: `apps/api/migrations/0020_create_badges.sql`