# Task 10 — Frontend: the admin nav links are declared twice, and the two lists drift

**Status:** 📝 Open
**Team:** Frontend Web
**Found in:** Milestone 20 follow-up, 2026-09-23

## Summary

The admin navigation exists as **two independent arrays**:

- `apps/web/src/components/layout/admin-sidebar.tsx` — the desktop sidebar, entries carrying
  `requiredRoles`;
- `apps/web/src/components/layout/nav.tsx` — a second `adminLinks` array for the mobile
  drawer, entries carrying `roles`.

They list the same destinations, with different field names, and nothing keeps them in
sync.

They have already drifted once. Milestone 20 added `/admin/events` to the desktop sidebar
and not to the drawer, so the events backoffice was reachable on desktop and invisible on
mobile. Nobody noticed until someone went looking for the link, because **no test compares
the two lists** and each one renders correctly in isolation.

## Why it is worth fixing

The failure is silent and role-shaped: a `content_creator` on a phone simply has no way to
reach a surface they are entitled to, and the UI gives no hint that anything is missing.
Every future admin area inherits the same trap — the next one added to one list and not the
other fails the same way.

## Scope

In:
- One declaration of the admin destinations, with one field name for roles, consumed by
  both the desktop sidebar and the mobile drawer.
- A test asserting both surfaces render the same destination set for a given role — so a
  future entry added once cannot half-ship.

Out:
- Changing which roles may see which area, or the visual design of either surface. This is
  a de-duplication, not a redesign.

## Acceptance Criteria

- [ ] Admin destinations and their roles are declared **once**.
- [ ] Desktop and mobile render the same set for `admin`, for `content_creator`, and for a
      student (empty), asserted by a test that compares the two.
- [ ] No behaviour or styling change on either surface.
- [ ] `make test-web` and `make lint` green.
