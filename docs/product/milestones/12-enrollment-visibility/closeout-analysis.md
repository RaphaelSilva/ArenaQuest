# Milestone 12 — Closeout Analysis

**Milestone:** [12 — Enrollment enforcement and node visibility](./milestone.md)
**RFC:** [0005 — Enrollment enforcement and node visibility](../../RFCs/0005-enrollment-exclusions-and-visibility.md)
**Date:** 2026-06-17
**Branch:** `candidate/m12-enrollment-visibility` (merged per-task; `develop` intentionally untouched)

---

## 1. Outcome

All 8 tasks delivered and merged into the candidate branch. The catalog now enforces
enrollment, a per-node `visibility` primitive (`public` / `restricted` / `private`)
gates reads through a single-CTE resolver, the admin/creator bypass is explicit, and
the admin UI gained a per-topic visibility selector plus a unified principal-centric
Access page.

| # | Task | Result |
|---|------|--------|
| 01 | Catalog enrollment enforcement (Phase 0) | ✅ Done |
| 02 | `visibility` column, enum, ports, adapter (Phase 1) | ✅ Done |
| 03 | Resolver `(allow ∪ public) − private` rewrite (Phase 1) | ✅ Done |
| 04 | Admin/creator `PRIVATE` bypass + admin `PATCH` visibility (Phase 2) | ✅ Done |
| 05 | Topic-editor visibility selector (Phase 3) | ✅ Done |
| 06 | Unified Access page + `GET /admin/groups` (Phase 3) | ✅ Done |
| 07 | Detail-page "Manage access" deep-link + retire `enrollments-tab` (Phase 3) | ✅ Done |
| 08 | Visual QA + closeout + RFC status | ✅ Done |

## 2. RFC 0005 Success Criteria — verification

Each criterion is encoded as an automated test; the suite stands in for the manual
staging walk-through (see §6 for the one remaining manual step).

| Success Criterion | Status | Evidence |
|---|---|---|
| Participant granted 1 of N topics sees exactly that subtree in `GET /topics` (Phase 0 bug fixed) | ✅ | `topics.router.spec.ts` → "Phase 0 — enrollment enforcement" |
| Admin can mark a topic `PRIVATE`; it disappears for non-admins, stays in `/admin/topics/*` | ✅ | `topics.router.spec.ts` → "Visibility filter" |
| `PUBLIC` topics appear for a zero-grant user | ✅ | `topics.router.spec.ts` + `d1-enrollment-repository.spec.ts` |
| `DRAFT` / `archived` never appear for anyone, incl. admins | ✅ | pre-existing draft/archived assertions + resolver `archived = 0` |
| Existing grants behave identically (cascade preserved) | ✅ | 4 pre-existing cascade tests unchanged + green |
| Resolver p95 `< 50 ms` on 1,000-topic fixture | ✅ | `d1-enrollment-repository.spec.ts` benchmark (~17 ms/call observed) |
| `PUBLIC` topic commentable by any authenticated user; lacked `RESTRICTED` rejects comments | ✅ | `comments.spec.ts` → "public topic visibility — unenrolled access" + existing 403 case |
| All new admin strings in both `dict-pt.ts` and `dict-en.ts`; `check-i18n-coverage.js` passes | ✅ | i18n coverage gate green |

## 3. Test summary

Verified via **targeted specs** (the full `make test-api` is unstable on the WSL2 host —
see §5). Aggregate of the milestone-relevant suites on the candidate branch:

- **Backend — 114 tests green** across 7 specs: `topics.router`, `d1-enrollment-repository`
  (incl. benchmark), `d1-topic-node-repository`, `topics.controller`,
  `admin-topics.controller`, `comments`, `admin-groups.router`.
- **Web — 23 tests green** across 4 specs: `admin-topics-api`, `admin-groups-api`,
  `i18n-plumbing`, `users` (list). `check-i18n-coverage.js` passes (zero hardcoded strings).
- New/changed files lint clean (scoped). Shared package builds.

## 4. Notable decisions & deviations

1. **Scope expansion — `GET /admin/groups` (approved by product).** The Access page's
   Group principal dimension required enumerating groups, but no group-list endpoint
   existed (the groups admin page was a "coming soon" stub). Added a minimal
   `IUserGroupRepository` + `D1UserGroupRepository` + `AdminGroupsController` +
   `GET /admin/groups` route (list only — no group CRUD). This is the milestone's only
   departure from the visibility-only backend scope.
2. **"Reuse the catalog tree component" → catalog-consistent tree ordering.** The Access
   page renders the grant picker in hierarchical (parent→child, depth-indented) order
   derived from `parentId`, rather than mounting the participant `TopicTreeNode`
   (which is coupled to catalog routing/state). Same structure participants browse,
   without the coupling.
3. **`enrollment.*` dict keys retained.** The retired `EnrollmentsTab` component was
   deleted, but its `enrollment.*` dictionary keys are now **reused** by the Access page,
   so they were kept; only the truly-orphaned `admin.users.tabEnrollments`/`tabProfile`
   were removed.
4. **Web `TopicNode.visibility` is optional** (`visibility?`) to avoid breaking
   pre-existing test fixtures; the editor defaults absent values to `restricted`. The
   shared backend `TopicNodeRecord.visibility` is required, per the RFC.

## 5. Environmental caveats (pre-existing, not introduced by this milestone)

- **`make lint` (repo-wide) is red on `apps/api/scripts/generate-bruno.ts`** — 14
  pre-existing `no-explicit-any` errors in an out-of-scope file (red on the clean base).
  Per the scope guardrail it was not bundled. All milestone-changed files lint clean.
- **Full `make test-api` is unstable on this WSL2 host** — the
  `@cloudflare/vitest-pool-workers` RPC times out (`Timeout calling "onTaskUpdate"`) when
  all 62 specs run in parallel, producing phantom failures. Verification was done via
  targeted spec batches throughout.
- **Strict `tsc --noEmit` is pre-red on both `apps/api` and `apps/web`** (Hono/OpenAPI
  handler-type friction; a pre-existing `User.timezone`/`updatedAt` drift on the API side;
  6 pre-existing `TopicNode` fixture errors on the web side). The project gates on
  lint + vitest + esbuild build, not strict tsc. The milestone added **zero** new tsc errors.

## 6. Remaining manual step

Live **staging visual QA** (deploy to staging, click through the admin visibility
selector and the Access page in a browser) was **not** executed in this headless run —
no deploy/browser access. The automated suite encodes every Success Criterion; the
staging walk-through in the task Verification Plan remains a manual follow-up before
promoting beyond candidate.

## 7. Deferred (unchanged from RFC 0005 — explicitly out of scope)

Negative grants ("denies"), time-bounded access (`grantedUntil`), per-media exclusions,
per-creator content scoping, and `PUBLIC` comment rate-limiting/moderation remain
backlog. Group CRUD / membership management beyond the new list endpoint is also still open.

## 8. Artifacts

- Per-task plans, child prompts, and logs: `./.executor-logs/`.
- Migration: `apps/api/migrations/0025_add_topic_visibility.sql`.
- New endpoint: `GET /admin/groups`.
- New page: `apps/web/src/app/(protected)/admin/access/page.tsx`.
