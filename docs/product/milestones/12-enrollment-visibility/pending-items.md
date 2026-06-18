# Milestone 12 / RFC 0005 — Pending Items & Inconsistencies

**RFC:** [0005 — Enrollment enforcement and node visibility](../../RFCs/0005-enrollment-exclusions-and-visibility.md)
**Branch under review:** `candidate/m12-enrollment-visibility`
**Date:** 2026-06-17
**Status of this doc:** Resolved (2026-06-17) — all items closed; see Resolution section.

> **Context.** A re-analysis of the branch against RFC 0005 was triggered after the
> closeout marked all 8 tasks ✅ and flipped the RFC to **Implemented**. The
> *code* for Phases 0–3 is largely present (backend resolver, migration file,
> admin PATCH, visibility selector, unified Access page, detail-page deep-links).
> However, several items prevent the feature from working end-to-end, and a few
> RFC requirements were only partially met. They are listed below by severity.

---

## Summary table

| # | Severity | Item | Status |
|---|----------|------|--------|
| 1 | 🟠 Functional | No navigation entry to reach `/admin/access` | ✅ Resolved |
| 2 | 🟠 Functional | No group create/CRUD → group grants are unusable end-to-end | ✅ Resolved (CRUD built) |
| 3 | 🟡 Inconsistency | Stale "Enrollments" action on the **users list** page | ✅ Resolved |

---

## 1. 🟠 No navigation entry to reach `/admin/access`

**Evidence.** `apps/web/src/components/layout/admin-sidebar.tsx:39-44` lists only
Users / Topics / Tasks / Groups. The unified Access page
(`app/(protected)/admin/access/page.tsx`) is **only** reachable via the "Manage
access" deep-links on the user/group detail pages
(`users/[userId]/page.tsx:72`, `groups/[groupId]/page.tsx:55`).

**Why it matters.** RFC §6 describes a verb-first "manage access → pick whom"
flow on a standalone principal-centric page that *replaces* the old per-user /
per-group entry points. Without a top-level entry it is effectively
undiscoverable — matching the "there is no menu to manage permissions" report.

**Fix.** Add an "Access" item (gated to `ROLES.ADMIN`) to the admin sidebar
pointing at `/admin/access`, with `dict-en`/`dict-pt` keys.

---

## 2. 🟠 No group creation / CRUD — group grants unusable end-to-end

**Evidence.** `app/(protected)/admin/groups/page.tsx` is a "coming soon"
placeholder (its own comment notes "no group CRUD endpoints yet"). The backend
added only `GET /admin/groups` (list) in this milestone (closeout §4.1); there is
no create / edit / membership endpoint. `enrollments_user_group` has 0 rows
locally.

**Why it matters.** The Access page exposes a **Group** principal dimension and
the resolver honours group grants, but no group can be created and no member can
be added, so the entire group half of RFC §6 ("grants for users **and groups**")
cannot be exercised. Acknowledged as deferred in closeout §7 — but it leaves the
RFC's stated UI scope only half-functional and should be explicitly tracked, not
silently closed.

**Fix.** Either (a) build minimal group create + membership management, or
(b) explicitly descope the group dimension from RFC 0005's "done" definition and
hide/disable the Group toggle on the Access page until the follow-up ships.

---

## 3. 🟡 Stale "Enrollments" action on the users list page

**Evidence.** `app/(protected)/admin/users/page.tsx:367-372` renders a per-row
link labelled `d.actions.enrollments` ("Enrollments") that points to the user
detail page. Task 07 migrated the **detail** page to a deep-link but left this
list-page action with its pre-RFC "Enrollments" label.

**Why it matters.** It reads as a leftover access-control entry point on
`/admin/users` (matching the "there's still an access controller on admin/users"
report) and is inconsistent with the new "Manage access" vocabulary.

**Fix.** Relabel to a neutral "View" / "Details", or repoint/duplicate as a
"Manage access" deep-link; retire the now-misleading `actions.enrollments` key if
unused elsewhere.

---

## Recommendation on RFC status

**Updated recommendation (after migration fix):**

RFC 0005 may be promoted to **Implemented** pending the following:

**Critical (unblock by fixing):**
- #1 — Add `/admin/access` to sidebar (1-line change + i18n keys)
- #2 — Relabel users-list "Enrollments" action or repurpose as deep-link

**Important (accept but track):**
- #3 — No group create/CRUD; must either be built or Group toggle disabled in Access page

---

## Resolution (2026-06-17)

All three items were resolved on `candidate/m12-enrollment-visibility`:

- **#1 — Sidebar entry.** Added an ADMIN-gated **Access** item pointing at `/admin/access`
  in `admin-sidebar.tsx`, with `layout.adminSidebar.access` keys in `dict-en`/`dict-pt`.
- **#3 — Stale users-list action.** Relabelled the per-row link from "Enrollments" to a
  neutral **Details**; renamed the i18n key `actions.enrollments` → `actions.details`
  (no other references).
- **#2 — Group CRUD (built, per product decision).** The `user_groups` /
  `user_group_members` schema already existed (migration 0011); no new migration was
  needed. Added:
  - **Backend** — `IUserGroupRepository` + `D1UserGroupRepository` gained
    `getById`, `findByName`, `create`, `listMembers`, `addMember` (idempotent),
    `removeMember`. `AdminGroupsController` gained `createGroup` (409 on duplicate name),
    `listMembers`, `addMember` (404 on missing group/user), `removeMember`. New routes:
    `POST /admin/groups`, `GET|POST /admin/groups/:groupId/members`,
    `DELETE /admin/groups/:groupId/members/:userId`. 10 new router tests.
  - **Frontend** — `admin-groups-api` client gained `create` / `listMembers` /
    `addMember` / `removeMember`. The groups list page now offers create + list with
    "Manage members" / "Manage access" deep-links; the group detail page is a full
    membership manager (search-to-add, remove). New `admin.groups.*` i18n keys.

**Verification:** `make test-api` (651 + new) and `make test-web` (183, incl. i18n
coverage) green. Lint clean on all touched files (pre-existing `scripts/generate-bruno.ts`
`no-explicit-any` errors are unrelated to this work).

